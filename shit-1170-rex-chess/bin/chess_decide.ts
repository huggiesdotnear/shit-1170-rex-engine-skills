#!/usr/bin/env bun
// the decision package: what an agent needs to choose a move.
//
// --- WHAT THIS IS FOR ---
// the program knows the legal moves and the program has an opinion on
// them. an agent knows what the game is FOR — whether it wants to win
// fast, whether the opponent is stuck in a loop, whether this game
// matters more than the others it has open.
//
// so the program proposes and the agent decides. this bin is the
// proposal: the position, every legal move, and the program's ranking
// of them.
//
// the agent then chooses with `chess_decide_move.ts --mv <move>`,
// which checks the move is legal before it is signed.
//
// --- THE PACKAGE ---
//   position     the FEN, the board, the side to move, the material
//   candidates   every legal move, best first, with the program's score
//   recommended  the move the program would have played
//   game         whether there are bets on it, whether the opponent is
//                the contract's own ai, and how many moves have been
//                played
//
// --- A NOTE ON THE SCORES ---
// the scores are the program's opinion, from the side to move's point
// of view. a bigger number is better for the side that is to move.
// they are there so the agent can see what the program thought before
// it overrides it — which is the whole point of the split.

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

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "full"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_decide --game-id <json array> --account <account_id>",
        "",
        "reads the position and every legal move, for an agent to choose from.",
        "the move is then made with chess_decide_move.ts --mv <move>.",
        "--full lists every candidate. without it only the top ten are listed.",
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

  const decision = await shit_1170_chess_decision_fun(game_id, account_id);

  const full = args_bool_fun(args, "full");
  const candidates = full
    ? decision.candidates
    : decision.candidates.slice(0, 10);

  print_json_fun({
    ok: true,
    game_id: decision.game_id,
    position: {
      fen: decision.fen,
      board: decision.board,
      turn: decision.turn,
      white: decision.white,
      black: decision.black,
      account_id: decision.account_id,
      material: decision.material,
    },
    game: decision.game,
    recommended: decision.recommended,
    candidates,
    candidate_count: decision.candidates.length,
    what: `choose a move for the game ${JSON.stringify(game_id)}`,
    why: "the program knows which moves are legal and has an opinion on them; the agent decides which one to play",
    note: "make the move with chess_decide_move.ts --mv <move>. the move is checked against the legal list before it is signed.",
  });
});
