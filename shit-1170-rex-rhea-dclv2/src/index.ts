// the Rhea DCL v2 concentrated-liquidity DEX, as the shit-1170 rex
// engine needs it: the reads the bins make, and the queue payloads an
// agent hands to a human to sign.
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
// `place_order` method**.
//
// --- WHAT THE TOOL BOX SUPPLIES ---
// the toolbox's `rhea_dclv2_*_fun_json` helpers are the facts: the
// argument shape, the gas, the deposit. the CALL helpers are
// reference here — their gas and deposit values are carried over into
// the queue payloads, but nothing is sent by this skill.
//
// --- THE INTERNAL BALANCE ---
// the DEX keeps a per-user internal balance of every token it has
// seen. `add_liquidity` pulls from it, and `withdraw_asset` pays out
// of it. so the LP flow is always three steps, never two:
//
//   1. `ft_transfer_call` on the token with msg = `"Deposit"`
//   2. `add_liquidity` — pulls from the internal balance
//   3. `withdraw_asset` — pays out of it
//
// a swap does NOT touch the internal balance — it goes straight in and
// straight out to the wallet.

export * from "./chain";
export * from "./queue";

// the methods this skill uses, and whether they are a view or a call.
// a view needs no queue payload.
export const SHIT_1170_RHEA_DCLV2_METHODS = {
  get_metadata: "view",
  get_pool: "view",
  get_pools: "view",
  list_pools: "view",
  get_liquidity: "view",
  list_liquidities: "view",
  list_liquidity_views: "view",
  get_user_asset: "view",
  list_user_assets: "view",
  quote: "view",
  quote_by_output: "view",
  predict_add_liquidity: "view",
  predict_remove_liquidity: "view",
  get_marketdepth: "view",
  get_market_depth_list: "view",
  get_order: "view",
  find_order: "view",
  list_active_orders: "view",
  list_history_orders: "view",
  storage_balance_of: "view",
  storage_balance_bounds: "view",
  get_user_storage_detail: "view",
  add_liquidity: "call",
  remove_liquidity: "call",
  withdraw_asset: "call",
  cancel_order: "call",
  storage_deposit: "call",
  storage_withdraw: "call",
  storage_unregister: "call",
} as const;

export type SHIT_1170_RHEA_DCLV2_METHOD =
  keyof typeof SHIT_1170_RHEA_DCLV2_METHODS;

/**
 * is this method a view?
 *
 * a view is a read: the bins call it directly, and it never becomes
 * a queue payload.
 */
export function shit_1170_rhea_dclv2_is_view_fun(method: string): boolean {
  return (
    SHIT_1170_RHEA_DCLV2_METHODS[method as SHIT_1170_RHEA_DCLV2_METHOD] ===
    "view"
  );
}

// the fees the DEX charges, and the point delta each one implies.
//
// an LP range must sit on multiples of the pool's point delta, else
// the call fails with `E200: invalid endpoint`.
export const SHIT_1170_RHEA_DCLV2_POINT_DELTAS = {
  100: 1,
  400: 8,
  2000: 40,
  10000: 200,
} as const;

export type SHIT_1170_RHEA_DCLV2_FEE = keyof typeof SHIT_1170_RHEA_DCLV2_POINT_DELTAS;
