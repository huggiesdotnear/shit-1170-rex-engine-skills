// the NEP-141 / NEP-145 fungible token standard, as the rex engine
// needs it: the method shapes, the gas and the deposit, and the queue
// payloads an agent hands to a human to sign.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the write
// side of this skill is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// --- WHY THE GAS IS WHERE IT IS ---
// the standard fixes the argument shapes, but it does not fix the gas.
// only two of the numbers here are confirmed by the standard itself:
// ft_transfer's deposit is exactly 1 yoctoNEAR, and ft_transfer_call's
// gas is 50 Tgas. the rest are marked as not documented, and the
// defaults used by the bins are the engine's own working values, not
// the standard's promise. an agent that treats a default as a
// guarantee is reading more than is there.

import { ft_methods_const } from "@near-kit-tool-box/fun";
import {
  queue_call_fun,
  type QUEUE_CALL,
} from "@huggies/shit-1170-rex-engine-middleman";

export type { QUEUE_CALL };

// the wrap.near contract: `near_deposit` and `near_withdraw`, the
// queue payloads for them, and the batch that wraps with the storage
// registration in front of it.
export * from "./wrap_near";

// the local account list, read only. no key is ever read or printed.
export * from "./accounts";

export interface SHIT_1170_FT_TRANSFER_REQUEST {
  tokenId: string;
  receiverId: string;
  amount: string;
  memo?: string;
  gas?: string;
  deposit?: string;
}

export interface SHIT_1170_FT_TRANSFER_CHECK {
  receiverExists: boolean;
  receiverOnContacts: boolean;
  receiverHasTokenStorage: boolean | null;
  tokenDecimals: number | null;
  warnings: string[];
}

// --- THE GAS AND THE DEPOSIT ---
//
// confirmed by the NEP-141 / NEP-145 standard:
//   ft_transfer      deposit is exactly 1 yoctoNEAR
//   ft_transfer_call gas is 50 Tgas, deposit is exactly 1 yoctoNEAR
//
// not documented by the standard:
//   ft_metadata, ft_total_supply, ft_balance_of, storage_balance_of,
//   storage_balance_bounds — views, so they need no gas
//   storage_deposit  — the standard's minimum storage is 0.00125 NEAR,
//                       but the gas is not documented
//   storage_withdraw — the deposit is 1 yoctoNEAR, the gas is not
//                       documented
//   ft_transfer      — the gas is not documented
//
// the defaults below are the values the engine's own bins use. they
// are working values, not guarantees.
export const SHIT_1170_FT_DEFAULT_GAS = "30000000000000";
export const SHIT_1170_FT_DEFAULT_DEPOSIT = "1";

// the standard's minimum storage registration: 0.00125 NEAR.
export const SHIT_1170_FT_MIN_STORAGE_DEPOSIT = "1250000000000000000000";

// ft_transfer_call's gas, as the standard states it: 50 Tgas.
export const SHIT_1170_FT_TRANSFER_CALL_GAS = "50000000000000";

// storage_withdraw's deposit, as the standard states it.
export const SHIT_1170_FT_STORAGE_WITHDRAW_DEPOSIT = "1";

export const SHIT_1170_FT_METHODS = {
  ft_metadata: "view",
  ft_total_supply: "view",
  ft_balance_of: "view",
  storage_balance_of: "view",
  storage_balance_bounds: "view",
  storage_deposit: "call",
  storage_withdraw: "call",
  ft_transfer: "call",
  ft_transfer_call: "call",
} as const;

export type SHIT_1170_FT_METHOD = keyof typeof SHIT_1170_FT_METHODS;

export function shit_1170_ft_is_view_fun(method: string): boolean {
  return SHIT_1170_FT_METHODS[method as SHIT_1170_FT_METHOD] === "view";
}

// --- THE ARGUMENT SHAPES ---
//
// every shape the standard defines, so an agent can build the right
// call without reading the standard's prose.

export function shit_1170_ft_metadata_args_fun(): Record<string, unknown> {
  return {};
}

export function shit_1170_ft_total_supply_args_fun(): Record<string, unknown> {
  return {};
}

export function shit_1170_ft_balance_of_args_fun(
  account_id: string,
): Record<string, unknown> {
  const id = account_id.trim();
  if (!id) throw new Error("account id is required");
  return { account_id: id };
}

export function shit_1170_storage_balance_of_args_fun(
  account_id: string,
): Record<string, unknown> {
  return shit_1170_ft_balance_of_args_fun(account_id);
}

export function shit_1170_storage_balance_bounds_args_fun(): Record<
  string,
  unknown
> {
  return {};
}

export function shit_1170_storage_deposit_args_fun(): Record<string, unknown> {
  return {};
}

export function shit_1170_storage_withdraw_args_fun(): Record<string, unknown> {
  return {};
}

export function shit_1170_ft_transfer_args_fun(
  receiver_id: string,
  amount: string,
  memo?: string,
): Record<string, unknown> {
  const receiver = receiver_id.trim();
  if (!receiver) throw new Error("receiver id is required");
  const unit = amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error("amount must be a whole number in the token's smallest unit");
  }
  const args: Record<string, unknown> = {
    receiver_id: receiver,
    amount: unit,
  };
  if (memo !== undefined && memo !== "") args.memo = memo;
  return args;
}

export function shit_1170_ft_transfer_call_args_fun(
  receiver_id: string,
  amount: string,
  msg: string,
  memo?: string,
): Record<string, unknown> {
  const args = shit_1170_ft_transfer_args_fun(receiver_id, amount, memo);
  args.msg = msg;
  return args;
}

// --- THE QUEUE PAYLOADS ---
//
// these are DATA. the engine queues them and a human signs them.

export function shit_1170_ft_transfer_queue_call_fun(
  request: SHIT_1170_FT_TRANSFER_REQUEST,
): QUEUE_CALL {
  const tokenId = request.tokenId.trim();
  if (!tokenId) throw new Error("token id is required");

  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.ft_transfer,
    args: shit_1170_ft_transfer_args_fun(
      request.receiverId,
      request.amount,
      request.memo,
    ),
    gas: request.gas ?? SHIT_1170_FT_DEFAULT_GAS,
    deposit: request.deposit ?? SHIT_1170_FT_DEFAULT_DEPOSIT,
  });
}

export function shit_1170_ft_transfer_call_queue_call_fun(request: {
  tokenId: string;
  receiverId: string;
  amount: string;
  msg: string;
  memo?: string;
  gas?: string;
  deposit?: string;
}): QUEUE_CALL {
  const tokenId = request.tokenId.trim();
  if (!tokenId) throw new Error("token id is required");

  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.ft_transfer_call,
    args: shit_1170_ft_transfer_call_args_fun(
      request.receiverId,
      request.amount,
      request.msg,
      request.memo,
    ),
    gas: request.gas ?? SHIT_1170_FT_TRANSFER_CALL_GAS,
    deposit: request.deposit ?? SHIT_1170_FT_DEFAULT_DEPOSIT,
  });
}

// the storage registration that has to land before a transfer can
// deliver anything to a receiver that has no storage on the token.
export function shit_1170_storage_deposit_queue_call_fun(request: {
  tokenId: string;
  deposit?: string;
  gas?: string;
}): QUEUE_CALL {
  const tokenId = request.tokenId.trim();
  if (!tokenId) throw new Error("token id is required");

  return queue_call_fun({
    contractId: tokenId,
    method: ft_methods_const.storage_deposit,
    args: {},
    gas: request.gas ?? SHIT_1170_FT_DEFAULT_GAS,
    deposit: request.deposit ?? SHIT_1170_FT_MIN_STORAGE_DEPOSIT,
  });
}
