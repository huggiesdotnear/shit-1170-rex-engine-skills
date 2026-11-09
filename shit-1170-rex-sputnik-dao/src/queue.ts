// the Sputnik DAO queue payloads, as the rex engine needs them.
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
// the toolbox's `sputnik_dao_*_fun_json` CALL helpers are the
// strongest evidence for the argument shape, the gas and the deposit,
// because they build and send the exact JSON. the values below are
// taken from those helpers:
//
//   add_proposal                    gas 30 Tgas  deposit = the bond
//   act_proposal                    gas 30 Tgas  deposit 0
//   bounty_claim                    gas 30 Tgas  deposit = the bond
//   bounty_done                     gas 30 Tgas  deposit = the bond
//   bounty_giveup                   gas 30 Tgas  deposit 0
//   store_blob                      gas 30 Tgas  deposit = the storage
//   remove_blob                     gas 30 Tgas  deposit 0
//
// the DAZ's own `get_policy` is where the BOND comes from — it is a
// per-dao value and the contract checks it with EQUALITY, so a
// deposit that is too large fails the same way a small one does.
// never hardcode a bond. read it.

import { sputnik_dao_methods_const } from "@near-kit-tool-box/fun";
import {
  queue_call_fun,
  type QUEUE_CALL,
} from "@huggies/shit-1170-rex-engine-middleman";

export type { QUEUE_CALL };

// the toolbox's working gas for the Sputnik DAO calls, in gas units.
export const SHIT_1170_SPUTNIK_DEFAULT_GAS = "30000000000000";

// --- THE ARGUMENT SHAPES ---
//
// every shape the contract defines, so an agent can build the right
// call without reading the contract's source.
//
// the args are JSON and the numbers are JSON NUMBERS. sending a
// number as a string panics with
// `invalid type: string "0", expected u64`.

export interface SHIT_1170_SPUTNIK_PROPOSAL_KIND {
  [variant: string]: unknown;
}

/**
 * the `add_proposal` args.
 *
 * the contract wraps the proposal in a `proposal` object:
 * `{ proposal: { description, kind } }`.
 */
export function shit_1170_sputnik_add_proposal_args_fun(
  description: string,
  kind: SHIT_1170_SPUTNIK_PROPOSAL_KIND,
): Record<string, unknown> {
  const text = description.trim();
  if (!text) throw new Error("description is required");
  if (!kind || typeof kind !== "object" || Array.isArray(kind)) {
    throw new Error(
      "kind is required and must be the proposal kind object, e.g. { \"Vote\": null } or { \"Transfer\": { ... } }",
    );
  }
  return { proposal: { description: text, kind } };
}

/**
 * the `act_proposal` args.
 *
 * `proposal` must be the proposal's stored kind, unchanged — the
 * whole payload, not just the label. a mismatch fails with
 * `ERR_WRONG_KIND`.
 *
 * `action` is one of `RemoveProposal`, `VoteApprove`, `VoteReject`,
 * `VoteRemove`, `Finalize` or `MoveToHub`. `AddProposal` is not
 * accepted.
 */
export function shit_1170_sputnik_act_proposal_args_fun(
  id: number,
  action: string,
  proposal: SHIT_1170_SPUTNIK_PROPOSAL_KIND,
  memo?: string | null,
): Record<string, unknown> {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("id is required and must be a whole number");
  }
  const actions = [
    "RemoveProposal",
    "VoteApprove",
    "VoteReject",
    "VoteRemove",
    "Finalize",
    "MoveToHub",
  ];
  if (!actions.includes(action)) {
    throw new Error(
      `action must be one of ${actions.join(", ")} — got ${action}`,
    );
  }
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error(
      "proposal is required and must be the proposal's stored kind, read from get_proposal",
    );
  }
  return { id, action, proposal, memo: memo ?? null };
}

/**
 * the `bounty_claim` args.
 *
 * `deadline` is a duration in nanoseconds and must not exceed the
 * bounty's `max_deadline`.
 */
export function shit_1170_sputnik_bounty_claim_args_fun(
  id: number,
  deadline: string,
): Record<string, unknown> {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("id is required and must be a whole number");
  }
  const duration = deadline.trim();
  if (!/^\d+$/.test(duration)) {
    throw new Error("deadline must be a whole number of nanoseconds");
  }
  return { id, deadline: duration };
}

/**
 * the `bounty_done` args.
 *
 * `account_id` may be null to mean the caller. when it is not null it
 * names the claim owner, and the caller must be that owner while the
 * claim is still active.
 */
export function shit_1170_sputnik_bounty_done_args_fun(
  id: number,
  description: string,
  account_id?: string | null,
): Record<string, unknown> {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("id is required and must be a whole number");
  }
  const text = description.trim();
  if (!text) throw new Error("description is required");
  return { id, account_id: account_id ?? null, description: text };
}

/**
 * the `bounty_giveup` args.
 */
export function shit_1170_sputnik_bounty_giveup_args_fun(
  id: number,
): Record<string, unknown> {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("id is required and must be a whole number");
  }
  return { id };
}

// --- THE QUEUE PAYLOADS ---
//
// these are DATA. the engine queues them and a human signs them.

export interface SHIT_1170_SPUTNIK_CALL_REQUEST {
  daoId: string;
  gas?: string;
  deposit?: string;
}

/**
 * prepare an `add_proposal` queue payload.
 *
 * `deposit` MUST be the DAO's own `proposal_bond`, read from
 * `get_policy`. the contract checks it with equality.
 */
export function shit_1170_sputnik_add_proposal_queue_call_fun(
  request: SHIT_1170_SPUTNIK_CALL_REQUEST & {
    description: string;
    kind: SHIT_1170_SPUTNIK_PROPOSAL_KIND;
  },
): QUEUE_CALL {
  const daoId = request.daoId.trim();
  if (!daoId) throw new Error("dao id is required");
  const deposit = request.deposit;
  if (deposit === undefined || deposit === null) {
    throw new Error(
      "deposit is required — it must be the dao's proposal_bond, read from get_policy",
    );
  }
  return queue_call_fun({
    contractId: daoId,
    method: sputnik_dao_methods_const.add_proposal,
    args: shit_1170_sputnik_add_proposal_args_fun(
      request.description,
      request.kind,
    ),
    gas: request.gas ?? SHIT_1170_SPUTNIK_DEFAULT_GAS,
    deposit,
  });
}

/**
 * prepare an `act_proposal` queue payload.
 *
 * the deposit is 0.
 */
export function shit_1170_sputnik_act_proposal_queue_call_fun(
  request: SHIT_1170_SPUTNIK_CALL_REQUEST & {
    id: number;
    action: string;
    proposal: SHIT_1170_SPUTNIK_PROPOSAL_KIND;
    memo?: string | null;
  },
): QUEUE_CALL {
  const daoId = request.daoId.trim();
  if (!daoId) throw new Error("dao id is required");
  return queue_call_fun({
    contractId: daoId,
    method: sputnik_dao_methods_const.act_proposal,
    args: shit_1170_sputnik_act_proposal_args_fun(
      request.id,
      request.action,
      request.proposal,
      request.memo,
    ),
    gas: request.gas ?? SHIT_1170_SPUTNIK_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

/**
 * prepare a `bounty_claim` queue payload.
 *
 * `deposit` MUST be the DAO's own `bounty_bond`.
 */
export function shit_1170_sputnik_bounty_claim_queue_call_fun(
  request: SHIT_1170_SPUTNIK_CALL_REQUEST & {
    id: number;
    deadline: string;
  },
): QUEUE_CALL {
  const daoId = request.daoId.trim();
  if (!daoId) throw new Error("dao id is required");
  const deposit = request.deposit;
  if (deposit === undefined || deposit === null) {
    throw new Error(
      "deposit is required — it must be the dao's bounty_bond, read from get_policy",
    );
  }
  return queue_call_fun({
    contractId: daoId,
    method: sputnik_dao_methods_const.bounty_claim,
    args: shit_1170_sputnik_bounty_claim_args_fun(request.id, request.deadline),
    gas: request.gas ?? SHIT_1170_SPUTNIK_DEFAULT_GAS,
    deposit,
  });
}

/**
 * prepare a `bounty_done` queue payload.
 *
 * `deposit` MUST be the DAO's own `proposal_bond` — this call creates
 * a proposal, so it is bonded like one.
 */
export function shit_1170_sputnik_bounty_done_queue_call_fun(
  request: SHIT_1170_SPUTNIK_CALL_REQUEST & {
    id: number;
    description: string;
    account_id?: string | null;
  },
): QUEUE_CALL {
  const daoId = request.daoId.trim();
  if (!daoId) throw new Error("dao id is required");
  const deposit = request.deposit;
  if (deposit === undefined || deposit === null) {
    throw new Error(
      "deposit is required — it must be the dao's proposal_bond, read from get_policy",
    );
  }
  return queue_call_fun({
    contractId: daoId,
    method: sputnik_dao_methods_const.bounty_done,
    args: shit_1170_sputnik_bounty_done_args_fun(
      request.id,
      request.description,
      request.account_id,
    ),
    gas: request.gas ?? SHIT_1170_SPUTNIK_DEFAULT_GAS,
    deposit,
  });
}

/**
 * prepare a `bounty_giveup` queue payload.
 *
 * the deposit is 0.
 */
export function shit_1170_sputnik_bounty_giveup_queue_call_fun(
  request: SHIT_1170_SPUTNIK_CALL_REQUEST & { id: number },
): QUEUE_CALL {
  const daoId = request.daoId.trim();
  if (!daoId) throw new Error("dao id is required");
  return queue_call_fun({
    contractId: daoId,
    method: sputnik_dao_methods_const.bounty_giveup,
    args: shit_1170_sputnik_bounty_giveup_args_fun(request.id),
    gas: request.gas ?? SHIT_1170_SPUTNIK_DEFAULT_GAS,
    deposit: request.deposit ?? "0",
  });
}

// --- THE PROPOSAL KINDS ---
//
// the kinds an agent can propose, and how to build each one. the
// kind is an externally tagged enum, so it is an object with ONE key
// and the payload under it.

/**
 * a signalling proposal. the simplest kind, and the one that needs no
 * payload.
 */
export function shit_1170_sputnik_vote_kind_fun(): SHIT_1170_SPUTNIK_PROPOSAL_KIND {
  return { Vote: null };
}

/**
 * a proposal to move tokens out of the DAO.
 *
 * `token_id` is the token's account id. an empty string means NEAR.
 * `msg` must be null for NEAR — a non-null `msg` with an empty
 * `token_id` fails with `ERR_BASE_TOKEN_NO_MSG`.
 */
export function shit_1170_sputnik_transfer_kind_fun(
  token_id: string,
  receiver_id: string,
  amount: string,
  msg?: string | null,
): SHIT_1170_SPUTNIK_PROPOSAL_KIND {
  const token = token_id.trim();
  const receiver = receiver_id.trim();
  const unit = amount.trim();
  if (!receiver) throw new Error("receiver id is required");
  if (!/^\d+$/.test(unit)) {
    throw new Error("amount must be a whole number in the token's smallest unit");
  }
  if (token === "" && msg) {
    throw new Error(
      "a NEAR transfer must carry a null msg — a non-null msg with an empty token_id fails with ERR_BASE_TOKEN_NO_MSG",
    );
  }
  return {
    Transfer: {
      token_id: token,
      receiver_id: receiver,
      amount: unit,
      msg: msg ?? null,
    },
  };
}

/**
 * a proposal to call a method on another contract.
 *
 * each action's `args` are the target method's arguments as
 * BASE64-ENCODED bytes — the contract stores them raw, so a plain
 * JSON object is rejected. `deposit` and `gas` are decimal strings in
 * yoctoNEAR and yoctoGas.
 */
export function shit_1170_sputnik_function_call_kind_fun(
  receiver_id: string,
  method_name: string,
  args_base64: string,
  deposit = "0",
  gas = "30000000000000",
): SHIT_1170_SPUTNIK_PROPOSAL_KIND {
  const receiver = receiver_id.trim();
  const method = method_name.trim();
  if (!receiver) throw new Error("receiver id is required");
  if (!method) throw new Error("method name is required");
  const encoded = args_base64.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("args must be base64-encoded");
  }
  return {
    FunctionCall: {
      receiver_id: receiver,
      actions: [
        {
          method_name: method,
          args: encoded,
          deposit,
          gas,
        },
      ],
    },
  };
}

/**
 * a proposal to add an account to a role.
 */
export function shit_1170_sputnik_add_member_kind_fun(
  member_id: string,
  role: string,
): SHIT_1170_SPUTNIK_PROPOSAL_KIND {
  const member = member_id.trim();
  const roleName = role.trim();
  if (!member) throw new Error("member id is required");
  if (!roleName) throw new Error("role is required");
  return { AddMemberToRole: { member_id: member, role: roleName } };
}

/**
 * a proposal to remove an account from a role.
 */
export function shit_1170_sputnik_remove_member_kind_fun(
  member_id: string,
  role: string,
): SHIT_1170_SPUTNIK_PROPOSAL_KIND {
  const member = member_id.trim();
  const roleName = role.trim();
  if (!member) throw new Error("member id is required");
  if (!roleName) throw new Error("role is required");
  return { RemoveMemberFromRole: { member_id: member, role: roleName } };
}
