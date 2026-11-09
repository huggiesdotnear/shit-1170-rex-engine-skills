// the chain reads the Rhea DCL v2 bins need.
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
  rhea_dclv2_contractid,
  rhea_dclv2_get_metadata_fun_json,
  rhea_dclv2_get_pool_fun_json,
  rhea_dclv2_get_user_asset_fun_json,
  rhea_dclv2_list_liquidities_fun_json,
  rhea_dclv2_list_pools_fun_json,
  rhea_dclv2_list_user_assets_fun_json,
  type RHEA_DCLV2_LIQUIDITY_TYPE,
  type RHEA_DCLV2_POOL_TYPE,
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
// the DEX is `dclv2.ref-labs.near` on mainnet and
// `dclv2.ref-dev.testnet` on testnet.

/**
 * the DEX's account id for one network.
 */
export function shit_1170_rhea_dclv2_id_fun(
  network: SHIT_1170_NETWORK = "mainnet",
): string {
  return rhea_dclv2_contractid(network);
}

// --- THE DCL READS ---
//
// these go through the tool box's typed helpers, so the answers are
// Zod-validated against the shapes read off live mainnet responses.

/**
 * the DEX's own metadata — the version, the owner, the wNEAR id, the
 * state and the pool and user counts.
 */
export async function shit_1170_rhea_dclv2_metadata_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
): Promise<Awaited<ReturnType<typeof rhea_dclv2_get_metadata_fun_json>>> {
  return await rhea_dclv2_get_metadata_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
  );
}

/**
 * one pool, by its id.
 */
export async function shit_1170_rhea_dclv2_pool_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_id: string,
): Promise<RHEA_DCLV2_POOL_TYPE> {
  return await rhea_dclv2_get_pool_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    pool_id,
  );
}

/**
 * a page of pools.
 *
 * the pool id is a composite STRING, not a number:
 * `<token_x_account_id>|<token_y_account_id>|<fee>` — both segments are
 * the tokens' NEAR account ids and the fee is in basis points.
 */
export async function shit_1170_rhea_dclv2_pools_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  from_index = 0,
  limit = 50,
): Promise<RHEA_DCLV2_POOL_TYPE[]> {
  return await rhea_dclv2_list_pools_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    from_index,
    limit,
  );
}

/**
 * one account's positions.
 *
 * the `lpt_id` is the pool id plus the owner's liquidity index —
 * `<pool_id>#<index>`.
 */
export async function shit_1170_rhea_dclv2_liquidities_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  owner_id: string,
  from_index = 0,
  limit = 50,
): Promise<RHEA_DCLV2_LIQUIDITY_TYPE[]> {
  return await rhea_dclv2_list_liquidities_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    owner_id,
    from_index,
    limit,
  );
}

/**
 * one account's internal balance of one token.
 *
 * the view answers with a BARE decimal string, not an object.
 */
export async function shit_1170_rhea_dclv2_user_asset_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  token_id: string,
  account_id: string,
): Promise<string> {
  return await rhea_dclv2_get_user_asset_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    token_id,
    account_id,
  );
}

/**
 * every token an account holds in the DEX's internal balance.
 */
export async function shit_1170_rhea_dclv2_user_assets_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  account_id: string,
): Promise<Record<string, string>> {
  return await rhea_dclv2_list_user_assets_fun_json(
    shit_1170_near_client_fun(network),
    dcl_id,
    account_id,
  );
}

// --- THE STORAGE ---
//
// the DEX charges per liquidity and per order slot, so an account
// that wants to provide liquidity needs storage registered on the DEX
// itself. without it the add fails.

export interface SHIT_1170_RHEA_DCLV2_STORAGE {
  hasStorage: boolean;
  total: string | null;
  available: string | null;
}

/**
 * the NEP-145 storage balance of an account on the DEX.
 *
 * `hasStorage: false` means the account holds no storage on the DEX,
 * so `add_liquidity` and the limit order methods will fail.
 */
export async function shit_1170_rhea_dclv2_storage_balance_of_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  account_id: string,
): Promise<SHIT_1170_RHEA_DCLV2_STORAGE> {
  let result: { total?: string; available?: string } | null;
  try {
    result = await shit_1170_view_fun<{ total?: string; available?: string } | null>(
      network,
      dcl_id,
      "storage_balance_of",
      { account_id },
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
 * the answer is `{ min, max }` — the minimum and maximum registration
 * in yoctoNEAR. the live `min` on mainnet is 0.5 NEAR.
 *
 * the DEX charges per liquidity and per order slot ON TOP of this,
 * so the deposit has to cover the slots too — see
 * `get_user_storage_detail` for the slot price.
 */
export interface SHIT_1170_RHEA_DCLV2_STORAGE_BOUNDS {
  min: string | null;
  max: string | null;
}

export async function shit_1170_rhea_dclv2_storage_bounds_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
): Promise<SHIT_1170_RHEA_DCLV2_STORAGE_BOUNDS> {
  const bounds = await shit_1170_view_fun<{
    min?: string | null;
    max?: string | null;
  }>(network, dcl_id, "storage_balance_bounds", {});
  return {
    min: bounds?.min ?? null,
    max: bounds?.max ?? null,
  };
}

/**
 * the DEX's own storage minimum, in yoctoNEAR.
 */
export async function shit_1170_rhea_dclv2_storage_minimum_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
): Promise<string | null> {
  const bounds = await shit_1170_rhea_dclv2_storage_bounds_fun(network, dcl_id);
  return bounds.min;
}

/**
 * the per-slot storage detail the DEX tracks for one user.
 *
 * the live answer carries the locked NEAR, the storage held for
 * assets, the `slot_price`, the `max_slots` and how many liquidity and
 * order slots are in use.
 */
export interface SHIT_1170_RHEA_DCLV2_STORAGE_DETAIL {
  sponsor_id?: string;
  locked_near?: string;
  storage_for_asset?: string;
  slot_price?: string;
  max_slots?: number;
  cur_order_slots?: number;
  cur_liquidity_slots?: number;
  extra: Record<string, unknown>;
}

export async function shit_1170_rhea_dclv2_storage_detail_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  user_id: string,
): Promise<SHIT_1170_RHEA_DCLV2_STORAGE_DETAIL> {
  const raw = await shit_1170_view_fun<Record<string, unknown>>(
    network,
    dcl_id,
    "get_user_storage_detail",
    { user_id },
  );
  const detail = raw ?? {};
  return {
    sponsor_id: detail.sponsor_id as string | undefined,
    locked_near: detail.locked_near as string | undefined,
    storage_for_asset: detail.storage_for_asset as string | undefined,
    slot_price: detail.slot_price as string | undefined,
    max_slots: detail.max_slots as number | undefined,
    cur_order_slots: detail.cur_order_slots as number | undefined,
    cur_liquidity_slots: detail.cur_liquidity_slots as number | undefined,
    extra: detail,
  };
}

// --- THE POINTS ---
//
// a pool's `point_delta` comes from its fee: 100→1, 400→8, 2000→40,
// 10000→200.
//
// an LP range (`left_point`, `right_point`) must sit on multiples of
// `point_delta`, else the call fails with `E200: invalid endpoint`.
// a limit order's `point` must also sit on the correct side of
// `current_point` for the token being sold, else `E202: illegal point`.
//
// `current_point` is generally NOT a multiple of `point_delta`, so
// round to it. the aligned edges around it are
// `floor(current_point / point_delta) * point_delta` and that plus
// `point_delta`.

/**
 * the point delta for a fee, in basis points.
 *
 * 100→1, 400→8, 2000→40, 10000→200.
 */
export function shit_1170_rhea_dclv2_point_delta_fun(fee: number): number {
  const deltas: Record<number, number> = {
    100: 1,
    400: 8,
    2000: 40,
    10000: 200,
  };
  return deltas[fee] ?? 0;
}

/**
 * the aligned point edges around a pool's current point.
 *
 * the lower edge is at or below `current_point` and the upper edge is
 * above it, both multiples of `point_delta`.
 */
export function shit_1170_rhea_dclv2_aligned_points_fun(
  current_point: number,
  point_delta: number,
): { left: number; right: number } {
  if (!point_delta || point_delta <= 0) {
    return { left: current_point, right: current_point };
  }
  const left = Math.floor(current_point / point_delta) * point_delta;
  return { left, right: left + point_delta };
}

/**
 * is this point on a multiple of the pool's point delta?
 */
export function shit_1170_rhea_dclv2_point_aligned_fun(
  point: number,
  point_delta: number,
): boolean {
  if (!point_delta || point_delta <= 0) return false;
  return point % point_delta === 0;
}

// --- THE QUOTE ---
//
// a quote is a view. it takes the ordered route through the pools.

export interface SHIT_1170_RHEA_DCLV2_QUOTE {
  amount: string;
  tag?: string | null;
  extra: Record<string, unknown>;
}

/**
 * quote an exact-input swap.
 *
 * `pool_ids` is the ordered ROUTE through the pools — a comma
 * separated list in the bin. `input_amount` is in yocto units of the
 * input token.
 *
 * the returned `amount` is the expected output in the output token's
 * smallest unit. apply a slippage tolerance to it to get the
 * `min_output_amount` for the swap.
 */
export async function shit_1170_rhea_dclv2_quote_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_ids: string[],
  input_token: string,
  output_token: string,
  input_amount: string,
  tag?: string,
): Promise<SHIT_1170_RHEA_DCLV2_QUOTE> {
  const raw = await shit_1170_view_fun<Record<string, unknown>>(
    network,
    dcl_id,
    "quote",
    {
      pool_ids,
      input_token,
      output_token,
      input_amount,
      tag: tag ?? null,
    },
  );
  const quote = raw ?? {};
  return {
    amount: String(quote.amount ?? "0"),
    tag: (quote.tag as string | undefined) ?? null,
    extra: quote,
  };
}

/**
 * quote an exact-OUTPUT swap.
 *
 * the returned `amount` is the INPUT needed for that exact output.
 */
export async function shit_1170_rhea_dclv2_quote_by_output_fun(
  network: SHIT_1170_NETWORK,
  dcl_id: string,
  pool_ids: string[],
  input_token: string,
  output_token: string,
  output_amount: string,
): Promise<SHIT_1170_RHEA_DCLV2_QUOTE> {
  const raw = await shit_1170_view_fun<Record<string, unknown>>(
    network,
    dcl_id,
    "quote_by_output",
    {
      pool_ids,
      input_token,
      output_token,
      output_amount,
    },
  );
  const quote = raw ?? {};
  return {
    amount: String(quote.amount ?? "0"),
    tag: (quote.tag as string | undefined) ?? null,
    extra: quote,
  };
}
