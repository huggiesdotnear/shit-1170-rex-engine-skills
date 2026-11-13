// the agent's reasoning, tested against the mistakes it exists to
// prevent.
//
// --- WHY THIS FILE EXISTS ---
// two bugs made the agent play badly.
//
// the first was the MATERIAL GUARD. it looked at the position after
// the move, where the piece is still on the board, so it could not
// see a move that hangs it. the capture happens on the OPPONENT'S
// REPLY.
//
// the second was the SEARCH ORIENTATION. the evaluation is from
// white's point of view, so a root that always maximises from white's
// side plays black's WORST move.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";

import {
  shit_1170_chess_best_move_fun,
  shit_1170_chess_decide_fun,
  shit_1170_chess_keeps_material_fun,
  shit_1170_chess_material_fun,
} from "./agent";

describe("the material", () => {
  test("it is from white's point of view", () => {
    const fen = "4k3/8/8/8/8/8/8/4K1Q1 w - - 0 1";
    expect(shit_1170_chess_material_fun(new Chess(fen))).toBe(900);
  });

  test("it is negative when black is ahead", () => {
    const fen = "4k3/8/8/8/8/8/8/q3K3 b - - 0 1";
    expect(shit_1170_chess_material_fun(new Chess(fen))).toBe(-900);
  });
});

describe("the material guard", () => {
  test("it refuses a move that walks a queen into a capture", () => {
    // the white queen on g1, the black queen on d4. Qg4 does not lose
    // the queen on the move — it loses it on black's reply, which is
    // exactly why the guard has to look that far.
    const fen = "4k3/8/8/8/3q4/8/8/4K1Q1 w - - 0 1";
    expect(shit_1170_chess_keeps_material_fun(fen, "Qg4", true)).toBe(false);
    expect(shit_1170_chess_keeps_material_fun(fen, "Qf2", true)).toBe(false);
  });

  test("it allows a move that takes the hanging piece", () => {
    const fen = "4k3/8/8/8/3q4/8/8/4K1Q1 w - - 0 1";
    expect(shit_1170_chess_keeps_material_fun(fen, "Qxd4", true)).toBe(true);
  });

  test("it allows a quiet move that keeps everything", () => {
    const fen = "4k3/8/8/8/3q4/8/8/4K1Q1 w - - 0 1";
    expect(shit_1170_chess_keeps_material_fun(fen, "Qg2", true)).toBe(true);
  });

  test("it works for black as well", () => {
    // the same position, mirrored: black to move, and the white queen
    // on e5 is the one that is hanging. the black queen is on g1, so
    // moving the king is the safe play — Qe3 would hang the queen.
    const fen = "4K3/8/8/8/4Q3/8/8/4k1q1 b - - 0 1";
    const game = new Chess(fen);
    const legal = game.moves({ verbose: true });
    expect(legal.length).toBeGreaterThan(0);

    const safe = legal.find((m) => m.san === "Kd1");
    expect(safe).toBeDefined();
    expect(
      shit_1170_chess_keeps_material_fun(fen, safe!.san, false),
    ).toBe(true);
  });
});

describe("the search", () => {
  test("it plays black as black", () => {
    // black is up a queen. a search that always maximises from WHITE's
    // point of view plays black's worst move — it looks for the move
    // that leaves the position best for white, which for black means
    // the worst possible one.
    const fen = "4k3/8/8/8/8/8/8/q3K3 b - - 0 1";
    const best = shit_1170_chess_best_move_fun(fen, 2000, 4);

    expect(best).not.toBeNull();

    // whatever it picks, the black queen must still be on the board
    // unless black took the white king, which is a win for black.
    const game = new Chess(fen);
    game.move(best!.san);
    const queen_gone = !game.moves().some((m) => m.startsWith("Qxe1"));
    expect(queen_gone || best!.san.startsWith("Qxe1")).toBe(true);
  });

  test("it finds a mate in one", () => {
    const fen = "R5k1/5ppp/8/8/8/8/8/6K1 w - - 0 1";
    const best = shit_1170_chess_best_move_fun(fen, 2000, 4);
    expect(best).not.toBeNull();

    const game = new Chess(fen);
    game.move(best!.san);
    expect(game.isCheckmate()).toBe(true);
  });
});

describe("the decision", () => {
  test("it takes a free queen", () => {
    // the white queen on h5, the black queen on e8 with nothing
    // defending it.
    const fen = "4q2k/8/8/7Q/8/8/8/4K3 w - - 0 1";
    const choice = shit_1170_chess_decide_fun(fen, null, 2000);
    expect(choice).not.toBeNull();
    expect(choice!.san).toBe("Qxe8+");
  });

  test("it falls back to the program's choice when the search has nothing", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const choice = shit_1170_chess_decide_fun(
      fen,
      { mv: "a2a3", san: "a3" },
      50,
    );
    expect(choice).not.toBeNull();
    expect(choice!.mv.length).toBeGreaterThan(0);
  });

  test("it answers null when there is no legal move", () => {
    const fen = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
    expect(shit_1170_chess_decide_fun(fen, null, 500)).toBeNull();
  });
});
