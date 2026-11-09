// the chain reads the Rhea AMM v2 bins need.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the only
// chain access here is VIEW reads.
//
// these reads go through the near-kit tool box:
//   `@near-kit-tool-box/fun` — typed helpers, Zod-validated answers
//   `generic_contract_view_fun_json` — the escape hatch for a view
//     that has no dedicated helper
//
// the client is built here rather than taken from the env package,
// because the env package defaults to testnet and these skills
// default to MAINNET. `new Near({ network })` says what we mean.

import { Near } from "near-kit";
import {
  generic_contract_view_fun_json,
  rhea_ammv2_contractid,
  rhea_ammv2_get_account_basic_info_fun_json,
  rhea_ammv2_get_deposits_fun_json,
  rhea_ammv2_get_number_of_pools_fun_json,
  rhea_ammv2_get_pool_fun_json,
  rhea_ammv2_get_pool_share_price_fun_json,
  rhea_ammv2_get_pool_shares_fun_json,
  rhea_ammv2_get_pool_total_shares_fun_json,
  rhea_ammv2_get_pools_fun_json,
  rhea_ammv2_get_return_fun_json,
  rhea_ammv2_metadata_fun_json,
  rhea_ammv2_storage_balance_of_fun_json,
  type RHEA_AMMV2_GET_POOL_TYPE,
} from "@near-kit-tool-box/fun";

export type SHIT_1170_NETWORK = "mainnet" | "testnet";

/**
 * the network a flag named.
 *
 * anything that is not "testnet" is mainnet — the skills default to
 * mainnet because the contracts people talk about live there.
 */
export function shit_1170_network_fun(
  network: string | undefined,
): SHIT_1170_NETWORK {
  return network === "testnet" ? "testnet" : "mainnet";
}

/**
 * a NEAR client for one network.
 *
 * the client is read-only here: it has no signer and no private key,
 * so it can only answer views.
 */
export function shit_1170_near_client_fun(
  network: SHIT_1170_NETWORK = "mainnet",
): Near {
  return new Near({ network });
}

// --- THE MISSING-METHOD QUESTION ---
//
// a probe that fails because the ARGUMENTS were wrong still proves
// the method exists: the contract resolved it and ran it. only a
// method the contract does not have at all means the method is
// missing.
//
//   missing:   "wasm execution failed with error: MethodResolveError(MethodNotFound)"
//   wrong args: "HostError(GuestPanic { panic_msg: \"Failed to deserialize
//                input from JSON...\" })"
const SHIT_1170_METHOD_MISSING = /MethodNotFound|MethodResolveError/i;

/**
 * a view call that ran and failed.
 *
 * `missing` is true only when the contract does not have the method
 * at all. a call that failed because the ARGUMENTS were wrong is NOT
 * missing: the method resolved and ran, so it exists.
 */
export class SHIT_1170_VIEW_CALL_ERROR extends Error {
  readonly missing: boolean;

  constructor(message: string, missing: boolean) {
    super(message);
    this.name = "SHIT_1170_VIEW_CALL_ERROR";
    this.missing = missing;
  }
}

function shit_1170_error_message_fun(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * one view call, with the args written as json for you.
 *
 * a call that ran and failed throws a `SHIT_1170_VIEW_CALL_ERROR`,
 * which says whether the method was missing.
 */
export async function shit_1170_view_fun<T>(
  network: SHIT_1170_NETWORK,
  contract_id: string,
  method_name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await generic_contract_view_fun_json<T>(
      shit_1170_near_client_fun(network),
      contract_id,
      method_name,
      args,
    );
  } catch (error) {
    const message = shit_1170_error_message_fun(error);
    throw new SHIT_1170_VIEW_CALL_ERROR(
      message,
      SHIT_1170_METHOD_MISSING.test(message),
    );
  }
}

// --- THE CONTRACT ID ---
//
// the DEX is `v2.ref-finance.near` on mainnet and
// `ref-finance-101.testnet` on testnet.

/**
 * the DEX's account id for one network.
 */
export function shit_1170_rhea_ammv2_id_fun(
  network: SHIT_1170_NETWORK = "mainnet",
): string {
  return rhea_ammv2_contractid(network);
}

// --- THE AMM READS ---
//
// these go through the tool box's typed helpers, so the answers are
// Zod-validated against the shapes read off live mainnet responses.

/**
 * the DEX's own metadata — the version, the owner, the wNEAR id, the
 * state, the admin fee and the pool count.
 */
export async function shit_1170_rhea_ammv2_metadata_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
): Promise<Awaited<ReturnType<typeof rhea_ammv2_metadata_fun_json>>> {
  return await rhea_ammv2_metadata_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
  );
}

/**
 * how many pools the DEX has.
 */
export async function shit_1170_rhea_ammv2_number_of_pools_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
): Promise<number> {
  return await rhea_ammv2_get_number_of_pools_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
  );
}

/**
 * one pool, by its id.
 *
 * a pool answers with exactly six keys: `pool_kind`,
 * `token_account_ids`, `amounts`, `total_fee`, `shares_total_supply`
 * and `amp`.
 *
 * the pool kinds seen live are `SIMPLE_POOL`, `STABLE_SWAP`,
 * `RATED_SWAP` and `DEGEN_SWAP`.
 */
export async function shit_1170_rhea_ammv2_pool_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: number,
): Promise<RHEA_AMMV2_GET_POOL_TYPE> {
  return await rhea_ammv2_get_pool_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    pool_id,
  );
}

/**
 * a page of pools.
 */
export async function shit_1170_rhea_ammv2_pools_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  from_index = 0,
  limit = 50,
): Promise<RHEA_AMMV2_GET_POOL_TYPE[]> {
  return await rhea_ammv2_get_pools_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    from_index,
    limit,
  );
}

/**
 * the expected output of a swap.
 *
 * the answer is the output amount in `token_out`'s smallest unit.
 * apply a slippage tolerance to it for the `min_amount_out` of the
 * swap action.
 */
export async function shit_1170_rhea_ammv2_return_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: number,
  token_in: string,
  amount_in: string,
  token_out: string,
): Promise<string> {
  return await rhea_ammv2_get_return_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    pool_id,
    token_in,
    amount_in,
    token_out,
  );
}

/**
 * the expected output of a swap, quoted by the output amount.
 *
 * the answer is the INPUT needed for that exact output.
 */
export async function shit_1170_rhea_ammv2_return_by_output_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: number,
  token_in: string,
  token_out: string,
  amount_out: string,
): Promise<string> {
  const result = await shit_1170_view_fun<string>(
    network,
    dcl_id,
    "get_return_by_output",
    { pool_id, token_in, token_out, amount_out },
  );
  return result ?? "0";
}

/**
 * an account's deposited balances — every token the DEX holds for it.
 */
export async function shit_1170_rhea_ammv2_deposits_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  account_id: string,
): Promise<Record<string, string>> {
  return await rhea_ammv2_get_deposits_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    account_id,
  );
}

/**
 * an account's basic info — its near balance and its storage used.
 */
export async function shit_1170_rhea_ammv2_account_info_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  account_id: string,
): Promise<Awaited<
  ReturnType<typeof rhea_ammv2_get_account_basic_info_fun_json>
>> {
  return await rhea_ammv2_get_account_basic_info_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    account_id,
  );
}

/**
 * an account's LP shares in one pool.
 */
export async function shit_1170_rhea_ammv2_pool_shares_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: number,
  account_id: string,
): Promise<string> {
  return await rhea_ammv2_get_pool_shares_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    pool_id,
    account_id,
  );
}

/**
 * the total shares issued for one pool.
 */
export async function shit_1170_rhea_ammv2_pool_total_shares_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: number,
): Promise<string> {
  return await rhea_ammv2_get_pool_total_shares_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    pool_id,
  );
}

/**
 * the share price of a pool.
 *
 * **this view is not implemented on the live build** — it panics with
 * `not implemented` at `ref-exchange/src/pool.rs:161`. the helper is
 * here so the shape stays pinned, but a call to it fails on chain.
 */
export async function shit_1170_rhea_ammv2_share_price_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: number,
): Promise<string> {
  return await rhea_ammv2_get_pool_share_price_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    pool_id,
  );
}

// --- THE STORAGE ---
//
// the DEX keeps NEP-145 storage per account, and the deposit methods
// need it.

export interface SHIT_1170_RHEA_AMMV2_STORAGE {
  hasStorage: boolean;
  total: string | null;
  available: string | null;
}

/**
 * the NEP-145 storage balance of an account on the DEX.
 */
export async function shit_1170_rhea_ammv2_storage_balance_of_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  account_id: string,
): Promise<SHIT_1170_RHEA_AMMV2_STORAGE> {
  let result: { total?: string; available?: string } | null;
  try {
    result = await rhea_ammv2_storage_balance_of_fun_json(
      shit_1170_near_client_fun(network),
      dcl_id,
      account_id,
    );
  } catch (error) {
    if (/returned no value/i.test(shit_1170_error_message_fun(error))) {
      return { hasStorage: false, total: null, available: null };
    }
    throw error;
  }
  if (!result) {
    return { hasStorage: false, total: null, available: null };
  }
  return {
    hasStorage: true,
    total: result.total ?? null,
    available: result.available ?? null,
  };
}

/**
 * the DEX's own storage bounds.
 *
 * the live `min` on mainnet is 0.00102 NEAR. the standard's NEP-145
 * floor is 0.00125 NEAR, so read the contract's own number rather
 * than assuming the standard's.
 */
export async function shit_1170_rhea_ammv2_storage_bounds_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
): Promise<{ min: string | null; max: string | null }> {
  const bounds = await shit_1170_view_fun<{
    min?: string | null;
    max?: string | null;
  }>(network, dcl_id, "storage_balance_bounds", {});
  return { min: bounds?.min ?? null, max: bounds?.max ?? null };
}
