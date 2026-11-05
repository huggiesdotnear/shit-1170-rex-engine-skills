#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_number_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";
import { shit_1170_swap_list_fun, shit_1170_tx_list_fun } from "../src/engine";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  const kind = args.positional[0] ?? "help";
  const baseUrl = shit_1170_flag_string_fun(args, "base-url");

  if (kind === "tx") {
    const result = await shit_1170_tx_list_fun(
      {
        account_id: shit_1170_flag_string_fun(args, "account-id"),
        contract_id: shit_1170_flag_string_fun(args, "contract-id"),
        method: shit_1170_flag_string_fun(args, "method"),
        hide_sent: shit_1170_flag_bool_fun(args, "hide-sent"),
        limit: shit_1170_flag_number_fun(args, "limit"),
        cursor: shit_1170_flag_string_fun(args, "cursor"),
      },
      { baseUrl },
    );
    shit_1170_print_json_fun({ ok: true, ...result });
    return;
  }

  if (kind === "swap") {
    const result = await shit_1170_swap_list_fun(
      {
        account_id: shit_1170_flag_string_fun(args, "account-id"),
        contract_id: shit_1170_flag_string_fun(args, "contract-id"),
        token_in: shit_1170_flag_string_fun(args, "token-in"),
        token_out: shit_1170_flag_string_fun(args, "token-out"),
        hide_sent: shit_1170_flag_bool_fun(args, "hide-sent"),
        limit: shit_1170_flag_number_fun(args, "limit"),
        cursor: shit_1170_flag_string_fun(args, "cursor"),
      },
      { baseUrl },
    );
    shit_1170_print_json_fun({ ok: true, ...result });
    return;
  }

  if (kind === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
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
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
