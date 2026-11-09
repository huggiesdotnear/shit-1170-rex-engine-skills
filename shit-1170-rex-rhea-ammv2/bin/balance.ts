#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_network_fun,
  shit_1170_rhea_ammv2_account_info_fun,
  shit_1170_rhea_ammv2_deposits_fun,
  shit_1170_rhea_ammv2_id_fun,
  shit_1170_rhea_ammv2_pool_shares_fun,
} from "../src/chain";
import {
  shit_1170_rhea_ammv2_deposit_queue_call_fun,
  shit_1170_rhea_ammv2_withdraw_queue_call_fun,
} from "../src/queue";

// read or move the DEX's per-account deposited balance.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// the `check` command is a VIEW read. the `deposit` and `withdraw`
// commands print the QUEUE PAYLOAD and send nothing.
//
// --- THE DEPOSITED BALANCE ---
// the DEX keeps a per-account balance of every token it has seen.
// `withdraw` pays out of it.
//
// the **deposit** is an `ft_transfer_call` on the **token**, with the
// DEX as `receiver_id` and the msg `"Deposit"`. so the payload's
// `contractId` is the TOKEN.
//
// the **withdrawal** is a contract method on the DEX, and its
// `token_id` is the DEX's INNER token id for the pool — `"2794"` for
// pool 2794, or the full `<pool_id>:<token_account>` form. so the
// payload's `contractId` is the DEX.
//
// a swap does NOT need the deposited balance — it takes the tokens
// straight from the caller's wallet.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "balance check --account <account_id> [--pool-id <n>]",
        "balance deposit --token <token_id> --amount <unit_amount> [--account <account_id>]",
        "balance withdraw --token-id <inner_token_id> --amount <unit_amount> [--account <account_id>]",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_ammv2_id_fun(network);
  const command = args.positional[0] ?? "check";
  const account = args_string_fun(args, "account");

  if (command === "check") {
    if (!account) throw new Error("--account <account_id> is required");
    const [deposits, info] = await Promise.all([
      shit_1170_rhea_ammv2_deposits_fun(network, dclId, account),
      shit_1170_rhea_ammv2_account_info_fun(network, dclId, account),
    ]);

    // the account's LP shares in one pool, when asked.
    const poolId = args_number_fun(args, "pool-id");
    let poolShares: string | null = null;
    if (poolId !== undefined) {
      poolShares = await shit_1170_rhea_ammv2_pool_shares_fun(
        network,
        dclId,
        poolId,
        account,
      );
    }

    // only the non-zero entries — the full map holds every token the
    // DEX has ever seen.
    const held: Record<string, string> = {};
    for (const [token, balance] of Object.entries(deposits ?? {})) {
      if (balance && balance !== "0") held[token] = balance;
    }

    print_json_fun({
      ok: true,
      dclId,
      network,
      account,
      accountInfo: info,
      // the non-zero part of the deposited balance.
      depositedBalance: held,
      // how many tokens the DEX holds for this account in total.
      depositedTokenCount: Object.keys(held).length,
      poolId: poolId ?? null,
      poolShares,
    });
    return;
  }

  if (command === "deposit") {
    const token = args_string_fun(args, "token");
    if (!token) throw new Error("--token <token_id> is required");
    const amount = args_string_fun(args, "amount");
    if (!amount) throw new Error("--amount <unit_amount> is required");

    const transaction = shit_1170_rhea_ammv2_deposit_queue_call_fun({
      dclId,
      token_id: token,
      amount,
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_deposit",
      dclId,
      network,
      token,
      amount,
      // the call is on the TOKEN, with the DEX as the receiver.
      calledOn: token,
      receiver: dclId,
      warnings: [
        "the DEX must be registered as an FT holder of the token, or the call panics with \"The account <dex> is not registered\" and the tokens are refunded",
      ],
      transactions: [transaction],
      transaction,
    });
    return;
  }

  if (command === "withdraw") {
    // the DEX's inner token id for the pool — "2794" for pool 2794,
    // or the full "<pool_id>:<token_account>" form.
    const tokenId =
      args_string_fun(args, "token-id") ?? args_string_fun(args, "token");
    if (!tokenId) {
      throw new Error(
        "--token-id <inner_token_id> is required — the dex's inner token id for the pool, e.g. 2794",
      );
    }
    const amount = args_string_fun(args, "amount");
    if (!amount) throw new Error("--amount <unit_amount> is required");

    const transaction = shit_1170_rhea_ammv2_withdraw_queue_call_fun({
      dclId,
      token_id: tokenId,
      amount,
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
    });
    print_json_fun({
      ok: true,
      queueAction: "queue_withdraw",
      dclId,
      network,
      tokenId,
      amount,
      // a wNEAR withdrawal is unwrapped back to NEAR by default.
      skipUnwrapNear: false,
      transactions: [transaction],
      transaction,
    });
    return;
  }

  throw new Error(`unknown command: ${command} — use check, deposit or withdraw`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
