#!/usr/bin/env bun
// propose a move — the human signs it.
//
// a queue payload. it is NOT a transaction and NOT a near call. the
// engine holds it, and a human signs it in the web app with their
// wallet.
//
// the payload is the exact shape the engine's tx-queue accepts:
//   { contractId, method, args, gas, deposit }

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_game_id_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { shit_1170_chess_game_info_fun } from "../src/chain";
import { shit_1170_chess_move_gas_tgas_fun } from "../src/game";
import type { SHIT_1170_CHESS_GAME } from "../src/game";
import { shit_1170_chess_play_move_payload_fun } from "../src/payload";
import {
  shit_1170_chess_choose_move_for_fen_fun,
  shit_1170_chess_choose_move_for_game_fun,
} from "../src/move";
import { shit_1170_chess_api_position_fen_fun } from "../src/api";
import { shit_1170_chess_board_fun } from "../src/chain";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_propose_move --game-id '<json array>' | --height <n> --white <account> [--black <account>]",
        "chess_propose_move --game-id '...' --mv 'e2e4'",
        "",
        "builds the play_move payload for a human to sign. without --mv",
        "the skill picks a move itself.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const game_id = shit_1170_chess_game_id_fun(
    args_string_fun(args, "game-id"),
    args_string_fun(args, "height")
      ? Number(args_string_fun(args, "height"))
      : undefined,
    args_string_fun(args, "white"),
    args_string_fun(args, "black"),
  );

  const account_id = args_string_fun(args, "account-id");
  const mv_flag = args_string_fun(args, "mv");

  const [info, board] = await Promise.all([
    shit_1170_chess_game_info_fun(game_id, network),
    shit_1170_chess_board_fun(game_id, network),
  ]);
  const game: SHIT_1170_CHESS_GAME = { game_id, info, board };

  // the gas follows the opponent, and the account decides which side
  // the account is playing. without an account the human-game gas is
  // used, which is right for most games.
  const gas_tgas = account_id
    ? shit_1170_chess_move_gas_tgas_fun(game, account_id)
    : 150;

  let mv = mv_flag;
  let chosen: { san: string; from: string; to: string } | null = null;
  let fen: string | null = null;

  if (!mv) {
    // the api's fen carries the REAL castling rights, so it is the
    // source the chooser prefers. the board is the fallback.
    fen = await shit_1170_chess_api_position_fen_fun(game_id);
    const picked = fen
      ? shit_1170_chess_choose_move_for_fen_fun(fen)
      : shit_1170_chess_choose_move_for_game_fun(game);
    if (!picked) {
      throw new Error(
        "there is no legal move in this position — the game is over.",
      );
    }
    mv = picked.mv;
    chosen = { san: picked.san, from: picked.from, to: picked.to };
  }

  const payload = shit_1170_chess_play_move_payload_fun(game_id, mv, gas_tgas);

  print_json_fun({
    ok: true,
    game_id,
    turn_color: info.turn_color,
    payload,
    chosen,
    fen,
    fen_source: fen ? "api" : "board",
    gas_tgas,
    what: `play ${mv} in game ${JSON.stringify(game_id)}`,
  });
});
