#!/usr/bin/env bun
import {
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
} from "../src/bin_stuff";
import {
  shit_1170_social_check_writes_fun,
  shit_1170_social_post_queue_call_fun,
  type SHIT_1170_SOCIAL_MEDIA,
} from "../src/index";

// prepare a post, a reply or a quote.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// the write is a `__fastdata_kv` call on the `social` account, with
// the gas the standard states: `1`. the receiver has no contract on
// it and needs none.
//
// --- WHAT THE PAYLOAD LOOKS LIKE ---
// the args are a JSON OBJECT whose top-level keys are the KV keys:
//   post/{post_id}                        the post
//   reply/{parent}/{post_id}              a reply's backlink
// so a post is `{"post/1759140000000":{"text":"gm"}}`.
//
// --- A REPLY ---
// `--reply-to alice.near/1759140000000` makes it a reply. the root
// of the thread is the parent's root, or the parent itself when the
// parent is a top-level post — so the payload needs `--root` only
// when the parent is itself a reply.
//
// a reply writes the post AND its backlink in one action.
//
// --- A QUOTE ---
// `--quote alice.near/1759140000000` makes it a quote.
//
// --- THE POST ID ---
// by default the id is the current Unix time in milliseconds, which is
// what the standard says clients SHOULD use. `--post-id` sets it by
// hand, and `--edit` reuses an existing id — writing the same
// `post/{id}` again is an EDIT.
//
// --- MEDIA ---
// `--media` takes a JSON array of media objects. each needs a
// `fastfs://` src and a mime of image/webp, image/jpeg, image/png,
// image/gif or image/avif. the fastfs skill has the upload.

function parse_media_fun(raw: string | undefined): SHIT_1170_SOCIAL_MEDIA[] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("--media must be a JSON array of media objects");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--media must be a JSON array of media objects");
  }
  return parsed as SHIT_1170_SOCIAL_MEDIA[];
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "edit", "root-is-parent"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "post_write --account <account_id> --text <text>",
        "post_write --account <account_id> --text <text> --reply-to <account_id/post_id> [--root-is-parent | --root <account_id/post_id>]",
        "post_write --account <account_id> --text <text> --quote <account_id/post_id>",
        "post_write --account <account_id> --text <text> --media <json-array>",
        "post_write --account <account_id> --text <text> --edit --post-id <post_id>",
        "--post-id <post_id> sets the id. --edit writes the same post/{id} again, which is an edit.",
        "--reply-to names the post being replied to.",
        "--root-is-parent says that parent is a top-level post, so it IS the root of the thread.",
        "--root names the top of the thread, and is needed when the parent is itself a reply.",
      ],
    });
    return;
  }

  const account = args_string_fun(args, "account");
  if (!account) {
    throw new Error("--account <account_id> is required — the account that will sign the post");
  }

  const text = args_string_fun(args, "text");
  const media = parse_media_fun(args_string_fun(args, "media"));
  const quote = args_string_fun(args, "quote");
  const replyTo = args_string_fun(args, "reply-to");
  const root = args_string_fun(args, "root");
  const rootIsParent = args_bool_fun(args, "root-is-parent");
  const postId = args_string_fun(args, "post-id");
  const isEdit = args_bool_fun(args, "edit");

  if (text === undefined && !media && !quote) {
    throw new Error(
      "a post needs --text, --media or --quote — a post with none of the three is invalid and the indexer treats it as absent",
    );
  }
  if (isEdit && !postId) {
    throw new Error("--edit needs --post-id <post_id> — an edit writes the same post/{id} again");
  }
  if (isEdit && (replyTo || quote)) {
    throw new Error(
      "--edit writes an existing post, so it cannot also be a reply or a quote",
    );
  }
  if (root && rootIsParent) {
    throw new Error("--root and --root-is-parent are two different things — pass one");
  }

  const queueCall = shit_1170_social_post_queue_call_fun({
    accountId: account,
    text,
    media,
    quote,
    replyTo,
    root,
    rootIsParent,
    postId,
    gas: args_string_fun(args, "gas"),
    deposit: args_string_fun(args, "deposit"),
  });

  // the check is what stands between a queued post and a post that
  // never appears: the indexer drops what breaks its rules SILENTLY.
  const check = shit_1170_social_check_writes_fun(queueCall.args);
  if (check.problems.length > 0) {
    print_error_fun(
      `the payload breaks ${check.problems.length} rule(s) of the social-kv/1 standard, and the indexer DROPS what breaks them silently:\n${check.problems
        .map((problem) => `  - ${problem.rule}: ${problem.detail}`)
        .join("\n")}`,
    );
    process.exitCode = 2;
    return;
  }

  print_json_fun({
    ok: true,
    action: "queue_post",
    isEdit,
    transactions: [queueCall],
    transaction: queueCall,
    keys: check.keys,
    bytes: check.bytes,
    // the human signs this, so say what it will do.
    willDo: replyTo
      ? `reply to ${replyTo} as ${account}`
      : quote
        ? `quote ${quote} as ${account}`
        : isEdit
          ? `edit the post ${postId} of ${account}`
          : `post as ${account}`,
    // say what the root is, because the root of a thread is easy to
    // get wrong and a wrong root puts the reply in the wrong place.
    root: replyTo
      ? root
        ? `the top of the thread is ${root}`
        : rootIsParent
          ? `the parent ${replyTo} is a top-level post, so it is the top of the thread`
          : "NO root was written. the indexer falls back to the parent. pass --root-is-parent if the parent is top-level, or --root <account_id/post_id> if it is not."
      : null,
    // the receipt will fail. that is correct.
    note: "the receipt of a social write FAILS with CodeDoesNotExist, because the `social` account has no contract. that is expected — the FastData indexer reads the transaction, not the receipt.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
