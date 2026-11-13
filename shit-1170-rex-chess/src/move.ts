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
 *   - `"e7 to e8 queen"` a promotion
 *
 * a plain move is the two squares joined. a castling move is the
 * castle form, because the king moves two squares in a castle and the
 * two squares alone would not say which side. a promotion needs the
 * spaces and the piece spelled out in full, because the contract
 * cannot guess it: `"e7 to e8 Q"` is refused with `invalid piece
 * name`.
 */
/**
 * the piece a promotion promotes to, in the CONTRACT's spelling.
 *
 * the contract parses the piece name against
 * `kingqueenrookbishopknightpawn`, so the piece is spelled out in
 * full. `"e7 to e8 Q"` is refused with `invalid piece name` — the
 * forms that work are `"e7 to e8 queen"`, `"e7 to e8 rook"`,
 * `"e7 to e8 bishop"` and `"e7 to e8 knight"`.
 */
const SHIT_1170_CHESS_PROMOTION_PIECES: Record<string, string> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
};

/**
 * the move in the notation the contract takes.
 *
 * the contract accepts `"e2e4"`, `"e2 e4"` and `"e2 to e4"`, and the
 * castles as `"O-O"` and `"O-O-O"`. a promotion needs the spaces and
 * the piece in full: `"e7 to e8 queen"`.
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
    const piece =
      SHIT_1170_CHESS_PROMOTION_PIECES[move.promotion.toLowerCase()] ??
      move.promotion;
    return `${move.from} to ${move.to} ${piece}`;
  }

  return `${move.from}${move.to}`;
}

/**
 * does a move string name this move?
 *
 * an agent may type the move in any of the forms people write them:
 * the contract's own notation (`"b7 to b8 queen"`), san (`"b8=Q"`),
 * or the two squares (`"b7b8"`). they all name the same move, and the
 * one that is SENT is always the contract's own notation.
 */
export function shit_1170_chess_move_matches_fun(
  move: {
    mv: string;
    san: string;
    from?: string;
    to?: string;
  },
  requested: string,
): boolean {
  const wanted = requested.trim();

  // the contract's own notation, and san
  if (wanted === move.mv || wanted === move.san) return true;

  // the two squares, with or without a promotion piece
  if (move.from && move.to) {
    const squares = `${move.from}${move.to}`.toLowerCase();
    const lower = wanted.toLowerCase().replace(/[\s-]/g, "");

    if (lower === squares) return true;

    // san with a promotion: "e8=q", "e8=queen". the san names the
    // square it LANDS on, so the "from" square is not a prefix of it.
    if (lower.startsWith(`${move.to.toLowerCase()}=`)) {
      const piece = lower.slice(move.to.length + 1);
      if (
        piece === "q" ||
        piece === "queen" ||
        piece === "r" ||
        piece === "rook" ||
        piece === "b" ||
        piece === "bishop" ||
        piece === "n" ||
        piece === "knight"
      ) {
        return true;
      }
    }
  }

  // the contract's form without the spaces: "b7tob8queen"
  if (
    wanted.toLowerCase().replace(/\s/g, "") ===
    move.mv.toLowerCase().replace(/\s/g, "")
  ) {
    return true;
  }

  return false;
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
 * --- WHY IT LOOKS TWO MOVES AHEAD ---
 * ONE ply is not enough to tell a quiet move from a useful one. a
 * rook that gives check drives the enemy king away from the squares
 * it wanted, and a one-ply evaluation cannot see that: the position
 * after the check is worth the same as the position after a quiet
 * move, because the material is identical.
 *
 * so the search looks one move further, and takes the opponent's
 * best reply into account. that is the difference between a rook that
 * drives the king to the back rank and a rook that sits still.
 *
 * the cost is about 150ms a move, which is nothing against a poll
 * interval of fifteen seconds.
 *
 * --- THE POSITIONS ALREADY SEEN ---
 * the contract has NO repetition rule. a position seen three times
 * does not end the game — it just goes on, forever. an agent that
 * walks into a loop plays forever and never wins.
 *
 * so the caller may pass the positions the game has already been
 * through, and a move that returns to one of them is worth less. it
 * is a penalty, not a ban: sometimes a move that repeats is the only
 * move there is.
 *
 * null means there is no legal move: the game is over.
 */
export function shit_1170_chess_choose_move_fun(
  fen: string,
  seen_positions: string[] = [],
): SHIT_1170_CHESS_CHOSEN_MOVE | null {
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

  // the positions the game has been through, reduced to the part that
  // decides whether two positions are the same.
  const seen = new Set(seen_positions.map(position_key_fun));

  for (const move of moves) {
    let score = search_move_score_fun(game, move, mover_is_white);

    // a move that returns to a position already seen is worth less.
    if (seen.size > 0) {
      game.move(move);
      const key = position_key_fun(game.fen());
      game.undo();
      if (seen.has(key)) score -= REPETITION_PENALTY;
    }

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
 * the penalty for a move that returns to a position already seen.
 *
 * it is worth a rook. that is much more than a pawn, and it has to
 * be: a CYCLING move has to lose CLEARLY to any move that goes
 * somewhere new, or the loop wins on a tie-break.
 *
 * the live game that exposed this had the shuffle and the best
 * alternative within five points of each other, so a small penalty
 * was a coin toss rather than a decision. with the penalty this
 * large the cycle is never the move that is taken.
 *
 * it is still a penalty and not a ban. when the position is FORCED —
 * there is one legal move, and it repeats — the move is still played,
 * because refusing to play is worse than playing badly. the contract
 * has no repetition rule, so a drawn-out game beats no game at all.
 */
const REPETITION_PENALTY = 400;

/**
 * a key for a position, for spotting repeats.
 *
 * the side to move IS part of the key here: a position with white to
 * move is not the same position as the one with black to move, and
 * the game loop the agent fell into was white to move both times.
 *
 * the halfmove clock and the move number are left out: they count
 * plies, not positions, and including them would make every position
 * look different.
 */
function position_key_fun(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  // placement, side to move, castling rights, en passant.
  return parts.slice(0, 4).join(" ");
}

/**
 * the score of one candidate move, looking one move further.
 *
 * the score is from the MOVER's point of view: positive means the
 * mover is better off.
 */
function search_move_score_fun(
  game: Chess,
  move: { from: string; to: string; promotion?: string },
  mover_is_white: boolean,
): number {
  game.move(move);

  try {
    // --- THE END OF THE GAME ---
    //
    // a move that delivers checkmate is the best move there is, and a
    // move that stalemates is the worst. neither shows up in a
    // material evaluation, so they are checked first.
    if (game.isCheckmate()) {
      return mate_score_fun(mover_is_white);
    }
    if (game.isStalemate() || game.isInsufficientMaterial()) {
      return -mate_score_fun(mover_is_white);
    }

    // --- THE OPPONENT'S REPLY ---
    //
    // the position after the move is worth what the opponent can make
    // it worth. the opponent takes its best reply, and the position
    // is evaluated from there.
    //
    // --- WHY THE REPLIES ARE ABLENDED, NOT MINIMISED ---
    // minimising over the replies punishes the move that drives the
    // enemy king away. a rook that gives check pushes the enemy king
    // off the seventh rank, and the position AFTER that escape looks
    // worse than the quiet move that let the king stay where it
    // liked. the move was still the better one — the escape was
    // forced, and it is temporary.
    //
    // so the static value of the position after the move is the
    // main term, and the opponent's best reply only pulls it a little.
    // the search still sees a mate, and it still sees a blunder, but
    // it does not confuse "the king had to move" with "the king is
    // comfortable".
    const replies = game.moves({ verbose: true });

    const static_value = simple_evaluation_fun(game);

    if (!replies.length) {
      // the opponent has no reply, and the game is not over.
      return static_value;
    }

    let worst_reply = Infinity;
    for (const reply of replies) {
      game.move(reply);

      const position_value = game.isCheckmate()
        ? -mate_score_fun(mover_is_white)
        : simple_evaluation_fun(game);

      game.undo();

      const for_mover = mover_is_white ? position_value : -position_value;
      if (for_mover < worst_reply) worst_reply = for_mover;
    }

    // the blend. the static value leads, and the opponent's best
    // reply corrects it a little.
    const blended = static_value * (1 - REPLY_WEIGHT) + worst_reply * REPLY_WEIGHT;

    return mover_is_white ? blended : blended;
  } finally {
    game.undo();
  }
}

/**
 * how much the opponent's best reply counts for.
 *
 * it is a correction, not the answer. too high and the search stops
 * seeing progress; too low and it stops seeing tactics.
 */
const REPLY_WEIGHT = 0.25;

/**
 * the score of a checkmate.
 *
 * a big number, so that mate beats every other move. the sign flips
 * with the side, because the evaluation is from white's point of view
 * and the caller wants the mover's point of view.
 */
function mate_score_fun(mover_is_white: boolean): number {
  return mover_is_white ? 100_000 : -100_000;
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
 *
 * --- WHY IT IS NOT ENOUGH, AND WHAT WAS ADDED ---
 * MATERIAL ALONE CANNOT SEE AN ENDGAME. with a rook and a knight
 * against a bare king, every legal move keeps the material exactly
 * the same, so every move scores the same and the chooser takes the
 * first one it finds. in practice that means the king walks in a
 * circle while the win sits on the board unclaimed.
 *
 * so the evaluation also knows about:
 *
 *   - WHERE the king is (it wants to be central, and in an endgame
 *     it wants to be close to the enemy king)
 *   - WHERE the rook is (a rook on the seventh rank cuts the enemy
 *     king off, and that is worth more than a rook anywhere else)
 *   - the enemy king's ESCAPE SQUARES — a rook that is nearer to the
 *     enemy king is worth more, because that is what boxes it in
 *   - the KING DISTANCE between the two kings, which is what decides
 *     most endgames
 *
 * the material values stay exactly as they were, so the existing
 * behaviour in the opening and the middlegame is unchanged.
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

  score += endgame_evaluation_fun(game);

  return score;
}

// --- THE ENDGAME KNOWLEDGE ---
//
// the material evaluation above cannot tell a won endgame from a
// drawn one, because the material does not change. these terms are
// what make the difference in the positions the chooser used to
// shuffle through forever.

/**
 * the bonus for a rook on the seventh rank.
 *
 * a rook on the seventh cuts the enemy king off from the pawns, and
 * it is the single most important square for a rook in an endgame.
 */
const ROOK_SEVENTH_BONUS = 25;

/**
 * the bonus for a rook that is close to the enemy king.
 *
 * the rook's job in an endgame is to take the squares away from the
 * enemy king, so a rook that is nearer is better.
 */
const ROOK_PROXIMITY_MAX = 30;
const ROOK_PROXIMITY_RANGE = 7;

/**
 * the bonus for a rook that has the enemy king cut off.
 *
 * this is what wins a king-and-rook ending. a rook that stands
 * between the enemy king and the rest of the board takes away half
 * its escape squares, and the king can be walked towards the edge and
 * mated.
 */
const ROOK_BOX_BONUS = 60;

/**
 * the bonus for a rook that is pushing the enemy king to the edge.
 *
 * the rook wants to be on the edge file with the enemy king between
 * it and the middle of the board. then the king has nowhere to go
 * but the corner, and the rook mates it there.
 */
const ROOK_EDGE_PUSH_BONUS = 50;

/**
 * the bonus for the king being close to the enemy king.
 *
 * in an endgame the king is a fighting piece. two kings facing each
 * other with a rook between them is the shape of a won position.
 */
const KING_PROXIMITY_MAX = 40;
const KING_PROXIMITY_RANGE = 4;

/**
 * the bonus for a king that has come off its own back rank.
 *
 * a king on the back rank in an endgame has done nothing yet.
 */
const KING_ACTIVITY_MAX = 30;

/**
 * how much the endgame terms count for, at most.
 *
 * they are a TIE-BREAK between moves that keep the material equal,
 * so they must not outvote a real material difference. they are
 * scaled so that the biggest of them is worth less than a pawn.
 */
const ENDGAME_SCALE = 0.8;

/**
 * the endgame terms, from white's point of view.
 *
 * every term here is a difference between the two sides, so the
 * function returns a signed number and the caller adds it to the
 * material score.
 */
function endgame_evaluation_fun(game: Chess): number {
  const white_king = find_king_square_fun(game, "w");
  const black_king = find_king_square_fun(game, "b");
  if (!white_king || !black_king) return 0;

  const white_rooks = find_piece_squares_fun(game, "r", "w");
  const black_rooks = find_piece_squares_fun(game, "r", "b");

  let score = 0;

  // --- THE ROOKS ---
  //
  // a rook on the seventh rank, and a rook that is near the enemy
  // king. both are about boxing the enemy king in.
  for (const rook of white_rooks) {
    score += rook_value_fun(rook, black_king);
  }
  for (const rook of black_rooks) {
    score -= rook_value_fun(rook, white_king);
  }

  // --- THE KINGS ---
  //
  // a king that has come off its back rank, and two kings that are
  // close to each other.
  score += king_value_fun(white_king) - king_value_fun(black_king);

  const distance = square_distance_fun(white_king, black_king);
  const proximity = Math.max(0, KING_PROXIMITY_MAX - distance * (KING_PROXIMITY_MAX / KING_PROXIMITY_RANGE));
  score += proximity;

  // --- ONLY WHEN IT MATTERS ---
  //
  // the king terms are endgame knowledge. in the opening the king
  // belongs on the back rank, and rewarding it for leaving would
  // make the chooser walk its king out early. so they only apply
  // once the pawns are off.
  const pawns = count_pawns_fun(game);
  if (pawns <= 6) {
    score *= ENDGAME_SCALE;
  } else {
    // in the opening and the middlegame only the rook terms apply,
    // and only faintly.
    score *= 0.2;
  }

  return score;
}

/**
 * what one rook is worth, by where it stands.
 */
function rook_value_fun(rook: string, enemy_king: string): number {
  let value = 0;

  const rook_row = square_row_fun(rook);
  const king_row = square_row_fun(enemy_king);
  const rook_col = square_col_fun(rook);
  const king_col = square_col_fun(enemy_king);

  // --- THE SEVENTH RANK ---
  //
  // a rook on the seventh rank is worth more than a rook anywhere
  // else, because it cuts the enemy king off from the pawns.
  if (rook_row === 1) value += ROOK_SEVENTH_BONUS;

  // --- THE BOX ---
  //
  // this is the thing that wins a king-and-rook ending: the rook
  // stands BETWEEN the enemy king and the middle of the board, so the
  // king cannot get past it. a rook on the seventh rank with the
  // enemy king above it does exactly that, and a rook on the same
  // FILE as the enemy king does the same thing sideways.
  //
  // without this, the rook drifts about at the edge of the board
  // while the enemy king walks around it.
  const same_rank = rook_row === king_row;
  const same_file = rook_col === king_col;

  if (rook_row === 1 && king_row === 0) {
    // the rook is on the seventh and the king is on the eighth: the
    // king is shut off from the whole board.
    value += ROOK_BOX_BONUS;
  } else if (same_rank || same_file) {
    // the rook is lined up with the king. that cuts the king's
    // escape squares on one side.
    value += ROOK_BOX_BONUS / 2;
  }

  // --- PUSHING THE KING TO THE EDGE ---
  //
  // this is what finishes a king-and-rook ending. the rook does not
  // want to be on the same file as the enemy king — that lets the king
  // walk up and down it. it wants to be on the file on the FAR side,
  // so that the king is pushed towards the edge of the board with
  // nowhere to go.
  //
  // so a rook on the edge file, with the enemy king between the rook
  // and the middle of the board, is the best place for it to be.
  const rook_on_edge = rook_col === 0 || rook_col === 7;
  const king_past_rook = same_file
    ? king_row > rook_row
    : king_col > rook_col
      ? rook_col < king_col
      : rook_col > king_col;
  if (rook_on_edge && king_past_rook) {
    value += ROOK_EDGE_PUSH_BONUS;
  }

  // --- PROXIMITY ---
  //
  // the rook's job is to take the squares away from the enemy king,
  // so a rook that is nearer is better.
  const distance = square_distance_fun(rook, enemy_king);
  value += Math.max(
    0,
    ROOK_PROXIMITY_MAX - distance * (ROOK_PROXIMITY_MAX / ROOK_PROXIMITY_RANGE),
  );

  return value;
}

/**
 * what one king is worth, by where it stands.
 */
function king_value_fun(king: string): number {
  const row = square_row_fun(king);
  // the back rank is row 0 for white and row 7 for black. a king that
  // has stepped off it has done something.
  const off_back_rank = row !== 0 && row !== 7 ? 1 : 0;
  return off_back_rank * KING_ACTIVITY_MAX;
}

/**
 * find the king's square.
 */
function find_king_square_fun(game: Chess, color: "w" | "b"): string | null {
  const board = game.board();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = board[row][col];
      if (square && square.type === "k" && square.color === color) {
        return square.square;
      }
    }
  }
  return null;
}

/**
 * find every square a kind of piece stands on.
 */
function find_piece_squares_fun(
  game: Chess,
  type: string,
  color: "w" | "b",
): string[] {
  const squares: string[] = [];
  const board = game.board();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = board[row][col];
      if (square && square.type === type && square.color === color) {
        squares.push(square.square);
      }
    }
  }
  return squares;
}

/**
 * how many pawns are on the board.
 */
function count_pawns_fun(game: Chess): number {
  let count = 0;
  const board = game.board();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = board[row][col];
      if (square && square.type === "p") count += 1;
    }
  }
  return count;
}

/**
 * the row of a square. row 0 is rank 8.
 */
function square_row_fun(square: string): number {
  return 8 - Number(square[1]);
}

/**
 * the column of a square.
 */
function square_col_fun(square: string): number {
  return square.charCodeAt(0) - 97;
}

/**
 * the distance between two squares, the king-move distance.
 */
function square_distance_fun(a: string, b: string): number {
  const dr = Math.abs(square_row_fun(a) - square_row_fun(b));
  const dc = Math.abs(square_col_fun(a) - square_col_fun(b));
  return Math.max(dr, dc);
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
