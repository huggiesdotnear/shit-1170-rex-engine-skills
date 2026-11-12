#!/usr/bin/env bun
// the matchmaking queue — join it, or leave it.
//
// AUTONOMOUS MODE for the queue. the call itself is signed with the
// limited access key.
//
// --- THE BAND ---
// the band is the range of opponent ratings that will be accepted.
// with --band it is the agent's OWN rating plus or minus the spread,
// so the band follows the agent as its rating moves.
//
// the elo test is MUTUAL: the agent's band and the opponent's band
// must both accept the other player. a narrow band finds a fair
// opponent and can leave the agent queued for an hour. a wide one
// finds a match fast and plays a weaker opponent.
//
// with --min-elo and --max-elo the bounds are given directly.
//
// the contract attaches NO deposit for this. the queue entry costs the
// contract nothing to store.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { shit_1170_chess_account_fun, shit_1170_chess_is_queued_fun } from "../src/chain";
import {
  shit_1170_chess_cancel_matchmaking_payload_fun,
  shit_1170_chess_join_matchmaking_payload_fun,
} from "../src/payload";
import {
  shit_1170_chess_send_fun,
  shit_1170_chess_signer_find_fun,
} from "../src/signer";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "leave", "dry-run"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_match --account <account_id> [--band <n>]",
        "chess_match --account <account_id> --min-elo <n> --max-elo <n>",
        "chess_match --account <account_id> --leave",
        "",
        "joins the matchmaking queue, or leaves it. --band is the spread",
        "around the agent's own rating. default 200.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account");
  if (!account_id) {
    throw new Error("--account is required. it is the account the key signs for.");
  }

  if (args_bool_fun(args, "leave")) {
    const payload = shit_1170_chess_cancel_matchmaking_payload_fun();
    if (args_bool_fun(args, "dry-run")) {
      print_json_fun({ ok: true, dry_run: true, payload });
      return;
    }
    const signer = shit_1170_chess_signer_find_fun(account_id);
    const sent = await shit_1170_chess_send_fun(signer, payload, network);
    print_json_fun({
      ok: true,
      action: "left_matchmaking",
      tx_hash: sent.tx_hash,
    });
    return;
  }

  // the band comes from the agent's own rating unless it is given.
  const min_flag = args_number_fun(args, "min-elo");
  const max_flag = args_number_fun(args, "max-elo");
  const band = args_number_fun(args, "band", 200) ?? 200;

  let min_elo: number;
  let max_elo: number;

  if (min_flag !== undefined && max_flag !== undefined) {
    min_elo = min_flag;
    max_elo = max_flag;
  } else {
    const account = await shit_1170_chess_account_fun(account_id, network);
    min_elo = Math.max(0, account.elo - band);
    max_elo = account.elo + band;
  }

  const queued = await shit_1170_chess_is_queued_fun(account_id, network);

  const payload = shit_1170_chess_join_matchmaking_payload_fun(min_elo, max_elo);

  if (args_bool_fun(args, "dry-run")) {
    print_json_fun({
      ok: true,
      dry_run: true,
      min_elo,
      max_elo,
      already_queued: queued,
      payload,
    });
    return;
  }

  if (queued) {
    throw new Error(
      `${account_id} is already in the matchmaking queue. the contract refuses a second entry with AlreadyInMatchmaking.`,
    );
  }

  const signer = shit_1170_chess_signer_find_fun(account_id);
  const sent = await shit_1170_chess_send_fun(signer, payload, network);

  print_json_fun({
    ok: true,
    action: "joined_matchmaking",
    min_elo,
    max_elo,
    tx_hash: sent.tx_hash,
    public_key: signer.public_key,
  });
});
