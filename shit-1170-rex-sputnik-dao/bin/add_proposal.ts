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
import {
  shit_1170_sputnik_add_member_kind_fun,
  shit_1170_sputnik_add_proposal_queue_call_fun,
  shit_1170_sputnik_function_call_kind_fun,
  shit_1170_sputnik_remove_member_kind_fun,
  shit_1170_sputnik_transfer_kind_fun,
  shit_1170_sputnik_vote_kind_fun,
} from "../src/queue";

// prepare an `add_proposal` queue payload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, args, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- THE DEPOSIT IS READ, NOT GUESSED ---
// `add_proposal` needs a deposit equal to the DAO's own
// `proposal_bond`, and the contract checks it with EQUALITY — a
// deposit that is too large fails the same way a small one does.
//
// so the bin reads `get_policy` and takes the bond from there. the
// bond is a per-dao value: `huggies.sputnik-dao.near` has one of `0`,
// `onsocial.sputnik-dao.near` has `100000000000000000000000`.
//
// --- THE PROPOSAL KIND ---
// the kind is an externally tagged enum — an object with ONE key and
// the payload under it. the bin builds the common ones so the caller
// does not hand-write the nesting:
//
//   --kind vote        a signalling proposal
//   --kind transfer    move tokens out of the dao
//   --kind call        call a method on another contract
//   --kind add-member  add an account to a role
//   --kind remove-member  take an account out of a role
//
// `--kind-json` takes the kind object directly, for the kinds the bin
// does not build.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "add_proposal --dao <name|account_id> --description <text> --kind vote [--account <account_id>] [--network mainnet|testnet]",
        "add_proposal --dao <name> --description <text> --kind transfer --token <token_id> --receiver <account_id> --amount <unit_amount> [--msg <text>]",
        "add_proposal --dao <name> --description <text> --kind call --receiver <account_id> --method <name> --args-base64 <base64> [--action-deposit 0] [--action-gas 30000000000000]",
        "add_proposal --dao <name> --description <text> --kind add-member --member <account_id> --role <role>",
        "add_proposal --dao <name> --description <text> --kind-json '<kind object>'",
        "--deposit and --gas override what the policy says",
      ],
    });
    return;
  }

  const network = shit_1170_network_fun(args_string_fun(args, "network"));
  const daoInput = args_string_fun(args, "dao");
  if (!daoInput) throw new Error("--dao <name|account_id> is required");
  const description = args_string_fun(args, "description");
  if (!description) throw new Error("--description <text> is required");
  const daoId = shit_1170_sputnik_dao_id_fun(daoInput, network);

  // build the kind.
  const kindJson = args_string_fun(args, "kind-json");
  let kind: Record<string, unknown>;
  let kindLabel = "Vote";

  if (kindJson) {
    kind = JSON.parse(kindJson) as Record<string, unknown>;
    kindLabel = Object.keys(kind)[0] ?? "Vote";
  } else {
    const kindName = args_string_fun(args, "kind") ?? "vote";
    switch (kindName) {
      case "vote":
        kind = shit_1170_sputnik_vote_kind_fun();
        kindLabel = "Vote";
        break;
      case "transfer": {
        const token = args_string_fun(args, "token") ?? "";
        const receiver = args_string_fun(args, "receiver");
        if (!receiver) throw new Error("--receiver <account_id> is required");
        const amount = args_string_fun(args, "amount");
        if (!amount) throw new Error("--amount <unit_amount> is required");
        kind = shit_1170_sputnik_transfer_kind_fun(
          token,
          receiver,
          amount,
          args_string_fun(args, "msg") ?? null,
        );
        kindLabel = "Transfer";
        break;
      }
      case "call": {
        const receiver = args_string_fun(args, "receiver");
        if (!receiver) throw new Error("--receiver <account_id> is required");
        const method = args_string_fun(args, "method");
        if (!method) throw new Error("--method <name> is required");
        const argsBase64 = args_string_fun(args, "args-base64");
        if (!argsBase64) {
          throw new Error(
            "--args-base64 <base64> is required — a FunctionCall action's args are the target method's arguments as base64-encoded bytes",
          );
        }
        kind = shit_1170_sputnik_function_call_kind_fun(
          receiver,
          method,
          argsBase64,
          args_string_fun(args, "action-deposit") ?? "0",
          args_string_fun(args, "action-gas") ?? "30000000000000",
        );
        kindLabel = "FunctionCall";
        break;
      }
      case "add-member": {
        const member = args_string_fun(args, "member");
        const role = args_string_fun(args, "role");
        if (!member) throw new Error("--member <account_id> is required");
        if (!role) throw new Error("--role <role> is required");
        kind = shit_1170_sputnik_add_member_kind_fun(member, role);
        kindLabel = "AddMemberToRole";
        break;
      }
      case "remove-member": {
        const member = args_string_fun(args, "member");
        const role = args_string_fun(args, "role");
        if (!member) throw new Error("--member <account_id> is required");
        if (!role) throw new Error("--role <role> is required");
        kind = shit_1170_sputnik_remove_member_kind_fun(member, role);
        kindLabel = "RemoveMemberFromRole";
        break;
      }
      default:
        throw new Error(
          `unknown --kind ${kindName}; use vote, transfer, call, add-member, remove-member, or --kind-json`,
        );
    }
  }

  // the account that will sign. it decides whether the proposal is
  // even allowed, so the policy is read with it.
  const account = args_string_fun(args, "account");
  const depositOverride = args_string_fun(args, "deposit");
  const gasOverride = args_string_fun(args, "gas");

  let deposit = depositOverride;
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
    if (deposit === undefined) deposit = check.proposalBond;
  }

  if (deposit === undefined) {
    throw new Error(
      "--deposit is required when --account is not given — it must be the dao's proposal_bond, read it with dao_policy.ts or pass --account",
    );
  }

  const transaction = shit_1170_sputnik_add_proposal_queue_call_fun({
    daoId,
    description,
    kind,
    deposit,
    ...(gasOverride ? { gas: gasOverride } : {}),
  });

  print_json_fun({
    ok: true,
    action: "queue_add_proposal",
    daoId,
    network,
    kind: kindLabel,
    // the deposit the payload carries, and where it came from.
    deposit,
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
