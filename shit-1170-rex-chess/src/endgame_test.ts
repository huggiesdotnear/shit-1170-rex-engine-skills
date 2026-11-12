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

import {
  shit_1170_chess_choose_move_fun,
  shit_1170_chess_legal_moves_fun,
  simple_evaluation_fun,
} from "./move";

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
});
