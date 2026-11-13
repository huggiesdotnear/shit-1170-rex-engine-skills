#!/usr/bin/env bun
// make the move an agent chose.
//
// --- WHAT THIS IS FOR ---
// the program proposes the legal moves and the agent picks one. this
// bin is where the choice becomes a transaction.
//
// --- WHY THE MOVE IS CHECKED HERE ---
// the contract validates the move too, and a move it rejects is a
// FAILED TRANSACTION THAT STILL COSTS GAS. so the move is checked
// against the legal list BEFORE it is signed, and a move that is not
// legal is refused without touching the chain.
//
// that is the whole reason for the split. an agent that chose a move
// on its own would occasionally choose one that hangs a piece, and
// the chain would charge it for finding out. here the agent's choice
// is checked by the same engine that produced the candidates, so an
// illegal choice costs nothing.
//
// --- WHAT IT ACCEPTS ---
// the move in the contract's coordinate notation ("e2e4"), in san
// ("e4"), or as the two squares ("e2 e4"). they all name the same
// move, and the contract only takes the first form.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_game_id_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { shit_1170_chess_decision_fun } from "../src/decision";
import { shit_1170_chess_move_matches_fun } from "../src/move";
import { shit_1170_chess_game_read_fun } from "../src/game";
import { shit_1170_chess_move_gas_tgas_fun } from "../src/game";
import { shit_1170_chess_play_move_payload_fun } from "../src/payload";
import {
  shit_1170_chess_send_fun,
  shit_1170_chess_signer_find_fun,
} from "../src/signer";
import {
  shit_1170_chess_games_db_open_fun,
  shit_1170_chess_games_put_fun,
  shit_1170_chess_log_append_fun,
} from "../src/store";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "dry-run"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_decide_move --game-id <json array> --account <account_id> --mv <move>",
        "",
        "makes the move the agent chose. the move is checked against the",
        "legal list first, so an illegal choice costs nothing.",
        "--dry-run checks the move and builds the payload without signing.",
        "--mv takes the contract's notation (\"e2e4\"), san (\"e4\"), or \"e2 e4\".",
      ],
    });
    return;
  }

  shit_1170_chess_network_fun(args_string_fun(args, "network"));

  const account_id = args_string_fun(args, "account");
  if (!account_id) {
    throw new Error("--account is required. it is the account the agent plays as.");
  }

  const game_id = shit_1170_chess_game_id_fun(
    args_string_fun(args, "game-id"),
    args_number_fun(args, "height"),
    args_string_fun(args, "white"),
    args_string_fun(args, "black"),
  );

  const requested = args_string_fun(args, "mv");
  if (!requested) {
    throw new Error("--mv is required. it is the move to make.");
  }

  // --- THE LEGAL MOVES ---
  //
  // the same engine that proposed the candidates is the one that
  // checks the choice. that is what makes the split safe.
  const decision = await shit_1170_chess_decision_fun(game_id, account_id);

  if (decision.candidates.length === 0) {
    throw new Error(
      `the game ${JSON.stringify(game_id)} has no legal move. it is over.`,
    );
  }

  const match = decision.candidates.find((candidate) =>
    shit_1170_chess_move_matches_fun(candidate, requested),
  );

  if (!match) {
    print_json_fun({
      ok: false,
      error: `"${requested}" is not a legal move in this position. it was not sent, and nothing was signed.`,
      game_id,
      position: decision.fen,
      legal_moves: decision.candidates.map((candidate) => candidate.mv),
      note: "the legal moves are the ones the contract would accept. the notation is the contract's own: two squares joined.",
    });
    throw new Error("the move is not legal in this position.");
  }

  // --- THE GAS ---
  //
  // the gas follows the opponent, and it is the same figure the
  // daemon uses.
  const game = await shit_1170_chess_game_read_fun(game_id);
  const gas_tgas = shit_1170_chess_move_gas_tgas_fun(game, account_id);

  const payload = shit_1170_chess_play_move_payload_fun(
    game_id,
    match.mv,
    gas_tgas,
  );

  if (args_bool_fun(args, "dry-run")) {
    print_json_fun({
      ok: true,
      dry_run: true,
      game_id,
      mv: match.mv,
      san: match.san,
      gas_tgas,
      payload,
    });
    return;
  }

  // --- THE MOVE ---
  const signer = shit_1170_chess_signer_find_fun(account_id);
  const sent = await shit_1170_chess_send_fun(signer, payload);

  const db = shit_1170_chess_games_db_open_fun();
  shit_1170_chess_games_put_fun(db, game_id, Date.now());
  db.close();

  shit_1170_chess_log_append_fun({
    at: Date.now(),
    event: "played_move",
    detail: {
      game_id,
      mv: match.mv,
      san: match.san,
      gas_tgas,
      tx_hash: sent.tx_hash,
    },
  });

  print_json_fun({
    ok: true,
    game_id,
    mv: match.mv,
    san: match.san,
    gas_tgas,
    tx_hash: sent.tx_hash,
    public_key: signer.public_key,
    receiver_id: signer.receiver_id,
    what: `played ${match.san} in the game ${JSON.stringify(game_id)}`,
  });
});
