#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_network_fun,
  shit_1170_rhea_dclv2_id_fun,
  shit_1170_rhea_dclv2_storage_balance_of_fun,
  shit_1170_rhea_dclv2_storage_detail_fun,
  shit_1170_rhea_dclv2_storage_bounds_fun,
} from "../src/chain";
import {
  shit_1170_rhea_dclv2_storage_deposit_queue_call_fun,
  shit_1170_rhea_dclv2_storage_unregister_queue_call_fun,
  shit_1170_rhea_dclv2_storage_withdraw_queue_call_fun,
} from "../src/queue";

// prepare a storage register, release or unregister queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- WHY STORAGE MATTERS HERE ---
// the DEX charges per liquidity slot and per order slot on top of the
// base storage, so an account with no storage registered on the DEX
// cannot add liquidity or place a limit order.
//
// the bare `storage_balance_bounds` minimum is NOT enough in practice
// — the live minimum on mainnet is 0.5 NEAR, and that is what the
// registration attaches.
//
// --- THE RELEASES ---
// `storage_withdraw` returns everything above the required minimum,
// and `storage_unregister` returns the locked NEAR and takes the
// account's storage on the DEX back to none. both attach exactly
// 1 yoctoNEAR.
//
// **unregistering while a position is open leaves the position
// stranded.** withdraw the liquidity first.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "storage register [--account <account_id>] [--deposit <yocto>]",
        "storage withdraw [--account <account_id>]",
        "storage unregister [--account <account_id>]",
        "storage status --account <account_id>",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);
  const command = args.positional[0] ?? "register";
  const account = args_string_fun(args, "account");
  const gas = args_string_fun(args, "gas");

  if (command === "status") {
    if (!account) throw new Error("--account <account_id> is required");
    const [balance, detail, bounds] = await Promise.all([
      shit_1170_rhea_dclv2_storage_balance_of_fun(network, dclId, account),
      shit_1170_rhea_dclv2_storage_detail_fun(network, dclId, account),
      shit_1170_rhea_dclv2_storage_bounds_fun(network, dclId),
    ]);
    print_json_fun({
      ok: true,
      dclId,
      network,
      account,
      hasStorage: balance.hasStorage,
      storageTotal: balance.total,
      storageAvailable: balance.available,
      storageBounds: bounds,
      detail,
    });
    return;
  }

  if (command === "register") {
    const transaction = shit_1170_rhea_dclv2_storage_deposit_queue_call_fun({
      dclId,
      ...(gas ? { gas } : {}),
      ...(args_string_fun(args, "deposit")
        ? { deposit: args_string_fun(args, "deposit")! }
        : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_storage_deposit",
      dclId,
      network,
      // the deposit the payload carries.
      deposit: transaction.deposit,
      warnings: [
        "the deposit must cover the base storage AND the liquidity or order slots the account will use",
      ],
      transactions: [transaction],
      transaction,
    });
    return;
  }

  if (command === "withdraw") {
    const transaction = shit_1170_rhea_dclv2_storage_withdraw_queue_call_fun({
      dclId,
      ...(gas ? { gas } : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_storage_withdraw",
      dclId,
      network,
      transactions: [transaction],
      transaction,
    });
    return;
  }

  if (command === "unregister") {
    const transaction = shit_1170_rhea_dclv2_storage_unregister_queue_call_fun({
      dclId,
      ...(gas ? { gas } : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_storage_unregister",
      dclId,
      network,
      warnings: [
        "unregistering while a position is open leaves the position stranded — withdraw the liquidity first",
      ],
      transactions: [transaction],
      transaction,
    });
    return;
  }

  throw new Error(`unknown command: ${command} — use register, withdraw, unregister or status`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
