#!/usr/bin/env bun
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_fastfs_check_args_fun } from "../src/index";

// look at the args of a FastFS action and say whether they are borsh.
//
// --- WHY THIS EXISTS ---
// the browser once passed a FastFS payload's bytes through
// `JSON.stringify`, so the action's args arrived on chain as the json
// text of a byte map — `{"0":0,"1":15,…}` — instead of borsh. the
// indexer read it, found no borsh, and DROPPED the action silently.
//
// the receipt fails the way a FastFS receipt always fails, and the file
// never appears at its URL, so neither the chain nor the CDN says why.
// this bin says it: it reads the args and names the problem.
//
// --- WHERE THE ARGS COME FROM ---
// the chain reports an action's args as base64. pass that base64 with
// `--args-base64`, or pass a transaction hash with `--tx` and this bin
// reads the args off the chain itself.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "fastfs_args --args-base64 <base64>",
        "fastfs_args --tx <tx_hash>",
      ],
    });
    return;
  }

  let argsBase64 = args_string_fun(args, "args-base64");
  const txHash = args_string_fun(args, "tx");

  if (!argsBase64 && txHash) {
    const response = await fetch(
      "https://tx.main.fastnear.com/v0/transactions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_hashes: [txHash] }),
      },
    );
    const body = (await response.json()) as {
      transactions?: Array<{
        transaction?: {
          actions?: Array<{
            FunctionCall?: { method_name: string; args: string };
          }>;
        };
      }>;
    };
    const call = body.transactions?.[0]?.transaction?.actions?.[0]?.FunctionCall;
    if (!call) {
      throw new Error(`no transaction found for ${txHash}`);
    }
    if (call.method_name !== "__fastdata_fastfs") {
      throw new Error(
        `the transaction's method is ${call.method_name}, not __fastdata_fastfs`,
      );
    }
    argsBase64 = call.args;
  }

  if (!argsBase64) {
    throw new Error("--args-base64 <base64> or --tx <tx_hash> is required");
  }

  const check = shit_1170_fastfs_check_args_fun(argsBase64);

  print_json_fun({
    ok: check.ok,
    kind: check.kind,
    headHex: check.headHex,
    message: check.message,
    note: check.ok
      ? "the bytes are borsh — the indexer can read them."
      : "the indexer drops a FastFS action whose args are not borsh, and it drops it silently.",
  });

  if (!check.ok) {
    process.exitCode = 2;
  }
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
