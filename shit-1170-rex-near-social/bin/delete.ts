#!/usr/bin/env bun
import {
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
} from "../src/bin_stuff";
import {
  shit_1170_social_check_writes_fun,
  shit_1170_social_delete_queue_call_fun,
} from "../src/index";

// prepare a deleted post.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// the write is a `__fastdata_kv` call on the `social` account, with
// the gas the standard states: `1`.
//
// --- A DELETE IS A TOMBSTONE ---
// the key is written `null`. the post stops being there, but **the old
// versions stay in public history forever**. FastData keeps the full
// history of every key, and anyone can read old values. so a delete
// is not a private act — say so before queueing one.
//
// --- A REPLY ---
// a reply's delete also tombstones its backlink, or the reply stays
// discoverable through the public KV API. `--reply-to
// <account_id/post_id>` names the post it replies to.
//
// --- THE EDIT ---
// editing a post is writing the same `post/{id}` again with the full
// new value. `post_write.ts --edit` does that.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "delete --account <account_id> --post-id <post_id>",
        "delete --account <account_id> --post-id <post_id> --reply-to <account_id/post_id>",
        "the reply-to names the post the deleted post replies to, so its backlink is tombstoned too.",
      ],
    });
    return;
  }

  const account = args_string_fun(args, "account");
  if (!account) {
    throw new Error(
      "--account <account_id> is required — the account that will sign the write",
    );
  }

  const postId = args_string_fun(args, "post-id");
  if (!postId) {
    throw new Error("--post-id <post_id> is required");
  }

  const replyTo = args_string_fun(args, "reply-to");
  let parentAccountId: string | undefined;
  let parentPostId: string | undefined;
  if (replyTo) {
    const parts = replyTo.split("/");
    if (parts.length !== 2) {
      throw new Error(
        `--reply-to "${replyTo}" is not a post reference. a post is account_id/post_id, e.g. alice.near/1759140000000`,
      );
    }
    parentAccountId = parts[0] as string;
    parentPostId = parts[1] as string;
  }

  const queueCall = shit_1170_social_delete_queue_call_fun({
    accountId: account,
    postId,
    isReply: Boolean(replyTo),
    parentAccountId,
    parentPostId,
    gas: args_string_fun(args, "gas"),
    deposit: args_string_fun(args, "deposit"),
  });

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
    action: "queue_delete",
    transactions: [queueCall],
    transaction: queueCall,
    keys: check.keys,
    bytes: check.bytes,
    willDo: `delete the post ${postId} of ${account}`,
    note: "a delete is a TOMBSTONE — the post goes away, but the old versions stay in public history forever, and anyone can read them.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
