#!/usr/bin/env bun
import {
  ft_balance_of_fun_json,
  ft_metadata_fun_json,
} from "@near-kit-tool-box/fun";
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../../shit-1170-rex-engine/src/args";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../../shit-1170-rex-engine/src/json_io";
import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
} from "../src/chain";

// read a token's balance for one account, and the token's decimals so
// the raw amount can be read.
//
// --- WHY THE DECIMALS TRAVEL WITH THE BALANCE ---
// a balance of "1500000" means nothing on its own. it is 1.5 USDC or
// 1500000 of a 0-decimal token or dust of an 18-decimal one. the
// decimals are what turn the number into an amount a human can check,
// and an amount a human cannot check is an amount nobody checked.
//
// this is a VIEW read. nothing here changes the chain.

async function main_fun(): Promise<void> {
  const args = shit_1170_parse_args_fun(process.argv.slice(2));
  if (args.positional[0] === "help" || shit_1170_flag_bool_fun(args, "help")) {
    shit_1170_print_json_fun({
      ok: true,
      usage: [
        "ft_balance --token <token_id> --account <account_id> [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const token = shit_1170_require_string_fun(args, "token");
  const account = shit_1170_require_string_fun(args, "account");
  const network = shit_1170_network_fun(
    shit_1170_flag_string_fun(args, "network"),
  );

  const near = shit_1170_near_client_fun(network);

  const balance = await ft_balance_of_fun_json(near, token, account);

  let decimals: number | null = null;
  let symbol: string | null = null;
  try {
    const metadata = await ft_metadata_fun_json(near, token);
    decimals = metadata.decimals ?? null;
    symbol = metadata.symbol ?? null;
  } catch {
    // the balance is the answer. missing metadata does not take it
    // away — the decimals are reported as null so nobody assumes 24.
  }

  shit_1170_print_json_fun({
    ok: true,
    token,
    account,
    network,
    balance,
    decimals,
    symbol,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
