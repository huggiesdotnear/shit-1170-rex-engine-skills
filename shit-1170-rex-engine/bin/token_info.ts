#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
} from "../src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
  shit_1170_quiet_fun,
} from "../src/json_io";
import { api_intear_tokens_get } from "@sleet-js/middleman-intear-api";

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "token_info --ids <token_a,token_b> [--fields name,symbol,decimals,icon_hash,price_usd,reputation,holders,liquidity_usd,market_cap_usd,total_supply]",
        "the default fields include icon_hash; \"icon\" is also valid but returns a large inline data uri",
      ],
    });
    return;
  }

  const ids = shit_1170_flag_string_fun(args, "ids")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fields = (
    shit_1170_flag_string_fun(
      args,
      "fields",
      "name,symbol,decimals,icon_hash,price_usd,reputation,holders,liquidity_usd,market_cap_usd,total_supply",
    ) ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as Array<
      | "name"
      | "symbol"
      | "decimals"
      | "icon"
      | "icon_hash"
      | "price_usd"
      | "reputation"
      | "holders"
      | "liquidity_usd"
      | "market_cap_usd"
      | "total_supply"
    >;

  const result = await shit_1170_quiet_fun(() =>
    api_intear_tokens_get({
      fields,
      ...(ids ? { ids } : {}),
    }),
  );
  shit_1170_print_json_fun({ ok: true, tokens: result });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
