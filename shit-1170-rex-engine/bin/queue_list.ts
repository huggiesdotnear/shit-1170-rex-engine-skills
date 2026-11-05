#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_swap_list_fun, shit_1170_tx_list_fun } from "../src/engine";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "hide-sent"],
  });
  const kind = args.positional[0] ?? "help";
  const baseUrl = args_string_fun(args, "base-url");

  if (kind === "tx") {
    const result = await shit_1170_tx_list_fun(
      {
        account_id: args_string_fun(args, "account-id"),
        contract_id: args_string_fun(args, "contract-id"),
        method: args_string_fun(args, "method"),
        hide_sent: args_bool_fun(args, "hide-sent"),
        limit: args_number_fun(args, "limit"),
        cursor: args_string_fun(args, "cursor"),
      },
      { baseUrl },
    );
    print_json_fun({ ok: true, ...result });
    return;
  }

  if (kind === "swap") {
    const result = await shit_1170_swap_list_fun(
      {
        account_id: args_string_fun(args, "account-id"),
        contract_id: args_string_fun(args, "contract-id"),
        token_in: args_string_fun(args, "token-in"),
        token_out: args_string_fun(args, "token-out"),
        hide_sent: args_bool_fun(args, "hide-sent"),
        limit: args_number_fun(args, "limit"),
        cursor: args_string_fun(args, "cursor"),
      },
      { baseUrl },
    );
    print_json_fun({ ok: true, ...result });
    return;
  }

  if (kind === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "queue_list tx [--account-id a,b] [--contract-id c,d] [--method m] [--hide-sent] [--limit n] [--cursor c]",
        "queue_list swap [--account-id a,b] [--contract-id c,d] [--token-in id] [--token-out id] [--hide-sent] [--limit n] [--cursor c]",
      ],
    });
    return;
  }

  throw new Error(`unknown command: ${kind}`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
