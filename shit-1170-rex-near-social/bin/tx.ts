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
import { shit_1170_social_tx_fun } from "../src/index";

// read what the indexer did with a transaction.
//
// --- THIS IS THE ANSWER AFTER A HUMAN SIGNS ---
// a social write's receipt FAILS with `CodeDoesNotExist`, because the
// `social` account has no contract. that is expected, and it is not
// a reason to retry. the FastData indexer does not read the receipt
// status — it reads the transaction's action args and indexes them.
//
// so this bin is the answer, and it says:
//   indexed: false   the indexer has not seen the transaction yet.
//                    poll every 1-2s; writes usually appear within
//                    about 3s.
//   indexed: true    the indexer has it.
//
// --- THE KEY STATUSES ---
//   ok             accepted
//   invalid        the value broke the standard, and the key says why.
//                  the entity is now ABSENT.
//   ignored        an unknown key, or a known key the indexer does
//                  not use — such as `reply/…`. a reply's backlink is
//                  SUPPOSED to be ignored: the indexer derives the
//                  thread from the post's reply_to instead.
//   rate_limited   over the daily limits, and not applied
//   key_too_long   the key was dropped
//   value_too_large  the value was dropped
//
// --- WHERE THE HASH COMES FROM ---
// the engine holds the hash of every send, so the agent reads it back
// from the queue it queued — the human never pastes one into a chat.
// see the engine skill's `queue_sent.ts` and `tx_status.ts`.
//
// this is a READ. nothing here changes anything.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "tx <tx_hash> [--for <seconds>] [--interval <ms>]",
        "tx <tx_hash> --for 30   # poll until the indexer has seen it",
      ],
    });
    return;
  }

  const txHash = args_string_fun(args, "tx-hash") ?? args.positional[0];
  if (!txHash) {
    throw new Error("a transaction hash is required");
  }

  const deadline = args_number_fun(args, "for");
  const interval = args_number_fun(args, "interval") ?? 1500;

  const read = async (): Promise<ReturnType<typeof shit_1170_social_tx_fun>> =>
    shit_1170_social_tx_fun(txHash);

  let result = await read();

  // the poll. the indexer usually sees a write within about three
  // seconds, so the poll is short and bounded.
  if (deadline !== undefined && !result.indexed) {
    const until = Date.now() + deadline * 1000;
    while (Date.now() < until && !result.indexed) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      try {
        result = await read();
      } catch {
        // a failed poll is not a failure: the next one may answer.
      }
    }
  }

  const actions = (result.actions ?? []).map((action) => {
    const keys = action.keys?.map((key) => ({
      key: key.key,
      status: key.status,
      reason: key.reason ?? null,
    }));
    return {
      kind: action.kind,
      status: action.status,
      keys,
      file: action.file ?? null,
      // a reply's backlink is a key the indexer does not use, so it
      // answers `ignored` — and that is NORMAL, not a failure. say so
      // here, so nobody reads it as a broken write.
      ignoredBacklinks: (keys ?? []).filter(
        (key) => key.key.startsWith("reply/") && key.status === "ignored",
      ).length,
    };
  });

  print_json_fun({
    ok: true,
    txHash: result.tx_hash,
    indexed: result.indexed,
    blockHeight: result.block_height ?? null,
    predecessorId: result.predecessor_id ?? null,
    actions,
    // what it means, in words.
    note: result.indexed
      ? "the indexer has seen this transaction"
      : "the indexer has NOT seen this transaction yet. poll again in a second or two — do not resend.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
