#!/usr/bin/env bun
// play ONE game to the end, as the agent.
//
// --- WHAT THIS IS FOR ---
// the daemon plays ONE game at a time, and it plays against people.
// this is the tool for the case where a game needs finishing or
// winning: it plays the agent's side of a game it has been given,
// until the game ends.
//
// it is a ONE-SHOT tool. the daemon never calls it, and it never
// starts a game on its own.
//
// --- HOW IT PLAYS ---
// the reasoning is the agent's — a search with a time budget, and a
// guard that refuses a move which hangs a piece — and it is in
// `src/agent.ts`, shared with the daemon.
//
// every move is checked against the legal list before it is signed,
// so nothing the contract would reject ever reaches the chain.
//
// --- THE OPTIONS ---
//   --max-plies  how many moves to play before giving up. default 200.
//   --budget     how long the search may take per move, in ms.
//   --resign     give the game up instead of playing it out.
//
// --- A NOTE ON A LOST POSITION ---
// a position that is lost cannot be won by searching: every legal move
// scores the same, so the search picks the first one and the game
// goes on forever. the contract has no repetition rule either, so
// nothing ends it. when the position is lost, resigning is the honest
// end — and `--resign` does it.

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
import { shit_1170_chess_decide_fun } from "../src/agent";
import {
  shit_1170_chess_game_read_fun,
  shit_1170_chess_is_my_turn_fun,
  shit_1170_chess_move_gas_tgas_fun,
} from "../src/game";
import { shit_1170_chess_board_to_fen_fun, shit_1170_chess_choose_move_fun } from "../src/move";
import {
  shit_1170_chess_play_move_payload_fun,
  shit_1170_chess_resign_payload_fun,
} from "../src/payload";
import {
  shit_1170_chess_send_fun,
  shit_1170_chess_signer_find_fun,
} from "../src/signer";
import { shit_1170_chess_send_safe_fun } from "../src/send";
import {
  shit_1170_chess_log_append_fun,
} from "../src/store";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "resign"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_play_out --game-id '<json array>' --account <account_id>",
        "",
        "plays the agent's side of one game, until it ends.",
        "--max-plies  how many moves to play. default 200.",
        "--budget     how long the search may take per move, in ms. default 8000.",
        "--resign     give the game up instead of playing it out.",
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

  const max_plies = args_number_fun(args, "max-plies", 200) ?? 200;
  const budget = args_number_fun(args, "budget", 8000) ?? 8000;

  const signer = shit_1170_chess_signer_find_fun(account_id);

  // --- THE RESIGN ---
  if (args_bool_fun(args, "resign")) {
    const sent = await shit_1170_chess_send_fun(
      signer,
      shit_1170_chess_resign_payload_fun(game_id),
    );
    print_json_fun({
      ok: true,
      game_id,
      resigned: true,
      tx_hash: sent.tx_hash,
      what: `resigned the game ${JSON.stringify(game_id)}`,
    });
    return;
  }

  // --- THE GAME ---
  let plies = 0;

  while (plies < max_plies) {
    const game = await shit_1170_chess_game_read_fun(game_id);

    if (!shit_1170_chess_is_my_turn_fun(game, account_id)) {
      // the opponent's move. wait for it.
      await Bun.sleep(7000);
      continue;
    }

    const fen = shit_1170_chess_board_to_fen_fun(game.board, game.info);
    const program = shit_1170_chess_choose_move_fun(fen);
    const choice = shit_1170_chess_decide_fun(
      fen,
      program ? { mv: program.mv, san: program.san } : null,
      budget,
    );
    if (!choice) {
      print_json_fun({
        ok: true,
        game_id,
        plies,
        finished: true,
        what: "there is no legal move. the game is over.",
      });
      return;
    }

    const gas_tgas = shit_1170_chess_move_gas_tgas_fun(game, account_id);
    const payload = shit_1170_chess_play_move_payload_fun(
      game_id,
      choice.mv,
      gas_tgas,
    );

    // the send is checked against the chain, because the rpc can
    // answer 429 AFTER the transaction has gone through.
    const sent = await shit_1170_chess_send_safe_fun(
      () => shit_1170_chess_send_fun(signer, payload),
      async () => fen,
      async () => {
        const now = await shit_1170_chess_game_read_fun(game_id);
        return (
          shit_1170_chess_board_to_fen_fun(now.board, now.info) !== fen
        );
      },
    );

    shit_1170_chess_log_append_fun({
      at: Date.now(),
      event: "played_move",
      detail: {
        game_id,
        mv: choice.mv,
        san: choice.san,
        gas_tgas,
        tx_hash: sent.tx_hash,
        landed_without_answer: sent.landed_without_answer,
      },
    });

    console.log(`${choice.san} — ${choice.reason}`);
    plies += 1;

    await Bun.sleep(3000);
  }

  print_json_fun({
    ok: true,
    game_id,
    plies,
    finished: false,
    what: `played ${plies} moves and stopped at the limit. the game is still open.`,
  });
});
