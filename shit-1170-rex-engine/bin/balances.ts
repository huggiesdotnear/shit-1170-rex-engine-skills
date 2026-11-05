#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
  shit_1170_quiet_fun,
} from "../src/json_io";
import { api_intear_balances_get } from "@sleet-js/middleman-intear-api";

const SHIT_1170_BALANCE_SOURCES = ["direct", "native", "rhea"] as const;
type SHIT_1170_BALANCE_SOURCE = (typeof SHIT_1170_BALANCE_SOURCES)[number];

function parse_sources_fun(value: string): SHIT_1170_BALANCE_SOURCE[] {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const sources: SHIT_1170_BALANCE_SOURCE[] = [];
  for (const part of parts) {
    if (
      !(SHIT_1170_BALANCE_SOURCES as readonly string[]).includes(part)
    ) {
      throw new Error(
        `unknown balance source "${part}"; allowed sources are ${SHIT_1170_BALANCE_SOURCES.join(", ")}`,
      );
    }
    sources.push(part as SHIT_1170_BALANCE_SOURCE);
  }
  return sources;
}

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "balances --account <account_id> [--sources direct,native,rhea] [--tokens token_a,token_b]",
      ],
    });
    return;
  }

  const account = shit_1170_require_string_fun(args, "account");
  const sources = parse_sources_fun(
    shit_1170_flag_string_fun(args, "sources") ?? "direct,native",
  );
  const tokens = shit_1170_flag_string_fun(args, "tokens")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await shit_1170_quiet_fun(() =>
    api_intear_balances_get({
      account,
      sources,
      ...(tokens ? { tokens } : {}),
    }),
  );
  shit_1170_print_json_fun({ ok: true, balances: result });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
