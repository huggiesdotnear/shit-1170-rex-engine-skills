// the Rhea AMM v2 queue payloads, as the rex engine needs them.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the write
// side of this skill is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// --- WHY THE GAS AND THE DEPOSIT ARE WHERE THEY ARE ---
// the toolbox's `rhea_ammv2_*_fun_json` helpers are the strongest
// evidence for the argument shape, the gas and the deposit, because
// they build and send the exact JSON. the values below are taken from
// those helpers:
//
//   swap               gas not set   deposit 0
//   withdraw           gas not set   deposit 0
//   add_simple_pool    gas not set   deposit 0
//   storage_deposit    gas not set   deposit 0.00125 NEAR
//
// the swap and withdraw helpers set no gas, so the engine's own
// default applies. that default is 30 Tgas — the middleman's
// `DEFAULT_GAS`.
//
// --- THE DEPOSITED BALANCE ---
// the DEX keeps a per-account deposited balance. `withdraw` pays out
// of it, and the `ft_transfer_call` on the token with msg `"Deposit"`
// credits it.

import { ft_methods_const } from "@near-kit-tool-box/fun";
import {
  queue_call_fun,
  type QUEUE_CALL,
} from "@huggies/shit-1170-rex-engine-middleman";

export type { QUEUE_CALL };

// the engine's default gas, in gas units. the toolbox's swap and
// withdraw helpers set no gas of their own, so this is what applies.
export const SHIT_1170_RHEA_AMMV2_DEFAULT_GAS = "30000000000000";

// the NEP-145 storage registration deposit: 0.00125 NEAR.
//
// the standard's floor. the DEX's own `storage_balance_bounds.min` is
// lower — 0.00102 NEAR on mainnet — so read the contract's number
// when the exact minimum matters.
export const SHIT_1170_RHEA_AMMV2_STORAGE_DEPOSIT = "1250000000000000000000";

// an `ft_transfer_call` attaches exactly 1 yoctoNEAR.
export const SHIT_1170_RHEA_AMMV2_FT_DEPOSIT = "1";

// --- THE ARGUMENT SHAPES ---
//
// every shape the contract defines, so an agent can build the right
// call without reading the contract's source.

export interface SHIT_1170_RHEA_AMMV2_CALL_REQUEST {
  dclId: string;
  gas?: string;
  deposit?: string;
}

/**
 * one step of a `swap` action list.
 *
 * `amount_in` is OPTIONAL — when it is absent the contract reads the
 * action as "swap every available balance of `token_in` I hold on the
 * DEX, up to `min_amount_out`".
 *
 * `min_amount_out` is the slippage guard, in `token_out`'s smallest
 * unit. `"0"` accepts any positive amount.
 */
export interface SHIT_1170_RHEA_AMMV2_SWAP_ACTION {
  pool_id: number;
  token_in: string;
  amount_in?: string;
  token_out: string;
  min_amount_out: string;
}

/**
 * the `swap` args.
 *
 * `actions` is the ordered list of swap steps, and `referral_id` is
 * optional.
 */
export function shit_1170_rhea_ammv2_swap_args_fun(
  actions: SHIT_1170_RHEA_AMMV2_SWAP_ACTION[],
  referral_id?: string,
): Record<string, unknown> {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("actions is required and must have at least one step");
  }
  for (const action of actions) {
    if (!Number.isInteger(action.pool_id)) {
      throw new Error("each action needs a whole-number pool_id");
    }
    if (!action.token_in?.trim()) {
      throw new Error("each action needs a token_in");
    }
    if (!action.token_out?.trim()) {
      throw new Error("each action needs a token_out");
    }
    const min = String(action.min_amount_out ?? "").trim();
    if (!/^\d+$/.test(min)) {
      throw new Error(
        "each action needs a min_amount_out as a whole number in the output token's smallest unit",
      );
    }
    if (action.amount_in !== undefined && !/^\d+$/.test(action.amount_in.trim())) {
      throw new Error(
        "amount_in must be a whole number in the input token's smallest unit",
      );
    }
  }
  return { actions, referral_id: referral_id?.trim() ?? "" };
}

/**
 * the `withdraw` args.
 *
 * `token_id` is the DEX's inner token id for the pool — `"2794"` for
 * pool 2794, or the full `<pool_id>:<token_account>` form.
 * `amount` is a decimal string in the token's smallest unit.
 *
 * `unregister` is false, so the position is kept. `skip_unwrap_near`
 * is false, so a wNEAR withdrawal is unwrapped back to NEAR.
 */
export function shit_1170_rhea_ammv2_withdraw_args_fun(
  token_id: string,
  amount: string,
): Record<string, unknown> {
  const id = token_id.trim();
  if (!id) throw new Error("token id is required");
  const unit = amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error("amount must be a whole number in the token's smallest unit");
  }
  return {
    amount: unit,
    token_id: id,
    unregister: false,
    skip_unwrap_near: false,
  };
}

/**
 * the `add_simple_pool` args.
 *
 * `fee` is in basis points, and `tokens` is the ORDERED list of the
 * pool's NEP-141 accounts — at least two.
 */
export function shit_1170_rhea_ammv2_add_simple_pool_args_fun(
  fee: number,
  tokens: string[],
): Record<string, unknown> {
  if (!Number.isInteger(fee) || fee <= 0) {
    throw new Error("fee is required and must be a whole number of basis points");
  }
  if (!Array.isArray(tokens) || tokens.length < 2) {
    throw new Error("a simple pool needs at least two tokens");
  }
  const cleaned = tokens.map((token) => token.trim()).filter(Boolean);
  if (cleaned.length < 2) {
    throw new Error("a simple pool needs at least two tokens");
  }
  return { fee, tokens: cleaned };
}

// --- THE QUEUE PAYLOADS ---
//
// these are DATA. the engine queues them and a human signs them.

/**
 * prepare a `swap` queue payload.
 *
 * the swap is a sequence of actions, each one a hop through a pool.
 */
export function shit_1170_rhea_ammv2_swap_queue_call_fun(
  request: SHIT_1170_RHEA_AMMV2_CALL_REQUEST & {
    actions: SHIT_1170_RHEA_AMMV2_SWAP_ACTION[];
    referral_id?: string;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "swap",
    args: shit_1170_rhea_ammv2_swap_args_fun(request.actions, request.referral_id),
    gas: request.gas ?? SHIT_1170_RHEA_AMMV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `withdraw` queue payload.
 */
export function shit_1170_rhea_ammv2_withdraw_queue_call_fun(
  request: SHIT_1170_RHEA_AMMV2_CALL_REQUEST & {
    token_id: string;
    amount: string;
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "withdraw",
    args: shit_1170_rhea_ammv2_withdraw_args_fun(request.token_id, request.amount),
    gas: request.gas ?? SHIT_1170_RHEA_AMMV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare an `add_simple_pool` queue payload.
 */
export function shit_1170_rhea_ammv2_add_simple_pool_queue_call_fun(
  request: SHIT_1170_RHEA_AMMV2_CALL_REQUEST & {
    fee: number;
    tokens: string[];
  },
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "add_simple_pool",
    args: shit_1170_rhea_ammv2_add_simple_pool_args_fun(request.fee, request.tokens),
    gas: request.gas ?? SHIT_1170_RHEA_AMMV2_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `storage_deposit` queue payload.
 */
export function shit_1170_rhea_ammv2_storage_deposit_queue_call_fun(
  request: SHIT_1170_RHEA_AMMV2_CALL_REQUEST,
): QUEUE_CALL {
  const dclId = request.dclId.trim();
  if (!dclId) throw new Error("dex id is required");
  return queue_call_fun({
    contractId: dclId,
    method: "storage_deposit",
    args: {},
    gas: request.gas ?? SHIT_1170_RHEA_AMMV2_DEFAULT_GAS,
    deposit: request.deposit ?? SHIT_1170_RHEA_AMMV2_STORAGE_DEPOSIT,
  });
}

// --- THE TOKEN INFLOWS ---
//
// the deposit into the DEX's per-account balance is an
// `ft_transfer_call` on the TOKEN, with the DEX as the receiver.

/**
 * prepare the `ft_transfer_call` that DEPOSITS into the DEX's
 * per-account balance.
 *
 * the `msg` is the JSON string `"Deposit"`, including its quotes.
 */
export function shit_1170_rhea_ammv2_deposit_queue_call_fun(
  request: SHIT_1170_RHEA_AMMV2_CALL_REQUEST & {
    token_id: string;
    amount: string;
  },
): QUEUE_CALL {
  const tokenId = request.token_id.trim();
  if (!tokenId) throw new Error("token id is required");
  const receiver = request.dclId.trim();
  if (!receiver) throw new Error("dex id is required");
  const unit = request.amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error("amount must be a whole number in the token's smallest unit");
  }
  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.ft_transfer_call,
    args: {
      receiver_id: receiver,
      amount: unit,
      msg: JSON.stringify("Deposit"),
    },
    gas: request.gas ?? SHIT_1170_RHEA_AMMV2_DEFAULT_GAS,
    deposit: request.deposit ?? SHIT_1170_RHEA_AMMV2_FT_DEPOSIT,
  });
}
