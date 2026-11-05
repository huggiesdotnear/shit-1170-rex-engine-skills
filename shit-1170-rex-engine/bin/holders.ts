#!/usr/bin/env bun
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
  shit_1170_quiet_fun,
} from "../src/json_io";
import { api_intear_holders_get } from "@sleet-js/middleman-intear-api";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: ["holders --token <token_id> [--limit 100] [--cursor cursor]"],
    });
    return;
  }

  const token = shit_1170_require_string_fun(args, "token");
  const result = await shit_1170_quiet_fun(() =>
    api_intear_holders_get({
      token,
      limit: shit_1170_flag_number_fun(args, "limit", 100),
      cursor: shit_1170_flag_string_fun(args, "cursor"),
    }),
  );
  shit_1170_print_json_fun({ ok: true, holders: result });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
