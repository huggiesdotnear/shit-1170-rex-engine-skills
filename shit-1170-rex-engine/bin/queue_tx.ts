#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_number_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";
import { shit_1170_account_resolve_fun } from "../src/keyring";
import { shit_1170_queue_tx_fun } from "../src/engine";
import type { SHIT_1170_TX_QUEUE_REQUEST } from "@huggies/shit-1170-rex-engine-middleman";

async function read_request_fun(
  args: ReturnType<typeof shit_1170_parse_args_fun>,
  defaultAccounts: string[],
): Promise<SHIT_1170_TX_QUEUE_REQUEST> {
  const accounts =
    shit_1170_flag_string_fun(args, "accounts")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? defaultAccounts;

  const file = shit_1170_flag_string_fun(args, "file");
  if (file) {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as SHIT_1170_TX_QUEUE_REQUEST;
    return { ...parsed, accounts: parsed.accounts ?? accounts };
  }

  const transactionsJson = shit_1170_flag_string_fun(args, "transactions");
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
    what: shit_1170_flag_string_fun(args, "what"),
    when: shit_1170_flag_string_fun(args, "when"),
    why: shit_1170_flag_string_fun(args, "why"),
    whenAt: shit_1170_flag_number_fun(args, "when-at"),
    accounts,
  };
}

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
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
    shit_1170_flag_string_fun(args, "account"),
  );
  const request = await read_request_fun(args, [profile.accountId]);
  const result = await shit_1170_queue_tx_fun(profile.apiKey, request, {
    baseUrl: shit_1170_flag_string_fun(args, "base-url") ?? profile.baseUrl,
  });
  shit_1170_print_json_fun({
    ok: true,
    queueId: result.queue.queueId,
    localPath: result.localPath,
    queue: result.queue,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
