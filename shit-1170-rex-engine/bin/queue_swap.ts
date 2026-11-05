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
import { shit_1170_queue_swap_fun } from "../src/engine";
import type { SHIT_1170_SWAP_QUEUE_REQUEST } from "@huggies/shit-1170-rex-engine-middleman";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "queue_swap --file <request.json>",
        "queue_swap --token-in <id> --amount-in <unit> --token-out <id> [--amount-out <unit>] [--dex-id <id>] [--what text] [--when text] [--why text] [--when-at <epoch_ms>] [--accounts a,b]",
        "--accounts defaults to the signing account",
      ],
    });
    return;
  }

  const profile = await shit_1170_account_resolve_fun(
    shit_1170_flag_string_fun(args, "account"),
  );
  const accounts =
    shit_1170_flag_string_fun(args, "accounts")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [profile.accountId];
  const file = shit_1170_flag_string_fun(args, "file");
  let request: SHIT_1170_SWAP_QUEUE_REQUEST;
  if (file) {
    const parsed = JSON.parse(
      await readFile(file, "utf8"),
    ) as SHIT_1170_SWAP_QUEUE_REQUEST;
    request = { ...parsed, accounts: parsed.accounts ?? accounts };
  } else {
    request = {
      tokenIn: shit_1170_require_string_fun(args, "token-in"),
      amountIn: shit_1170_require_string_fun(args, "amount-in"),
      tokenOut: shit_1170_require_string_fun(args, "token-out"),
      amountOut: shit_1170_flag_string_fun(args, "amount-out"),
      dexId: shit_1170_flag_string_fun(args, "dex-id"),
      what: shit_1170_flag_string_fun(args, "what"),
      when: shit_1170_flag_string_fun(args, "when"),
      why: shit_1170_flag_string_fun(args, "why"),
      whenAt: shit_1170_flag_number_fun(args, "when-at"),
      accounts,
    };
  }

  const result = await shit_1170_queue_swap_fun(profile.apiKey, request, {
    baseUrl: shit_1170_flag_string_fun(args, "base-url") ?? profile.baseUrl,
  });
  shit_1170_print_json_fun({
    ok: true,
    swapId: result.queue.swapId,
    localPath: result.localPath,
    swap: result.queue,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
