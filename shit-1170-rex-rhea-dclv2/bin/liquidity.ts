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
  shit_1170_rhea_dclv2_aligned_points_fun,
  shit_1170_rhea_dclv2_id_fun,
  shit_1170_rhea_dclv2_point_aligned_fun,
  shit_1170_rhea_dclv2_pool_fun,
  shit_1170_rhea_dclv2_point_delta_fun,
} from "../src/chain";
import {
  shit_1170_rhea_dclv2_add_liquidity_queue_call_fun,
  shit_1170_rhea_dclv2_remove_liquidity_queue_call_fun,
} from "../src/queue";

// prepare an add_liquidity or remove_liquidity queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- THE LP FLOW IS THREE STEPS ---
// `add_liquidity` PULLS FROM THE INTERNAL BALANCE, so the tokens have
// to be in there first:
//
//   1. `ft_transfer_call` on the token with msg = `"Deposit"`
//   2. `add_liquidity` — this bin
//   3. `withdraw_asset` — to get the tokens out again
//
// removing liquidity puts the tokens back in the internal balance —
// they do NOT land in the wallet.
//
// --- THE POINTS ---
// the range must sit on multiples of the pool's `point_delta` (fee
// 100→1, 400→8, 2000→40, 10000→200), else the call fails with
// `E200: invalid endpoint`. `current_point` is generally not a
// multiple, so the bin reports the aligned edges around it.
//
// --- THE SLIPPAGE BOUNDS ---
// `min_amount_x` and `min_amount_y` are REQUIRED fields — the
// contract rejects a missing one. they are sent as `"0"` when not
// given, so set them above zero before using this with value.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "liquidity add --pool-id <id> --left-point <n> --right-point <n> --amount-x <unit> --amount-y <unit> [--min-amount-x <unit>] [--min-amount-y <unit>]",
        "liquidity remove --lpt-id <pool_id#index> --amount <liquidity_amount> [--min-amount-x <unit>] [--min-amount-y <unit>]",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);
  const command = args.positional[0] ?? "add";
  const warnings: string[] = [];

  if (command === "add") {
    const poolId = args_string_fun(args, "pool-id");
    if (!poolId) throw new Error("--pool-id <id> is required");
    const leftPoint = Number(args_string_fun(args, "left-point"));
    const rightPoint = Number(args_string_fun(args, "right-point"));
    if (!Number.isInteger(leftPoint) || !Number.isInteger(rightPoint)) {
      throw new Error("--left-point and --right-point are required whole numbers");
    }
    const amountX = args_string_fun(args, "amount-x") ?? "0";
    const amountY = args_string_fun(args, "amount-y") ?? "0";

    // the pool's own point delta, read from the chain.
    const pool = await shit_1170_rhea_dclv2_pool_fun(network, dclId, poolId);
    const delta = pool.point_delta ?? shit_1170_rhea_dclv2_point_delta_fun(pool.fee);
    const aligned =
      pool.current_point !== undefined
        ? shit_1170_rhea_dclv2_aligned_points_fun(pool.current_point, delta)
        : null;

    if (!shit_1170_rhea_dclv2_point_aligned_fun(leftPoint, delta)) {
      warnings.push(
        `left_point ${leftPoint} is not a multiple of the pool's point_delta (${delta}) — the call fails with E200: invalid endpoint`,
      );
    }
    if (!shit_1170_rhea_dclv2_point_aligned_fun(rightPoint, delta)) {
      warnings.push(
        `right_point ${rightPoint} is not a multiple of the pool's point_delta (${delta}) — the call fails with E200: invalid endpoint`,
      );
    }
    if (aligned) {
      warnings.push(
        `the pool's current_point is ${pool.current_point}; the aligned edges around it are ${aligned.left} and ${aligned.right}`,
      );
    }

    const transaction = shit_1170_rhea_dclv2_add_liquidity_queue_call_fun({
      dclId,
      pool_id: poolId,
      left_point: leftPoint,
      right_point: rightPoint,
      amount_x: amountX,
      amount_y: amountY,
      min_amount_x: args_string_fun(args, "min-amount-x"),
      min_amount_y: args_string_fun(args, "min-amount-y"),
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
    });

    print_json_fun({
      ok: true,
      queueAction: "queue_add_liquidity",
      dclId,
      network,
      poolId,
      leftPoint,
      rightPoint,
      amountX,
      amountY,
      pointDelta: delta,
      alignedPoints: aligned,
      // the tokens must be in the internal balance before this works.
      requiresInternalBalance: true,
      warnings,
      transactions: [transaction],
      transaction,
    });
    return;
  }

  if (command === "remove") {
    const lptId = args_string_fun(args, "lpt-id");
    if (!lptId) throw new Error("--lpt-id <pool_id#index> is required");
    const amount = args_string_fun(args, "amount");
    if (!amount) throw new Error("--amount <liquidity_amount> is required");

    const transaction = shit_1170_rhea_dclv2_remove_liquidity_queue_call_fun({
      dclId,
      lpt_id: lptId,
      amount,
      min_amount_x: args_string_fun(args, "min-amount-x"),
      min_amount_y: args_string_fun(args, "min-amount-y"),
      ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
    });

    print_json_fun({
      ok: true,
      queueAction: "queue_remove_liquidity",
      dclId,
      network,
      lptId,
      // the liquidity amount, not a token amount.
      amount,
      // the tokens land in the internal balance, not the wallet.
      landsInInternalBalance: true,
      // an amount of "0" claims the fees without removing liquidity.
      claimsFeesOnly: amount === "0",
      warnings,
      transactions: [transaction],
      transaction,
    });
    return;
  }

  throw new Error(`unknown command: ${command} — use add or remove`);
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
