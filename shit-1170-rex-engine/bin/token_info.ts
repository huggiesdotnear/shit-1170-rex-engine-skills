#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
  quiet_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { api_intear_tokens_get } from "@sleet-js/middleman-intear-api";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "token_info --ids <token_a,token_b> [--fields name,symbol,decimals,icon_hash,price_usd,reputation,holders,liquidity_usd,market_cap_usd,total_supply]",
        "the default fields include icon_hash; \"icon\" is also valid but returns a large inline data uri",
      ],
    });
    return;
  }

  const ids = args_string_fun(args, "ids")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fields = (
    args_string_fun(
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

  const result = await quiet_fun(() =>
    api_intear_tokens_get({
      fields,
      ...(ids ? { ids } : {}),
    }),
  );
  print_json_fun({ ok: true, tokens: result });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
