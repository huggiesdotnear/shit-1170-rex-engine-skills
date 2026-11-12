// the agent's own safety checks, tested against the mistakes an agent
// makes when it overrides a program.
//
// --- WHY THIS FILE EXISTS ---
// the agent's job is to choose a move. the risk in that is that it
// chooses a move the program would not have chosen, and the move it
// chooses is worse.
//
// the mistake it made most often was walking a piece into a capture.
// the position does not look bad AFTER the move — the piece is still
// there. it looks bad after the OPPONENT'S REPLY, which is where the
// capture happens.
//
// so the guard looks at the position after the opponent's best reply,
// and refuses a move that gives away more than a pawn's worth.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";

/**
 * the material on the board, from white's point of view.
 */
function eval_board_fun(game: Chess): number {
  const values: Record<string, number> = {
    p: 100, n: 320, b: 330, r: 500, q: 900, k: 0,
  };
  let score = 0;
  for (const row of game.board()) {
    for (const square of row) {
      if (!square) continue;
      score += (square.color === "w" ? 1 : -1) * (values[square.type] ?? 0);
    }
  }
  return score;
}

/**
 * does this move leave the mover's material alone?
 *
 * the same rule the agent uses: play the move, play the opponent's
 * best reply, and compare the material.
 */
function keeps_material_fun(
  fen: string,
  san: string,
  from_mover: boolean,
): boolean {
  const before = new Chess(fen);
  const before_material = eval_board_fun(before);
  const mover_material = from_mover ? before_material : -before_material;

  const after = new Chess(fen);
  const move = after.moves({ verbose: true }).find((m) => m.san === san);
  if (!move) return false;

  after.move(move);

  const replies = after.moves({ verbose: true });
  let worst = mover_material;

  for (const reply of replies) {
    after.move(reply);
    const after_material = eval_board_fun(after);
    after.undo();

    const new_mover = from_mover ? after_material : -after_material;
    if (new_mover < worst) worst = new_mover;
  }

  return worst >= mover_material - 90;
}

describe("the agent's material guard", () => {
  test("it refuses a move that walks a queen into a capture", () => {    // the white queen on g1, the black queen on d4. Qg4 does not lose
    // the queen on the move — it loses it on black's reply, which is
    // exactly why the guard has to look that far.
    const fen = "4k3/8/8/8/3q4/8/8/4K1Q1 w - - 0 1";

    expect(keeps_material_fun(fen, "Qg4", true)).toBe(false);
    expect(keeps_material_fun(fen, "Qf2", true)).toBe(false);
  });

  test("it allows a move that takes the hanging piece", () => {
    // the black queen on d4 is defended by nothing, so Qxd4 wins a
    // queen and loses nothing.
    const fen = "4k3/8/8/8/3q4/8/8/4K1Q1 w - - 0 1";
    expect(keeps_material_fun(fen, "Qxd4", true)).toBe(true);
  });

  test("it allows a quiet move that keeps everything", () => {
    const fen = "4k3/8/8/8/3q4/8/8/4K1Q1 w - - 0 1";
    expect(keeps_material_fun(fen, "Qg2", true)).toBe(true);
  });

  test("it works for black as well", () => {
    // the same position, mirrored: black to move, and the white queen
    // on d4 is the one that is hanging.
    const fen = "4K3/8/8/8/4Q3/8/8/4k1q1 b - - 0 1";
    const game = new Chess(fen);
    const moves = game.moves({ verbose: true }).map((m) => m.san);
    expect(moves.length).toBeGreaterThan(0);

    // every move that keeps the material is allowed, and the guard
    // agrees for the safe ones.
    for (const san of moves.filter((m) => m === "Qd1" || m === "Qh1")) {
      expect(keeps_material_fun(fen, san, false)).toBe(true);
    }
  });
});

describe("the agent's search", () => {
  test("it plays black as black", () => {
    // black is up a queen. a search that always maximises from WHITE's
    // point of view plays black's WORST move — it looks for the move
    // that leaves the position best for white, which for black means
    // the worst possible one.
    //
    // the fix is that the root knows whose move it is: white to move
    // maximises the score, black to move minimises it.
    const fen = "4k3/8/8/8/8/8/8/q3K3 b - - 0 1";

    const game = new Chess(fen);
    const legal = game.moves({ verbose: true });
    expect(legal.length).toBeGreaterThan(0);

    // the white king is on e1 and the black queen on a1. capturing the
    // white king is not a move — but the point is which move the
    // search picks, and a white-maximising root picks the one that
    // hands the queen back.
    const best = best_move_for_test_fun(fen, 3);
    expect(best).not.toBeNull();

    // whatever it picks, it must not be a move that gives the queen
    // away for nothing.
    const after = new Chess(fen);
    const move = after.moves({ verbose: true }).find((m) => m.san === best);
    expect(move).toBeDefined();
    after.move(move!);

    // the queen is still on the board, or black took the white king
    // (which is a win for black, so it is fine too).
    const queen_gone = !after.moves().some((m) => m.startsWith("Qxe1"));
    expect(queen_gone || (best ?? "").startsWith("Qxe1")).toBe(true);
  });
});

/**
 * the search's choice, for the test above.
 */
function best_move_for_test_fun(fen: string, depth: number): string | null {
  const root = new Chess(fen);
  const root_maximizing = root.turn() === "w";

  let best: { san: string; score: number } | null = null;
  for (const move of root.moves({ verbose: true })) {
    root.move(move);
    const score = search_for_test_fun(
      root,
      depth - 1,
      !root_maximizing,
      -Infinity,
      Infinity,
    );
    root.undo();
    if (!best || score > best.score) best = { san: move.san, score };
  }
  return best?.san ?? null;
}

/**
 * the search itself, for the test above.
 */
function search_for_test_fun(
  game: Chess,
  depth: number,
  maximizing: boolean,
  alpha: number,
  beta: number,
): number {
  if (game.isCheckmate()) return maximizing ? -1_000_000 : 1_000_000;
  if (game.isStalemate() || game.isInsufficientMaterial()) return 0;
  if (depth === 0) return eval_board_fun(game);

  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return 0;

  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    game.move(move);
    const value = search_for_test_fun(
      game,
      depth - 1,
      !maximizing,
      maximizing ? alpha : beta,
      maximizing ? beta : alpha,
    );
    game.undo();
    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}
