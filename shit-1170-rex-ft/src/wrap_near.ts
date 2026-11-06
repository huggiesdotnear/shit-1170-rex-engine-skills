// the wrap.near wNEAR contract: the two methods that turn native NEAR
// into wNEAR and back, and the queue payloads an agent hands to a
// human to sign.
//
// --- WHAT wrap.near IS ---
// wrap.near is a NEP-141 token contract whose whole job is to hold
// wrapped NEAR. it is NOT the chain's own coin. native NEAR is the
// coin, with the id `near`; wNEAR is this contract's token, with the
// id `wrap.near` on mainnet and `wrap.testnet` on testnet.
//
// both are 24 decimals, so the decimals never tell you which one you
// are looking at. the id does.
//
// --- THE TWO METHODS ---
//
//   near_deposit   NEAR -> wNEAR. no arguments. the ATTACHED DEPOSIT
//                  is the amount to wrap. the deposit is not a fee —
//                  it becomes the wNEAR.
//   near_withdraw  wNEAR -> NEAR. one argument, `amount`, in wNEAR's
//                  smallest unit. the attached deposit is exactly 1
//                  yoctoNEAR, which is a security deposit and not a
//                  fee.
//
// --- WHY A WRAP IS NOT A SWAP ---
// the engine's swap queue names a token sold and a token bought, and
// a router works the route out at execution time. wrap.near is not a
// route — `near_deposit` and `near_withdraw` are direct calls. so a
// wrap or an unwrap is queued as a BATCH OF CALLS with queue_tx.ts,
// not as a swap.
//
// --- WHY THE WRAP NEEDS A STORAGE DEPOSIT FIRST ---
// `near_deposit` mints wNEAR to the caller, and the contract has to
// have somewhere to put the balance. the NEP-145 storage standard says
// an account with no storage registered gets `null` back from
// `storage_balance_of`, and a mint to such an account fails. so the
// registration is part of the wrap, in the same batch, before the
// deposit.
//
// the unwrap needs no registration: the account already holds wNEAR,
// so it already has the storage that holds it.
//
// --- THE GAS AND THE DEPOSIT ---
// the standard fixes none of these numbers for wrap.near's own
// methods. the values below are the engine's working values, not the
// contract's promise. the one deposit the contract DOES fix is
// `near_withdraw`'s: exactly 1 yoctoNEAR.

import {
  ft_methods_const,
  wrap_near_methods_const,
} from "@near-kit-tool-box/fun";
import {
  queue_call_fun,
  type QUEUE_CALL,
} from "@huggies/shit-1170-rex-engine-middleman";

// the contract id per network.
export const SHIT_1170_WRAP_NEAR_CONTRACT_IDS = {
  mainnet: "wrap.near",
  testnet: "wrap.testnet",
} as const;

/**
 * the wrap.near contract id for one network.
 *
 * the token id and the contract id are the same thing for a NEP-141
 * token, so `wrap.near` is both.
 */
export function shit_1170_wrap_near_contract_id_fun(
  network: "mainnet" | "testnet" = "mainnet",
): string {
  return network === "testnet"
    ? SHIT_1170_WRAP_NEAR_CONTRACT_IDS.testnet
    : SHIT_1170_WRAP_NEAR_CONTRACT_IDS.mainnet;
}

// 30 Tgas, the usual ceiling for a call that does real work. the
// contract does not document its own gas, so this is a working value.
export const SHIT_1170_WRAP_NEAR_DEFAULT_GAS = "30000000000000";

// `near_withdraw` requires exactly 1 yoctoNEAR. it is a security
// deposit against a restricted function-call key, and it is refunded.
export const SHIT_1170_WRAP_NEAR_WITHDRAW_DEPOSIT = "1";

// the NEP-145 registration cost on wrap.near: 0.00125 NEAR. read the
// contract's own `storage_minimum_balance` for the live value.
export const SHIT_1170_WRAP_NEAR_MIN_STORAGE_DEPOSIT =
  "1250000000000000000000";

export interface SHIT_1170_WRAP_NEAR_REQUEST {
  /** the amount, in the token's smallest unit */
  amount: string;
  /** the wrap.near contract id; defaults to the mainnet one */
  contractId?: string;
  gas?: string;
  /** only for `near_deposit`, where the deposit IS the amount */
  deposit?: string;
}

/**
 * the `near_deposit` arguments.
 *
 * there are none. the amount to wrap is the attached deposit, so the
 * deposit and the amount are the same number.
 */
export function shit_1170_near_deposit_args_fun(): Record<string, unknown> {
  return {};
}

/**
 * the `near_withdraw` arguments.
 *
 * `amount` is in wNEAR's smallest unit — 24 decimals.
 */
export function shit_1170_near_withdraw_args_fun(
  amount: string,
): Record<string, unknown> {
  const unit = amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error(
      "amount must be a whole number in wNEAR's smallest unit (24 decimals)",
    );
  }
  return { amount: unit };
}

/**
 * the `near_deposit` queue payload — native NEAR in, wNEAR out.
 *
 * the deposit is the amount being wrapped. it is not a fee and it is
 * not a refundable storage deposit: it becomes the wNEAR.
 */
export function shit_1170_near_deposit_queue_call_fun(
  request: SHIT_1170_WRAP_NEAR_REQUEST,
): QUEUE_CALL {
  const unit = request.amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error(
      "amount must be a whole number in yoctoNEAR (24 decimals)",
    );
  }
  if (unit === "0") {
    throw new Error("amount must be positive");
  }

  return queue_call_fun({
    contractId:
      request.contractId ?? SHIT_1170_WRAP_NEAR_CONTRACT_IDS.mainnet,
    method: wrap_near_methods_const.near_deposit,
    args: shit_1170_near_deposit_args_fun(),
    gas: request.gas ?? SHIT_1170_WRAP_NEAR_DEFAULT_GAS,
    deposit: request.deposit ?? unit,
  });
}

/**
 * the `near_withdraw` queue payload — wNEAR in, native NEAR out.
 *
 * the attached deposit is exactly 1 yoctoNEAR. the amount to unwrap
 * is the `amount` argument.
 */
export function shit_1170_near_withdraw_queue_call_fun(
  request: SHIT_1170_WRAP_NEAR_REQUEST,
): QUEUE_CALL {
  const unit = request.amount.trim();
  if (!/^\d+$/.test(unit)) {
    throw new Error(
      "amount must be a whole number in wNEAR's smallest unit (24 decimals)",
    );
  }
  if (unit === "0") {
    throw new Error("amount must be positive");
  }

  return queue_call_fun({
    contractId:
      request.contractId ?? SHIT_1170_WRAP_NEAR_CONTRACT_IDS.mainnet,
    method: wrap_near_methods_const.near_withdraw,
    args: shit_1170_near_withdraw_args_fun(unit),
    gas: request.gas ?? SHIT_1170_WRAP_NEAR_DEFAULT_GAS,
    deposit: request.deposit ?? SHIT_1170_WRAP_NEAR_WITHDRAW_DEPOSIT,
  });
}

/**
 * the `storage_deposit` queue payload that registers the wrapping
 * account on wrap.near.
 *
 * this is the call that has to land before `near_deposit` can mint
 * to the account.
 */
export function shit_1170_wrap_near_storage_deposit_queue_call_fun(
  request: {
    contractId?: string;
    deposit?: string;
    gas?: string;
  } = {},
): QUEUE_CALL {
  return queue_call_fun({
    contractId:
      request.contractId ?? SHIT_1170_WRAP_NEAR_CONTRACT_IDS.mainnet,
    method: ft_methods_const.storage_deposit,
    args: {},
    gas: request.gas ?? SHIT_1170_WRAP_NEAR_DEFAULT_GAS,
    deposit: request.deposit ?? SHIT_1170_WRAP_NEAR_MIN_STORAGE_DEPOSIT,
  });
}

/**
 * the whole wrap, as ONE batch of calls.
 *
 * the order matters: the registration lands first, so the mint has
 * somewhere to put the balance. the batch runs as one transaction, so
 * the receipt tree holds together — if the registration fails, the
 * deposit does not run either.
 *
 * `withStorageDeposit` is false only when the account is ALREADY
 * registered on wrap.near. check that with `wrap_check.ts` first.
 */
export function shit_1170_near_deposit_batch_fun(request: {
  amount: string;
  contractId?: string;
  gas?: string;
  deposit?: string;
  storageDeposit?: string;
  storageGas?: string;
  withStorageDeposit?: boolean;
}): QUEUE_CALL[] {
  const calls: QUEUE_CALL[] = [];

  if (request.withStorageDeposit !== false) {
    calls.push(
      shit_1170_wrap_near_storage_deposit_queue_call_fun({
        contractId: request.contractId,
        deposit: request.storageDeposit,
        gas: request.storageGas,
      }),
    );
  }

  calls.push(
    shit_1170_near_deposit_queue_call_fun({
      amount: request.amount,
      contractId: request.contractId,
      gas: request.gas,
      deposit: request.deposit,
    }),
  );

  return calls;
}
