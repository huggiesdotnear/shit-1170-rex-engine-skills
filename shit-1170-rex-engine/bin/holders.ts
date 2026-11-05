#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
  quiet_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { api_intear_holders_get } from "@sleet-js/middleman-intear-api";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: ["holders --token <token_id> [--limit 100] [--cursor cursor]"],
    });
    return;
  }

  const token = args_require_string_fun(args, "token");
  const result = await quiet_fun(() =>
    api_intear_holders_get({
      token,
      limit: args_number_fun(args, "limit", 100),
      cursor: args_string_fun(args, "cursor"),
    }),
  );
  print_json_fun({ ok: true, holders: result });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
