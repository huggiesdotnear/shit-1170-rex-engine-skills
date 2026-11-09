#!/usr/bin/env bun
import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_network_fun,
  shit_1170_sputnik_dao_id_fun,
  shit_1170_sputnik_policy_check_fun,
} from "../src/chain";

// what does this DAO's policy say about this account?
//
// --- WHY THIS CHECK EXISTS ---
// a Sputnik DAO's policy decides three things at once:
//
//   the DEPOSIT — `add_proposal` and `act_proposal` need a deposit
//   equal to the DAO's own `proposal_bond`. the contract checks it
//   with EQUALITY, so too much fails the same way too little does.
//   the bond is a per-dao value: `huggies.sputnik-dao.near` has one
//   of `0`, `onsocial.sputnik-dao.near` has `100000000000000000000000`.
//
//   the PERMISSION — a permission is written
//   `<proposal kind>:<action>`, and the prefix is the kind of the
//   PROPOSAL, not the method called. `call:VoteApprove` approves a
//   `Vote` proposal and `transfer:VoteApprove` approves a `Transfer`
//   one. the contract matches on `<kind>:<action>`, `<kind>:*`,
//   `*:<action>` and `*:*`.
//
//   the THRESHOLD — the roles whose `vote_policy` covers this
//   proposal kind are the ones whose votes count, and the threshold
//   is measured against the role, not the person.
//
// this bin reads the policy and answers all three, so a call is not
// queued against a guess.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this is a VIEW read. it changes nothing on the chain.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "dao_policy --dao <name|account_id> --account <account_id> [--kind Vote|Transfer|FunctionCall|...] [--action VoteApprove|VoteReject|Finalize|RemoveProposal|VoteRemove|MoveToHub] [--network mainnet|testnet]",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const accountId = args_string_fun(args, "account");
  if (!accountId) throw new Error("--account <account_id> is required");

  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);
  const kind = args_string_fun(args, "kind") ?? "Vote";
  const action = args_string_fun(args, "action");

  const check = await shit_1170_sputnik_policy_check_fun(
    network,
    daoId,
    accountId,
    kind,
    action,
  );

  print_json_fun({
    ok: true,
    account: accountId,
    kind,
    action: action ?? null,
    ...check,
    // the deposit the calls need, in yoctoNEAR. this is the value to
    // pass — it is the dao's own bond, not a guess.
    requiredDeposit: check.proposalBond,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
