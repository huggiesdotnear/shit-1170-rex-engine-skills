// the Rhea AMM v2 DEX, as the shit-1170 rex engine needs it: the
// reads the bins make, and the queue payloads an agent hands to a
// human to sign.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the write
// side of this skill is a QUEUE PAYLOAD —
// `{ contractId, method, args, gas, deposit }` — and never a
// near-kit transaction.
//
// --- WHAT THE TOOL BOX SUPPLIES ---
// the toolbox's `rhea_ammv2_*_fun_json` helpers are the facts: the
// argument shape, the gas, the deposit. the CALL helpers are
// reference here — their gas and deposit values are carried over into
// the queue payloads, but nothing is sent by this skill.
//
// --- THE DEPOSITED BALANCE ---
// the DEX keeps a per-account deposited balance of every token it has
// seen. `withdraw` pays out of it, and an `ft_transfer_call` on the
// token with msg `"Deposit"` credits it.
//
// a swap does NOT need it — a swap takes the tokens straight from the
// caller's wallet balance.

export * from "./chain";
export * from "./queue";

// the methods this skill uses, and whether they are a view or a call.
// a view needs no queue payload.
export const SHIT_1170_RHEA_AMMV2_METHODS = {
  metadata: "view",
  version: "view",
  get_number_of_pools: "view",
  get_pools: "view",
  get_pool: "view",
  get_pool_by_ids: "view",
  get_return: "view",
  get_return_by_output: "view",
  get_pool_shares: "view",
  get_pool_shares_batch: "view",
  get_pool_total_shares: "view",
  get_pool_share_price: "view",
  get_deposits: "view",
  get_deposit: "view",
  get_account_basic_info: "view",
  get_pool_fee: "view",
  get_pool_volumes: "view",
  storage_balance_of: "view",
  storage_balance_bounds: "view",
  get_user_storage_state: "view",
  predict_add_simple_liquidity: "view",
  predict_remove_liquidity: "view",
  predict_swap_actions: "view",
  swap: "call",
  swap_by_output: "call",
  withdraw: "call",
  add_simple_pool: "call",
  add_liquidity: "call",
  remove_liquidity: "call",
  storage_deposit: "call",
  storage_withdraw: "call",
  storage_unregister: "call",
} as const;

export type SHIT_1170_RHEA_AMMV2_METHOD =
  keyof typeof SHIT_1170_RHEA_AMMV2_METHODS;

/**
 * is this method a view?
 *
 * a view is a read: the bins call it directly, and it never becomes
 * a queue payload.
 */
export function shit_1170_rhea_ammv2_is_view_fun(method: string): boolean {
  return (
    SHIT_1170_RHEA_AMMV2_METHODS[method as SHIT_1170_RHEA_AMMV2_METHOD] ===
    "view"
  );
}

// the pool kinds the DEX runs. seen live on mainnet.
export const SHIT_1170_RHEA_AMMV2_POOL_KINDS = {
  SIMPLE_POOL: "simple pool — a constant-product pool",
  STABLE_SWAP: "stable swap — an amplified pool for like assets",
  RATED_SWAP: "rated swap — a pool with a rated token",
  DEGEN_SWAP: "degen swap — a pool with an oracle-priced token",
} as const;

export type SHIT_1170_RHEA_AMMV2_POOL_KIND =
  keyof typeof SHIT_1170_RHEA_AMMV2_POOL_KINDS;
