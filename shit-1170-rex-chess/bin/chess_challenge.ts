#!/usr/bin/env bun
// challenge somebody, accept a challenge, or reject one.
//
// AUTONOMOUS MODE for the calls. they are signed with the limited
// access key.
//
// --- A WAGERED CHALLENGE IS NEVER AUTONOMOUS ---
// a challenge with a wager is an `ft_transfer_call` on the TOKEN
// contract, and it attaches a token deposit. a token deposit moves
// money, and the human signs every one of those — in both modes.
//
// so this bin builds the PLAIN calls only. a wagered challenge is
// queued, like any other write, and it is the human's to sign.
//
// the challenge id is the two accounts joined with `-vs-`.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import {
  shit_1170_chess_accept_challenge_payload_fun,
  shit_1170_chess_challenge_id_fun,
  shit_1170_chess_challenge_payload_fun,
  shit_1170_chess_reject_challenge_payload_fun,
} from "../src/payload";
import {
  shit_1170_chess_send_fun,
  shit_1170_chess_signer_find_fun,
} from "../src/signer";
import type { SHIT_1170_CHESS_QUEUE_CALL } from "../src/types";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "reject", "dry-run"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_challenge --account <account_id> --opponent <account_id>",
        "chess_challenge --account <account_id> --challenge-id '<id>' --accept",
        "chess_challenge --account <account_id> --challenge-id '<id>' --reject",
        "",
        "challenges somebody, accepts a challenge, or rejects one.",
        "--challenger picks the rejecting side on a rejection.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account");
  if (!account_id) {
    throw new Error("--account is required. it is the account the key signs for.");
  }

  const challenge_id_flag = args_string_fun(args, "challenge-id");
  const opponent = args_string_fun(args, "opponent");
  const is_accept = args_bool_fun(args, "accept");
  const is_reject = args_bool_fun(args, "reject");

  if (is_accept && is_reject) {
    throw new Error("--accept and --reject are opposites. pick one.");
  }

  let payload: SHIT_1170_CHESS_QUEUE_CALL;

  if (opponent) {
    if (is_accept || is_reject) {
      throw new Error(
        "--opponent is for challenging somebody. to accept or reject, give --challenge-id.",
      );
    }
    payload = shit_1170_chess_challenge_payload_fun(opponent);
  } else if (challenge_id_flag) {
    if (is_reject) {
      payload = shit_1170_chess_reject_challenge_payload_fun(
        challenge_id_flag,
        args_bool_fun(args, "challenger"),
      );
    } else {
      payload = shit_1170_chess_accept_challenge_payload_fun(challenge_id_flag);
    }
  } else {
    throw new Error(
      "give --opponent to challenge somebody, or --challenge-id to accept or reject one.",
    );
  }

  if (args_bool_fun(args, "dry-run")) {
    print_json_fun({ ok: true, dry_run: true, payload });
    return;
  }

  const signer = shit_1170_chess_signer_find_fun(account_id);
  const sent = await shit_1170_chess_send_fun(signer, payload, network);

  print_json_fun({
    ok: true,
    action: is_reject ? "rejected" : is_accept ? "accepted" : "challenged",
    challenge_id:
      challenge_id_flag ??
      (opponent
        ? shit_1170_chess_challenge_id_fun(account_id, opponent)
        : null),
    payload,
    tx_hash: sent.tx_hash,
    public_key: signer.public_key,
  });
});
