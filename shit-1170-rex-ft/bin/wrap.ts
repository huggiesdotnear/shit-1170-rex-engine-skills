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
  shit_1170_near_deposit_batch_fun,
  shit_1170_near_deposit_queue_call_fun,
  shit_1170_near_withdraw_queue_call_fun,
  shit_1170_wrap_near_contract_id_fun,
  shit_1170_wrap_near_storage_deposit_queue_call_fun,
} from "../src/index";

// prepare a wrap or an unwrap.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- WHY A WRAP IS NOT A SWAP ---
// the engine's swap queue names a token sold and a token bought, and
// a router works the route out at execution time. `near_deposit` and
// `near_withdraw` are direct calls to wrap.near, so a wrap is queued
// as a BATCH OF CALLS with the engine skill's `queue_tx.ts`.
//
// --- WHY THE WRAP CARRIES A STORAGE DEPOSIT ---
// `near_deposit` mints wNEAR to the caller, and the contract needs
// somewhere to put the balance. an account with no NEP-145 storage
// registered on wrap.near cannot hold the mint. so the registration
// goes in the same batch, in front of the deposit.
//
// `--no-storage-deposit` drops it, and that is only right when the
// account is ALREADY registered. `wrap_check.ts` says which.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-storage-deposit"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "wrap --direction wrap --amount <yoctoNEAR> [--gas tgas] [--storage-deposit yocto] [--no-storage-deposit]",
        "wrap --direction unwrap --amount <wNEAR_unit> [--gas tgas]",
        "wrap --direction storage --storage-deposit yocto   # just the registration",
        "",
        "the amount is in the SMALLEST UNIT. native NEAR and wNEAR are both 24 decimals.",
        "--no-storage-deposit is only right when the account is already registered on wrap.near.",
      ],
    });
    return;
  }

  const direction = args_require_string_fun(args, "direction");
  const network = args_string_fun(args, "network") === "testnet" ? "testnet" : "mainnet";
  const contractId = args_string_fun(args, "contract") ?? shit_1170_wrap_near_contract_id_fun(network);
  const gas = args_string_fun(args, "gas");
  const amount = args_string_fun(args, "amount");
  const storageDeposit = args_string_fun(args, "storage-deposit");

  if (direction === "storage") {
    print_json_fun({
      ok: true,
      action: "queue_wrap_near_storage_deposit",
      transactions: [
        shit_1170_wrap_near_storage_deposit_queue_call_fun({
          contractId,
          deposit: storageDeposit,
          gas,
        }),
      ],
    });
    return;
  }

  if (!amount) {
    throw new Error("--amount <smallest_unit> is required");
  }

  if (direction === "wrap") {
    const transactions = shit_1170_near_deposit_batch_fun({
      amount,
      contractId,
      gas,
      deposit: args_string_fun(args, "deposit"),
      storageDeposit,
      storageGas: args_string_fun(args, "storage-gas"),
      withStorageDeposit: !args_bool_fun(args, "no-storage-deposit"),
    });

    print_json_fun({
      ok: true,
      action: "queue_near_deposit",
      direction: "wrap",
      from: "near",
      to: "wrap.near",
      amount,
      transactions,
    });
    return;
  }

  if (direction === "unwrap") {
    print_json_fun({
      ok: true,
      action: "queue_near_withdraw",
      direction: "unwrap",
      from: "wrap.near",
      to: "near",
      amount,
      transactions: [
        shit_1170_near_withdraw_queue_call_fun({
          amount,
          contractId,
          gas,
          deposit: args_string_fun(args, "deposit"),
        }),
      ],
    });
    return;
  }

  throw new Error(
    `--direction must be "wrap", "unwrap", or "storage", got "${direction}"`,
  );
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
