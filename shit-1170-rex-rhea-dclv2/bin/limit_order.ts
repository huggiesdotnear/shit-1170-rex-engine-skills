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
  shit_1170_rhea_dclv2_id_fun,
  shit_1170_rhea_dclv2_point_aligned_fun,
  shit_1170_rhea_dclv2_pool_fun,
  shit_1170_rhea_dclv2_point_delta_fun,
} from "../src/chain";
import { shit_1170_rhea_dclv2_limit_order_queue_call_fun } from "../src/queue";

// prepare a limit order queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- THE DEX HAS NO `place_order` METHOD ---
// a limit order is an `ft_transfer_call` on the **sell token**, with
// the DEX as `receiver_id` and the order carried inside `msg`. so the
// payload's `contractId` is the SELL TOKEN, not the DEX.
//
// `buy_token` is the token being BOUGHT — the one you do not send.
//
// --- THE POINT ---
// the point must be a multiple of the pool's `point_delta` (fee
// 100→1, 400→8, 2000→40, 10000→200) AND sit on the correct side of
// `current_point` for the token being sold, else the call fails with
// `E202: illegal point`.
//
// selling `token_y` wants a point BELOW `current_point`; selling
// `token_x` wants one ABOVE.
//
// read the live order points of a pool from `get_marketdepth` — the
// `orders` key — and pick one that already exists there.
//
// --- THE GAS ---
// `LimitOrderWithSwap` runs a real swap before parking the remainder,
// so it needs 300 Tgas. the 180 Tgas of a plain swap runs out of
// prepaid gas AFTER the swap already succeeded, so the swap goes
// through and the order placement fails.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "with-swap"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "limit_order --sell-token <token_id> --amount <unit_amount> --pool-id <id> --buy-token <token_id> --point <n> [--with-swap]",
        "--with-swap fills what it can right away, then rests the remainder",
        "--network mainnet|testnet",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const dclId = shit_1170_rhea_dclv2_id_fun(network);

  const sellToken = args_string_fun(args, "sell-token");
  if (!sellToken) throw new Error("--sell-token <token_id> is required");
  const amount = args_string_fun(args, "amount");
  if (!amount) throw new Error("--amount <unit_amount> is required");
  const poolId = args_string_fun(args, "pool-id");
  if (!poolId) throw new Error("--pool-id <id> is required");
  const buyToken = args_string_fun(args, "buy-token");
  if (!buyToken) throw new Error("--buy-token <token_id> is required");
  const point = args_number_fun(args, "point");
  if (point === undefined) throw new Error("--point <n> is required");

  const withSwap = args_bool_fun(args, "with-swap");

  // the pool's own point delta and current point, read from the chain.
  const pool = await shit_1170_rhea_dclv2_pool_fun(network, dclId, poolId);
  const delta = pool.point_delta ?? shit_1170_rhea_dclv2_point_delta_fun(pool.fee);
  const warnings: string[] = [];

  if (!shit_1170_rhea_dclv2_point_aligned_fun(point, delta)) {
    warnings.push(
      `point ${point} is not a multiple of the pool's point_delta (${delta}) — the call fails with E202: illegal point`,
    );
  }

  // which side of the current point the order must sit on, for the
  // token being sold.
  if (pool.current_point !== undefined) {
    const sellsTokenX = sellToken === pool.token_x;
    const wrongSide = sellsTokenX ? point <= pool.current_point : point >= pool.current_point;
    if (wrongSide) {
      warnings.push(
        sellsTokenX
          ? `selling token_x wants a point ABOVE current_point (${pool.current_point}), and ${point} is not`
          : `selling token_y wants a point BELOW current_point (${pool.current_point}), and ${point} is not`,
      );
    }
  }

  const transaction = shit_1170_rhea_dclv2_limit_order_queue_call_fun({
    dclId,
    sell_token_id: sellToken,
    amount,
    pool_id: poolId,
    buy_token: buyToken,
    point,
    with_swap: withSwap,
    ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
  });

  print_json_fun({
    ok: true,
    queueAction: "queue_limit_order",
    dclId,
    network,
    sellToken,
    buyToken,
    poolId,
    amount,
    point,
    variant: withSwap ? "LimitOrderWithSwap" : "LimitOrder",
    pointDelta: delta,
    currentPoint: pool.current_point,
    // the call is on the SELL token, with the DEX as the receiver.
    calledOn: sellToken,
    receiver: dclId,
    warnings,
    transactions: [transaction],
    transaction,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
