#!/usr/bin/env bun
// the board of a game, and whose turn it is.
//
// a chain VIEW. no api key, no engine account, no signature.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_game_id_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import {
  shit_1170_chess_board_fun,
  shit_1170_chess_game_info_fun,
  shit_1170_chess_rendered_board_fun,
} from "../src/chain";
import { shit_1170_chess_move_gas_tgas_fun } from "../src/game";
import type { SHIT_1170_CHESS_GAME } from "../src/game";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_board --game-id '<json array>' | --height <n> --white <account> [--black <account>]",
        "--network mainnet",
        "",
        "the board, the players, whose turn it is, and the gas a move needs.",
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

  const [info, board, rendered] = await Promise.all([
    shit_1170_chess_game_info_fun(game_id, network),
    shit_1170_chess_board_fun(game_id, network),
    shit_1170_chess_rendered_board_fun(game_id, network),
  ]);

  const game: SHIT_1170_CHESS_GAME = { game_id, info, board };

  print_json_fun({
    ok: true,
    game_id,
    info,
    board,
    rendered,
    gas_tgas: {
      easy_ai: 50,
      medium_ai: 150,
      hard_ai: 250,
      very_hard_ai: 400,
      human: 150,
    },
    gas_tgas_for_account: {
      white: shit_1170_chess_move_gas_tgas_fun(game, info.white.value),
      black:
        info.black.type === "Human"
          ? shit_1170_chess_move_gas_tgas_fun(game, info.black.value)
          : null,
    },
  });
});
