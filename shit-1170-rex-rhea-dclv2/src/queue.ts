// the Rhea DCL v2 queue payloads, as the rex engine needs them.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the write
// side of this skill is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// --- THE THREE KINDS OF CALL ---
// the DEX is reached in three different ways, and mixing them up is
// the most common mistake:
//
// 1. a VIEW — a read. free, no signer.
//
// 2. a CONTRACT METHOD — a call on the DEX itself.
//    `add_liquidity`, `remove_liquidity`, `withdraw_asset`,
//    `cancel_order`, the storage methods.
//
// 3. an `ft_transfer_call` on the TOKEN — a call on the token
//    contract, with the DEX as `receiver_id` and the DEX call carried
//    inside `msg`. swaps, internal-balance deposits and limit orders
//    all work this way.
//
// the DEX has **no `swap` method, no `deposit` method and no
// `place_order` method**. those three flows are all `ft_transfer_call`
// on the token.
//
// --- WHY THE GAS AND THE DEPOSIT ARE WHERE THEY ARE ---
// the toolbox's `rhea_dclv2_*_fun_json` helpers are the strongest
// evidence for the argument shape, the gas and the deposit, because
// they build and send the exact JSON. the values below are taken from
// those helpers:
//
//   add_liquidity        gas 300 Tgas   deposit 0
//   remove_liquidity     gas 300 Tgas   deposit 0
//   withdraw_asset       gas 300 Tgas   deposit 0
//   cancel_order         gas 300 Tgas   deposit 0
//   storage_deposit      gas not set    deposit 0.5 NEAR
//   storage_withdraw     gas 300 Tgas   deposit 1 yoctoNEAR
//   storage_unregister   gas 300 Tgas   deposit 1 yoctoNEAR
//   ft_transfer_call     gas varies     deposit 1 yoctoNEAR
//
// the `ft_transfer_call` gas depends on the flow, and it is the one to
// watch:
//
//   deposit          1000 Tgas
//   swap              180 Tgas
//   limit order       300 Tgas
//
// a limit order that swaps first needs more than the gas of a plain
// swap — 180 Tgas runs out of prepaid gas AFTER the swap already
// succeeded, so the swap goes through and the order placement fails.

import { ft_methods_const } from "@near-kit-tool-box/fun";
import {
  queue_call_fun,
  type QUEUE_CALL,
} from "@huggies/shit-1170-rex-engine-middleman";

export type { QUEUE_CALL };

// the toolbox's working gas for the DCL v2 contract methods.
export const SHIT_1170_RHEA_DCLV2_DEFAULT_GAS = "30000000000000";

// the gas each `ft_transfer_call` flow needs, in gas units.
export const SHIT_1170_RHEA_DCLV2_DEPOSIT_GAS = "1000000000000000";
export const SHIT_1170_RHEA_DCLV2_SWAP_GAS = "180000000000000";
export const SHIT_1170_RHEA_DCLV2_LIMIT_ORDER_GAS = "300000000000000";

// an `ft_transfer_call` attaches exactly 1 yoctoNEAR.
export const SHIT_1170_RHEA_DCLV2_FT_DEPOSIT = "1";

// the storage registration deposit: 0.5 NEAR.
//
// the bare `storage_balance_bounds` minimum is NOT enough in practice
// — the DEX charges per liquidity and per order slot on top of it,
// and the live minimum on mainnet is itself 0.5 NEAR.
export const SHIT_1170_RHEA_DCLV2_STORAGE_DEPOSIT = "500000000000000000000000";

// the storage release methods attach exactly 1 yoctoNEAR.
export const SHIT_1170_RHEA_DCLV2_STORAGE_RELEASE_DEPOSIT = "1";

// --- THE ARGUMENT SHAPES ---
//
// every shape the contract defines, so an agent can build the right
// call without reading the contract's source.

export interface SHIT_1170_RHEA_DCLV2_CALL_REQUEST {
  dclId: string;
  gas?: string;
  deposit?: string;
}

/**
 * the `add_liquidity` args.
 *
 * `pool_id` is `<token_x>|<token_y>|<fee>` — the tokens must be
 * sorted. `left_point` and `right_point` must be multiples of the
 * pool's `point_delta`, else the call fails with
 * `E200: invalid endpoint`.
 *
 * `amount_x` and `amount_y` are yocto deposits. for a single-sided
 * range pass `"0"` for the side you do not use: a range fully above
 * `current_point` only consumes `amount_x`, fully below only
 * `amount_y`.
 *
 * `min_amount_x` and `min_amount_y` are REQUIRED fields — the
 * slippage guards. they are sent as `"0"` when not given, so set them
 * above zero before using this with value.
 */
export function shit_1170_rhea_dclv2_add_liquidity_args_fun(
  pool_id: string,
  left_point: number,
  right_point: number,
  amount_x: string,
  amount_y: string,
  min_amount_x?: string,
  min_amount_y?: string,
): Record<string, unknown> {
  const pool = pool_id.trim();
  if (!pool) throw new Error("pool id is required");
  if (!Number.isInteger(left_point) || !Number.isInteger(right_point)) {
    throw new Error("left_point and right_point must be whole numbers");
  }
  if (right_point <= left_point) {
    throw new Error("right_point must be greater than left_point");
  }
  const x = amount_x.trim();
  const y = amount_y.trim();
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    throw new Error(
      "amount_x and amount_y must be whole numbers in the token's smallest unit",
    );
  }
  return {
    pool_id: pool,
    left_point,
    right_point,
    amount_x: x,
    amount_y: y,
    min_amount_x: min_amount_x ?? "0",
    min_amount_y: min_amount_y ?? "0",
  };
}

/**
 * the `remove_liquidity` args.
 *
 * `lpt_id` is the position id — `<pool_id>#<index>`. `amount` is the
 * **liquidity amount**, not a token amount.
 *
 * `min_amount_x` and `min_amount_y` are required fields, sent as
 * `"0"` when not given.
 *
 * the tokens land in the signer's internal balance — pull them out
 * with `withdraw_asset`.
 */
export function shit_1170_rhea_dclv2_remove_liquidity_args_fun(
  lpt_id: string,
  amount: string,
  min_amount_x?: string,
  min_amount_y?: string,
): Record<string, unknown> {
  const id = lpt_id.trim();
  if (!id) throw new Error("lpt id is required");
  const unit = amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error("amount must be a whole number — the LIQUIDITY amount, not a token amount");
  }
  return {
    lpt_id: id,
    amount: unit,
    min_amount_x: min_amount_x ?? "0",
    min_amount_y: min_amount_y ?? "0",
  };
}

/**
 * the `withdraw_asset` args.
 *
 * omit `amount` to withdraw the whole balance of that token — the call
 * shape is then just `{ token_id }`.
 */
export function shit_1170_rhea_dclv2_withdraw_asset_args_fun(
  token_id: string,
  amount?: string,
): Record<string, unknown> {
  const token = token_id.trim();
  if (!token) throw new Error("token id is required");
  const args: Record<string, unknown> = { token_id: token };
  if (amount !== undefined && amount !== "") {
    const unit = amount.trim();
    if (!/^\d+$/.test(unit)) {
      throw new Error("amount must be a whole number in the token's smallest unit");
    }
    args.amount = unit;
  }
  return args;
}

/**
 * the `cancel_order` args.
 *
 * omit `amount` for a full cancel. pass `"0"` to claim the filled
 * amount (`unclaimed_amount`) without cancelling the remainder.
 */
export function shit_1170_rhea_dclv2_cancel_order_args_fun(
  order_id: string,
  amount?: string,
): Record<string, unknown> {
  const id = order_id.trim();
  if (!id) throw new Error("order id is required");
  const args: Record<string, unknown> = { order_id: id };
  if (amount !== undefined && amount !== "") {
    const unit = amount.trim();
    if (!/^\d+$/.test(unit)) {
      throw new Error("amount must be a whole number in the token's smallest unit");
    }
    args.amount = unit;
  }
  return args;
}

/**
 * the `storage_deposit` args.
 *
 * `registration_only` registers the storage without doing anything
 * else with it.
 */
export function shit_1170_rhea_dclv2_storage_deposit_args_fun(
  registration_only = true,
): Record<string, unknown> {
  return { registration_only };
}

// --- THE QUEUE PAYLOADS ---
//
// these are DATA. the engine queues them and a human signs them.

/**
 * prepare an `add_liquidity` queue payload.
 *
 * the deposit is 0 — the contract rejects an attached one with
 * "Method add_liquidity doesn't accept deposit".
 */
export function shit_1170_rhea_dclv2_add_liquidity_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    pool_id: string;
    left_point: number;
    right_point: number;
    amount_x: string;
    amount_y: string;
    min_amount_x?: string;
    min_amount_y?: string;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "add_liquidity",
    args: shit_1170_rhea_dclv2_add_liquidity_args_fun(
      request.pool_id,
      request.left_point,
      request.right_point,
      request.amount_x,
      request.amount_y,
      request.min_amount_x,
      request.min_amount_y,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `remove_liquidity` queue payload.
 */
export function shit_1170_rhea_dclv2_remove_liquidity_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    lpt_id: string;
    amount: string;
    min_amount_x?: string;
    min_amount_y?: string;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "remove_liquidity",
    args: shit_1170_rhea_dclv2_remove_liquidity_args_fun(
      request.lpt_id,
      request.amount,
      request.min_amount_x,
      request.min_amount_y,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `withdraw_asset` queue payload.
 */
export function shit_1170_rhea_dclv2_withdraw_asset_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    token_id: string;
    amount?: string;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "withdraw_asset",
    args: shit_1170_rhea_dclv2_withdraw_asset_args_fun(
      request.token_id,
      request.amount,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `cancel_order` queue payload.
 */
export function shit_1170_rhea_dclv2_cancel_order_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    order_id: string;
    amount?: string;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "cancel_order",
    args: shit_1170_rhea_dclv2_cancel_order_args_fun(
      request.order_id,
      request.amount,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `storage_deposit` queue payload.
 *
 * the deposit is 0.5 NEAR — the DEX charges per liquidity and per
 * order slot, and the bare minimum is not enough in practice.
 */
export function shit_1170_rhea_dclv2_storage_deposit_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    registration_only?: boolean;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "storage_deposit",
    args: shit_1170_rhea_dclv2_storage_deposit_args_fun(
      request.registration_only ?? true,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit:
      request.deposit ?? SHIT_1170_RHEA_DCLV2_STORAGE_DEPOSIT,
  });
}

/**
 * prepare a `storage_withdraw` queue payload.
 *
 * the deposit is exactly 1 yoctoNEAR.
 */
export function shit_1170_rhea_dclv2_storage_withdraw_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST,
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "storage_withdraw",
    args: {},
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit:
      request.deposit ?? SHIT_1170_RHEA_DCLV2_STORAGE_RELEASE_DEPOSIT,
  });
}

/**
 * prepare a `storage_unregister` queue payload.
 *
 * the deposit is exactly 1 yoctoNEAR.
 */
export function shit_1170_rhea_dclv2_storage_unregister_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST,
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "storage_unregister",
    args: {},
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEFAULT_GAS,
    deposit:
      request.deposit ?? SHIT_1170_RHEA_DCLV2_STORAGE_RELEASE_DEPOSIT,
  });
}

// --- THE TOKEN INFLOWS ---
//
// these are calls on the TOKEN contract, with the DEX as the
// receiver. the `contractId` in the payload is the TOKEN, not the
// DEX.

/**
 * the `ft_transfer_call` args for a DEX inflow.
 */
export function shit_1170_rhea_dclv2_ft_transfer_call_args_fun(
  receiver_id: string,
  amount: string,
  msg: string,
): Record<string, unknown> {
  const receiver = receiver_id.trim();
  if (!receiver) throw new Error("receiver id is required");
  const unit = amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error("amount must be a whole number in the token's smallest unit");
  }
  return { receiver_id: receiver, amount: unit, msg };
}

/**
 * prepare the `ft_transfer_call` that DEPOSITS into the DEX's
 * internal balance.
 *
 * the `msg` is the JSON string `"Deposit"`, including its quotes.
 */
export function shit_1170_rhea_dclv2_deposit_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    token_id: string;
    amount: string;
  },
): QUEUE_CALL {
  const tokenId = request.token_id.trim();
  if (!tokenId) throw new Error("token id is required");
  const receiver = request.dclId.trim();
  if (!receiver) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.ft_transfer_call,
    args: shit_1170_rhea_dclv2_ft_transfer_call_args_fun(
      receiver,
      request.amount,
      JSON.stringify("Deposit"),
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_DEPOSIT_GAS,
    deposit: request.deposit ?? SHIT_1170_RHEA_DCLV2_FT_DEPOSIT,
  });
}

/**
 * prepare the `ft_transfer_call` that SWAPS.
 *
 * the `msg` carries the swap as a nested `Swap` object:
 * `{ "Swap": { "pool_ids": [...], "output_token": "...", "min_output_amount": "0" } }`.
 *
 * `min_output_amount` is the slippage floor — take the quote amount
 * and shave the tolerance off it. `"0"` accepts any output price.
 */
export function shit_1170_rhea_dclv2_swap_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    token_in_id: string;
    amount_in: string;
    pool_ids: string[];
    output_token: string;
    min_output_amount: string;
  },
): QUEUE_CALL {
  const tokenId = request.token_in_id.trim();
  if (!tokenId) throw new Error("input token id is required");
  const receiver = request.dclId.trim();
  if (!receiver) throw new Error("dex id is required");
  if (!request.pool_ids.length) {
    throw new Error("at least one pool id is required — the route");
  }
  const outputToken = request.output_token.trim();
  if (!outputToken) throw new Error("output token is required");
  const minOutput = request.min_output_amount.trim();
  if (!/^\d+$/.test(minOutput)) {
    throw new Error("min_output_amount must be a whole number in the output token's smallest unit");
  }
  const msg = JSON.stringify({
    Swap: {
      pool_ids: request.pool_ids,
      output_token: outputToken,
      min_output_amount: minOutput,
    },
  });
  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.ft_transfer_call,
    args: shit_1170_rhea_dclv2_ft_transfer_call_args_fun(
      receiver,
      request.amount_in,
      msg,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_SWAP_GAS,
    deposit: request.deposit ?? SHIT_1170_RHEA_DCLV2_FT_DEPOSIT,
  });
}

/**
 * prepare the `ft_transfer_call` that PLACES A LIMIT ORDER.
 *
 * the call is on the **sell** token — the one you send. `buy_token`
 * is the token being bought, the one you do not send.
 *
 * `with_swap` is true for `LimitOrderWithSwap` — it fills what it can
 * right away, then rests the remainder — and false for the plain
 * `LimitOrder`, which rests entirely.
 *
 * `point` must be a multiple of the pool's `point_delta` and sit on
 * the correct side of `current_point` for the token being sold.
 * selling `token_y` wants a point below, selling `token_x` wants one
 * above. read the live order points of a pool from `get_marketdepth`.
 *
 * the `client_id` is required and is always `""`. a `referral_id` must
 * NOT be passed — the contract parses it as an account id and an empty
 * string fails with
 * `E600: invalid msg: Error("the account ID is invalid")`.
 */
export function shit_1170_rhea_dclv2_limit_order_queue_call_fun(
  request: SHIT_1170_RHEA_DCLV2_CALL_REQUEST & {
    sell_token_id: string;
    amount: string;
    pool_id: string;
    buy_token: string;
    point: number;
    with_swap?: boolean;
  },
): QUEUE_CALL {
  const tokenId = request.sell_token_id.trim();
  if (!tokenId) throw new Error("sell token id is required");
  const receiver = request.dclId.trim();
  if (!receiver) throw new Error("dex id is required");
  const poolId = request.pool_id.trim();
  if (!poolId) throw new Error("pool id is required");
  const buyToken = request.buy_token.trim();
  if (!buyToken) throw new Error("buy token is required");
  if (!Number.isInteger(request.point)) {
    throw new Error("point must be a whole number");
  }
  const variant = request.with_swap ? "LimitOrderWithSwap" : "LimitOrder";
  const msg = JSON.stringify({
    [variant]: {
      pool_id: poolId,
      buy_token: buyToken,
      point: request.point,
      client_id: "",
    },
  });
  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.ft_transfer_call,
    args: shit_1170_rhea_dclv2_ft_transfer_call_args_fun(
      receiver,
      request.amount,
      msg,
    ),
    gas: request.gas ?? SHIT_1170_RHEA_DCLV2_LIMIT_ORDER_GAS,
    deposit: request.deposit ?? SHIT_1170_RHEA_DCLV2_FT_DEPOSIT,
  });
}
