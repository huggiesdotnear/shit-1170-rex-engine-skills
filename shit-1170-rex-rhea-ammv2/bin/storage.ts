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
  shit_1170_rhea_ammv2_id_fun,
  shit_1170_rhea_ammv2_storage_balance_of_fun,
  shit_1170_rhea_ammv2_storage_bounds_fun,
} from "../src/chain";
import { shit_1170_rhea_ammv2_storage_deposit_queue_call_fun } from "../src/queue";

// prepare a storage registration queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- THE DEPOSIT ---
// the NEP-145 standard's floor is 0.00125 NEAR, and that is what the
// payload attaches by default.
//
// the DEX's own `storage_balance_bounds.min` is LOWER — 0.00102 NEAR
// on mainnet. read it with `bin/dex_check.ts` and pass `--deposit`
// when the exact minimum matters.
//
// the deposit covers the base storage. the DEX also keeps a
// per-account deposited balance and LP positions on top of it.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "storage register [--account <account_id>] [--deposit <yocto>]",
        "storage status --account <account_id>",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_ammv2_id_fun(network);
  const command = args.positional[0] ?? "register";
  const account = args_string_fun(args, "account");

  if (command === "status") {
    if (!account) throw new Error("--account <account_id> is required");
    const [balance, bounds] = await Promise.all([
      shit_1170_rhea_ammv2_storage_balance_of_fun(network, dclId, account),
      shit_1170_rhea_ammv2_storage_bounds_fun(network, dclId),
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
    });
    return;
  }

  if (command === "register") {
    const transaction = shit_1170_rhea_ammv2_storage_deposit_queue_call_fun({
      dclId,
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
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
        "the standard's floor is 0.00125 NEAR; the DEX's own storage_balance_bounds.min is lower — read it and pass --deposit when the exact minimum matters",
      ],
      transactions: [transaction],
      transaction,
    });
    return;
  }

  throw new Error(`unknown command: ${command} — use register or status`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
