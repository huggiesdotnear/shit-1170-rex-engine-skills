#!/usr/bin/env bun
// play a move — the AGENT signs it.
//
// AUTONOMOUS MODE. this signs with the LIMITED access key the human
// signed onto the account. it is the exception to the library's rule
// that the agent never signs, and it is scoped to one key, one
// contract.
//
// the key must already exist. the human signs the add_key, and the
// keys skill queues it:
//
//   bun bin/key_queue_add.ts --receiver-id app.chess-game.near --allowance 0
//
// --dry-run builds the payload and does NOT sign it, so the move can
// be looked at before it goes out.

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
import {
  shit_1170_chess_board_fun,
  shit_1170_chess_game_info_fun,
} from "../src/chain";
import {
  shit_1170_chess_game_read_fun,
  shit_1170_chess_is_my_turn_fun,
  shit_1170_chess_move_gas_tgas_fun,
} from "../src/game";
import { shit_1170_chess_play_move_payload_fun } from "../src/payload";
import {
  shit_1170_chess_choose_move_for_fen_fun,
  shit_1170_chess_choose_move_for_game_fun,
  shit_1170_chess_board_to_fen_fun,
} from "../src/move";
import { shit_1170_chess_api_position_fen_fun } from "../src/api";
import {
  shit_1170_chess_send_fun,
  shit_1170_chess_signer_find_fun,
} from "../src/signer";
import { shit_1170_chess_send_safe_fun } from "../src/send";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "dry-run"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_play_move --account <account_id> --game-id '<json array>'",
        "chess_play_move --account <account_id> --game-id '...' --mv 'e2e4'",
        "chess_play_move ... --dry-run",
        "",
        "signs a play_move with the limited access key. without --mv the",
        "skill picks a move. --dry-run builds the payload and signs nothing.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account");
  if (!account_id) {
    throw new Error("--account is required. it is the account the key signs for.");
  }

  const game_id = shit_1170_chess_game_id_fun(
    args_string_fun(args, "game-id"),
    args_string_fun(args, "height")
      ? Number(args_string_fun(args, "height"))
      : undefined,
    args_string_fun(args, "white"),
    args_string_fun(args, "black"),
  );

  const game = await shit_1170_chess_game_read_fun(game_id, network);

  if (!shit_1170_chess_is_my_turn_fun(game, account_id)) {
    throw new Error(
      `it is ${game.info.turn_color}'s turn, and ${account_id} is not ${game.info.turn_color}. the contract rejects a move that is not the player's turn.`,
    );
  }

  const mv_flag = args_string_fun(args, "mv");
  let mv = mv_flag;
  let chosen: { san: string; from: string; to: string } | null = null;
  let fen: string | null = null;

  if (!mv) {
    fen = await shit_1170_chess_api_position_fen_fun(game_id);
    const picked = fen
      ? shit_1170_chess_choose_move_for_fen_fun(fen)
      : shit_1170_chess_choose_move_for_game_fun(game);
    if (!picked) {
      throw new Error("there is no legal move in this position — the game is over.");
    }
    mv = picked.mv;
    chosen = { san: picked.san, from: picked.from, to: picked.to };
  }

  const gas_tgas = shit_1170_chess_move_gas_tgas_fun(game, account_id);
  const payload = shit_1170_chess_play_move_payload_fun(game_id, mv, gas_tgas);

  if (args_bool_fun(args, "dry-run")) {
    print_json_fun({
      ok: true,
      dry_run: true,
      game_id,
      turn_color: game.info.turn_color,
      payload,
      chosen,
      fen,
      gas_tgas,
    });
    return;
  }

  // the key is found AFTER the move is chosen, so a dry run needs no
  // key at all.
  const signer = shit_1170_chess_signer_find_fun(account_id);

  // the send is checked against the chain. the rpc can answer 429
  // AFTER the transaction has gone through, and a move sent twice is a
  // move the contract refuses — a failed transaction that still costs
  // gas.
  const before = fen;
  const sent = await shit_1170_chess_send_safe_fun(
    () => shit_1170_chess_send_fun(signer, payload, network),
    async () => before,
    async () => {
      const now_fen = await shit_1170_chess_api_position_fen_fun(game_id);
      if (now_fen) return now_fen !== before;
      const now = await shit_1170_chess_game_read_fun(game_id);
      return (
        shit_1170_chess_board_to_fen_fun(now.board, now.info) !== before
      );
    },
  );

  print_json_fun({
    ok: true,
    game_id,
    mv,
    chosen,
    gas_tgas,
    tx_hash: sent.tx_hash,
    landed_without_answer: sent.landed_without_answer,
    public_key: signer.public_key,
    receiver_id: signer.receiver_id,
  });
});
