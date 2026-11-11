// the social-kv/1 write standard, as the rex engine needs it: the
// key shapes, the value shapes, the limits, and the queue payloads an
// agent hands to a human to sign.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the write
// side of this skill is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// the write is a `__fastdata_kv` call on the `social` account. the
// args are a JSON OBJECT whose top-level keys are the KV keys, one
// write each. the receiver has no contract on it and needs none.
//
// --- WHY THE GAS IS 1 ---
// the standard fixes the gas: `1`. the call does no work, so the gas
// is only there to satisfy the chain's minimum, and a function-call
// access key is charged for the gas it attaches. attaching 30 Tgas
// to a write that does nothing costs real NEAR for no reason.
//
// --- WHAT A WRITE LOOKS LIKE ON CHAIN ---
// the receipt FAILS, with `CodeDoesNotExist`, because `social` has
// no contract. that is the expected shape of a successful social
// write. the FastData indexer does not read the receipt status — it
// reads the transaction's action args and indexes them. so a failed
// receipt is never a reason to retry, and never a reason to tell the
// human their post failed. the answer is the indexer: `GET
// /v1/tx/{tx_hash}`.
//
// the facts here come from the standard itself:
// <https://near.social/standard.md>

import {
  queue_call_fun,
  type QUEUE_CALL,
} from "@huggies/shit-1170-rex-engine-middleman";

export type { QUEUE_CALL };

// ------------------------------------------------------------
// THE RECEIVER AND THE METHOD
// ------------------------------------------------------------

// the account every social write goes to.
export const SHIT_1170_SOCIAL_RECEIVER = "social";

// the method a social write is made with.
export const SHIT_1170_SOCIAL_METHOD = "__fastdata_kv";

// the standard the writes follow.
export const SHIT_1170_SOCIAL_STANDARD = "social-kv/1";

// the gas the standard states: the minimum, because the call does no
// work.
export const SHIT_1170_SOCIAL_GAS = "1";

// the deposit the standard states: none.
export const SHIT_1170_SOCIAL_DEPOSIT = "0";

// ------------------------------------------------------------
// THE LIMITS
// ------------------------------------------------------------
//
// the FastData indexer enforces these, and **what fails them is
// DROPPED SILENTLY**. no error, no failed receipt, nothing. the post
// just never appears.
//
// so every limit is checked BEFORE the payload is queued, and a
// payload that breaks one is refused rather than queued.

export const SHIT_1170_SOCIAL_MAX_KEYS = 256;
export const SHIT_1170_SOCIAL_MAX_KEY_BYTES = 1024;
export const SHIT_1170_SOCIAL_MAX_VALUE_BYTES = 262144;
export const SHIT_1170_SOCIAL_MAX_TX_BYTES = 1572864;

export const SHIT_1170_SOCIAL_MAX_TEXT_LENGTH = 25000;
export const SHIT_1170_SOCIAL_MAX_ABOUT_LENGTH = 10000;
export const SHIT_1170_SOCIAL_MAX_NAME_LENGTH = 256;
export const SHIT_1170_SOCIAL_MAX_LOCATION_LENGTH = 256;
export const SHIT_1170_SOCIAL_MAX_LINK_LENGTH = 2048;
export const SHIT_1170_SOCIAL_MAX_LINKS = 32;
export const SHIT_1170_SOCIAL_MAX_MEDIA = 10;
export const SHIT_1170_SOCIAL_MAX_MEDIA_ALT_LENGTH = 5000;
export const SHIT_1170_SOCIAL_MAX_MEDIA_DIMENSION = 16384;

// the per-account, per-UTC-day limits the reference indexer applies.
// writes over a limit are recorded but not applied, and the indexer
// reports them as `rate_limited`.
export const SHIT_1170_SOCIAL_LIMITS_PER_DAY = {
  posts: 300,
  likes: 1000,
  reposts: 300,
  follows: 5000,
  bytes: 5 * 1024 * 1024,
} as const;

// the account id pattern the standard accepts. a key that embeds an
// invalid account id is ignored by the indexer.
const SHIT_1170_ACCOUNT_ID_PATTERN =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

// the post id pattern the standard accepts: a decimal integer with no
// leading zeros, up to 2^53 - 1.
const SHIT_1170_POST_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

// the media mime types v1 accepts.
export const SHIT_1170_SOCIAL_MEDIA_MIMES = [
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/avif",
] as const;

// the link service names the standard keeps.
export const SHIT_1170_SOCIAL_LINK_SERVICES = [
  "website",
  "x",
  "github",
  "telegram",
  "discord",
  "bluesky",
  "farcaster",
  "youtube",
  "instagram",
  "linkedin",
] as const;

// ------------------------------------------------------------
// THE VALIDATION
// ------------------------------------------------------------

export interface SHIT_1170_SOCIAL_PROBLEM {
  // which limit or rule the payload breaks.
  rule: string;
  // what the payload carries, in plain words.
  detail: string;
}

/**
 * how many characters a string has.
 *
 * --- WHY NOT `String.length` ---
 * the standard says a character is a UNICODE SCALAR VALUE — rust's
 * `chars().count()`, which is js's `[...s].length`. js's own
 * `String.length` counts UTF-16 CODE UNITS, so an emoji counts as
 * two, and a string of 12,500 emoji has a `.length` of 25,000 while
 * the standard counts 12,500 characters.
 *
 * so a limit checked with `.length` refuses a post that the indexer
 * would accept. `[...s].length` is the count the standard means.
 */
export function shit_1170_social_char_length_fun(value: string): number {
  return [...value].length;
}

/**
 * is this a NEAR account id the standard accepts?
 *
 * an account id in a key that does not match is IGNORED by the
 * indexer — the write lands and nothing happens.
 */
export function shit_1170_social_is_account_id_fun(
  account_id: string,
): boolean {
  if (account_id.length < 2 || account_id.length > 64) return false;
  return SHIT_1170_ACCOUNT_ID_PATTERN.test(account_id);
}

/**
 * is this a post id the standard accepts?
 *
 * a post id is a decimal integer with no leading zeros, at most
 * 2^53 - 1. clients SHOULD use the current Unix time in
 * milliseconds.
 */
export function shit_1170_social_is_post_id_fun(post_id: string): boolean {
  if (!SHIT_1170_POST_ID_PATTERN.test(post_id)) return false;
  const value = Number(post_id);
  return Number.isSafeInteger(value) && value <= 9007199254740991;
}

/**
 * a post reference: `{account_id}/{post_id}`.
 *
 * a reference that names an account or a post id the standard does
 * not accept is ignored, so it is checked before it goes into a
 * payload.
 */
export function shit_1170_social_post_ref_fun(
  account_id: string,
  post_id: string,
): string {
  const account = account_id.trim();
  const id = String(post_id).trim();
  if (!shit_1170_social_is_account_id_fun(account)) {
    throw new Error(
      `"${account}" is not a valid NEAR account id, so a post that names it would be ignored by the indexer`,
    );
  }
  if (!shit_1170_social_is_post_id_fun(id)) {
    throw new Error(
      `"${id}" is not a valid post id, so a post that names it would be ignored by the indexer`,
    );
  }
  return `${account}/${id}`;
}

/**
 * a post id for a post written now.
 *
 * the current Unix time in milliseconds, which is what the standard
 * says clients SHOULD use.
 */
export function shit_1170_social_post_id_fun(now: number = Date.now()): string {
  const id = String(Math.floor(now));
  if (!shit_1170_social_is_post_id_fun(id)) {
    throw new Error(
      `the current time does not make a valid post id ("${id}"); the post id must be a decimal integer up to 2^53 - 1`,
    );
  }
  return id;
}

// ------------------------------------------------------------
// THE VALUES
// ------------------------------------------------------------

export interface SHIT_1170_SOCIAL_MEDIA {
  src: string;
  mime: string;
  w?: number;
  h?: number;
  alt?: string;
}

export interface SHIT_1170_SOCIAL_POST_VALUE {
  text?: string;
  media?: SHIT_1170_SOCIAL_MEDIA[];
  reply_to?: string;
  root?: string;
  quote?: string;
}

export interface SHIT_1170_SOCIAL_PROFILE_VALUE {
  text?: string;
  link?: string;
}

// the profile fields the standard defines, and the limit each one has.
//
// `max: null` means the standard states NO character limit for that
// field. `profile/avatar` and `profile/banner` hold a media URI and
// the standard puts their limit on the PATH (§4), not on the whole
// string — so there is no character limit to check here. the only
// 2048-character limit the standard states is on a profile LINK.
const SHIT_1170_PROFILE_LIMITS: Record<
  string,
  { key: string; max: number | null; kind: "text" | "link" | "media" }
> = {
  name: { key: "profile/name", max: SHIT_1170_SOCIAL_MAX_NAME_LENGTH, kind: "text" },
  about: { key: "profile/about", max: SHIT_1170_SOCIAL_MAX_ABOUT_LENGTH, kind: "text" },
  location: {
    key: "profile/location",
    max: SHIT_1170_SOCIAL_MAX_LOCATION_LENGTH,
    kind: "text",
  },
  avatar: { key: "profile/avatar", max: null, kind: "media" },
  banner: { key: "profile/banner", max: null, kind: "media" },
};

// the link services the standard names, and the pattern every service
// name has to match.
const SHIT_1170_LINK_SERVICE_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * the profile fields a write can set, and the limit each one has.
 *
 * the map is exported so an agent can say what the standard allows
 * without guessing.
 */
export function shit_1170_social_profile_fields_fun(): Record<
  string,
  { key: string; max: number | null; kind: "text" | "link" | "media" }
> {
  return { ...SHIT_1170_PROFILE_LIMITS };
}

/**
 * the profile field's key for one field name.
 */
export function shit_1170_social_profile_key_fun(field: string): string {
  const entry = SHIT_1170_PROFILE_LIMITS[field.trim().toLowerCase()];
  if (entry) return entry.key;
  if (field.trim().toLowerCase().startsWith("profile/")) {
    return field.trim();
  }
  throw new Error(
    `"${field}" is not a profile field. the fields are: ${Object.keys(SHIT_1170_PROFILE_LIMITS).join(", ")}`,
  );
}

// ------------------------------------------------------------
// THE KEY BUILDERS
// ------------------------------------------------------------

/** the key a post is written under. */
export function shit_1170_social_post_key_fun(post_id: string): string {
  if (!shit_1170_social_is_post_id_fun(post_id)) {
    throw new Error(
      `"${post_id}" is not a valid post id, so the post would be ignored by the indexer`,
    );
  }
  return `post/${post_id}`;
}

/** the key a reply's backlink is written under. */
export function shit_1170_social_reply_key_fun(
  parent_account_id: string,
  parent_post_id: string,
  post_id: string,
): string {
  const parent = shit_1170_social_post_ref_fun(parent_account_id, parent_post_id);
  const own = shit_1170_social_post_id_fun_checked(post_id);
  return `reply/${parent}/${own}`;
}

/**
 * the key a like is written under.
 *
 * --- THE ACCOUNT IN THE KEY IS THE POST'S AUTHOR, NOT THE LIKER ---
 * this is the one thing about the edge keys that is easy to get
 * wrong, so it is worth saying plainly: the key names the TARGET
 * POST, not the account that wrote the edge.
 *
 * the standard says "`{account}/{post_id}` is the target post", and
 * the chain agrees. on mainnet, `yawrd.near` and `vandal.near` both
 * wrote `like/23387b92.../1793547766638` for the same post, and
 * `GET /v1/posts/23387b92.../1793547766638/likes` answers with those
 * two accounts. the post's author is `23387b92...`, and that is what
 * the key carries.
 *
 * so the LIKER is the account that SIGNS the write — it is the
 * predecessor of the receipt — and the key names the post.
 */
export function shit_1170_social_like_key_fun(
  target_account_id: string,
  target_post_id: string,
): string {
  return `like/${shit_1170_social_post_ref_fun(target_account_id, target_post_id)}`;
}

/**
 * the key a repost is written under.
 *
 * like a like, the account in the key is the POST'S AUTHOR, not the
 * account that reposts.
 */
export function shit_1170_social_repost_key_fun(
  target_account_id: string,
  target_post_id: string,
): string {
  return `repost/${shit_1170_social_post_ref_fun(target_account_id, target_post_id)}`;
}

/** the key a follow is written under. */
export function shit_1170_social_follow_key_fun(account_id: string): string {
  const account = account_id.trim();
  if (!shit_1170_social_is_account_id_fun(account)) {
    throw new Error(
      `"${account}" is not a valid NEAR account id, so a follow of it would be ignored by the indexer`,
    );
  }
  return `graph/follow/${account}`;
}

/** the key a profile link is written under. */
export function shit_1170_social_profile_link_key_fun(service: string): string {
  const name = service.trim().toLowerCase();
  if (!SHIT_1170_LINK_SERVICE_PATTERN.test(name)) {
    throw new Error(
      `"${service}" is not a valid link service. a service name matches ^[a-z0-9_]{1,32}$`,
    );
  }
  return `profile/links/${name}`;
}

function shit_1170_social_post_id_fun_checked(post_id: string): string {
  const id = String(post_id).trim();
  if (!shit_1170_social_is_post_id_fun(id)) {
    throw new Error(
      `"${post_id}" is not a valid post id, so the reply would be ignored by the indexer`,
    );
  }
  return id;
}

// ------------------------------------------------------------
// THE CHECK
// ------------------------------------------------------------

export interface SHIT_1170_SOCIAL_CHECK {
  // every rule the payload breaks, named.
  problems: SHIT_1170_SOCIAL_PROBLEM[];
  // the keys the payload writes.
  keys: string[];
  // the size of the whole args object, in bytes.
  bytes: number;
}

/**
 * check a set of writes against the standard's rules.
 *
 * a payload that breaks a rule is DROPPED SILENTLY by the indexer, so
 * this is what stands between a queued post and a post that never
 * appears.
 */
export function shit_1170_social_check_writes_fun(
  writes: Record<string, unknown>,
): SHIT_1170_SOCIAL_CHECK {
  const problems: SHIT_1170_SOCIAL_PROBLEM[] = [];
  const keys = Object.keys(writes);

  if (keys.length > SHIT_1170_SOCIAL_MAX_KEYS) {
    problems.push({
      rule: "keys_per_call",
      detail: `${keys.length} keys, the indexer takes at most ${SHIT_1170_SOCIAL_MAX_KEYS} and drops the WHOLE action`,
    });
  }

  for (const key of keys) {
    const keyBytes = Buffer.byteLength(key, "utf8");
    if (keyBytes > SHIT_1170_SOCIAL_MAX_KEY_BYTES) {
      problems.push({
        rule: "key_bytes",
        detail: `the key "${key}" is ${keyBytes} bytes, the limit is ${SHIT_1170_SOCIAL_MAX_KEY_BYTES} and the key is dropped`,
      });
    }
    if (!key.startsWith("profile/") && !/^[a-z]+(\/|$)/.test(key)) {
      problems.push({
        rule: "key_ascii",
        detail: `the key "${key}" is not a key the standard defines`,
      });
    }
    if (key.startsWith("profile/") && !key.startsWith("profile/links/")) {
      const field = key.slice("profile/".length);
      const known = Object.values(SHIT_1170_PROFILE_LIMITS).some(
        (entry) => entry.key === key,
      );
      if (!known) {
        problems.push({
          rule: "profile_field",
          detail: `"${key}" is not a profile field the standard defines`,
        });
      }
      void field;
    }
  }

  // the value of every key, checked against its own limits.
  for (const [key, value] of Object.entries(writes)) {
    if (value === null) continue; // a tombstone carries no value.

    const valueBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (valueBytes > SHIT_1170_SOCIAL_MAX_VALUE_BYTES) {
      problems.push({
        rule: "value_bytes",
        detail: `the value of "${key}" is ${valueBytes} bytes, the limit is ${SHIT_1170_SOCIAL_MAX_VALUE_BYTES} and the key is dropped`,
      });
    }

    if (key.startsWith("post/")) {
      problems.push(...shit_1170_social_check_post_fun(key, value));
    }
    if (key.startsWith("profile/")) {
      problems.push(...shit_1170_social_check_profile_fun(key, value));
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(writes), "utf8");
  if (bytes > SHIT_1170_SOCIAL_MAX_TX_BYTES) {
    problems.push({
      rule: "tx_bytes",
      detail: `the args object is ${bytes} bytes, the chain rejects a transaction larger than ${SHIT_1170_SOCIAL_MAX_TX_BYTES}`,
    });
  }

  return { problems, keys, bytes };
}

function shit_1170_social_check_post_fun(
  key: string,
  value: unknown,
): SHIT_1170_SOCIAL_PROBLEM[] {
  const problems: SHIT_1170_SOCIAL_PROBLEM[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push({
      rule: "post_value",
      detail: `the value of "${key}" is not a JSON object, so the post is invalid and therefore absent`,
    });
    return problems;
  }

  const post = value as SHIT_1170_SOCIAL_POST_VALUE;

  if (post.text !== undefined) {
    if (typeof post.text !== "string") {
      problems.push({
        rule: "post_text_type",
        detail: `the text of "${key}" is not a string`,
      });
    } else if (
      shit_1170_social_char_length_fun(post.text) >
      SHIT_1170_SOCIAL_MAX_TEXT_LENGTH
    ) {
      problems.push({
        rule: "post_text_length",
        detail: `the text of "${key}" is ${shit_1170_social_char_length_fun(post.text)} characters, the limit is ${SHIT_1170_SOCIAL_MAX_TEXT_LENGTH}`,
      });
    }
  }

  if (post.media !== undefined) {
    if (!Array.isArray(post.media)) {
      problems.push({
        rule: "post_media_type",
        detail: `the media of "${key}" is not an array`,
      });
    } else {
      if (post.media.length > SHIT_1170_SOCIAL_MAX_MEDIA) {
        problems.push({
          rule: "post_media_count",
          detail: `"${key}" carries ${post.media.length} media items, the limit is ${SHIT_1170_SOCIAL_MAX_MEDIA}`,
        });
      }
      for (const media of post.media) {
        problems.push(...shit_1170_social_check_media_fun(key, media));
      }
    }
  }

  // a post is valid when it has non-empty trimmed text, at least one
  // media item, or a quote. none of the three makes it INVALID, and
  // an invalid post is absent — it does not show up at all.
  const hasText = typeof post.text === "string" && post.text.trim().length > 0;
  const hasMedia = Array.isArray(post.media) && post.media.length > 0;
  const hasQuote = typeof post.quote === "string" && post.quote.length > 0;
  if (!hasText && !hasMedia && !hasQuote) {
    problems.push({
      rule: "post_empty",
      detail: `"${key}" has no text, no media and no quote, so the post is invalid and therefore absent`,
    });
  }

  // a reply names its parent and the top of the thread.
  if (post.reply_to !== undefined) {
    if (!shit_1170_social_is_post_ref_fun(post.reply_to)) {
      problems.push({
        rule: "reply_to_format",
        detail: `the reply_to of "${key}" is not a "{account_id}/{post_id}" reference`,
      });
    }
    // "reply_to pointing to the post itself is invalid."
    //
    // the post being written is `post/{post_id}`, and its reference
    // form is `{author}/{post_id}`. the author's account is not in the
    // key — it is the predecessor of the receipt — so the comparison
    // is on the POST ID.
    const ownPostId = key.slice("post/".length);
    const replyToPostId = post.reply_to.split("/")[1];
    if (replyToPostId === ownPostId) {
      problems.push({
        rule: "reply_to_self",
        detail: `the reply_to of "${key}" is the post itself, which is invalid`,
      });
    }
  }
  if (post.root !== undefined && !shit_1170_social_is_post_ref_fun(post.root)) {
    problems.push({
      rule: "root_format",
      detail: `the root of "${key}" is not a "{account_id}/{post_id}" reference`,
    });
  }
  if (post.quote !== undefined && !shit_1170_social_is_post_ref_fun(post.quote)) {
    problems.push({
      rule: "quote_format",
      detail: `the quote of "${key}" is not a "{account_id}/{post_id}" reference`,
    });
  }

  return problems;
}

function shit_1170_social_check_media_fun(
  key: string,
  media: unknown,
): SHIT_1170_SOCIAL_PROBLEM[] {
  const problems: SHIT_1170_SOCIAL_PROBLEM[] = [];
  if (typeof media !== "object" || media === null) {
    problems.push({
      rule: "media_type",
      detail: `a media item of "${key}" is not an object`,
    });
    return problems;
  }
  const item = media as SHIT_1170_SOCIAL_MEDIA;

  if (typeof item.src !== "string" || !item.src.startsWith("fastfs://")) {
    problems.push({
      rule: "media_src",
      detail: `the src of a media item of "${key}" is not a fastfs:// URI, and v1 accepts no other scheme`,
    });
  }
  if (
    typeof item.mime !== "string" ||
    !SHIT_1170_SOCIAL_MEDIA_MIMES.includes(
      item.mime as (typeof SHIT_1170_SOCIAL_MEDIA_MIMES)[number],
    )
  ) {
    problems.push({
      rule: "media_mime",
      detail: `the mime of a media item of "${key}" is not one of: ${SHIT_1170_SOCIAL_MEDIA_MIMES.join(", ")}`,
    });
  }
  for (const dimension of ["w", "h"] as const) {
    const value = item[dimension];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > SHIT_1170_SOCIAL_MAX_MEDIA_DIMENSION
    ) {
      problems.push({
        rule: "media_dimension",
        detail: `the ${dimension} of a media item of "${key}" is not an integer in 1..${SHIT_1170_SOCIAL_MAX_MEDIA_DIMENSION}`,
      });
    }
  }
  if (
    item.alt !== undefined &&
    typeof item.alt === "string" &&
    shit_1170_social_char_length_fun(item.alt) >
      SHIT_1170_SOCIAL_MAX_MEDIA_ALT_LENGTH
  ) {
    problems.push({
      rule: "media_alt_length",
      detail: `the alt of a media item of "${key}" is ${shit_1170_social_char_length_fun(item.alt)} characters, the limit is ${SHIT_1170_SOCIAL_MAX_MEDIA_ALT_LENGTH}`,
    });
  }

  return problems;
}

function shit_1170_social_check_profile_fun(
  key: string,
  value: unknown,
): SHIT_1170_SOCIAL_PROBLEM[] {
  const problems: SHIT_1170_SOCIAL_PROBLEM[] = [];
  if (typeof value !== "string") {
    problems.push({
      rule: "profile_value_type",
      detail: `the value of "${key}" is not a string, and a profile field holds a string`,
    });
    return problems;
  }

  if (key.startsWith("profile/links/")) {
    if (shit_1170_social_char_length_fun(value) > SHIT_1170_SOCIAL_MAX_LINK_LENGTH) {
      problems.push({
        rule: "profile_link_length",
        detail: `the link "${key}" is ${shit_1170_social_char_length_fun(value)} characters, the limit is ${SHIT_1170_SOCIAL_MAX_LINK_LENGTH}`,
      });
    }
    return problems;
  }

  const entry = Object.values(SHIT_1170_PROFILE_LIMITS).find(
    (item) => item.key === key,
  );
  if (!entry) return problems;

  // a media field holds a `fastfs://` URI, and the standard puts its
  // limit on the PATH, not on the string.
  if (entry.kind === "media") {
    if (!value.startsWith("fastfs://")) {
      problems.push({
        rule: "profile_media_scheme",
        detail: `"${key}" holds a media URI, and v1 accepts only fastfs:// URIs`,
      });
    }
    return problems;
  }

  // a field with no stated character limit has no length to check.
  if (entry.max === null) return problems;

  if (shit_1170_social_char_length_fun(value) > entry.max) {
    problems.push({
      rule: "profile_field_length",
      detail: `"${key}" is ${shit_1170_social_char_length_fun(value)} characters, the limit is ${entry.max}`,
    });
  }

  return problems;
}

/**
 * is this a post reference the standard accepts?
 */
export function shit_1170_social_is_post_ref_fun(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  return (
    shit_1170_social_is_account_id_fun(parts[0] as string) &&
    shit_1170_social_is_post_id_fun(parts[1] as string)
  );
}

// ------------------------------------------------------------
// THE QUEUE PAYLOADS
// ------------------------------------------------------------
//
// these are DATA. the engine queues them and a human signs them.

/**
 * one `__fastdata_kv` write.
 *
 * `writes` is the args object: each top-level key is one KV key.
 */
export function shit_1170_social_queue_call_fun(
  writes: Record<string, unknown>,
  options: { gas?: string; deposit?: string } = {},
): QUEUE_CALL {
  const keys = Object.keys(writes);
  if (keys.length === 0) {
    throw new Error("a social write needs at least one key");
  }

  return queue_call_fun({
    contractId: SHIT_1170_SOCIAL_RECEIVER,
    method: SHIT_1170_SOCIAL_METHOD,
    args: writes,
    gas: options.gas ?? SHIT_1170_SOCIAL_GAS,
    deposit: options.deposit ?? SHIT_1170_SOCIAL_DEPOSIT,
  });
}

export interface SHIT_1170_SOCIAL_POST_REQUEST {
  accountId: string;
  text?: string;
  media?: SHIT_1170_SOCIAL_MEDIA[];
  quote?: string;
  replyTo?: string;
  // the top of the thread. needed when the parent is itself a reply.
  root?: string;
  // the parent is a top-level post, so the parent IS the root.
  rootIsParent?: boolean;
  postId?: string;
  gas?: string;
  deposit?: string;
}

/**
 * the queue payload for a post, a reply or a quote.
 *
 * a reply writes the post AND its backlink, in one action — the
 * standard says a client SHOULD write both in the same action.
 *
 * a reply's `root` is the top of the thread: the parent's `root`, or
 * the parent itself when the parent is a top-level post.
 */
export function shit_1170_social_post_queue_call_fun(
  request: SHIT_1170_SOCIAL_POST_REQUEST,
): QUEUE_CALL {
  const account = request.accountId.trim();
  if (!shit_1170_social_is_account_id_fun(account)) {
    throw new Error(
      `"${account}" is not a valid NEAR account id, so the post would be ignored by the indexer`,
    );
  }

  const postId = request.postId
    ? shit_1170_social_post_id_fun_checked(request.postId)
    : shit_1170_social_post_id_fun();
  const postKey = shit_1170_social_post_key_fun(postId);

  const value: SHIT_1170_SOCIAL_POST_VALUE = {};
  if (request.text !== undefined) value.text = request.text;
  if (request.media !== undefined && request.media.length > 0) {
    value.media = request.media;
  }
  if (request.quote !== undefined) value.quote = request.quote;

  const writes: Record<string, unknown> = {};

  if (request.replyTo !== undefined) {
    if (!shit_1170_social_is_post_ref_fun(request.replyTo)) {
      throw new Error(
        `--reply-to "${request.replyTo}" is not a "{account_id}/{post_id}" reference`,
      );
    }
    value.reply_to = request.replyTo;
    // --- THE ROOT OF THE THREAD ---
    // the standard: `root` MUST equal the parent's `root`, or the
    // parent itself when the parent is a top-level post.
    //
    // so the root CANNOT be guessed from the parent alone — when the
    // parent is itself a reply, the root is the top of the thread and
    // the parent is not it. writing the parent as the root would put
    // the reply in the wrong place.
    //
    // so the root is written only when it is known:
    //   - `--root` says it outright
    //   - `--root-is-parent` says the parent is top-level, so the
    //     parent IS the root
    //
    // with neither, `root` is left out. the standard says an indexer
    // falls back to `reply_to` when `root` is missing, so an omitted
    // root is a safe answer and a WRONG root is not.
    if (request.root !== undefined) {
      if (!shit_1170_social_is_post_ref_fun(request.root)) {
        throw new Error(
          `--root "${request.root}" is not a "{account_id}/{post_id}" reference`,
        );
      }
      value.root = request.root;
    } else if (request.rootIsParent) {
      value.root = request.replyTo;
    }

    const [parentAccount, parentPostId] = request.replyTo.split("/") as [
      string,
      string,
    ];
    writes[shit_1170_social_reply_key_fun(parentAccount, parentPostId, postId)] =
      {};
  } else if (request.root !== undefined) {
    throw new Error(
      "a root only makes sense on a reply — pass --reply-to as well",
    );
  }

  writes[postKey] = value;

  return shit_1170_social_queue_call_fun(writes, {
    gas: request.gas,
    deposit: request.deposit,
  });
}

export interface SHIT_1170_SOCIAL_EDGE_REQUEST {
  // the account that SIGNS the write — the liker, the reposter, the
  // follower. it is the predecessor of the receipt.
  accountId: string;
  // for a follow: the account that is followed.
  targetAccountId?: string;
  // for a like or a repost: the AUTHOR of the target post, NOT the
  // account that signs the write.
  targetPostAuthorId?: string;
  // for a like or a repost: the target post's id.
  targetPostId?: string;
  gas?: string;
  deposit?: string;
}

/**
 * the queue payload for a like, a repost or a follow.
 *
 * `on` says what the edge is on: a post, or an account.
 *
 * an edge is ACTIVE if and only if its value is a JSON object. `{}`
 * turns it on and `null` turns it off.
 *
 * --- WHO IS IN THE KEY ---
 * for a like and a repost, the key names the TARGET POST: its
 * author's account and its id. the account that signs the write is
 * the liker, and it is NOT in the key.
 *
 * for a follow, the key names the account that is followed, which IS
 * the target of the edge.
 */
export function shit_1170_social_edge_queue_call_fun(
  kind: "like" | "repost" | "follow",
  request: SHIT_1170_SOCIAL_EDGE_REQUEST,
  options: { on: boolean } = { on: true },
): QUEUE_CALL {
  const account = request.accountId.trim();
  if (!shit_1170_social_is_account_id_fun(account)) {
    throw new Error(
      `"${account}" is not a valid NEAR account id, so the ${kind} would be ignored by the indexer`,
    );
  }

  let key: string;
  if (kind === "follow") {
    const target = (request.targetAccountId ?? "").trim();
    if (!target) throw new Error("a follow needs the account it follows");
    if (target === account) {
      throw new Error(
        "following yourself is ignored by the indexer, so this write would do nothing",
      );
    }
    key = shit_1170_social_follow_key_fun(target);
  } else {
    const author = (request.targetPostAuthorId ?? "").trim();
    if (!author) {
      throw new Error(`a ${kind} needs the post it is on`);
    }
    if (!request.targetPostId) {
      throw new Error(`a ${kind} needs the post it is on`);
    }
    key =
      kind === "like"
        ? shit_1170_social_like_key_fun(author, request.targetPostId)
        : shit_1170_social_repost_key_fun(author, request.targetPostId);
  }

  return shit_1170_social_queue_call_fun(
    { [key]: options.on ? {} : null },
    { gas: request.gas, deposit: request.deposit },
  );
}

export interface SHIT_1170_SOCIAL_PROFILE_REQUEST {
  accountId: string;
  field?: string;
  value?: string;
  service?: string;
  gas?: string;
  deposit?: string;
}

/**
 * the queue payload for a profile field.
 *
 * a `null` value CLEARS the field. it is a tombstone, not a delete —
 * the old value stays in public history.
 */
export function shit_1170_social_profile_queue_call_fun(
  request: SHIT_1170_SOCIAL_PROFILE_REQUEST,
): QUEUE_CALL {
  const writes: Record<string, unknown> = {};

  if (request.service !== undefined) {
    const key = shit_1170_social_profile_link_key_fun(request.service);
    writes[key] = request.value ?? null;
  } else {
    if (!request.field) throw new Error("a profile write needs --field or --service");
    const key = shit_1170_social_profile_key_fun(request.field);
    writes[key] = request.value ?? null;
  }

  return shit_1170_social_queue_call_fun(writes, {
    gas: request.gas,
    deposit: request.deposit,
  });
}

export interface SHIT_1170_SOCIAL_DELETE_REQUEST {
  accountId: string;
  postId: string;
  isReply?: boolean;
  parentAccountId?: string;
  parentPostId?: string;
  gas?: string;
  deposit?: string;
}

/**
 * the queue payload for a deleted post.
 *
 * a delete is a TOMBSTONE: the key is written `null`. the old
 * versions of the post stay in public history forever.
 *
 * a reply's delete also tombstones its backlink, otherwise the reply
 * is still discoverable through the public KV API.
 */
export function shit_1170_social_delete_queue_call_fun(
  request: SHIT_1170_SOCIAL_DELETE_REQUEST,
): QUEUE_CALL {
  const postId = shit_1170_social_post_id_fun_checked(request.postId);
  const writes: Record<string, unknown> = {
    [shit_1170_social_post_key_fun(postId)]: null,
  };

  if (request.isReply) {
    if (!request.parentAccountId || !request.parentPostId) {
      throw new Error(
        "a deleted reply needs the post it replies to, so its backlink can be tombstoned too",
      );
    }
    writes[
      shit_1170_social_reply_key_fun(
        request.parentAccountId,
        request.parentPostId,
        postId,
      )
    ] = null;
  }

  return shit_1170_social_queue_call_fun(writes, {
    gas: request.gas,
    deposit: request.deposit,
  });
}
