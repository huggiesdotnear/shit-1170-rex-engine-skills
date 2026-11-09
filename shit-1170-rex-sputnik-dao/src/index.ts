// the Sputnik DAO, as the shit-1170 rex engine needs it: the reads
// the bins make, and the queue payloads an agent hands to a human to
// sign.
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
// the toolbox's `sputnik_dao_*_fun_json` helpers are the facts:
// the argument shape, the gas, the deposit. the CALL helpers are
// reference here — their gas and deposit values are carried over into
// the queue payloads, but nothing is sent by this skill.
//
// the toolbox's `sputnik_dao_methods_const` names the methods, so the
// method name in a payload is the contract's own spelling.
//
// --- THE DAO IS NOT THE FACTORY ---
// `sputnik-dao.near` deploys the daos and lists them. it holds no dao
// state. calling it as if it were a dao fails with
// `MethodResolveError(MethodNotFound)` for EVERY dao method.

export * from "./chain";
export * from "./queue";

// the methods this skill writes, and whether they are a view or a
// call. a view needs no queue payload.
export const SHIT_1170_SPUTNIK_METHODS = {
  get_config: "view",
  get_policy: "view",
  version: "view",
  get_proposals: "view",
  get_proposal: "view",
  get_last_proposal_id: "view",
  get_actions_log: "view",
  get_bounties: "view",
  get_bounty: "view",
  get_bounty_claims: "view",
  get_bounty_number_of_claims: "view",
  get_last_bounty_id: "view",
  get_available_amount: "view",
  get_locked_storage_amount: "view",
  get_staking_contract: "view",
  get_factory_info: "view",
  delegation_balance_of: "view",
  delegation_balance_ratio: "view",
  delegation_total_supply: "view",
  has_blob: "view",
  add_proposal: "call",
  act_proposal: "call",
  bounty_claim: "call",
  bounty_done: "call",
  bounty_giveup: "call",
  store_blob: "call",
  remove_blob: "call",
} as const;

export type SHIT_1170_SPUTNIK_METHOD = keyof typeof SHIT_1170_SPUTNIK_METHODS;

/**
 * is this method a view?
 *
 * a view is a read: the bins call it directly, and it never becomes
 * a queue payload.
 */
export function shit_1170_sputnik_is_view_fun(method: string): boolean {
  return (
    SHIT_1170_SPUTNIK_METHODS[method as SHIT_1170_SPUTNIK_METHOD] === "view"
  );
}

// the actions `act_proposal` accepts. `AddProposal` is not one of
// them — the contract rejects it with `ERR_WRONG_ACTION`.
export const SHIT_1170_SPUTNIK_ACTIONS = [
  "RemoveProposal",
  "VoteApprove",
  "VoteReject",
  "VoteRemove",
  "Finalize",
  "MoveToHub",
] as const;

export type SHIT_1170_SPUTNIK_ACTION =
  (typeof SHIT_1170_SPUTNIK_ACTIONS)[number];
