#!/usr/bin/env bun
import {
  shit_1170_flag_bool_fun,
  shit_1170_flag_string_fun,
  shit_1170_parse_args_fun,
  shit_1170_require_string_fun,
} from "../src/args";
import {
  shit_1170_account_exists_fun,
  shit_1170_account_fun,
  shit_1170_network_fun,
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
      usage: ["check_receiver --id <account_id> [--network mainnet|testnet]"],
    });
    return;
  }

  const accountId = shit_1170_require_string_fun(args, "id");
  const network = shit_1170_network_fun(
    shit_1170_flag_string_fun(args, "network"),
  );

  const exists = await shit_1170_account_exists_fun(network, accountId);

  let amount: string | null = null;
  let codeHash: string | null = null;
  if (exists) {
    const account = await shit_1170_account_fun(network, accountId);
    amount = account.amount;
    codeHash = account.codeHash;
  }

  shit_1170_print_json_fun({
    ok: true,
    accountId,
    network,
    exists,
    amountYocto: amount,
    codeHash,
  });
}

main_fun().catch((err) => {
  shit_1170_print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
