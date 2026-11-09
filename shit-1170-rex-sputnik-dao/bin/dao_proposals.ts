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
  sputnik_dao_get_actions_log_fun_json,
  sputnik_dao_get_last_proposal_id_fun_json,
} from "@near-kit-tool-box/fun";

import {
  shit_1170_network_fun,
  shit_1170_near_client_fun,
  shit_1170_sputnik_dao_id_fun,
  shit_1170_sputnik_proposals_fun,
} from "../src/chain";

// read a DAO's proposals.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.
//
// --- THE PAGE IS CLAMPED ---
// the contract clamps the page to the DAO's next proposal id, so a
// `limit` larger than what remains returns fewer rows. the last
// proposal id is read alongside the page, so the caller can tell a
// short page from an empty one.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dao_proposals --dao <name|account_id> [--from-index 0] [--limit 50] [--actions-log] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);
  const fromIndex = args_number_fun(args, "from-index", 0) ?? 0;
  const limit = args_number_fun(args, "limit", 50) ?? 50;
  const near = shit_1170_near_client_fun(network);

  const [proposals, lastProposalId] = await Promise.all([
    shit_1170_sputnik_proposals_fun(network, daoId, fromIndex, limit),
    sputnik_dao_get_last_proposal_id_fun_json(near, daoId),
  ]);

  const actionsLog = args_bool_fun(args, "actions-log")
    ? await sputnik_dao_get_actions_log_fun_json(near, daoId)
    : undefined;

  print_json_fun({
    ok: true,
    daoId,
    network,
    fromIndex,
    limit,
    // the id the DAO's NEXT proposal will carry. it is not the count
    // of the proposals — a dao whose proposals were all removed still
    // reports a non-zero id.
    lastProposalId,
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      proposer: proposal.proposer,
      status: proposal.status,
      description: proposal.description,
      // the proposal's kind, as stored. this is the object
      // `act_proposal` must be given unchanged.
      kind: proposal.kind,
      // the votes per role, as `[yes, no, spam]`.
      voteCounts: proposal.vote_counts,
      votes: proposal.votes,
      submissionTime: proposal.submission_time,
    })),
    ...(actionsLog ? { actionsLog } : {}),
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
