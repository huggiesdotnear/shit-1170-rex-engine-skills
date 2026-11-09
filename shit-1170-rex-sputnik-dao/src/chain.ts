// the chain reads the Sputnik DAO bins need.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract. every state-changing call is
// queued in the shit-1170 rex engine as a generic function call, and
// a HUMAN signs it in the web app with their wallet. so the only
// chain access here is VIEW reads.
//
// these reads go through the near-kit tool box:
//   `@near-kit-tool-box/fun` — typed helpers, Zod-validated answers
//
// the client is built here rather than taken from the env package,
// because the env package defaults to testnet and these skills
// default to MAINNET. `new Near({ network })` says what we mean.
//
// --- WHY THERE IS NO HAND-ROLLED RPC HERE ---
// near-kit picks a working public endpoint per network
// (`free.rpc.fastnear.com` for mainnet, `rpc.testnet.fastnear.com`
// for testnet) and decodes the answer. the old hand-rolled rpc
// posted to `rpc.mainnet.near.org`, which is DEPRECATED and now
// answers "THIS ENDPOINT IS DEPRECATED!".

import { Near } from "near-kit";
import {
  generic_contract_view_fun_json,
  sputnik_dao_account_id,
  sputnik_dao_account_id_for_network,
  sputnik_dao_factory_contractid,
  sputnik_dao_get_policy_fun_json,
  sputnik_dao_get_proposal_fun_json,
  sputnik_dao_get_proposals_fun_json,
  type SPUTNIK_DAO_POLICY_TYPE,
  type SPUTNIK_DAO_PROPOSAL_TYPE,
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
 * `args` is the contract's own argument object, e.g.
 * `{ account_id: "sleet.near" }` for `ft_balance_of`.
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

// --- THE ACCOUNT IDS ---
//
// a Sputnik DAO is TWO contracts and they are not interchangeable:
//
//   the FACTORY deploys the daos and lists them. it holds no dao
//   state. it is `sputnik-dao.near` on mainnet and
//   `sputnikv2.testnet` on testnet.
//
//   a DAO holds the config, the policy, the proposals and the
//   bounties. it is `<name>.sputnik-dao.near` on mainnet and
//   `<name>.sputnikv2.testnet` on testnet.
//
// calling the factory as if it were a dao fails with
// `MethodResolveError(MethodNotFound)` for EVERY dao method.

/**
 * the factory's account id for one network.
 */
export function shit_1170_sputnik_factory_id_fun(
  network: SHIT_1170_NETWORK = "mainnet",
): string {
  return sputnik_dao_factory_contractid(network);
}

/**
 * a DAO's account id from its name.
 *
 * a mainnet dao is `<name>.sputnik-dao.near` and a testnet dao is
 * `<name>.sputnikv2.testnet`. a name that already carries the suffix
 * is used as it is, so both forms work.
 */
export function shit_1170_sputnik_dao_id_fun(
  name: string,
  network: SHIT_1170_NETWORK = "mainnet",
): string {
  return sputnik_dao_account_id_for_network(name, network);
}

/**
 * the factory's account id for one network, from the tool box's own
 * mainnet-only helper — the same thing, spelled out.
 */
export function shit_1170_sputnik_mainnet_dao_id_fun(name: string): string {
  return sputnik_dao_account_id(name);
}

// --- THE DAO READS ---
//
// these go through the tool box's typed helpers, so the answers are
// Zod-validated against the shapes read off live mainnet responses.

/**
 * the DAO's policy — its roles, who is in them, what each role may
 * do, and the bonds the DAO holds.
 *
 * this is the answer that decides whether a proposal or a vote will
 * succeed, so it is read before anything is queued.
 */
export async function shit_1170_sputnik_policy_fun(
  network: SHIT_1170_NETWORK,
  dao_id: string,
): Promise<SPUTNIK_DAO_POLICY_TYPE> {
  return await sputnik_dao_get_policy_fun_json(
    shit_1170_near_client_fun(network),
    dao_id,
  );
}

/**
 * a page of the DAO's proposals.
 */
export async function shit_1170_sputnik_proposals_fun(
  network: SHIT_1170_NETWORK,
  dao_id: string,
  from_index = 0,
  limit = 50,
): Promise<SPUTNIK_DAO_PROPOSAL_TYPE[]> {
  return await sputnik_dao_get_proposals_fun_json(
    shit_1170_near_client_fun(network),
    dao_id,
    from_index,
    limit,
  );
}

/**
 * one proposal, by its id.
 *
 * the arg is `id`, not `proposal_id` — the contract panics with
 * `missing field 'id'` for the other name.
 */
export async function shit_1170_sputnik_proposal_fun(
  network: SHIT_1170_NETWORK,
  dao_id: string,
  id: number,
): Promise<SPUTNIK_DAO_PROPOSAL_TYPE | null> {
  return await sputnik_dao_get_proposal_fun_json(
    shit_1170_near_client_fun(network),
    dao_id,
    id,
  );
}

// --- THE PERMISSIONS ---
//
// a permission is written `<proposal kind>:<action>`. the prefix is
// the kind of the PROPOSAL, not the method called — `call:VoteApprove`
// approves a `Vote` proposal and `transfer:VoteApprove` approves a
// `Transfer` one.
//
// the contract matches a permission on any of four forms:
//   `<kind>:<action>`  `<kind>:*`  `*:<action>`  `*:*`
//
// the proposal kind's label is not always its name:
//   FunctionCall -> call      ChangeConfig -> config
//   Vote         -> vote      SetStakingContract -> set_vote_token
//   Transfer     -> transfer  ChangePolicy -> policy

/**
 * the label the contract uses for a proposal kind.
 *
 * this mirrors the contract's own `ProposalKind::to_policy_label`.
 */
export function shit_1170_sputnik_kind_label_fun(kind: string): string {
  const labels: Record<string, string> = {
    ChangeConfig: "config",
    ChangePolicy: "policy",
    AddMemberToRole: "add_member_to_role",
    RemoveMemberFromRole: "remove_member_from_role",
    FunctionCall: "call",
    UpgradeSelf: "upgrade_self",
    UpgradeRemote: "upgrade_remote",
    Transfer: "transfer",
    SetStakingContract: "set_vote_token",
    AddBounty: "add_bounty",
    BountyDone: "bounty_done",
    Vote: "vote",
    FactoryInfoUpdate: "factory_info_update",
    ChangePolicyAddOrUpdateRole: "policy_add_or_update_role",
    ChangePolicyRemoveRole: "policy_remove_role",
    ChangePolicyUpdateDefaultVotePolicy: "policy_update_default_vote_policy",
    ChangePolicyUpdateParameters: "policy_update_parameters",
  };
  return labels[kind] ?? kind;
}

/**
 * the permission labels one role carries.
 */
export function shit_1170_sputnik_role_permissions_fun(
  role: { permissions?: unknown },
): string[] {
  const permissions = role?.permissions;
  if (!Array.isArray(permissions)) return [];
  return permissions.filter(
    (value): value is string => typeof value === "string",
  );
}

/**
 * does one role's permission list allow this action on this proposal
 * kind?
 *
 * the permission is `<proposal kind label>:<action label>` — the
 * prefix is the KIND of the proposal, the suffix is the action. so
 * `call:VoteApprove` approves a `FunctionCall` proposal and
 * `transfer:VoteApprove` approves a `Transfer` one.
 *
 * the contract matches on any of four forms:
 *   `<kind>:<action>`  `<kind>:*`  `*:<action>`  `*:*`
 *
 * `AddProposal` is the action the `add_proposal` call itself is
 * checked against — the contract's own action enum, not a method
 * name.
 */
export function shit_1170_sputnik_role_allows_fun(
  role: { permissions?: unknown },
  kind_label: string,
  action_label: string,
): boolean {
  const permissions = shit_1170_sputnik_role_permissions_fun(role);
  return (
    permissions.includes(`${kind_label}:${action_label}`) ||
    permissions.includes(`${kind_label}:*`) ||
    permissions.includes(`*:${action_label}`) ||
    permissions.includes("*:*")
  );
}

// --- WHAT THE POLICY SAYS ABOUT A PROPOSAL ---
//
// the answer an agent needs before it queues anything: may this
// account propose this kind, may it vote this way, and what does the
// deposit have to be.

export interface SHIT_1170_SPUTNIK_POLICY_CHECK {
  daoId: string;
  // the proposal bond, in yoctoNEAR. the deposit must equal it.
  proposalBond: string;
  // the bounty bond, in yoctoNEAR.
  bountyBond: string;
  // the roles this account is in.
  memberRoles: string[];
  // the roles that are open to everyone.
  everyoneRoles: string[];
  // may this account propose a proposal of this kind?
  mayPropose: boolean;
  // may this account act this way on a proposal of this kind?
  mayAct: boolean;
  // the roles whose vote_policy covers this proposal kind.
  countingRoles: string[];
  // the threshold for each counting role, and the default for the rest.
  thresholds: { role: string; threshold: string | number[] }[];
  defaultThreshold: string | number[];
  warnings: string[];
}

/**
 * read the policy and work out what this account may do.
 *
 * `kind` is the proposal kind — `Vote`, `Transfer`, `FunctionCall` and
 * so on. `action` is the act_proposal action — `VoteApprove`,
 * `VoteReject`, `Finalize`, `RemoveProposal`, `VoteRemove` or
 * `MoveToHub`.
 *
 * the answer is advisory: it reads the policy as it is right now. the
 * contract checks again when it runs.
 */
export async function shit_1170_sputnik_policy_check_fun(
  network: SHIT_1170_NETWORK,
  dao_id: string,
  account_id: string,
  kind: string,
  action?: string,
): Promise<SHIT_1170_SPUTNIK_POLICY_CHECK> {
  const policy = await shit_1170_sputnik_policy_fun(network, dao_id);
  const warnings: string[] = [];

  const roles = policy.roles ?? [];
  const kindLabel = shit_1170_sputnik_kind_label_fun(kind);
  const actionLabel = action ?? "AddProposal";

  const memberRoles: string[] = [];
  const everyoneRoles: string[] = [];
  let mayPropose = false;
  let mayAct = false;

  for (const role of roles) {
    const roleKind = role.kind;
    let isMember = false;

    if (roleKind === "Everyone") {
      everyoneRoles.push(role.name);
      isMember = true;
    } else if (
      roleKind &&
      typeof roleKind === "object" &&
      "Group" in roleKind &&
      Array.isArray((roleKind as { Group: unknown }).Group)
    ) {
      const group = (roleKind as { Group: string[] }).Group;
      if (group.includes(account_id)) {
        memberRoles.push(role.name);
        isMember = true;
      }
    } else if (
      roleKind &&
      typeof roleKind === "object" &&
      "Member" in roleKind
    ) {
      // a role open to accounts holding at least this much delegated
      // balance. the balance is read from `delegation_balance_of`.
      const required = String(
        (roleKind as { Member: unknown }).Member ?? "0",
      );
      let held = "0";
      try {
        held = await shit_1170_view_fun<string>(
          network,
          dao_id,
          "delegation_balance_of",
          { account_id },
        );
      } catch {
        held = "0";
      }
      if (BigInt(held) >= BigInt(required)) {
        memberRoles.push(role.name);
        isMember = true;
      }
    }

    if (!isMember) continue;

    if (shit_1170_sputnik_role_allows_fun(role, kindLabel, "AddProposal")) {
      mayPropose = true;
    }
    if (
      action &&
      shit_1170_sputnik_role_allows_fun(role, kindLabel, actionLabel)
    ) {
      mayAct = true;
    }
  }

  // the roles whose vote_policy covers this proposal kind — the ones
  // whose votes count against a threshold.
  const countingRoles: string[] = [];
  const thresholds: { role: string; threshold: string | number[] }[] = [];
  for (const role of roles) {
    const votePolicy = (role.vote_policy ?? {}) as Record<
      string,
      { threshold?: string | number[] }
    >;
    const forKind = votePolicy[kindLabel];
    if (!forKind) continue;
    countingRoles.push(role.name);
    if (forKind.threshold !== undefined) {
      thresholds.push({ role: role.name, threshold: forKind.threshold });
    }
  }

  if (!mayPropose) {
    warnings.push(
      `${account_id} holds no role that may add a ${kind} proposal on this dao; the call would fail with ERR_PERMISSION_DENIED`,
    );
  }
  if (action && !mayAct) {
    warnings.push(
      `${account_id} holds no role that may ${action} a ${kind} proposal on this dao; the call would fail with ERR_PERMISSION_DENIED`,
    );
  }
  if (!thresholds.length) {
    warnings.push(
      "no role carries a vote_policy for this proposal kind, so the dao's default_vote_policy applies",
    );
  }

  return {
    daoId: dao_id,
    proposalBond: policy.proposal_bond ?? "0",
    bountyBond: policy.bounty_bond ?? "0",
    memberRoles,
    everyoneRoles,
    mayPropose,
    mayAct,
    countingRoles,
    thresholds,
    defaultThreshold: policy.default_vote_policy?.threshold ?? "1",
    warnings,
  };
}
