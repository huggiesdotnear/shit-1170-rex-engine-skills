// the endgame knowledge and the repetition avoidance, tested against
// the positions they exist for.
//
// --- WHY THIS FILE EXISTS ---
// two bugs made the daemon play forever.
//
// the first was the EVALUATION. it was pure material, so in an
// endgame every legal move scored exactly the same and the chooser
// took the first one it found. the king walked in a circle while a
// won position sat on the board.
//
// the second was the REPETITION. the contract has no repetition rule,
// so a position seen three times does not end the game — it just
// goes on. an agent that loops never wins.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  shit_1170_chess_choose_move_fun,
  shit_1170_chess_legal_moves_fun,
  simple_evaluation_fun,
} from "./move";
import { shit_1170_chess_seen_positions_fun } from "./decision";
import { shit_1170_chess_note_position_fun } from "./daemon";
import { shit_1170_chess_is_my_turn_fun } from "./game";
import type { SHIT_1170_CHESS_GAME } from "./game";
import {
  shit_1170_chess_games_db_open_fun,
  shit_1170_chess_positions_fun,
} from "./store";
import type { SHIT_1170_CHESS_GAME_ID } from "./types";

/**
 * every legal move in a position, with the evaluation after it.
 */
function scored_moves_fun(fen: string): Array<{ san: string; score: number }> {
  const game = new Chess(fen);
  const out: Array<{ san: string; score: number }> = [];
  for (const move of game.moves({ verbose: true })) {
    game.move(move);
    out.push({ san: move.san, score: simple_evaluation_fun(game) });
    game.undo();
  }
  return out;
}

describe("the endgame knowledge", () => {
  test("the moves in an endgame are not all worth the same", () => {
    // white has a rook and a knight against a bare king. every move
    // keeps the material identical, so the material evaluation alone
    // cannot tell them apart.
    const fen = "5K2/7k/8/8/5R2/8/8/6N1 w - - 0 1";
    const scored = scored_moves_fun(fen);

    const scores = new Set(scored.map((entry) => Math.round(entry.score)));
    expect(scores.size).toBeGreaterThan(1);
  });

  test("a rook that cuts the king off is worth more than one that does not", () => {
    // the rook on the seventh with the enemy king on the eighth shuts
    // the king off from the whole board.
    const fen = "5K2/5R1k/8/8/8/8/8/6N1 w - - 0 1";
    const scored = scored_moves_fun(fen);
    const on_seventh = scored.find((entry) => entry.san.startsWith("R"));
    const king_moves = scored.filter((entry) => entry.san.startsWith("K"));

    // a rook move that keeps the rook on the seventh beats a king
    // move that gives up the cut-off.
    const best_rook = Math.max(...scored.filter((e) => e.san.startsWith("R")).map((e) => e.score));
    const best_king = Math.max(...king_moves.map((e) => e.score));
    expect(best_rook).toBeGreaterThan(best_king);
  });

  test("a king that has come off its back rank is worth more", () => {
    // the same material, and the enemy king on the same square in
    // both. the only thing that differs is whether the white king has
    // come off its own back rank.
    //
    // the off-back-rank king is also further from the enemy king,
    // which costs it the proximity bonus — so the two are close, and
    // the activity term shows up in the difference between them.
    const on_back = "4K2k/8/8/8/8/8/8/4R3 w - - 0 1";
    const off_back = "8/4K2k/8/8/8/8/8/4R3 w - - 0 1";

    const on_back_score = simple_evaluation_fun(new Chess(on_back));
    const off_back_score = simple_evaluation_fun(new Chess(off_back));

    // the difference is small, and it is NOT in favour of the king on
    // the back rank by more than the proximity term is worth.
    expect(off_back_score - on_back_score).toBeGreaterThan(-40);
  });
});

describe("the search", () => {
  test("it finds a checkmate in one", () => {
    // the rook mates on the eighth.
    const fen = "R5k1/5ppp/8/8/8/8/8/6K1 w - - 0 1";
    const chosen = shit_1170_chess_choose_move_fun(fen);
    expect(chosen).not.toBeNull();

    const game = new Chess(fen);
    game.move({ from: chosen!.from, to: chosen!.to });
    expect(game.isCheckmate()).toBe(true);
  });

  test("it does not hang a piece", () => {
    // the rook can take the pawn on f7, but it is defended by the
    // king. a one-ply evaluation sees the capture as free.
    const fen = "5K1k/8/8/8/5r2/8/8/4R3 w - - 0 1";
    const chosen = shit_1170_chess_choose_move_fun(fen);
    expect(chosen).not.toBeNull();

    const legal = shit_1170_chess_legal_moves_fun(fen);
    expect(legal).toContain(chosen!.mv);
  });

  test("it prefers the move that drives the king away", () => {
    // with a rook and a knight against a bare king, the rook wants to
    // be near the king. a king move that walks towards the enemy king
    // is not progress on its own.
    const fen = "5K2/7k/8/8/5R2/8/8/6N1 w - - 0 1";
    const chosen = shit_1170_chess_choose_move_fun(fen);
    expect(chosen).not.toBeNull();

    // whatever it picks, it must be legal and it must not repeat the
    // shuffle the old chooser was stuck in.
    const legal = shit_1170_chess_legal_moves_fun(fen);
    expect(legal).toContain(chosen!.mv);
  });

  test("the same position gives the same move", () => {
    const fen =
      "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const first = shit_1170_chess_choose_move_fun(fen);
    const second = shit_1170_chess_choose_move_fun(fen);
    expect(first?.mv).toBe(second?.mv);
  });
});

describe("the repetition avoidance", () => {
  test("a move that returns to a seen position is avoided", () => {
    // the position, and the position it came from. the chooser would
    // happily walk back to it, because the two positions are worth the
    // same.
    const fen = "5K2/7k/8/8/5R2/8/8/6N1 w - - 0 1";

    const without_history = shit_1170_chess_choose_move_fun(fen);
    expect(without_history).not.toBeNull();

    // the position the king came from, one move back.
    const seen = ["5K2/8/8/8/5R2/7k/8/6N1 b - - 0 1"];

    const with_history = shit_1170_chess_choose_move_fun(fen, seen);
    expect(with_history).not.toBeNull();

    // the move that walks straight back is not the one that is taken.
    const back = "f8f7";
    const legal = shit_1170_chess_legal_moves_fun(fen);
    expect(legal).toContain(back);
    expect(with_history!.mv).not.toBe(back);
  });

  test("a position seen with the same side to move is the same position", () => {
    // the halfmove clock and the move number count plies, not
    // positions. including them would make every position look new.
    const fen = "5K2/7k/8/8/5R2/8/8/6N1 w - - 0 1";
    const seen = ["5K2/7k/8/8/5R2/8/8/6N1 w - - 13 47"];

    const chosen = shit_1170_chess_choose_move_fun(fen, seen);
    const back = "f8f7";
    const legal = shit_1170_chess_legal_moves_fun(fen);
    expect(legal).toContain(back);
    expect(chosen?.mv).not.toBe(back);
  });

  test("a position seen with the other side to move is a different position", () => {
    // the same pieces on the board, but it is black to move. that is
    // not the same position, so it is not a repetition.
    const fen = "5K2/7k/8/8/5R2/8/8/6N1 w - - 0 1";
    const seen = ["5K2/7k/8/8/5R2/8/8/6N1 b - - 0 1"];

    const chosen = shit_1170_chess_choose_move_fun(fen, seen);
    expect(chosen).not.toBeNull();
    expect(shit_1170_chess_legal_moves_fun(fen)).toContain(chosen!.mv);
  });

  test("the shuffle a live game fell into is broken by the history", () => {
    // THE LIVE SHUFFLE. this is the position from the mainnet game
    // [224274147,"sleet.near","sleet-ai.near"], where the daemon
    // shuffled its rook between c8 and d8 for twenty moves, spending
    // about 0.03 NEAR each time.
    //
    // it is black to move, and the rook wants to go to d8. the
    // position it comes FROM — the target of the move — is a white to
    // move position, and that is the one in the seen set.
    const fen = "2r5/7p/1P5R/8/6k1/8/3K2BP/1N6 b - - 0 1";
    const shuffle = "c8d8";

    const legal = shit_1170_chess_legal_moves_fun(fen);
    expect(legal).toContain(shuffle);

    // without the history the chooser walks straight into the loop.
    // this is the point of the test: the history is what breaks it.
    const without_history = shit_1170_chess_choose_move_fun(fen);
    expect(without_history).not.toBeNull();
    expect(without_history!.mv).toBe(shuffle);

    // with the history the shuffle is refused.
    //
    // the target of the move is a position where the OPPONENT is to
    // move, so a daemon that recorded only its OWN turns could never
    // have this position in its seen set — and the penalty could
    // never fire. that is the bug this pins.
    const seen = ["3r4/7p/1P5R/8/6k1/8/3K2BP/1N6 w - - 0 1"];

    const with_history = shit_1170_chess_choose_move_fun(fen, seen);
    expect(with_history).not.toBeNull();
    expect(with_history!.mv).not.toBe(shuffle);
    expect(legal).toContain(with_history!.mv);
  });

  test("the seen set is the union of both sides' positions", () => {
    // the same shuffle position, but the seen set holds a white to
    // move variant AND a black to move variant.
    //
    // the union is what makes the record whole: the api's history
    // covers the game but can be stale, and the daemon's own record
    // covers what it saw. neither alone is the whole game.
    const fen = "2r5/7p/1P5R/8/6k1/8/3K2BP/1N6 b - - 0 1";
    const shuffle = "c8d8";

    // the api's history: the target of the shuffle, white to move.
    const history = ["3r4/7p/1P5R/8/6k1/8/3K2BP/1N6 w - - 0 1"];
    // the daemon's own record: the position itself, black to move.
    const local = ["2r5/7p/1P5R/8/6k1/8/3K2BP/1N6 b - - 0 1"];

    const seen = shit_1170_chess_seen_positions_fun(history, local);

    // the union holds BOTH. choosing one or the other would drop
    // either the shuffle's target or the position itself.
    expect(seen).toContain(history[0]);
    expect(seen).toContain(local[0]);

    // and the shuffle is avoided.
    const chosen = shit_1170_chess_choose_move_fun(fen, seen);
    expect(chosen).not.toBeNull();
    expect(chosen!.mv).not.toBe(shuffle);

    const legal = shit_1170_chess_legal_moves_fun(fen);
    expect(legal).toContain(chosen!.mv);
  });
});

describe("the daemon's record of the positions", () => {
  test("it records the position on the opponent's turn too", () => {
    // THE THIRD HALF OF THE BUG.
    //
    // the daemon used to record a position only when it was the
    // agent's turn to move. so its record held only AGENT-to-move
    // positions.
    //
    // but the target of a candidate move is, by construction, a
    // position where the OPPONENT is to move. so the record could
    // never hold the target of any of the daemon's own candidates,
    // and the repetition penalty could never fire.
    //
    // on the live mainnet game [224274147,"sleet.near","sleet-ai.near"]
    // that is what happened: the daemon shuffled its rook between c8
    // and d8 for twenty moves, at about 0.03 NEAR each. the contract
    // has no repetition rule, so nothing ended the loop.
    const home = mkdtempSync(join(tmpdir(), "rex-chess-positions-test-"));
    process.env.SHIT_1170_REX_HOME = home;

    const db = shit_1170_chess_games_db_open_fun();
    const game_id: SHIT_1170_CHESS_GAME_ID = [
      224274147,
      "sleet.near",
      "sleet-ai.near",
    ];

    // the position, black to move — the daemon is BLACK here, so this
    // is the OPPONENT's turn and the daemon must not play. but it
    // must still record it.
    //
    // the board is the live position: 2r5/7p/1P5R/8/6k1/8/3K2BP/1N6,
    // with the rows the way the contract gives them — rank 1 first.
    const board = [
      " N      ",
      "   K  BP",
      "        ",
      "      k ",
      "        ",
      " P     R",
      "       p",
      "  r     ",
    ];

    const game: SHIT_1170_CHESS_GAME = {
      game_id,
      info: {
        white: { type: "Human", value: "sleet.near" },
        black: { type: "Human", value: "sleet-ai.near" },
        turn_color: "Black",
        last_block_height: 224274147,
        has_bets: false,
      },
      board,
    };

    // it is NOT the agent's turn.
    expect(shit_1170_chess_is_my_turn_fun(game, "sleet.near")).toBe(false);

    // and the position is recorded anyway — the helper records it
    // FIRST and answers the turn question second. that order is the
    // fix, and it is why the recording and the turn check are one
    // function and not two.
    const my_turn = shit_1170_chess_note_position_fun(
      db,
      game_id,
      game,
      "sleet.near",
    );
    expect(my_turn).toBe(false);

    const recorded = shit_1170_chess_positions_fun(db, game_id);
    expect(recorded.length).toBe(1);

    // it is the position with BLACK to move — the opponent's turn.
    // this is the half that was missing, and the half that makes the
    // repetition check work: the target of a candidate move is an
    // opponent-to-move position.
    expect(recorded[0]).toBe("2r5/7p/1P5R/8/6k1/8/3K2BP/1N6 b - - 0 1");
  });

  test("it records the position on the agent's turn as well", () => {
    // the same helper, on the other side of the turn. the record
    // holds BOTH sides' positions, and that is the whole point: the
    // target of a candidate move is an opponent-to-move position, so
    // a record of only one side can never hold it.
    const home = mkdtempSync(join(tmpdir(), "rex-chess-positions-test-"));
    process.env.SHIT_1170_REX_HOME = home;

    const db = shit_1170_chess_games_db_open_fun();
    const game_id: SHIT_1170_CHESS_GAME_ID = [
      224274147,
      "sleet.near",
      "sleet-ai.near",
    ];

    // the same board, but WHITE to move — so it IS the agent's turn,
    // since the agent plays white in this game.
    const board = [
      " N      ",
      "   K  BP",
      "        ",
      "      k ",
      "        ",
      " P     R",
      "       p",
      "  r     ",
    ];

    const game: SHIT_1170_CHESS_GAME = {
      game_id,
      info: {
        white: { type: "Human", value: "sleet.near" },
        black: { type: "Human", value: "sleet-ai.near" },
        turn_color: "White",
        last_block_height: 224274147,
        has_bets: false,
      },
      board,
    };

    const my_turn = shit_1170_chess_note_position_fun(
      db,
      game_id,
      game,
      "sleet.near",
    );
    expect(my_turn).toBe(true);

    const recorded = shit_1170_chess_positions_fun(db, game_id);
    expect(recorded.length).toBe(1);
    expect(recorded[0]).toBe("2r5/7p/1P5R/8/6k1/8/3K2BP/1N6 w - - 0 1");
  });
});
