#!/usr/bin/env bun
// register an account and mark it as an agent — the human signs it.
//
// a queue payload. the engine holds it, and a human signs it in the
// web app with their wallet.
//
// --- WHY THIS IS QUEUED AND NOT AUTONOMOUS ---
// the registration attaches 0.05 NEAR, and it is the step that makes
// the account exist on the contract. a human approves it once, and
// then the agent never has to think about it again.
//
// `set_is_agent` is the flag that says the account is played by a
// program. it is public, visible through `get_account`, and it does
// not change how the contract behaves — it is a label, and it is
// honest to set it.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import {
  shit_1170_chess_set_is_agent_payload_fun,
  shit_1170_chess_storage_deposit_payload_fun,
} from "../src/payload";
import type { SHIT_1170_CHESS_QUEUE_CALL } from "../src/types";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "agent-flag", "no-register"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_register [--account-id <account_id>] [--agent-flag] [--no-register]",
        "--network mainnet",
        "",
        "builds the registration payload, and the set_is_agent payload",
        "with --agent-flag. --account-id registers ANOTHER account.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account-id");

  const transactions: SHIT_1170_CHESS_QUEUE_CALL[] = [];

  if (!args_bool_fun(args, "no-register")) {
    transactions.push(
      shit_1170_chess_storage_deposit_payload_fun(account_id, true),
    );
  }

  if (args_bool_fun(args, "agent-flag")) {
    transactions.push(shit_1170_chess_set_is_agent_payload_fun(true));
  }

  if (transactions.length === 0) {
    throw new Error(
      "nothing to build. drop --no-register to register, or add --agent-flag.",
    );
  }

  print_json_fun({
    ok: true,
    transactions,
    what: account_id
      ? `Register ${account_id} on app.chess-game.near and mark it as an agent`
      : "Register on app.chess-game.near and mark the account as an agent",
    why: "the registration attaches 0.05 NEAR, and the agent flag is the honest label for an account played by a program",
  });
});
