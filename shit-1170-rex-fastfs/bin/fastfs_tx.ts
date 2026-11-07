#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  api_transactions,
  fastfs_file_uri_fun,
  parse_transaction,
} from "@sleet-js/fastnear-explorer-api-client";

import {
  SHIT_1170_FASTFS_CHUNK_SIZE,
  SHIT_1170_FASTFS_MAX_FULL_SIZE,
  SHIT_1170_FASTFS_MAX_MIME_LENGTH,
  SHIT_1170_FASTFS_MAX_NONCE,
  SHIT_1170_FASTFS_MAX_PATH_LENGTH,
} from "../src/index";

// read a FastFS upload OFF A TRANSACTION.
//
// --- WHY THIS BIN EXISTS ---
// the upload bins work on a file ON DISK. this one works on a
// TRANSACTION ON CHAIN. an agent that gets a tx hash — from the engine
// after a human signed, or read off the chain any other way — needs to
// know what the transaction actually put up: the path, the mime, the
// size, whether it was a delete, and where the file is served from.
//
// --- WHY THE EXPLORER CLIENT DOES THE READING ---
// the FastFS payload is RAW BORSH BYTES, and the receiver is ANY
// account, so the METHOD NAME is the only thing that says a call is a
// FastFS upload. finding it, base64-decoding its args and reading the
// borsh back is exactly what the explorer's parser does, and it does it
// WITHOUT throwing: a payload that is not FastFS borsh decodes to null
// rather than raising. a transaction that holds no FastFS upload is a
// normal answer here, not a crash.
//
// --- WHY THE CONTENT IS NOT PRINTED ---
// a 121 KB png is 162 KB of base64 on stdout. stdout is json that an
// agent READS, and a payload that big buries the facts the agent came
// for. so the CONTENT is left out and its LENGTH is reported. a
// `--with-content` flag asks for the bytes explicitly.
//
// --- WHY THE RECEIPT IS NOT THE ANSWER ---
// a FastFS upload's receipt FAILS by design — the receiver has no
// contract. so this bin reports the file's facts and the serving URL,
// and it says plainly that the failed receipt means nothing.

const SHIT_1170_FASTFS_TX_MAX_HASHES = 20;

interface SHIT_1170_FASTFS_TX_UPLOAD {
  kind: "simple" | "partial";
  relativePath: string;
  mimeType: string;
  size: number;
  totalSize: number;
  offset: number;
  nonce: number;
  isDelete: boolean;
  contentLength: number;
  url: string;
  uri: string;
  problems: string[];
}

/**
 * the indexer's own rules, checked against the decoded upload.
 *
 * --- WHY THE LIMITS ARE NAMED AND NOT COUNTED: a number of errors
 * tells the reader nothing. "the path is 1200 characters" says which
 * rule broke and by how much.
 */
function problems_of_fun(upload: {
  kind: "simple" | "partial";
  relativePath: string;
  mimeType: string;
  totalSize: number;
  offset: number;
  nonce: number;
  isDelete: boolean;
}): string[] {
  const problems: string[] = [];

  if (upload.relativePath.length > SHIT_1170_FASTFS_MAX_PATH_LENGTH) {
    problems.push(
      `the relative path is ${upload.relativePath.length} characters, over the ${SHIT_1170_FASTFS_MAX_PATH_LENGTH} limit`,
    );
  }

  // a delete carries no mime, and it is never refused for one.
  if (!upload.isDelete) {
    if (upload.mimeType.length === 0) {
      problems.push("the mime type is empty");
    } else if (upload.mimeType.length > SHIT_1170_FASTFS_MAX_MIME_LENGTH) {
      problems.push(
        `the mime type is ${upload.mimeType.length} characters, over the ${SHIT_1170_FASTFS_MAX_MIME_LENGTH} limit`,
      );
    }
  }

  if (upload.kind === "partial") {
    if (upload.totalSize > SHIT_1170_FASTFS_MAX_FULL_SIZE) {
      problems.push(
        `the whole file is ${upload.totalSize} bytes, over the ${SHIT_1170_FASTFS_MAX_FULL_SIZE} limit`,
      );
    }
    if (upload.offset % SHIT_1170_FASTFS_CHUNK_SIZE !== 0) {
      problems.push(
        `the offset ${upload.offset} is not a multiple of 1 MiB (${SHIT_1170_FASTFS_CHUNK_SIZE})`,
      );
    }
    if (upload.nonce < 1 || upload.nonce > SHIT_1170_FASTFS_MAX_NONCE) {
      problems.push(
        `the nonce ${upload.nonce} is outside 1..=${SHIT_1170_FASTFS_MAX_NONCE}`,
      );
    }
  }

  return problems;
}

/**
 * one upload, read out of a parsed transaction.
 *
 * --- WHY THE URL IS BUILT HERE AND NOT TAKEN FROM THE PARSER: the
 * parser builds it from the SIGNER and the receiver, which is right.
 * this bin builds it again from the same two facts so that the `uri`
 * form sits next to it — the parser gives the http url only.
 */
function upload_of_fun(
  action: {
    fastfs?: {
      kind: "simple" | "partial";
      relative_path: string;
      mime_type: string;
      size: number;
      total_size: number;
      offset: number;
      nonce: number;
      is_delete: boolean;
      content: Uint8Array;
    } | undefined;
  },
  signerId: string,
  receiverId: string,
): SHIT_1170_FASTFS_TX_UPLOAD | null {
  const info = action.fastfs;
  if (info === undefined) return null;

  const upload = {
    kind: info.kind,
    relativePath: info.relative_path,
    mimeType: info.mime_type,
    size: info.size,
    totalSize: info.total_size,
    offset: info.offset,
    nonce: info.nonce,
    isDelete: info.is_delete,
    contentLength: info.content.length,
  };

  return {
    ...upload,
    url: `https://${signerId}.fastfs.io/${receiverId}/${info.relative_path}`,
    uri: fastfs_file_uri_fun(signerId, receiverId, info.relative_path),
    problems: problems_of_fun(upload),
  };
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "with-content"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "fastfs_tx --tx-hash <hash> [--network mainnet|testnet] [--with-content]",
        "fastfs_tx <hash> [<hash> ...] [--network mainnet|testnet] [--with-content]",
      ],
    });
    return;
  }

  // a hash per --tx-hash flag, or a bare list of hashes. the arg
  // parser's map holds ONE value per flag, so a repeated --tx-hash is
  // the last one — the bare list is the way to ask for many.
  const hashes: string[] = [];
  const flagHash = args_string_fun(args, "tx-hash");
  if (flagHash !== undefined && flagHash.trim().length > 0) {
    hashes.push(flagHash.trim());
  }
  for (const positional of args.positional) {
    if (positional === "help") continue;
    const trimmed = positional.trim();
    if (trimmed.length > 0) hashes.push(trimmed);
  }

  if (hashes.length === 0) {
    throw new Error("--tx-hash <hash> is required");
  }
  if (hashes.length > SHIT_1170_FASTFS_TX_MAX_HASHES) {
    throw new Error(
      `at most ${SHIT_1170_FASTFS_TX_MAX_HASHES} hashes per call, got ${hashes.length}`,
    );
  }

  const network = args_string_fun(args, "network") ?? "mainnet";
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error(`--network must be mainnet or testnet, got "${network}"`);
  }

  const withContent = args_bool_fun(args, "with-content");

  const answer = await api_transactions({
    tx_hashes: hashes,
    config: { network },
    quiet: true,
  });

  const results: Array<Record<string, unknown>> = [];
  const found = new Set<string>();

  for (const detail of answer.transactions) {
    const raw = detail.transaction;
    const parsed = parse_transaction(detail);

    const uploads: SHIT_1170_FASTFS_TX_UPLOAD[] = [];
    for (const action of parsed.actions) {
      const upload = upload_of_fun(action, raw.signer_id, raw.receiver_id);
      if (upload === null) continue;
      uploads.push(upload);
    }

    found.add(raw.hash);

    const result: Record<string, unknown> = {
      txHash: raw.hash,
      signer: raw.signer_id,
      receiver: raw.receiver_id,
      // the receipt fails by design for a FastFS upload. it says
      // nothing about the file.
      isFastfs: uploads.length > 0,
      uploads,
      note:
        uploads.length > 0
          ? "a FastFS upload's receipt fails with CodeDoesNotExist by design. the file's facts are above, and the serving URL is the thing to verify."
          : "this transaction carries no FastFS upload.",
    };

    // the content, only when it was asked for. it is big.
    if (withContent) {
      const contents = uploads.map((upload) => {
        const action = parsed.actions.find((a) => a.fastfs !== undefined);
        const bytes = action?.fastfs?.content ?? new Uint8Array(0);
        return Buffer.from(bytes).toString("base64");
      });
      result.contentBase64 = contents;
    }

    results.push(result);
  }

  // a hash the api did not answer with. the api answers with fewer
  // transactions than asked for, so this is a normal answer.
  const missing = hashes.filter((hash) => !found.has(hash));

  print_json_fun({
    ok: missing.length === 0 && results.length > 0,
    action: "fastfs_tx",
    network,
    asked: hashes.length,
    found: found.size,
    missing,
    results,
    note:
      missing.length > 0
        ? "some hashes were not answered with. the hash may be wrong, or the transaction may not be indexed yet."
        : "the receipt of a FastFS upload fails by design. the serving URL is the thing to verify.",
  });

  if (missing.length > 0) process.exitCode = 1;
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
