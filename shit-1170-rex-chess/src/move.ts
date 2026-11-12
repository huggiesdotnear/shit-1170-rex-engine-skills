// choosing a move.
//
// --- WHY chess.js AND NOT THE MODEL'S OWN JUDGEMENT ---
// the contract validates the move, and a move it rejects is a failed
// transaction that still costs gas. so the skill must send a LEGAL
// move, every time.
//
// `chess.js` is the library that guarantees it: it takes a position
// and answers with the legal moves, already filtered for check,
// stalemate and the rest. the model is not a chess engine, and a
// model asked to pick a move will sometimes pick an illegal one.
//
// --- WHY THE POSITION COMES FROM THE API, NOT THE BOARD ---
// `chess.js` needs a position as a FEN. the chain answers with eight
// rank strings, which is not a FEN — it has no side to move, no castling
// rights, no en-passant square and no halfmove clock.
//
// the protocol pawns api's `GET /game/{game_id}/moves` answers with the
// FEN of every position in the game, so the daemon reads the position
// from there.
//
// --- WHY A FEN BUILDER IS HERE AS WELL ---
// a FEN from the api's move history is the position AFTER the last
// move. the chain's board is the CURRENT position. when the two are
// needed together, the board is turned into a FEN by hand — the four
// missing fields are filled from the game info.
//
// the side to move comes from `game_info.turn_color`, the castling
// rights are derived from the board, and the en-passant square and the
// clocks are left at their defaults, which is right for a position
// that is not being searched deeply.

import { Chess } from "chess.js";

import type {
  SHIT_1170_CHESS_BOARD,
  SHIT_1170_CHESS_GAME_ID,
  SHIT_1170_CHESS_GAME_INFO,
} from "./types";
import type { SHIT_1170_CHESS_GAME } from "./game";

// --- THE FEN ---
//
// --- WHY THE FEN COMES FROM THE API, NOT FROM THE BOARD ---
// a FEN carries six fields: the placement, the side to move, the
// CASTLING RIGHTS, the en-passant square and the two clocks.
//
// the chain's `get_board` gives only the placement. the side to move
// comes from `game_info.turn_color`, but the castling rights CANNOT be
// derived from the board: the contract keeps them as state, because a
// king or a rook that has moved loses its rights even if it comes
// back to its home square.
//
// so the position comes from the protocol pawns api's
// `GET /game/{game_id}/moves`, which answers with the FEN of every
// position in the game — the last one being the current position.
//
// `shit_1170_chess_board_to_fen_fun` is the FALLBACK, for when the api
// is not reachable. it derives the rights from the board, which is
// right when neither the king nor the rooks have moved and wrong when
// they have. the fallback says so in the docs, and the chooser works
// either way — a wrong castling right can cost a castling opportunity,
// and a wrong castling move is rejected by the contract.
//
// --- THE ROW ORDER, AND WHY IT IS BACKWARDS ---
// the contract's `get_board` answers with eight rank strings where
// **row 0 is RANK 1** — white's back rank — and row 7 is rank 8,
// black's back rank.
//
// a FEN's piece placement is the OTHER way round: it starts at rank 8
// and walks down to rank 1.
//
// so the rows are REVERSED on the way into the FEN. a board that came
// out the other way is a legal-looking position, so chess.js accepts
// it and the chooser plays a completely different game — with the
// colours swapped. the test for a live game's board catches it,
// because the starting position is symmetric and hides the mistake
// while a real position does not.
//
// the tool box's docs and the upstream skill both say "row 0 is rank
// 8". the live contract and the protocol pawns api both say rank 1,
// and they agree with each other, so the live behaviour wins.

// --- THE MOVE ---

/**
 * a move the chooser picked.
 */
export interface SHIT_1170_CHESS_CHOSEN_MOVE {
  /** the move in the contract's coordinate notation. */
  mv: string;
  /** the move's san, for the log and for a human to read. */
  san: string;
  /** the from square, e.g. `"e2"`. */
  from: string;
  /** the to square, e.g. `"e4"`. */
  to: string;
  /** the promotion piece, when the move is a promotion. */
  promotion?: string;
}

// --- THE BOARD-DERIVED FEN, THE FALLBACK ---

/**
 * the contract's piece letters, and the FEN letters they become.
 *
 * the contract uses UPPERCASE for white and lowercase for black, and
 * the FEN uses the SAME convention. so the mapping is the identity,
 * and it is written out rather than assumed, because getting it
 * backwards turns white's pieces into black's.
 */
const FEN_PIECES: Record<string, string> = {
  K: "K",
  Q: "Q",
  R: "R",
  B: "B",
  N: "N",
  P: "P",
  k: "k",
  q: "q",
  r: "r",
  b: "b",
  n: "n",
  p: "p",
};

/**
 * the board the contract answers, as a FEN's piece placement.
 *
 * the rows are REVERSED on the way in, because the contract's row 0 is
 * rank 1 and a FEN starts at rank 8.
 */
export function shit_1170_chess_board_to_placement_fun(
  board: SHIT_1170_CHESS_BOARD,
): string {
  return [...board]
    .reverse()
    .map((rank) => {
      let out = "";
      let empty = 0;
      for (const piece of rank) {
        if (piece === " ") {
          empty += 1;
          continue;
        }
        if (empty > 0) {
          out += String(empty);
          empty = 0;
        }
        out += FEN_PIECES[piece] ?? "?";
      }
      if (empty > 0) out += String(empty);
      return out;
    })
    .join("/");
}

/**
 * the castling rights of a position, derived from the board.
 *
 * a right exists when the king AND the rook are on their home squares.
 * the board's row 0 is RANK 1, so white's back rank is row 0 and
 * black's back rank is row 7.
 *
 * the order is the FEN's order: `K`, `Q`, `k`, `q`.
 *
 * --- WHY THIS IS ONLY A FALLBACK ---
 * the contract keeps the castling rights as STATE. a king or a rook
 * that has moved loses its rights even if it comes back to its home
 * square, so the rights cannot be read off the board.
 *
 * so this derivation is right only in a game where nothing has moved
 * off its home square. that is why the api's fen is the primary
 * source and this is the fallback.
 */
export function shit_1170_chess_castling_rights_fun(
  board: SHIT_1170_CHESS_BOARD,
): string {
  const rank1 = board[0] ?? "        ";
  const rank8 = board[7] ?? "        ";

  let rights = "";
  if (rank1[4] === "K" && rank1[7] === "R") rights += "K";
  if (rank1[4] === "K" && rank1[0] === "R") rights += "Q";
  if (rank8[4] === "k" && rank8[7] === "r") rights += "k";
  if (rank8[4] === "k" && rank8[0] === "r") rights += "q";
  return rights === "" ? "-" : rights;
}

/**
 * a FEN built from the chain's board alone.
 *
 * THE FALLBACK. the api's fen is better, because it carries the real
 * castling rights. this one derives them from the board, which is
 * right only when nothing has moved off its home square.
 */
export function shit_1170_chess_board_to_fen_fun(
  board: SHIT_1170_CHESS_BOARD,
  info: SHIT_1170_CHESS_GAME_INFO,
): string {
  const side = info.turn_color === "White" ? "w" : "b";
  return [
    shit_1170_chess_board_to_placement_fun(board),
    side,
    shit_1170_chess_castling_rights_fun(board),
    "-",
    "0",
    "1",
  ].join(" ");
}

/**
 * the contract's notation for a move.
 *
 * COORDINATE NOTATION, not san. the contract accepts:
 *   - `"e2e4"`     compact
 *   - `"e2 e4"`    separated
 *   - `"e2 to e4"` explicit
 *   - `"O-O"`      kingside castle
 *   - `"O-O-O"`    queenside castle
 *   - `"e7 to e8 Q"` a promotion
 *
 * a plain move is the two squares joined. a castling move is the
 * castle form, because the king moves two squares in a castle and the
 * two squares alone would not say which side. a promotion needs the
 * piece, because the contract cannot guess it.
 */
export function shit_1170_chess_move_notation_fun(move: {
  from: string;
  to: string;
  flags: string;
  promotion?: string;
}): string {
  const isKingSideCastle = move.flags.includes("k");
  const isQueenSideCastle = move.flags.includes("q");

  if (isKingSideCastle) return "O-O";
  if (isQueenSideCastle) return "O-O-O";

  if (move.promotion) {
    return `${move.from} to ${move.to} ${move.promotion.toUpperCase()}`;
  }

  return `${move.from}${move.to}`;
}

/**
 * the legal moves of a position.
 *
 * the empty array means the game is over — checkmate, stalemate, or a
 * position with no legal move at all.
 */
export function shit_1170_chess_legal_moves_fun(fen: string): string[] {
  const game = new Chess(fen);
  return game.moves({ verbose: true }).map((move) =>
    shit_1170_chess_move_notation_fun(move),
  );
}

/**
 * pick a move for a position.
 *
 * the position is a FEN. the returned move is legal by construction —
 * it came out of the legal move list — and it is in the contract's
 * notation.
 *
 * the search is a shallow one: every legal move is tried, the position
 * is evaluated, and the best is taken. a full search would be better
 * chess, and it would also cost far more time per move, and the point
 * of this skill is a playing agent rather than a strong one.
 *
 * null means there is no legal move: the game is over.
 */
export function shit_1170_chess_choose_move_fun(fen: string): SHIT_1170_CHESS_CHOSEN_MOVE | null {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  let best = moves[0];
  let best_score = -Infinity;

  // the evaluation is from WHITE's point of view, but the side that
  // just moved is not always white. so the score is flipped for the
  // side to move's benefit, and the mover's score is positive when
  // the mover is ahead.
  //
  // WITHOUT THIS FLIP the chooser plays black as if it were white:
  // it looks for the move that leaves the position best for WHITE,
  // which for black means the worst possible move. the first version
  // of this had the bug, and a test caught it.
  const mover_is_white = game.turn() === "w";

  for (const move of moves) {
    game.move(move);
    const evaluation = simple_evaluation_fun(game);
    // a positive score is good for the player who just moved.
    const score = mover_is_white ? evaluation : -evaluation;
    game.undo();

    // a tie is broken towards the move that comes first, so the choice
    // is stable between runs.
    if (score > best_score) {
      best_score = score;
      best = move;
    }
  }

  return {
    mv: shit_1170_chess_move_notation_fun(best),
    san: best.san,
    from: best.from,
    to: best.to,
    ...(best.promotion ? { promotion: best.promotion } : {}),
  };
}

/**
 * a material-and-position evaluation, from white's point of view.
 *
 * the piece values are the usual ones. the positional part is small:
 * a pawn is worth a little more in the centre, and a bishop is worth a
 * little more on a long diagonal.
 *
 * this is not a strong evaluation and it is not trying to be. it is
 * enough to tell a queen capture from a pawn push, which is what a
 * shallow search needs to be worth running.
 */
export function simple_evaluation_fun(game: Chess): number {
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

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = board[row][col];
      if (!square) continue;

      const value = values[square.type] ?? 0;
      // the centre squares are worth a little more for a pawn and a
      // bishop. rank 0 is rank 8, so the centre is rows 2..5 and
      // columns 2..5.
      const in_center = row >= 2 && row <= 5 && col >= 2 && col <= 5;
      const positional = square.type === "p" && in_center ? 12 : 0;

      if (square.color === "w") {
        score += value + positional;
      } else {
        score -= value + positional;
      }
    }
  }

  return score;
}

/**
 * pick a move for a position.
 *
 * THE PRIMARY ENTRY POINT. the caller has a FEN — from the api, which
 * is where the real castling rights live — and this answers with a
 * legal move.
 */
export function shit_1170_chess_choose_move_for_fen_fun(
  fen: string,
): SHIT_1170_CHESS_CHOSEN_MOVE | null {
  return shit_1170_chess_choose_move_fun(fen);
}

/**
 * pick a move for a game the skill holds, from its board.
 *
 * THE FALLBACK path, for when the api's fen is not available. the
 * castling rights are derived from the board, which is right only when
 * nothing has moved off its home square.
 */
export function shit_1170_chess_choose_move_for_game_fun(
  game: SHIT_1170_CHESS_GAME,
): SHIT_1170_CHESS_CHOSEN_MOVE | null {
  const fen = shit_1170_chess_board_to_fen_fun(game.board, game.info);
  return shit_1170_chess_choose_move_fun(fen);
}
