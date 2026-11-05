#!/usr/bin/env bun
import { ft_metadata_fun_json } from "@near-kit-tool-box/fun";
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_contact_has_fun } from "../src/contacts";
import {
  shit_1170_account_exists_fun,
  shit_1170_network_fun,
  shit_1170_near_client_fun,
  shit_1170_storage_balance_of_fun,
} from "../src/chain";

// the receiver check: does the account exist, is it a known contact,
// and can it hold the token at all.
//
// --- WHY THE STORAGE CHECK IS HERE ---
// storage_balance_of returning null means the receiver has no
// NEP-145 storage on this token. a transfer to such an account can
// succeed as a transaction and deliver nothing, because the token
// contract has nowhere to put the balance. the transfer does not
// fail. it just goes nowhere, and it says so nowhere.
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
        "ft_check --token <token_id> --receiver <account_id> [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const token = args_require_string_fun(args, "token");
  const receiver = args_require_string_fun(args, "receiver");
  const network = shit_1170_network_fun(
    args_string_fun(args, "network"),
  );

  const warnings: string[] = [];

  const receiverExists = await shit_1170_account_exists_fun(network, receiver);
  if (!receiverExists) {
    warnings.push(
      `${receiver} does not exist on ${network}; the transfer would fail`,
    );
  }

  // the receiver's token storage. `hasStorage: false` is the fact
  // that matters: the receiver cannot hold the token.
  let receiverHasTokenStorage: boolean | null = null;
  let receiverStorage: unknown = null;
  if (receiverExists) {
    try {
      const storage = await shit_1170_storage_balance_of_fun(
        network,
        token,
        receiver,
      );
      receiverHasTokenStorage = storage.hasStorage;
      receiverStorage = storage.hasStorage
        ? { total: storage.total, available: storage.available }
        : null;
      if (!storage.hasStorage) {
        warnings.push(
          `${receiver} has no NEP-145 storage on ${token}; register storage with storage_deposit before the transfer or the tokens can be lost`,
        );
      }
    } catch (err) {
      warnings.push(
        `the receiver's token storage could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let tokenDecimals: number | null = null;
  let tokenSymbol: string | null = null;
  try {
    const metadata = await ft_metadata_fun_json(
      shit_1170_near_client_fun(network),
      token,
    );
    tokenDecimals = metadata.decimals ?? null;
    tokenSymbol = metadata.symbol ?? null;
  } catch (err) {
    warnings.push(
      `the token metadata could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const receiverOnContacts = await shit_1170_contact_has_fun(receiver);
  if (!receiverOnContacts) {
    warnings.push(
      `${receiver} is not on the contacts list; confirm the address with the human before transferring`,
    );
  }

  print_json_fun({
    ok: true,
    token,
    receiver,
    network,
    receiverExists,
    receiverOnContacts,
    receiverHasTokenStorage,
    receiverStorage,
    tokenDecimals,
    tokenSymbol,
    warnings,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
