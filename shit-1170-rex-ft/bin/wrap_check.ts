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
  shit_1170_ft_balance_of_fun,
  shit_1170_network_fun,
  shit_1170_storage_balance_of_fun,
  shit_1170_storage_minimum_balance_fun,
} from "../src/chain";
import { shit_1170_wrap_near_contract_id_fun } from "../src/wrap_near";

// the wrap check: what does the account hold, and can it wrap?
//
// --- WHY THIS CHECK IS HERE ---
// a wrap has three ways to be wrong that the chain will not stop:
//
//   1. the account has no native NEAR to wrap. `near_deposit` needs
//      an attached deposit, and an account with nothing cannot
//      attach it.
//   2. the account has no NEP-145 storage on wrap.near. the mint
//      needs somewhere to put the balance, so `near_deposit` fails
//      for an unregistered account. the fix is a `storage_deposit`
//      in the same batch.
//   3. the amount is wrong. native NEAR and wNEAR are both 24
//      decimals, so an amount that is off by a factor of a million
//      looks plausible and succeeds.
//
// this is a VIEW read. nothing here changes the chain.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "wrap_check --account <account_id> [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const account = args_require_string_fun(args, "account");
  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const contractId =
    args_string_fun(args, "contract") ?? shit_1170_wrap_near_contract_id_fun(network);

  const warnings: string[] = [];

  const accountExists = await shit_1170_account_exists_fun(network, account);
  if (!accountExists) {
    warnings.push(
      `${account} does not exist on ${network}; the wrap would fail`,
    );
  }

  // native NEAR. this is the coin the account spends when it wraps.
  let nativeNear: string | null = null;
  if (accountExists) {
    try {
      const info = await shit_1170_account_fun(network, account);
      nativeNear = info.amount;
    } catch (err) {
      warnings.push(
        `the native NEAR balance could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // wNEAR. this is what the account unwraps.
  let wnearBalance: string | null = null;
  try {
    wnearBalance = await shit_1170_ft_balance_of_fun(
      network,
      contractId,
      account,
    );
  } catch (err) {
    warnings.push(
      `the wNEAR balance could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // the storage registration. `hasStorage: false` is the fact that
  // matters: the account cannot receive the mint.
  let hasStorage: boolean | null = null;
  let storage: unknown = null;
  if (accountExists) {
    try {
      const balance = await shit_1170_storage_balance_of_fun(
        network,
        contractId,
        account,
      );
      hasStorage = balance.hasStorage;
      storage = balance.hasStorage
        ? { total: balance.total, available: balance.available }
        : null;
      if (!balance.hasStorage) {
        warnings.push(
          `${account} has no NEP-145 storage on ${contractId}; the wrap needs a storage_deposit in the same batch, before the near_deposit`,
        );
      }
    } catch (err) {
      warnings.push(
        `the account's storage on ${contractId} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // the contract's own storage minimum, so the registration deposit
  // is the live number rather than the standard's floor.
  let storageMinimum: string | null = null;
  try {
    storageMinimum = await shit_1170_storage_minimum_balance_fun(
      network,
      contractId,
    );
  } catch (err) {
    warnings.push(
      `the storage minimum could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // what the account can actually do, said plainly.
  const canWrap = accountExists && nativeNear !== null && nativeNear !== "0";
  const canUnwrap = accountExists && wnearBalance !== null && wnearBalance !== "0";

  if (!canWrap && accountExists) {
    warnings.push(
      `${account} holds no native NEAR to wrap; near_deposit needs an attached deposit and there is nothing to attach`,
    );
  }
  if (!canUnwrap && accountExists) {
    warnings.push(
      `${account} holds no wNEAR to unwrap; near_withdraw needs a balance on ${contractId}`,
    );
  }

  print_json_fun({
    ok: true,
    account,
    network,
    contract: contractId,
    accountExists,
    nativeNear,
    wnearBalance,
    hasStorage,
    storage,
    storageMinimum,
    canWrap,
    canUnwrap,
    warnings,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
