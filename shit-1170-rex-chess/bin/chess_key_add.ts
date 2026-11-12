#!/usr/bin/env bun
// the limited access key the agent signs with — the human signs it.
//
// this bin does NOT make the key and does NOT queue the add_key. the
// KEYS SKILL owns that, and it owns it for a reason: a key that was
// already handed to somebody else has another holder, and that holder
// can sign anything the new one can.
//
// so this bin tells the human what to run, and it shows the key that
// is already there.
//
// --- THE COMMAND ---
//   bun bin/key_queue_add.ts --receiver-id app.chess-game.near --allowance 1000000000000000000000000
//
// no method names means EVERY method on that contract, which is the
// whole-contract scope.
//
// the ALLOWANCE is not the deposit. it is the prepaid gas —
// gas_limit x gas_price — and mainnet's gas price is 1000000000
// yoctoNEAR per gas unit, so a 30 Tgas call needs 0.03 NEAR of
// allowance before the contract is reached at all. 1 NEAR covers every
// call this skill makes.
//
// the NARROWER key is one flag away:
//
//   bun bin/key_queue_add.ts \
//     --receiver-id app.chess-game.near \
//     --methods play_move,resign,cancel,challenge,accept_challenge,reject_challenge,claim_points,set_is_agent,join_matchmaking,cancel_matchmaking,create_ai_game \
//     --allowance 1000000000000000000000000
//
// that keeps every game operation and drops the money-shaped methods —
// `withdraw_token`, `cancel_bet` and the NEP-141 surface.
//
// --- WHY THE HUMAN SIGNS IT ---
// a key that a human approves cannot be created by a compromised
// agent alone. the agent cannot add keys to an account anyway — that
// is what a limited key cannot do — so this is belt and braces.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { SHIT_1170_CHESS_CONTRACT_ID } from "../src/chain";
import {
  shit_1170_chess_key_command_fun,
  shit_1170_chess_key_whole_contract_command_fun,
} from "../src/payload";
import {
  shit_1170_chess_key_details_fun,
  shit_1170_chess_held_secrets_fun,
} from "../src/signer";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_key_add --account <account_id>",
        "",
        "shows the limited key the agent signs with, and the command",
        "the human runs to add one. it never signs anything itself.",
      ],
    });
    return;
  }

  shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account");
  if (!account_id) {
    throw new Error("--account is required. it is the account the key is for.");
  }

  const details = shit_1170_chess_key_details_fun(account_id);
  const for_chess = details.filter(
    (detail) => detail.receiver_id === SHIT_1170_CHESS_CONTRACT_ID,
  );

  const held = shit_1170_chess_held_secrets_fun(
    for_chess.map((detail) => detail.public_key),
  );

  print_json_fun({
    ok: true,
    account_id,
    contract_id: SHIT_1170_CHESS_CONTRACT_ID,
    keys: for_chess.map((detail) => ({
      public_key: detail.public_key,
      method_names: detail.method_names,
      scope: detail.method_names.length === 0 ? "every method" : "listed methods",
      held_by_agent: held.has(detail.public_key),
    })),
    has_signing_key: for_chess.some((detail) => held.has(detail.public_key)),
    // the commands the HUMAN runs. the keys skill queues them and the
    // human signs them in the web app.
    commands: {
      whole_contract: shit_1170_chess_key_whole_contract_command_fun(),
      narrower: shit_1170_chess_key_command_fun(),
    },
    what: `Add a limited access key for ${SHIT_1170_CHESS_CONTRACT_ID} to ${account_id}`,
    why: "the agent signs its own moves with it, so the human approves the key once and the agent plays on its own",
    note: "this bin never signs. the keys skill queues the add_key and the human approves it in the web app.",
  });
});
