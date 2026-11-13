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

import { shit_1170_chess_decide_fun } from "../src/agent";

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
 * the move to play in a position, and why.
 *
 * the reasoning is in `src/agent.ts`, so the daemon and this bin use
 * the same one.
 */
function decide_fun(
  fen: string,
  candidates: Array<{ mv: string; san: string; rank: number; score: number }>,
  recommended: { mv: string; san: string; score?: number } | null,
): { mv: string; san: string; reason: string } | null {
  if (candidates.length === 0) return null;

  const choice = shit_1170_chess_decide_fun(
    fen,
    recommended ? { mv: recommended.mv, san: recommended.san } : null,
    TIME_BUDGET_MS,
  );
  if (!choice) return null;

  // the choice is one of the candidates, so the move that is sent is
  // in the contract's own notation.
  const match = candidates.find(
    (c) => c.mv === choice.mv || c.san === choice.san,
  );
  if (!match) return null;

  return { mv: match.mv, san: match.san, reason: choice.reason };
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
