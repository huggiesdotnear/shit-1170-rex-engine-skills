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
  shit_1170_rhea_dclv2_user_asset_fun,
} from "../src/chain";
import {
  shit_1170_rhea_dclv2_deposit_queue_call_fun,
  shit_1170_rhea_dclv2_withdraw_asset_queue_call_fun,
} from "../src/queue";

// prepare an internal-balance deposit or a withdrawal.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- THE TWO SIDES ---
// the **deposit** is an `ft_transfer_call` on the TOKEN, with the DEX
// as `receiver_id` and the msg `"Deposit"`. so the payload's
// `contractId` is the TOKEN, not the DEX.
//
// the **withdrawal** is a contract method on the DEX. so the payload's
// `contractId` is the DEX.
//
// --- WHY THE INTERNAL BALANCE EXISTS ---
// `add_liquidity` pulls from the internal balance, so the tokens have
// to be in there first. a swap does NOT touch it — a swap goes
// straight in and straight out to the wallet.
//
// --- THE GAS ---
// a deposit needs 1000 Tgas — far more than a swap's 180, because
// the DEX credits the balance and does the storage work.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "balance deposit --token <token_id> --amount <unit_amount> [--account <account_id>]",
        "balance withdraw --token <token_id> [--amount <unit_amount>] [--account <account_id>]",
        "balance check --token <token_id> --account <account_id>",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);
  const command = args.positional[0] ?? "deposit";
  const account = args_string_fun(args, "account");
  const token = args_string_fun(args, "token");
  if (!token) throw new Error("--token <token_id> is required");

  if (command === "check") {
    if (!account) throw new Error("--account <account_id> is required");
    const balance = await shit_1170_rhea_dclv2_user_asset_fun(
      network,
      dclId,
      token,
      account,
    );
    print_json_fun({
      ok: true,
      dclId,
      network,
      account,
      token,
      // the internal balance of that token, in its smallest unit.
      internalBalance: balance,
    });
    return;
  }

  if (command === "deposit") {
    const amount = args_string_fun(args, "amount");
    if (!amount) throw new Error("--amount <unit_amount> is required");
    const transaction = shit_1170_rhea_dclv2_deposit_queue_call_fun({
      dclId,
      token_id: token,
      amount,
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_internal_deposit",
      dclId,
      network,
      token,
      amount,
      // the call is on the TOKEN, with the DEX as the receiver.
      calledOn: token,
      receiver: dclId,
      warnings: [
        "the DEX must be registered as an FT holder of the token, or the call panics with \"The account <dex> is not registered\" and the tokens are refunded",
        "a taxed token arrives with less than was sent",
      ],
      transactions: [transaction],
      transaction,
    });
    return;
  }

  if (command === "withdraw") {
    const transaction = shit_1170_rhea_dclv2_withdraw_asset_queue_call_fun({
      dclId,
      token_id: token,
      ...(args_string_fun(args, "amount")
        ? { amount: args_string_fun(args, "amount")! }
        : {}),
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_internal_withdraw",
      dclId,
      network,
      token,
      // no amount means the whole balance of that token.
      wholeBalance: !args_string_fun(args, "amount"),
      transactions: [transaction],
      transaction,
    });
    return;
  }

  throw new Error(`unknown command: ${command} — use deposit, withdraw or check`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
