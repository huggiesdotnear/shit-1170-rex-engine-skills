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
  shit_1170_sputnik_policy_check_fun,
} from "../src/chain";
import {
  shit_1170_sputnik_bounty_claim_queue_call_fun,
  shit_1170_sputnik_bounty_done_queue_call_fun,
  shit_1170_sputnik_bounty_giveup_queue_call_fun,
} from "../src/queue";

// prepare a bounty action — claim a bounty, complete it, or give it
// up.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign.
//
// --- THE DEPOSITS DIFFER ---
//   bounty_claim   the dao's `bounty_bond`
//   bounty_done    the dao's `proposal_bond` — it creates a proposal
//   bounty_giveup  0
//
// the bonds are per-dao values, so they are read from the policy
// rather than guessed.
//
// --- THE DEADLINE ---
// `bounty_claim`'s deadline is a duration in NANOSECONDS and must not
// exceed the bounty's `max_deadline`. read the bounty first.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "bounty --dao <name|account_id> --bounty-id <n> --action claim --deadline <ns> [--account <account_id>]",
        "bounty --dao <name|account_id> --bounty-id <n> --action done --description <text> [--claim-owner <account_id>] [--account <account_id>]",
        "bounty --dao <name|account_id> --bounty-id <n> --action giveup [--account <account_id>]",
        "--deposit and --gas override what the policy says",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const bountyId = args_number_fun(args, "bounty-id");
  if (bountyId === undefined) throw new Error("--bounty-id <n> is required");
  const action = args_string_fun(args, "action");
  if (!action) {
    throw new Error("--action is required — one of claim, done, giveup");
  }

  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);
  const account = args_string_fun(args, "account");
  const depositOverride = args_string_fun(args, "deposit");
  const gasOverride = args_string_fun(args, "gas");

  // the policy, for the bond and for the permission.
  const kindLabel =
    action === "done" ? "BountyDone" : action === "claim" ? "AddBounty" : "Vote";
  let policyCheck: unknown;
  const warnings: string[] = [];

  if (account) {
    const check = await shit_1170_sputnik_policy_check_fun(
      network,
      daoId,
      account,
      kindLabel,
    );
    policyCheck = check;
    warnings.push(...check.warnings);
  }

  const gas = gasOverride ? { gas: gasOverride } : {};
  let transaction: unknown;
  let deposit = depositOverride;

  if (action === "claim") {
    const deadline = args_string_fun(args, "deadline");
    if (!deadline) {
      throw new Error(
        "--deadline <ns> is required for a claim — it is a duration in nanoseconds",
      );
    }
    if (deposit === undefined) {
      if (!policyCheck) {
        throw new Error(
          "--deposit is required when --account is not given — it must be the dao's bounty_bond",
        );
      }
      deposit = (policyCheck as { bountyBond: string }).bountyBond;
    }
    transaction = shit_1170_sputnik_bounty_claim_queue_call_fun({
      daoId,
      id: bountyId,
      deadline,
      deposit,
      ...gas,
    });
  } else if (action === "done") {
    const description = args_string_fun(args, "description");
    if (!description) {
      throw new Error("--description <text> is required for a done");
    }
    if (deposit === undefined) {
      if (!policyCheck) {
        throw new Error(
          "--deposit is required when --account is not given — it must be the dao's proposal_bond",
        );
      }
      deposit = (policyCheck as { proposalBond: string }).proposalBond;
    }
    transaction = shit_1170_sputnik_bounty_done_queue_call_fun({
      daoId,
      id: bountyId,
      description,
      account_id: args_string_fun(args, "claim-owner") ?? null,
      deposit,
      ...gas,
    });
  } else if (action === "giveup") {
    transaction = shit_1170_sputnik_bounty_giveup_queue_call_fun({
      daoId,
      id: bountyId,
      ...gas,
    });
  } else {
    throw new Error(`unknown --action ${action}; use claim, done or giveup`);
  }

  print_json_fun({
    ok: true,
    action: `queue_bounty_${action}`,
    daoId,
    network,
    bountyId,
    deposit: deposit ?? "0",
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
