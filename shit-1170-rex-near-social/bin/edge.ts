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
  shit_1170_social_edge_queue_call_fun,
} from "../src/index";

// prepare a like, a repost or a follow.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// the write is a `__fastdata_kv` call on the `social` account, with
// the gas the standard states: `1`.
//
// --- THE THREE EDGES ---
//   --like <account_id/post_id>     like a post
//   --repost <account_id/post_id>   repost a post
//   --follow <account_id>           follow an account
//
// an edge is ACTIVE if and only if its value is a JSON object. `{}`
// turns it on. `--undo` writes `null` instead, which turns it off.
//
// --- THE KEYS ---
//   like/alice.near/1759140000000
//   repost/alice.near/1759140000000
//   graph/follow/alice.near
//
// --- THE LIMITS ---
// per account per UTC day: 1000 likes, 300 reposts, 5000 follows.
// a write over a limit is recorded but NOT applied, and the indexer
// reports it as `rate_limited`.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "undo"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "edge --account <account_id> --like <account_id/post_id>",
        "edge --account <account_id> --repost <account_id/post_id>",
        "edge --account <account_id> --follow <account_id>",
        "edge ... --undo   # write null instead of {} — turns the edge off",
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

  const like = args_string_fun(args, "like");
  const repost = args_string_fun(args, "repost");
  const follow = args_string_fun(args, "follow");
  const undo = args_bool_fun(args, "undo");

  const chosen = [like, repost, follow].filter(Boolean).length;
  if (chosen !== 1) {
    throw new Error(
      "exactly one of --like, --repost or --follow is required",
    );
  }

  const on = !undo;
  let queueCall;
  let willDo: string;

  if (like) {
    const parts = like.split("/");
    if (parts.length !== 2) {
      throw new Error(
        `--like "${like}" is not a post reference. a post is account_id/post_id, e.g. alice.near/1759140000000`,
      );
    }
    queueCall = shit_1170_social_edge_queue_call_fun(
      "like",
      {
        accountId: account,
        // the key names the TARGET POST — its author and its id. the
        // liker is the account that signs the write, and it is not in
        // the key.
        targetPostAuthorId: parts[0] as string,
        targetPostId: parts[1] as string,
        gas: args_string_fun(args, "gas"),
        deposit: args_string_fun(args, "deposit"),
      },
      { on },
    );
    willDo = `${on ? "like" : "unlike"} the post ${like}`;
  } else if (repost) {
    const parts = repost.split("/");
    if (parts.length !== 2) {
      throw new Error(
        `--repost "${repost}" is not a post reference. a post is account_id/post_id, e.g. alice.near/1759140000000`,
      );
    }
    queueCall = shit_1170_social_edge_queue_call_fun(
      "repost",
      {
        accountId: account,
        targetPostAuthorId: parts[0] as string,
        targetPostId: parts[1] as string,
        gas: args_string_fun(args, "gas"),
        deposit: args_string_fun(args, "deposit"),
      },
      { on },
    );
    willDo = `${on ? "repost" : "undo the repost of"} the post ${repost}`;
  } else {
    queueCall = shit_1170_social_edge_queue_call_fun(
      "follow",
      {
        accountId: account,
        targetAccountId: follow as string,
        gas: args_string_fun(args, "gas"),
        deposit: args_string_fun(args, "deposit"),
      },
      { on },
    );
    willDo = `${on ? "follow" : "unfollow"} ${follow}`;
  }

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
    action: "queue_edge",
    undo,
    transactions: [queueCall],
    transaction: queueCall,
    keys: check.keys,
    bytes: check.bytes,
    willDo,
    note: "the receipt of a social write FAILS with CodeDoesNotExist, because the `social` account has no contract. that is expected — the FastData indexer reads the transaction, not the receipt.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
