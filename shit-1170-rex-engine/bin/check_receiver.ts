#!/usr/bin/env bun
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";
import {
  shit_1170_account_exists_fun,
  shit_1170_account_fun,
  shit_1170_network_fun,
} from "../src/chain";


async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: ["check_receiver --id <account_id> [--network mainnet|testnet]"],
    });
    return;
  }

  const accountId = args_require_string_fun(args, "id");
  const network = shit_1170_network_fun(
    args_string_fun(args, "network"),
  );

  const exists = await shit_1170_account_exists_fun(network, accountId);

  let amount: string | null = null;
  let codeHash: string | null = null;
  if (exists) {
    const account = await shit_1170_account_fun(network, accountId);
    amount = account.amount;
    codeHash = account.codeHash;
  }

  print_json_fun({
    ok: true,
    accountId,
    network,
    exists,
    amountYocto: amount,
    codeHash,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
