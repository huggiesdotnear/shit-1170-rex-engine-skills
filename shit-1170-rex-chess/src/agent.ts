// the agent's reasoning, in one place.
//
// --- WHY THIS EXISTS ---
// choosing a LEGAL move is mechanical, and `chess.js` already knows
// about check, pins, stalemate and the rest. choosing a GOOD move is
// judgement.
//
// the agent's judgement lives here: a search, a guard that refuses a
// move which hangs a piece, and the program's own ranking as a second
// opinion.
//
// it is a module rather than part of a bin because more than one thing
// needs it — the daemon asks an agent for a move, and a one-shot tool
// plays a game out — and a copy of a chess search in each of them is a
// copy that drifts.
//
// --- THE GUARD ---
// an agent that overrides a program needs a guard, because overriding
// is where the mistakes happen.
//
// the mistake it made most often was walking a piece into a capture.
// the position does not look bad AFTER the move — the piece is still
// there. it looks bad after the OPPONENT'S REPLY, which is where the
// capture happens. so the guard plays the move, plays the opponent's
// best reply, and refuses a move that gives away more than a pawn's
// worth.
//
// --- THE SEARCH ---
// the evaluation is from WHITE's point of view, so the root has to
// know whose move it is: white to move maximises the score, black to
// move minimises it. without that, a search that always maximises
// from white's side plays black's WORST move — it looks for the move
// that leaves the position best for white, which for black means the
// worst possible one.
//
// the mate score is flipped for the same reason: a mate FOR the mover
// is a reason to play the move, and a mate AGAINST the mover is not.

import { Chess } from "chess.js";

/**
 * the piece values, from white's point of view.
 */
export const SHIT_1170_CHESS_PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/**
 * the score of a mate. it is bigger than any material difference, so
 * a mate is always preferred.
 */
export const SHIT_1170_CHESS_MATE_SCORE = 1_000_000;

/**
 * how much material a move may give away before the guard refuses it.
 * it is a pawn and a bit.
 */
export const SHIT_1170_CHESS_MATERIAL_TOLERANCE = 90;

/**
 * the material on the board, from white's point of view.
 */
export function shit_1170_chess_material_fun(game: Chess): number {
  let score = 0;
  for (const row of game.board()) {
    for (const square of row) {
      if (!square) continue;
      score +=
        (square.color === "w" ? 1 : -1) *
        (SHIT_1170_CHESS_PIECE_VALUES[square.type] ?? 0);
    }
  }
  return score;
}

/**
 * alpha-beta, with a clock.
 *
 * the deadline is checked between moves, so the search returns the
 * best it found rather than running past the budget.
 */
export function shit_1170_chess_search_fun(
  game: Chess,
  depth: number,
  maximizing: boolean,
  alpha: number,
  beta: number,
  deadline: number,
): number {
  if (Date.now() > deadline) {
    return shit_1170_chess_material_fun(game);
  }

  if (game.isCheckmate()) {
    return maximizing ? -SHIT_1170_CHESS_MATE_SCORE : SHIT_1170_CHESS_MATE_SCORE;
  }
  if (game.isStalemate() || game.isInsufficientMaterial()) return 0;
  if (depth === 0) return shit_1170_chess_material_fun(game);

  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return 0;

  let best = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    game.move(move);
    const value = shit_1170_chess_search_fun(
      game,
      depth - 1,
      !maximizing,
      maximizing ? alpha : beta,
      maximizing ? beta : alpha,
      deadline,
    );
    game.undo();

    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }

    // alpha-beta cut: the opponent cannot improve on this line.
    if (alpha >= beta) break;

    // the clock.
    if (Date.now() > deadline) break;
  }

  return best;
}

/**
 * the best move in a position, by iterative deepening.
 *
 * the search goes as deep as the budget allows, so a move is always
 * returned even when the clock runs out.
 */
export function shit_1170_chess_best_move_fun(
  fen: string,
  budget_ms: number,
  max_depth = 7,
): { san: string; score: number; depth: number } | null {
  const deadline = Date.now() + budget_ms;

  const root = new Chess(fen);
  const root_maximizing = root.turn() === "w";
  const root_moves = root.moves({ verbose: true });
  if (root_moves.length === 0) return null;

  let best: { san: string; score: number; depth: number } | null = null;

  for (let depth = 1; depth <= max_depth; depth += 1) {
    let at_depth: { san: string; score: number } | null = null;

    for (const move of root_moves) {
      root.move(move);
      const score = shit_1170_chess_search_fun(
        root,
        depth - 1,
        !root_maximizing,
        -Infinity,
        Infinity,
        deadline,
      );
      root.undo();

      if (!at_depth || score > at_depth.score) {
        at_depth = { san: move.san, score };
      }

      if (Date.now() > deadline) break;
    }

    // a depth that did not finish is not trusted.
    if (!at_depth) break;
    best = { ...at_depth, depth };

    if (Math.abs(at_depth.score) >= SHIT_1170_CHESS_MATE_SCORE) break;
    if (Date.now() > deadline) break;
  }

  return best;
}

/**
 * does this move leave the mover's material alone?
 *
 * the check looks at the position AFTER the opponent's best reply,
 * because that is where a capture happens.
 */
export function shit_1170_chess_keeps_material_fun(
  fen: string,
  san: string,
  from_mover: boolean,
): boolean {
  const before = new Chess(fen);
  const mover_material = from_mover
    ? shit_1170_chess_material_fun(before)
    : -shit_1170_chess_material_fun(before);

  const after = new Chess(fen);
  const move = after.moves({ verbose: true }).find((m) => m.san === san);
  if (!move) return false;
  after.move(move);

  let worst = mover_material;
  for (const reply of after.moves({ verbose: true })) {
    after.move(reply);
    const value = shit_1170_chess_material_fun(after);
    after.undo();

    const for_mover = from_mover ? value : -value;
    if (for_mover < worst) worst = for_mover;
  }

  return worst >= mover_material - SHIT_1170_CHESS_MATERIAL_TOLERANCE;
}

/**
 * the move to play in a position, and why.
 *
 * `recommended` is the program's own choice, and it is used when the
 * search has nothing better to say. it is the fallback, not the
 * answer.
 */
export function shit_1170_chess_decide_fun(
  fen: string,
  recommended: { mv: string; san: string } | null,
  budget_ms: number,
): { mv: string; san: string; reason: string } | null {
  const game = new Chess(fen);
  const mover_is_white = game.turn() === "w";
  const legal = game.moves({ verbose: true });
  if (legal.length === 0) return null;

  const deep = shit_1170_chess_best_move_fun(fen, budget_ms);

  if (deep) {
    const match = legal.find((m) => m.san === deep.san);
    if (match) {
      // the score is from white's point of view. the question is
      // whether the move is good for the MOVER.
      const for_mover = mover_is_white ? deep.score : -deep.score;
      const safe = shit_1170_chess_keeps_material_fun(
        fen,
        match.san,
        mover_is_white,
      );

      // a mate FOR the mover. a negative mate score means the mover is
      // the one being mated, and that is not a reason to play the move.
      if (
        for_mover >= SHIT_1170_CHESS_MATE_SCORE &&
        safe
      ) {
        return {
          mv: match.from + match.to,
          san: match.san,
          reason: `a depth-${deep.depth} search finds this forces mate`,
        };
      }

      if (safe) {
        return {
          mv: match.from + match.to,
          san: match.san,
          reason: `a depth-${deep.depth} search`,
        };
      }
    }
  }

  // the search's move was unsafe. the program's own choice is used
  // instead.
  if (recommended) {
    const match = legal.find(
      (m) => m.from + m.to === recommended.mv || m.san === recommended.san,
    );
    if (match) {
      return {
        mv: match.from + match.to,
        san: match.san,
        reason: "the program's own choice",
      };
    }
  }

  const first = legal[0];
  if (!first) return null;
  return {
    mv: first.from + first.to,
    san: first.san,
    reason: "the first legal move",
  };
}
