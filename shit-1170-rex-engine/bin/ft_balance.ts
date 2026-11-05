#!/usr/bin/env bun
import { ft_balance_of_fun_json } from "@near-kit-tool-box/fun";
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
} from "../src/chain";
import {
  shit_1170_print_error_fun,
  shit_1170_print_json_fun,
} from "../src/json_io";

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

  const balance = await ft_balance_of_fun_json(
    shit_1170_near_client_fun(network),
    token,
    account,
  );

  shit_1170_print_json_fun({
    ok: true,
    token,
    account,
    network,
    balance,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
