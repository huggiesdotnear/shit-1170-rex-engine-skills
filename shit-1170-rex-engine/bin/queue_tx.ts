#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_account_resolve_fun } from "../src/keyring";
import { shit_1170_queue_tx_fun } from "../src/engine";
import type { SHIT_1170_TX_QUEUE_REQUEST } from "@huggies/shit-1170-rex-engine-middleman";

async function read_request_fun(
  args: ReturnType<typeof parse_args_fun>,
  defaultAccounts: string[],
): Promise<SHIT_1170_TX_QUEUE_REQUEST> {
  const accounts =
    args_string_fun(args, "accounts")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? defaultAccounts;

  const file = args_string_fun(args, "file");
  if (file) {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as SHIT_1170_TX_QUEUE_REQUEST;
    return { ...parsed, accounts: parsed.accounts ?? accounts };
  }

  const transactionsJson = args_string_fun(args, "transactions");
  if (!transactionsJson) {
    throw new Error(
      "--file <path> or --transactions <json-array> is required",
    );
  }
  const transactions = JSON.parse(transactionsJson);
  if (!Array.isArray(transactions)) {
    throw new Error("--transactions must be a JSON array");
  }
  return {
    transactions,
    what: args_string_fun(args, "what"),
    when: args_string_fun(args, "when"),
    why: args_string_fun(args, "why"),
    whenAt: args_number_fun(args, "when-at"),
    accounts,
  };
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "queue_tx --file <request.json>",
        "queue_tx --transactions <json-array> [--what text] [--when text] [--why text] [--when-at <epoch_ms>] [--accounts a,b] [--account signer]",
        "--accounts defaults to the signing account",
      ],
    });
    return;
  }

  const profile = await shit_1170_account_resolve_fun(
    args_string_fun(args, "account"),
  );
  const request = await read_request_fun(args, [profile.accountId]);
  const result = await shit_1170_queue_tx_fun(profile.apiKey, request, {
    baseUrl: args_string_fun(args, "base-url") ?? profile.baseUrl,
  });
  print_json_fun({
    ok: true,
    queueId: result.queue.queueId,
    localPath: result.localPath,
    queue: result.queue,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
