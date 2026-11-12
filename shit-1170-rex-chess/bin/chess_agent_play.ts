#!/usr/bin/env bun
// the AGENT: it decides the moves the daemon asks about.
//
// --- WHAT THIS IS ---
// the daemon proposes the legal moves and the program has an opinion on
// them. this decides which one to play.
//
// the split is deliberate:
//
//   - choosing a LEGAL move is mechanical, and the engine does it.
//   - choosing a GOOD move is judgement, and that is here.
//
// so the agent works out what it wants to play, and the daemon checks
// the answer against the legal list before anything is signed. an
// answer that names a move the contract would reject costs nothing,
// because it never reaches the chain.
//
// --- HOW IT DECIDES ---
// 1. a search, deeper than the daemon's own, so it can see a mate
//    that a two-ply evaluation cannot
// 2. the program's own ranking, as a second opinion
// 3. the game's own state — a game against the ai, a game with bets
//    on it, how many moves have gone by
//
// the search is alpha-beta with a time budget. a full-depth search of
// an opening position is far too slow to run on every move, so the
// budget is what keeps it honest: it goes as deep as it can in the
// time it has, and the move it has at the end is the best it found.

import { Chess } from "chess.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  shit_1170_chess_decisions_dir_fun,
} from "/home/sleet-dev/.shit-1170-rex-engine/.agents/skills/shit-1170-rex-chess/src/paths";

const DIR = shit_1170_chess_decisions_dir_fun();

/**
 * how long the search may take, in ms.
 *
 * the daemon waits five minutes for an answer, so there is room. but
 * a move that takes a minute to decide is a move the game waits for,
 * and the opponent is playing the whole time.
 */
const TIME_BUDGET_MS = Number(process.env.CHESS_AGENT_BUDGET_MS ?? 8000);

/**
 * the deepest the search goes, whatever the clock says.
 */
const MAX_DEPTH = Number(process.env.CHESS_AGENT_DEPTH ?? 6);

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
 * the score of a mate, and the score of a mate being handed over.
 */
const MATE = 1_000_000;

/**
 * alpha-beta, with a clock.
 *
 * the deadline is checked between moves, so the search returns the
 * best it found rather than running past the budget.
 */
function search_fun(
  game: Chess,
  depth: number,
  maximizing: boolean,
  alpha: number,
  beta: number,
  deadline: number,
): number {
  if (Date.now() > deadline) return eval_board_fun(game);

  if (game.isCheckmate()) return maximizing ? -MATE : MATE;
  if (game.isStalemate() || game.isInsufficientMaterial()) return 0;
  if (depth === 0) return eval_board_fun(game);

  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return 0;

  let best = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    game.move(move);
    const value = search_fun(
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
 * the best move in a position, by the search.
 *
 * the search is iterative deepening: depth 1 first, then 2, and so on
 * for as long as the budget allows. the last completed depth is the
 * answer, so a move is always returned even when the clock runs out.
 */
function best_move_fun(
  fen: string,
  budget_ms: number,
  max_depth: number,
): { san: string; score: number; depth: number } | null {
  const deadline = Date.now() + budget_ms;

  const root = new Chess(fen);
  const root_moves = root.moves({ verbose: true });
  if (root_moves.length === 0) return null;

  // the evaluation is from WHITE's point of view, so the root has to
  // know whose move it is. white to move means the root MAXIMISES the
  // score; black to move means it MINIMISES it. without this the
  // search plays black as if it were white, and picks black's worst
  // move.
  const root_maximizing = root.turn() === "w";

  let best: { san: string; score: number; depth: number } | null = null;

  for (let depth = 1; depth <= max_depth; depth += 1) {
    let best_at_depth: { san: string; score: number } | null = null;

    for (const move of root_moves) {
      root.move(move);

      // the reply is the opponent's, so the search is run from the
      // opponent's side — which is the opposite of the root.
      const score = search_fun(
        root,
        depth - 1,
        !root_maximizing,
        -Infinity,
        Infinity,
        deadline,
      );
      root.undo();

      if (!best_at_depth || score > best_at_depth.score) {
        best_at_depth = { san: move.san, score };
      }

      // the clock is done, so this depth is as far as it goes.
      if (Date.now() > deadline) break;
    }

    // a depth that did not finish is not trusted.
    if (!best_at_depth) break;
    best = { ...best_at_depth, depth };

    // a mate is found, or the clock is done.
    if (Math.abs(best_at_depth.score) >= MATE) break;
    if (Date.now() > deadline) break;
  }

  return best;
}

/**
 * the requests waiting for an answer.
 */
function pending_fun(): Array<Record<string, unknown>> {
  let files: string[] = [];
  try {
    files = readdirSync(DIR);
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const file of files) {
    if (!file.endsWith(".request.json")) continue;
    try {
      out.push(
        JSON.parse(readFileSync(join(DIR, file), "utf8")) as Record<string, unknown>,
      );
    } catch {
      // a half-written request. the next tick will pick it up.
    }
  }
  return out;
}

/**
 * the answer file for a request, if there is one.
 */
function answered_fun(id: string): boolean {
  try {
    readFileSync(join(DIR, `${id}.answer.json`), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * does this move leave the mover's material alone?
 *
 * a move that walks a piece into a capture is the worst thing an
 * agent can do, and it is the mistake an agent makes most often when
 * it overrides a program that has already checked the position.
 *
 * the check has to look at the position AFTER the opponent's reply,
 * because that is where the capture happens. `Qg4` does not lose the
 * queen on the move — the queen is taken on the opponent's reply.
 *
 * so the move is played, the opponent's best reply is played, and the
 * material is compared. a move that gives up more than a pawn's worth
 * is refused, and the program's own choice is used instead.
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

  // the opponent's best reply, by material. a capture is worth more
  // than anything else, so it is what gets found.
  const replies = after.moves({ verbose: true });
  let worst_material = mover_material;

  for (const reply of replies) {
    after.move(reply);
    const after_material = eval_board_fun(after);
    after.undo();

    const new_mover_material = from_mover ? after_material : -after_material;
    if (new_mover_material < worst_material) worst_material = new_mover_material;
  }

  return worst_material >= mover_material - 90;
}

/**
 * the move to play in a position, and why.
 */
function decide_fun(
  fen: string,
  candidates: Array<{ mv: string; san: string; rank: number; score: number }>,
  recommended: { mv: string; san: string; score?: number } | null,
): { mv: string; san: string; reason: string } | null {
  if (candidates.length === 0) return null;

  // whose side to move is it? the program's scores are from the side
  // to move's point of view.
  const game = new Chess(fen);
  const mover_is_white = game.turn() === "w";

  const deep = best_move_fun(fen, TIME_BUDGET_MS, MAX_DEPTH);

  if (deep) {
    const match = candidates.find((c) => c.san === deep.san);
    if (match) {
      // the score is from WHITE's point of view. the question the
      // agent is asking is whether the move is good for the MOVER, so
      // it is flipped for black.
      const score_for_mover = mover_is_white ? deep.score : -deep.score;

      // a mate FOR the mover. a negative mate score means the mover is
      // the one being mated, and that is not a reason to play the move.
      const forces_mate = score_for_mover >= MATE;
      const is_recommended = recommended?.mv === match.mv;

      if (forces_mate && keeps_material_fun(fen, match.san, mover_is_white)) {
        return {
          mv: match.mv,
          san: match.san,
          reason: `a depth-${deep.depth} search finds this forces mate`,
        };
      }

      // the search's move, when it is better than the program's own
      // choice AND it does not give material away. the material test
      // is what stops the agent from playing a move that walks a
      // piece into a capture — the mistake it makes most often when
      // it overrides a program that has already checked the position.
      //
      // the program's score is from the MOVER's point of view, so the
      // two are compared in the same terms.
      const program_score =
        recommended?.score !== undefined
          ? recommended.score
          : mover_is_white
            ? -Infinity
            : Infinity;

      const safe = keeps_material_fun(fen, match.san, mover_is_white);

      if (!is_recommended && score_for_mover > program_score + 20 && safe) {
        return {
          mv: match.mv,
          san: match.san,
          reason: `a depth-${deep.depth} search prefers this over ${recommended?.san ?? "the program's choice"}`,
        };
      }
    }
  }

  if (recommended) {
    return {
      mv: recommended.mv,
      san: recommended.san,
      reason: "the program's own choice",
    };
  }

  return {
    mv: candidates[0].mv,
    san: candidates[0].san,
    reason: "the first legal move",
  };
}

/**
 * answer one request.
 */
async function answer_fun(request: Record<string, unknown>): Promise<boolean> {
  const id = String(request.id ?? "");
  const fen = (request.position as { fen?: string })?.fen ?? "";
  const candidates = (request.candidates ?? []) as Array<{
    mv: string; san: string; rank: number; score: number;
  }>;
  const recommended = (request.recommended ?? null) as {
    mv: string; san: string; score?: number;
  } | null;

  if (!id || !fen || candidates.length === 0) return false;
  if (answered_fun(id)) return false;

  const choice = decide_fun(fen, candidates, recommended);
  if (!choice) return false;

  await Bun.write(
    join(DIR, `${id}.answer.json`),
    `${JSON.stringify({ mv: choice.mv, san: choice.san, note: choice.reason }, null, 2)}\n`,
  );
  console.log(`${id} -> ${choice.san} (${choice.mv}) — ${choice.reason}`);
  return true;
}

// --- ONE PASS ---
for (const request of pending_fun()) {
  await answer_fun(request);
}

// --- THE LOOP ---
if (process.argv.includes("--play")) {
  console.log("watching for decisions. ctrl-c ends it.");
  while (true) {
    await Bun.sleep(2000);
    for (const request of pending_fun()) {
      await answer_fun(request);
    }
  }
}
