#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_network_fun,
  shit_1170_sputnik_dao_id_fun,
  shit_1170_sputnik_kind_label_fun,
  shit_1170_sputnik_policy_check_fun,
  shit_1170_sputnik_proposal_fun,
} from "../src/chain";
import { shit_1170_sputnik_act_proposal_queue_call_fun } from "../src/queue";

// prepare an `act_proposal` queue payload — vote on a proposal,
// finalize it, or remove it.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- THE KIND MUST MATCH THE STORED ONE ---
// the contract checks the `proposal` argument against the kind stored
// for that id, and rejects a mismatch with `ERR_WRONG_KIND`. it must
// be the WHOLE payload, not just the label: for a `Transfer` that is
// the `token_id`, `receiver_id`, `amount` and `msg` as they are
// stored.
//
// so the bin reads the proposal and takes its kind from there. that
// is the only way to get it right, and it is why the bin does not
// take a `--kind` flag.
//
// --- THE ACTION ---
// one of `VoteApprove`, `VoteReject`, `VoteRemove`, `Finalize`,
// `RemoveProposal` or `MoveToHub`. `AddProposal` is not accepted —
// the contract rejects it with `ERR_WRONG_ACTION`.
//
// --- THE DEPOSIT ---
// `act_proposal` needs a deposit of 0.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "act_proposal --dao <name|account_id> --proposal-id <n> --action VoteApprove|VoteReject|VoteRemove|Finalize|RemoveProposal|MoveToHub [--memo <text>] [--account <account_id>] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const proposalId = args_number_fun(args, "proposal-id");
  if (proposalId === undefined) {
    throw new Error("--proposal-id <n> is required");
  }
  const action = args_string_fun(args, "action");
  if (!action) {
    throw new Error(
      "--action is required — one of VoteApprove, VoteReject, VoteRemove, Finalize, RemoveProposal, MoveToHub",
    );
  }

  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);

  // the proposal's stored kind. the contract compares against this,
  // so it is read rather than supplied.
  const proposal = await shit_1170_sputnik_proposal_fun(
    network,
    daoId,
    proposalId,
  );
  if (!proposal) {
    throw new Error(
      `proposal ${proposalId} is not on this dao — it may have been removed, which drops the proposal but keeps the id in the counter`,
    );
  }

  const kindLabel = shit_1170_sputnik_kind_label_fun(
    Object.keys(proposal.kind)[0] ?? "",
  );

  // the account that will sign. it decides whether this action is
  // allowed, so the policy is read with it.
  const account = args_string_fun(args, "account");
  const warnings: string[] = [];
  let policyCheck: unknown;

  if (account) {
    const check = await shit_1170_sputnik_policy_check_fun(
      network,
      daoId,
      account,
      Object.keys(proposal.kind)[0] ?? "Vote",
      action,
    );
    policyCheck = check;
    warnings.push(...check.warnings);
  }

  const transaction = shit_1170_sputnik_act_proposal_queue_call_fun({
    daoId,
    id: proposalId,
    action,
    // the kind exactly as it is stored.
    proposal: proposal.kind as Record<string, unknown>,
    memo: args_string_fun(args, "memo") ?? null,
    ...(args_string_fun(args, "gas") ? { gas: args_string_fun(args, "gas")! } : {}),
  });

  print_json_fun({
    ok: true,
    queueAction: "queue_act_proposal",
    daoId,
    network,
    proposalId,
    action,
    // the proposal's kind label, for the permission check.
    kindLabel,
    // the proposal's status, as the contract reports it.
    proposalStatus: proposal.status,
    // the proposal's stored kind, echoed back so the human can see
    // what is being voted on.
    proposalKind: proposal.kind,
    voteCounts: proposal.vote_counts,
    ...(policyCheck ? { policyCheck } : {}),
    warnings,
    transactions: [transaction],
    transaction,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
