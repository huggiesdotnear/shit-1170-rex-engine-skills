#!/usr/bin/env bun
import { ft_balance_of_fun_json } from "@near-kit-tool-box/fun";
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";
import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
} from "../src/chain";


async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "ft_balance --token <token_id> --account <account_id> [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const token = args_require_string_fun(args, "token");
  const account = args_require_string_fun(args, "account");
  const network = shit_1170_network_fun(
    args_string_fun(args, "network"),
  );

  const balance = await ft_balance_of_fun_json(
    shit_1170_near_client_fun(network),
    token,
    account,
  );

  print_json_fun({
    ok: true,
    token,
    account,
    network,
    balance,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
