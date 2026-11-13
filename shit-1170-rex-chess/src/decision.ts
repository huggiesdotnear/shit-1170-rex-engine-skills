// the position, and the candidates, for an agent to decide from.
//
// --- WHY THIS EXISTS ---
// the skill has two ways to play. in the autonomous mode the program
// picks the move itself, from a search over the legal moves. in the
// agent-decides mode the PROGRAM proposes and the AGENT chooses.
//
// the split matters because the two halves of chess-playing are
// different kinds of work:
//
//   - choosing a LEGAL move is mechanical. the contract validates the
//     move, and a move it rejects is a failed transaction that still
//     costs gas. so the candidate set comes from chess.js, which
//     already knows about check, pins, stalemate and the rest.
//
//   - choosing a GOOD move is judgement. which move to play against
//     an opponent that is shuffling its king is not a search
//     question — it is a question about what the opponent is doing
//     and what the game is for.
//
// so this module produces the package an agent needs to decide: the
// position in a form a model can read, every legal move with its
// notation, and the program's own ranking of them as a starting
// point. the agent then picks one, and the engine guarantees the
// choice is legal.
//
// --- WHAT THE AGENT GETS ---
//   position    the board, the side to move, the castling rights, the
//               material, and the game's own state
//   candidates  every legal move, with the notation the contract
//               wants, and the program's score for each
//   recommended  the move the program would have played
//
// --- WHY THE SCORES ARE THERE AT ALL ---
// a model asked to pick a chess move from a bare list of legal moves
// will sometimes pick one that hangs a piece. the scores are a
// second opinion: the agent can override the program, but it can see
// what the program thought first.

import { Chess } from "chess.js";

import { shit_1170_chess_api_position_history_fun } from "./api";
import { shit_1170_chess_game_read_fun } from "./game";
import {
  shit_1170_chess_board_to_fen_fun,
  shit_1170_chess_choose_move_fun,
  shit_1170_chess_move_notation_fun,
  simple_evaluation_fun,
} from "./move";
import type { SHIT_1170_CHESS_CHOSEN_MOVE } from "./move";
import {
  shit_1170_chess_games_db_open_fun,
  shit_1170_chess_positions_fun,
} from "./store";
import type { SHIT_1170_CHESS_GAME_ID } from "./types";

/**
 * one candidate move, with the program's opinion of it.
 */
export interface SHIT_1170_CHESS_CANDIDATE {
  /** the notation the contract takes: "e2e4", "O-O", "e7 to e8 Q". */
  mv: string;
  /** the same move in chess notation: "e4", "O-O", "e8=Q". */
  san: string;
  /** the square it starts on. */
  from: string;
  /** the square it ends on. */
  to: string;
  /** the program's score, from the side to move's point of view. */
  score: number;
  /** the program's rank, best first. */
  rank: number;
  /** what the program thought of the move, in words. */
  note?: string;
}

/**
 * everything an agent needs to choose a move.
 */
export interface SHIT_1170_CHESS_DECISION {
  game_id: SHIT_1170_CHESS_GAME_ID;
  /** the position, as a FEN. */
  fen: string;
  /** the board as the contract renders it: eight rank strings. */
  board: string[];
  /** the side to move: "White" or "Black". */
  turn: "White" | "Black";
  /** the white player. */
  white: string;
  /** the black player. */
  black: string;
  /** who the agent is playing. */
  account_id: string;
  /** the material on the board, from white's point of view. */
  material: number;
  /** every legal move, best first. */
  candidates: SHIT_1170_CHESS_CANDIDATE[];
  /** the move the program would have played. */
  recommended: SHIT_1170_CHESS_CHOSEN_MOVE | null;
  /** the game as the contract sees it. */
  game: {
    /** whether the game has a bet on it. */
    has_bets: boolean;
    /** whether the opponent is the contract's own ai. */
    opponent_is_ai: boolean;
    /** how many moves have been played, as far as the api knows. */
    moves_played: number;
  };
}

/**
 * the material on the board, from white's point of view.
 */
function material_fun(game: Chess): number {
  const values: Record<string, number> = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0,
  };

  let score = 0;
  const board = game.board();
  for (const row of board) {
    for (const square of row) {
      if (!square) continue;
      const value = values[square.type] ?? 0;
      score += square.color === "w" ? value : -value;
    }
  }
  return score;
}

/**
 * the positions a game has been through: the api's history AND the
 * daemon's own record.
 *
 * the union, and not one or the other.
 *
 * the api's history covers the whole game, but it is an index, and an
 * index can lag behind the chain — then it has nothing at all. the
 * daemon's own record is always there, but it only holds what the
 * daemon happened to observe.
 *
 * choosing between them means throwing half the game away, and it is
 * the half that matters that gets thrown: a position the daemon saw
 * is exactly the position the api is missing when it is behind.
 *
 * the order is the api's history first, then the daemon's own record,
 * and the duplicates are dropped — the same position in both is one
 * position, seen once.
 */
export function shit_1170_chess_seen_positions_fun(
  history: string[],
  local: string[],
): string[] {
  return [...new Set([...history, ...local])];
}

/**
 * read a position and every legal move, for an agent to decide from.
 *
 * the position comes from the api's fen when it has one, because the
 * api's fen carries the real castling rights. when it does not, the
 * board is turned into a fen by hand — the castling rights are
 * derived from the board, which is right as long as nothing has moved
 * off its home square.
 */
export async function shit_1170_chess_decision_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
  account_id: string,
): Promise<SHIT_1170_CHESS_DECISION> {
  const game = await shit_1170_chess_game_read_fun(game_id);

  // the api's history carries the FEN of every position the game has
  // been through, so it answers three questions at once: where the
  // game is now, which positions have already come round, and how
  // many moves have been played.
  const history = await shit_1170_chess_api_position_history_fun(game_id);

  // the daemon's own record of the positions, for when the api's
  // index is behind and has no history at all.
  const local = shit_1170_chess_positions_fun(db, game_id);

  // THE SEEN SET IS THE UNION OF BOTH SOURCES.
  //
  // the api's history covers the whole game, but it is an INDEX: it
  // can lag behind the chain, and then it has nothing at all. the
  // daemon's own record covers what the daemon saw, and it is always
  // there — but it only holds what the daemon happened to observe.
  //
  // neither one alone is the whole game, and choosing between them
  // means throwing half of it away. so they are unioned: the api's
  // history AND the daemon's own record. a position in either one is
  // a position the game has been through.
  const seen = shit_1170_chess_seen_positions_fun(history, local);

  const api_fen = history.length > 0 ? history[history.length - 1] : null;
  const fen = api_fen ?? shit_1170_chess_board_to_fen_fun(game.board, game.info);

  const candidates = await shit_1170_chess_candidates_fun(fen);
  const recommended = shit_1170_chess_choose_move_fun(fen, seen);

  const chess = new Chess(fen);

  return {
    game_id,
    fen,
    board: game.board,
    turn: game.info.turn_color as "White" | "Black",
    white: game.info.white.value,
    black: game.info.black.value,
    account_id,
    material: material_fun(chess),
    candidates,
    recommended,
    game: {
      has_bets: game.info.has_bets,
      opponent_is_ai: game.info.black.type === "Ai",
      moves_played: Math.max(history.length, local.length),
    },
  };
}

/**
 * the daemon's game history.
 *
 * one database for the process. it is opened lazily, because the
 * decision package is also used by a one-shot bin that has no reason
 * to create a history.
 */
const db = shit_1170_chess_games_db_open_fun();

/**
 * every legal move in a position, with the program's score for each.
 *
 * the scores come from the same evaluation the chooser uses, so they
 * say the same thing the chooser would say — they are the program's
 * opinion, laid out where an agent can read them.
 */
export async function shit_1170_chess_candidates_fun(
  fen: string,
): Promise<SHIT_1170_CHESS_CANDIDATE[]> {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return [];

  const scored: { move: (typeof moves)[number]; score: number }[] = [];

  for (const move of moves) {
    game.move(move);
    const score = shit_1170_chess_score_for_side_fun(game);
    game.undo();
    scored.push({ move, score });
  }

  // best first. the mover's point of view, so a bigger score is
  // better for the side that is to move.
  scored.sort((a, b) => b.score - a.score);

  return scored.map((entry, index) => ({
    mv: shit_1170_chess_move_notation_fun(entry.move),
    san: entry.move.san,
    from: entry.move.from,
    to: entry.move.to,
    score: Math.round(entry.score),
    rank: index + 1,
  }));
}

/**
 * the evaluation of a position, from the side to move's point of view.
 */
function shit_1170_chess_score_for_side_fun(game: Chess): number {
  const evaluation = simple_evaluation_fun(game);
  return game.turn() === "w" ? evaluation : -evaluation;
}

/**
 * how many moves the api has for a game.
 *
 * the api's move history is empty when the indexer is behind, and
 * that is not an error — it just means the count is unknown.
 */
async function shit_1170_chess_moves_played_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
): Promise<number> {
  const history = await shit_1170_chess_api_position_history_fun(game_id);
  return history.length;
}
