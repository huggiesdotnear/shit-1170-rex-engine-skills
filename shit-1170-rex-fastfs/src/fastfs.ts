// FastFS: the borsh wire format for a file upload, and the queue
// payloads an agent hands to a human to sign.
//
// --- WHAT FASTFS IS ---
// FastFS is FastData's file standard. a file is uploaded by a NEAR
// transaction whose single FunctionCall action carries the file's
// BYTES inside a borsh payload, sent to the method `__fastdata_fastfs`.
//
// the receiver is ANY account. `fastfs.near` is the convention and the
// namespace everyone uses. there is NO contract on it, and none is
// needed. the receiver is a NAME, not a program.
//
// --- THE RECEIPT FAILS, AND THAT IS CORRECT ---
// the receiver has no contract, so the call cannot succeed. the real
// mainnet upload (5vUqtNhYchWyrifviVZ9F6k4QprgfW9fjSAtcGMdQyRw) has a
// receipt that FAILED with
// `CompilationError(CodeDoesNotExist { account_id: "fastfs.near" })`.
// that is the expected shape of a FastFS upload.
//
// the FastData indexer does not look at receipt status. it reads the
// TRANSACTION and indexes the bytes from the action's args. so a
// human who signs a FastFS upload will see a failed receipt, and the
// file will still be there.
//
// --- WHY THE ARGS ARE RAW BORSH BYTES ---
// the HackMD doc says "base64". that is only the JSON-RPC PRESENTATION
// of the bytes. the indexer does `borsh::from_slice(&action.args)` on
// the RAW bytes straight out of the action. base64-encoding the bytes
// and sending that as the arg would decode to the base64 TEXT, which
// is not borsh, and the indexer would drop the action silently.
//
// the queue payload carries the bytes as `argsBase64` — base64 is how
// JSON carries binary safely, and the engine decodes it back to raw
// bytes before it becomes the action's args.
//
// --- WHY THE BORSH ENCODING IS HAND-ROLLED ---
// the schema is small, fixed, and fully known: one enum with two
// variants, four primitive types, and no maps. a borsh dependency
// would be a package, a version, and a type-definition language to
// learn, in exchange for encoding four shapes. a hand-rolled encoder
// is 60 lines, has no dependencies, and can be AUDITED line by line —
// which matters, because the wrong byte here is a file that is
// silently dropped by the indexer with no error anywhere.
//
// the decoder exists for the same reason: encode then decode must
// round-trip, and the round-trip is checked against a real mainnet
// transaction (see the eval and `bin/fastfs_check.ts`).

// the method every FastFS upload uses.
export const SHIT_1170_FASTFS_METHOD = "__fastdata_fastfs";

// the conventional receiver. it is a NAME — there is no contract on
// it, and it does not need code.
export const SHIT_1170_FASTFS_DEFAULT_RECEIVER = "fastfs.near";

// the gas and the deposit the reference client sends.
//
// gas `1` is the minimum. the call does no work, so the gas is only
// there to satisfy the chain's own minimum. the HackMD doc's "300
// Tgas" is NOT what the reference client sends, and the real mainnet
// transaction used gas 1.
//
// the deposit is `0`: nothing is paid, because nothing is executed.
export const SHIT_1170_FASTFS_DEFAULT_GAS = "1";
export const SHIT_1170_FASTFS_DEFAULT_DEPOSIT = "0";

// --- THE INDEXER'S LIMITS ---
//
// these come from the indexer's own `is_valid()` on the two variants.
// what fails them is DROPPED SILENTLY — there is no error, no failed
// receipt, nothing. so the skill checks every one of them BEFORE the
// payload is queued.
export const SHIT_1170_FASTFS_MAX_PATH_LENGTH = 1024;
export const SHIT_1170_FASTFS_MAX_MIME_LENGTH = 256;

// the chunk alignment: 1 MiB.
export const SHIT_1170_FASTFS_CHUNK_SIZE = 1048576;

// the largest file the indexer will hold: 32 MiB.
export const SHIT_1170_FASTFS_MAX_FULL_SIZE = 33554432;

// the nonce's ceiling. the indexer compares against `i32::MAX`.
export const SHIT_1170_FASTFS_MAX_NONCE = 2147483647;

// the enum's variant indexes. borsh writes the variant index as one
// byte before the variant's fields.
export const SHIT_1170_FASTFS_VARIANT_SIMPLE = 0;
export const SHIT_1170_FASTFS_VARIANT_PARTIAL = 1;

// --- THE QUEUE PAYLOAD ---
//
// the engine's tx-queue accepts a call whose args are either a JSON
// object (`args`) or raw bytes (`argsBase64`). exactly one of the two
// is set.
//
// --- WHY THIS SHAPE IS BUILT HERE AND NOT BY `queue_call_fun` ---
// the middleman's `queue_call_fun` takes `args` as a plain object and
// has no `args_base64` support. a FastFS call has NO argument object
// at all — its args are bytes. so this builder emits the QUEUE_CALL
// shape directly and mirrors the middleman's own validation rules
// (a non-empty contract id, a non-empty method, a gas and a deposit
// that are raw digit strings) so a payload that the engine would
// refuse is refused here instead, where the mistake is still visible.
//
// the validation the middleman does NOT do — the path length, the
// mime length, the chunk alignment, the file size, the nonce — is
// the indexer's, and it drops those silently. that is why those
// checks live here too.

export interface SHIT_1170_FASTFS_QUEUE_CALL {
  contractId: string;
  method: string;
  argsBase64: string;
  gas: string;
  deposit: string;
}

// the two decoded shapes, as the indexer sees them.
export interface SHIT_1170_FASTFS_SIMPLE_CONTENT {
  mimeType: string;
  content: Uint8Array;
}

export interface SHIT_1170_FASTFS_SIMPLE {
  kind: "simple";
  relativePath: string;
  content: SHIT_1170_FASTFS_SIMPLE_CONTENT | null;
}

export interface SHIT_1170_FASTFS_PARTIAL {
  kind: "partial";
  relativePath: string;
  offset: number;
  fullSize: number;
  mimeType: string;
  contentChunk: Uint8Array;
  nonce: number;
}

export type SHIT_1170_FASTFS_DATA =
  | SHIT_1170_FASTFS_SIMPLE
  | SHIT_1170_FASTFS_PARTIAL;

// ========================================
// THE BORSH PRIMITIVES
// ========================================

// every integer borsh writes is LITTLE-ENDIAN, and every length
// prefix is a u32.
function shit_1170_fastfs_u32_fun(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`u32 out of range: ${value}`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

// a String: u32 length prefix, then the UTF-8 bytes.
function shit_1170_fastfs_string_fun(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + bytes.length);
  out.set(shit_1170_fastfs_u32_fun(bytes.length), 0);
  out.set(bytes, 4);
  return out;
}

// a Vec<u8>: u32 length prefix, then the bytes.
function shit_1170_fastfs_vec_u8_fun(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  out.set(shit_1170_fastfs_u32_fun(value.length), 0);
  out.set(value, 4);
  return out;
}

// an Option<T>: one byte — 0 for None, 1 for Some — then the value
// when it is Some.
function shit_1170_fastfs_option_fun(
  present: boolean,
  value: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(1 + value.length);
  out[0] = present ? 1 : 0;
  out.set(value, 1);
  return out;
}

function shit_1170_fastfs_concat_fun(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ========================================
// THE ENCODERS
// ========================================

/**
 * the `Simple` payload: one whole file, in one transaction.
 *
 * `bytes` is `null` for a DELETE — the indexer reads a `None` content
 * as "remove this path".
 */
export function shit_1170_fastfs_simple_bytes_fun(
  relative_path: string,
  mime_type: string,
  bytes: Uint8Array | null,
): Uint8Array {
  const content =
    bytes === null
      ? shit_1170_fastfs_option_fun(false, new Uint8Array(0))
      : shit_1170_fastfs_option_fun(
          true,
          shit_1170_fastfs_concat_fun([
            shit_1170_fastfs_string_fun(mime_type),
            shit_1170_fastfs_vec_u8_fun(bytes),
          ]),
        );

  return shit_1170_fastfs_concat_fun([
    new Uint8Array([SHIT_1170_FASTFS_VARIANT_SIMPLE]),
    shit_1170_fastfs_string_fun(relative_path),
    content,
  ]);
}

/**
 * the `Partial` payload: one 1 MiB chunk of a bigger file.
 *
 * every chunk of one upload carries the SAME `full_size` and the SAME
 * `nonce`. the nonce is what tells the indexer that two chunks belong
 * together — a fresh nonce at the same path is a DIFFERENT upload.
 */
export function shit_1170_fastfs_partial_bytes_fun(
  relative_path: string,
  offset: number,
  full_size: number,
  mime_type: string,
  content_chunk: Uint8Array,
  nonce: number,
): Uint8Array {
  return shit_1170_fastfs_concat_fun([
    new Uint8Array([SHIT_1170_FASTFS_VARIANT_PARTIAL]),
    shit_1170_fastfs_string_fun(relative_path),
    shit_1170_fastfs_u32_fun(offset),
    shit_1170_fastfs_u32_fun(full_size),
    shit_1170_fastfs_string_fun(mime_type),
    shit_1170_fastfs_vec_u8_fun(content_chunk),
    shit_1170_fastfs_u32_fun(nonce),
  ]);
}

// ========================================
// THE DECODER
// ========================================
//
// it reads the bytes back, so the encoder can be PROVEN rather than
// asserted: encode, then decode, then compare. it is also how the
// real mainnet transaction's args are read back.

function shit_1170_fastfs_reader_fun(bytes: Uint8Array) {
  let offset = 0;
  const u8 = (): number => {
    if (offset + 1 > bytes.length) {
      throw new Error("unexpected end of bytes reading u8");
    }
    const value = bytes[offset] ?? 0;
    offset += 1;
    return value;
  };
  const u32 = (): number => {
    if (offset + 4 > bytes.length) {
      throw new Error("unexpected end of bytes reading u32");
    }
    const value = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0, true);
    offset += 4;
    return value;
  };
  const string = (): string => {
    const length = u32();
    if (offset + length > bytes.length) {
      throw new Error("unexpected end of bytes reading string");
    }
    const value = new TextDecoder().decode(
      bytes.subarray(offset, offset + length),
    );
    offset += length;
    return value;
  };
  const vecU8 = (): Uint8Array => {
    const length = u32();
    if (offset + length > bytes.length) {
      throw new Error("unexpected end of bytes reading vec<u8>");
    }
    const value = bytes.slice(offset, offset + length);
    offset += length;
    return value;
  };
  return { u8, u32, string, vecU8, get offset() { return offset; } };
}

/**
 * read a FastFS payload back.
 *
 * the round-trip is the point: whatever the encoder wrote, this reads
 * back to the same shape. a mismatch here is a bug in the encoder.
 */
export function shit_1170_fastfs_decode_fun(
  bytes: Uint8Array,
): SHIT_1170_FASTFS_DATA {
  const reader = shit_1170_fastfs_reader_fun(bytes);
  const variant = reader.u8();

  if (variant === SHIT_1170_FASTFS_VARIANT_SIMPLE) {
    const relativePath = reader.string();
    const hasContent = reader.u8() === 1;
    if (!hasContent) {
      return { kind: "simple", relativePath, content: null };
    }
    const mimeType = reader.string();
    const content = reader.vecU8();
    return { kind: "simple", relativePath, content: { mimeType, content } };
  }

  if (variant === SHIT_1170_FASTFS_VARIANT_PARTIAL) {
    const relativePath = reader.string();
    const offset = reader.u32();
    const fullSize = reader.u32();
    const mimeType = reader.string();
    const contentChunk = reader.vecU8();
    const nonce = reader.u32();
    return {
      kind: "partial",
      relativePath,
      offset,
      fullSize,
      mimeType,
      contentChunk,
      nonce,
    };
  }

  throw new Error(`unknown FastFS variant index: ${variant}`);
}

// ========================================
// THE VALIDATION
// ========================================
//
// these mirror the indexer's own `is_valid()`. what fails them is
// dropped SILENTLY by the indexer, so they are checked here — where
// the human can still be told which limit was broken.

export interface SHIT_1170_FASTFS_VALIDATION {
  ok: boolean;
  errors: string[];
}

/**
 * check one `Simple` payload against the indexer's rules.
 *
 * note the mime check: the indexer only checks the mime type when
 * there IS content. a delete carries no content and no mime, so it is
 * never refused for an empty mime.
 */
export function shit_1170_fastfs_validate_simple_fun(
  relative_path: string,
  mime_type: string,
  has_content: boolean,
): SHIT_1170_FASTFS_VALIDATION {
  const errors: string[] = [];

  if (relative_path.length === 0) {
    errors.push("the relative path is empty");
  }
  if (relative_path.length > SHIT_1170_FASTFS_MAX_PATH_LENGTH) {
    errors.push(
      `the relative path is ${relative_path.length} characters; the indexer drops anything over ${SHIT_1170_FASTFS_MAX_PATH_LENGTH}`,
    );
  }
  if (has_content) {
    if (mime_type.length === 0) {
      errors.push("the mime type is empty; the indexer drops a file with no mime type");
    }
    if (mime_type.length > SHIT_1170_FASTFS_MAX_MIME_LENGTH) {
      errors.push(
        `the mime type is ${mime_type.length} characters; the indexer drops anything over ${SHIT_1170_FASTFS_MAX_MIME_LENGTH}`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * check one `Partial` payload against the indexer's rules.
 */
export function shit_1170_fastfs_validate_partial_fun(
  relative_path: string,
  offset: number,
  full_size: number,
  mime_type: string,
  chunk_length: number,
  nonce: number,
): SHIT_1170_FASTFS_VALIDATION {
  const errors: string[] = [];

  if (relative_path.length === 0) {
    errors.push("the relative path is empty");
  }
  if (relative_path.length > SHIT_1170_FASTFS_MAX_PATH_LENGTH) {
    errors.push(
      `the relative path is ${relative_path.length} characters; the indexer drops anything over ${SHIT_1170_FASTFS_MAX_PATH_LENGTH}`,
    );
  }
  if (offset % SHIT_1170_FASTFS_CHUNK_SIZE !== 0) {
    errors.push(
      `the offset ${offset} is not a multiple of ${SHIT_1170_FASTFS_CHUNK_SIZE} (1 MiB); the indexer drops the chunk`,
    );
  }
  if (offset >= SHIT_1170_FASTFS_MAX_FULL_SIZE) {
    errors.push(
      `the offset ${offset} is not under ${SHIT_1170_FASTFS_MAX_FULL_SIZE} (32 MiB); the indexer drops the chunk`,
    );
  }
  if (full_size === 0 || full_size > SHIT_1170_FASTFS_MAX_FULL_SIZE) {
    errors.push(
      `the full size ${full_size} is outside 1..=${SHIT_1170_FASTFS_MAX_FULL_SIZE} (32 MiB); the indexer drops the chunk`,
    );
  }
  if (mime_type.length === 0) {
    errors.push("the mime type is empty; the indexer drops a chunk with no mime type");
  }
  if (mime_type.length > SHIT_1170_FASTFS_MAX_MIME_LENGTH) {
    errors.push(
      `the mime type is ${mime_type.length} characters; the indexer drops anything over ${SHIT_1170_FASTFS_MAX_MIME_LENGTH}`,
    );
  }
  if (chunk_length > SHIT_1170_FASTFS_CHUNK_SIZE) {
    errors.push(
      `the chunk is ${chunk_length} bytes; the indexer drops anything over ${SHIT_1170_FASTFS_CHUNK_SIZE} (1 MiB)`,
    );
  }
  if (nonce === 0 || nonce > SHIT_1170_FASTFS_MAX_NONCE) {
    errors.push(
      `the nonce ${nonce} is outside 1..=${SHIT_1170_FASTFS_MAX_NONCE}; the indexer drops the chunk`,
    );
  }

  return { ok: errors.length === 0, errors };
}

// ========================================
// THE QUEUE PAYLOAD BUILDERS
// ========================================

function shit_1170_fastfs_raw_amount_fun(
  value: string,
  field: string,
): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${field} must be a raw digit string (gas units or yoctoNEAR), got "${value}"`,
    );
  }
  return trimmed;
}

/**
 * build the queue payload for one FastFS call.
 *
 * `args` stays a JSON object for the other skills; a FastFS call has
 * no argument object, so the bytes ride in `argsBase64` instead. the
 * engine decodes it back to raw bytes before it becomes the action's
 * args, which is what the indexer reads.
 */
export function shit_1170_fastfs_queue_call_fun(options: {
  receiver: string;
  bytes: Uint8Array;
  gas?: string;
  deposit?: string;
}): SHIT_1170_FASTFS_QUEUE_CALL {
  const receiver = options.receiver.trim();
  if (receiver.length === 0) {
    throw new Error("the receiver is required");
  }

  return {
    contractId: receiver,
    method: SHIT_1170_FASTFS_METHOD,
    argsBase64: Buffer.from(options.bytes).toString("base64"),
    gas: shit_1170_fastfs_raw_amount_fun(
      options.gas ?? SHIT_1170_FASTFS_DEFAULT_GAS,
      "gas",
    ),
    deposit: shit_1170_fastfs_raw_amount_fun(
      options.deposit ?? SHIT_1170_FASTFS_DEFAULT_DEPOSIT,
      "deposit",
    ),
  };
}

/**
 * a fresh nonce for one upload.
 *
 * --- WHY A FRESH NONCE MATTERS ---
// the nonce is what tells the indexer that two chunks belong together.
 * every chunk of ONE upload carries the SAME nonce, and a DIFFERENT
 * upload of the same path needs a DIFFERENT nonce — otherwise the
 * server serves the old file's chunks mixed with the new one's.
 *
 * the reference client's approach is the timestamp in milliseconds
// modulo 2^31, which lands inside the indexer's `1..=i32::MAX` range.
 * it is not a secret and does not need to be: the nonce only has to
// differ from the previous upload of the same path.
 */
export function shit_1170_fastfs_nonce_fun(now_millis?: number): number {
  const now = now_millis ?? Date.now();
  const nonce = now % 2147483648;
  return nonce === 0 ? 1 : nonce;
}

// ========================================
// THE FILE PLANN
// ========================================
//
// the shape of one upload, decided from the file's size: one `Simple`
// transaction, or one `Partial` transaction per 1 MiB chunk.

export interface SHIT_1170_FASTFS_PLAN {
  size: number;
  chunked: boolean;
  chunkCount: number;
  transactionCount: number;
  fullSize: number;
  nonce: number;
}

/**
 * decide how one file is uploaded.
 *
 * a file of 1 MiB or less is ONE `Simple` transaction — one call, one
 * signature, the cheapest path. a bigger file is split into 1 MiB
 * chunks, one `Partial` transaction each.
 */
export function shit_1170_fastfs_plan_fun(
  size: number,
  now_millis?: number,
): SHIT_1170_FASTFS_PLAN {
  const chunked = size > SHIT_1170_FASTFS_CHUNK_SIZE;
  const chunkCount = chunked
    ? Math.ceil(size / SHIT_1170_FASTFS_CHUNK_SIZE)
    : 1;
  return {
    size,
    chunked,
    chunkCount,
    transactionCount: chunkCount,
    fullSize: size,
    nonce: chunked ? shit_1170_fastfs_nonce_fun(now_millis) : 0,
  };
}

// ========================================
// THE SERVING URL
// ========================================

/**
 * the URL a FastFS file is served at.
 *
 * --- WHY THE PREDECESSOR AND NOT THE RECEIVER ---
// the host is the account that SIGNED the transaction — the receipt's
 * predecessor id — and the path holds the receiver. so the file lives
// under the uploader's namespace, and the receiver is the namespace
 * inside it. `mob.near` signed the real mainnet upload, and the file
// is at `https://mob.near.fastfs.io/fastfs.near/fastnear.png`.
 */
export function shit_1170_fastfs_url_fun(
  predecessor: string,
  receiver: string,
  relative_path: string,
): string {
  const host = predecessor.trim();
  const namespace = receiver.trim();
  const path = relative_path.replace(/^\/+/, "");
  if (host.length === 0) throw new Error("the predecessor is required");
  if (namespace.length === 0) throw new Error("the receiver is required");
  if (path.length === 0) throw new Error("the relative path is required");
  return `https://${host}.fastfs.io/${namespace}/${path}`;
}

/**
 * the `fastfs://` URI form.
 *
 * it is gateway-independent: the same URI names the file on any
 * FastFS gateway, which is why near.social media references use it
 * rather than an https URL.
 */
export function shit_1170_fastfs_uri_fun(
  predecessor: string,
  receiver: string,
  relative_path: string,
): string {
  const host = predecessor.trim();
  const namespace = receiver.trim();
  const path = relative_path.replace(/^\/+/, "");
  if (host.length === 0) throw new Error("the predecessor is required");
  if (namespace.length === 0) throw new Error("the receiver is required");
  if (path.length === 0) throw new Error("the relative path is required");
  return `fastfs://${host}/${namespace}/${path}`;
}

// ========================================
// THE MIME TABLE
// ========================================

// --- WHY THIS TABLE IS SMALL ---
// it is a convenience, not a database. it covers the types a FastFS
// upload actually uses — images, text, json, a couple of archives —
// and a caller can always pass `--mime` explicitly for anything else.
// guessing wrong is cheap to fix here and expensive to fix after the
// bytes are on chain, so the guess is only ever a default.
const SHIT_1170_FASTFS_MIME_TABLE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  csv: "text/csv",
  js: "text/javascript",
  json: "application/json",
  xml: "application/xml",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

/**
 * guess a mime type from a file name.
 *
 * `null` when the extension is not in the table. the caller then
 * passes `--mime` explicitly rather than the bin inventing a type.
 */
export function shit_1170_fastfs_mime_guess_fun(
  file_name: string,
): string | null {
  const dot = file_name.lastIndexOf(".");
  if (dot < 0 || dot === file_name.length - 1) return null;
  const extension = file_name.slice(dot + 1).toLowerCase();
  return SHIT_1170_FASTFS_MIME_TABLE[extension] ?? null;
}

// ========================================
// THE ENCODING OF A FILE
// ========================================

export interface SHIT_1170_FASTFS_UPLOAD {
  transaction: SHIT_1170_FASTFS_QUEUE_CALL;
  bytes: Uint8Array;
  relativePath: string;
  mimeType: string;
  offset: number;
  fullSize: number;
  nonce: number;
  isDelete: boolean;
}

/**
 * build the upload for one chunk of one file.
 *
 * `bytes` is the whole file for a `Simple` upload, and the chunk for
 * a `Partial` one.
 */
export function shit_1170_fastfs_upload_fun(options: {
  receiver: string;
  relative_path: string;
  mime_type: string;
  bytes: Uint8Array;
  offset?: number;
  full_size?: number;
  nonce?: number;
  gas?: string;
  deposit?: string;
}): SHIT_1170_FASTFS_UPLOAD {
  const offset = options.offset ?? 0;
  const fullSize = options.full_size ?? options.bytes.length;
  const nonce = options.nonce ?? 0;
  const isDelete = options.bytes.length === 0 && offset === 0 && fullSize === 0;

  const bytes = isDelete
    ? shit_1170_fastfs_simple_bytes_fun(options.relative_path, options.mime_type, null)
    : offset === 0 && fullSize <= SHIT_1170_FASTFS_CHUNK_SIZE
      ? shit_1170_fastfs_simple_bytes_fun(
          options.relative_path,
          options.mime_type,
          options.bytes,
        )
      : shit_1170_fastfs_partial_bytes_fun(
          options.relative_path,
          offset,
          fullSize,
          options.mime_type,
          options.bytes,
          nonce,
        );

  return {
    transaction: shit_1170_fastfs_queue_call_fun({
      receiver: options.receiver,
      bytes,
      gas: options.gas,
      deposit: options.deposit,
    }),
    bytes,
    relativePath: options.relative_path,
    mimeType: options.mime_type,
    offset,
    fullSize,
    nonce,
    isDelete,
  };
}

// ========================================
// THE STRINGIFIED-BYTES CHECK
// ========================================
//
// --- WHY THIS EXISTS ---
// the browser once passed a FastFS payload's bytes through
// `JSON.stringify`, so the action's args arrived on chain as the json
// text of a byte map — `{"0":0,"1":15,…}` — instead of borsh. the
// indexer read it, found no borsh, and DROPPED the action silently:
// the receipt failed the way a FastFS receipt always fails, and the
// file never appeared at its URL.
//
// nothing anywhere said why. this function is how an agent finds out:
// it reads the action's args back off the chain and says which of the
// two it is.

export interface SHIT_1170_FASTFS_ARGS_CHECK {
  /** `true` when the bytes are borsh — the upload can be indexed. */
  ok: boolean;
  /** what the bytes turned out to be. */
  kind: "borsh" | "jsonified" | "empty";
  /** the first bytes, in hex — `00 0f 00 00 00` for borsh. */
  headHex: string;
  /** the whole thing, in words. */
  message: string;
}

/**
 * look at the action's args and say whether they are borsh.
 *
 * `args_base64` is the action's args as base64, exactly as the chain
 * reports them.
 *
 * the two cases are told apart by the FIRST bytes:
 *
 * - borsh starts with the variant byte `0x00` for `Simple`, then a
 *   u32 length. `00 0f 00 00 00` is `Simple` with a 15-byte path.
 * - a stringified byte array starts with the ascii text `{"0":`,
 *   because that is what `JSON.stringify` of a `Uint8Array` gives.
 */
export function shit_1170_fastfs_check_args_fun(
  args_base64: string,
): SHIT_1170_FASTFS_ARGS_CHECK {
  const trimmed = args_base64.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      kind: "empty",
      headHex: "",
      message: "the action carries no args at all",
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(trimmed, "base64"));
  } catch {
    return {
      ok: false,
      kind: "jsonified",
      headHex: "",
      message: "the action's args are not base64",
    };
  }

  const head = bytes.subarray(0, 5);
  const headHex = shit_1170_fastfs_hex_fun(head);

  // the ascii text `{"0":` — what JSON.stringify of a byte array gives.
  const isJsonText =
    bytes.length >= 5 &&
    bytes[0] === 0x7b &&
    bytes[1] === 0x22 &&
    bytes[2] === 0x30 &&
    bytes[3] === 0x22 &&
    bytes[4] === 0x3a;

  if (isJsonText) {
    return {
      ok: false,
      kind: "jsonified",
      headHex,
      message:
        "the action's args are the JSON text of a byte map, not borsh — " +
        "the bytes were stringified on the way to the wallet, so the " +
        "indexer dropped the action and the file was never indexed",
    };
  }

  // borsh: the variant byte, then the fields.
  if (bytes[0] !== SHIT_1170_FASTFS_VARIANT_SIMPLE &&
      bytes[0] !== SHIT_1170_FASTFS_VARIANT_PARTIAL) {
    return {
      ok: false,
      kind: "jsonified",
      headHex,
      message:
        `the action's args do not start with a FastFS variant byte ` +
        `(0x00 for Simple, 0x01 for Partial); they start with 0x${bytes[0]
          .toString(16)
          .padStart(2, "0")}`,
    };
  }

  return {
    ok: true,
    kind: "borsh",
    headHex,
    message: "the action's args are borsh — the indexer can read them",
  };
}

// ========================================
// THE HEX DUMP
// ========================================
//
// for the small example in the README and for the eval. a hex dump
// of the first bytes is how a borsh payload is checked by eye.

export function shit_1170_fastfs_hex_fun(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

/**
 * a hex dump of the first `count` bytes, in rows of 16.
 */
export function shit_1170_fastfs_hex_dump_fun(
  bytes: Uint8Array,
  count = 48,
): string {
  const slice = bytes.subarray(0, count);
  const rows: string[] = [];
  for (let index = 0; index < slice.length; index += 16) {
    const row = Array.from(slice.subarray(index, index + 16))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    rows.push(`${index.toString(16).padStart(4, "0")}  ${row}`);
  }
  return rows.join("\n");
}
