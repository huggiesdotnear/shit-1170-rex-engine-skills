#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";
import { ft_metadata_fun_json } from "@near-kit-tool-box/fun";

import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
} from "../src/chain";
import { shit_1170_token_info_fun } from "../src/token_info";

// read a token's info — from the chain and from the intear API.
//
// --- WHY BOTH ---
// the CHAIN is authoritative for a token's own metadata: its name,
// its symbol and its decimals. `ft_metadata` is the token talking
// about itself.
//
// the INTEAR API adds what the chain does not know: the token's PRICE,
// its liquidity, its market cap, and the pool it trades in.
//
// so this bin reads both and labels which is which. when the two
// disagree about the symbol or the decimals, the chain wins — the
// API's symbol is a label the indexer carries, and the same symbol
// can name different tokens with different decimals.
//
// --- THE MISSING TOKENS ---
// a token the indexer has not seen comes back in `missing`. that is
// not a broken token — it is just a token the index does not have.
//
// this is a VIEW read. nothing here changes the chain.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: ["token_info --token <token_id[,token_id,...]> [--network mainnet|testnet]"],
    });
    return;
  }

  const tokenInput = args_string_fun(args, "token");
  if (!tokenInput) throw new Error("--token <token_id[,token_id,...]> is required");
  const tokens = tokenInput
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const network = shit_1170_network_fun(args_string_fun(args, "network"));

  // the chain's own answer, per token.
  const chain: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const token of tokens) {
    try {
      const metadata = await ft_metadata_fun_json(
        shit_1170_near_client_fun(network),
        token,
      );
      chain[token] = metadata;
    } catch (error) {
      chain[token] = null;
      warnings.push(
        `the chain metadata for ${token} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // the api's answer. it is an index, so it may not know the token.
  let api: Awaited<ReturnType<typeof shit_1170_token_info_fun>> | null = null;
  try {
    api = await shit_1170_token_info_fun(tokens);
  } catch (error) {
    warnings.push(
      `the intear api could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  print_json_fun({
    ok: true,
    network,
    tokens,
    // the token's own words, from the chain.
    chain,
    // the price and the market data, from the intear api.
    api,
    warnings,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
