// the protocol pawns api — the indexed view of the chess contract.
//
// --- WHY THE API AND NOT THE CHAIN ---
// the chain is the source of truth for the game. the api is an INDEX
// of it, and it answers two questions the chain answers badly:
//
//   1. the FEN of a position, with the REAL castling rights. the
//      chain's `get_board` gives only the placement, and the castling
//      rights are STATE on the contract — a king that has moved loses
//      its rights even if it returns home — so they cannot be derived
//      from the board.
//   2. the open challenges, across the whole platform. the chain's
//      `get_challenges` answers for ONE account at a time.
//
// the api has no auth, and it cannot play a move or place a bet.
//
// --- THE `/info` ENDPOINT IS BROKEN ---
// `GET /info` answers `COALESCE types text and integer cannot be
// matched` — a server-side type error. nothing in this skill depends
// on it.

import {
  api_protocol_pawns_account_query,
  api_protocol_pawns_challenges,
  api_protocol_pawns_game_moves,
  api_protocol_pawns_leaderboard_elo,
} from "@sleet-js/middleman-protocol-pawns-api";
import { quiet_fun } from "@huggies/shit-1170-rex-engine-middleman";

import type { SHIT_1170_CHESS_GAME_ID } from "./types";

// --- WHY THE CALLS ARE QUIETED ---
// the middleman logs every request and every response with
// `console.log`. that is right for a script a human watches, and
// wrong for a bin, because the bin's stdout IS the answer — a log line
// in the middle of the json makes the output unparseable.
//
// `quiet_fun` swallows the log and returns the value.

/**
 * the current position of a game, as a FEN.
 *
 * the api's move history carries the FEN of every position, and the
 * last one is the current position.
 *
 * null when the api has no moves for the game yet — a game that was
 * created and never played. the caller then falls back to the board.
 */
export async function shit_1170_chess_api_position_fen_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
): Promise<string | null> {
  try {
    const moves = await quiet_fun(() =>
      api_protocol_pawns_game_moves({
        game_id: game_id as unknown as [number, string, string | null],
      }),
    );

    if (!Array.isArray(moves) || moves.length === 0) return null;

    const last = moves[moves.length - 1] as { fen?: string };
    return typeof last.fen === "string" ? last.fen : null;
  } catch {
    // the api is an index. it can lag behind the chain, and it can be
    // down. neither is a reason to refuse the work — the caller falls
    // back to the board.
    return null;
  }
}

/**
 * the open challenges on the platform.
 */
export async function shit_1170_chess_api_challenges_fun(
  limit = 25,
): Promise<unknown[]> {
  const page = await quiet_fun(() =>
    api_protocol_pawns_challenges({ limit }),
  );
  return (page as { items?: unknown[] }).items ?? [];
}

/**
 * the elo leaderboard, SORTED.
 *
 * the contract's own `get_elo_ratings` answers in STORAGE ORDER, so
 * the api is the ranked list. every entry carries the rank, the
 * rating, the points and the win/loss/draw record.
 */
export async function shit_1170_chess_api_leaderboard_fun(
  page = 1,
  per_page = 25,
): Promise<{
  total: number;
  entries: {
    rank: number;
    account_id: string;
    elo: number;
    ppp: string;
    wins: number;
    losses: number;
    draws: number;
    total_games: number;
  }[];
}> {
  const result = await quiet_fun(() =>
    api_protocol_pawns_leaderboard_elo({ page, per_page, dir: "desc" }),
  );
  return result as unknown as {
    total: number;
    entries: {
      rank: number;
      account_id: string;
      elo: number;
      ppp: string;
      wins: number;
      losses: number;
      draws: number;
      total_games: number;
    }[];
  };
}

/**
 * search the registered accounts by name prefix.
 *
 * this is how an agent picks a SPECIFIC opponent, as opposed to
 * letting the contract's matchmaking pick one.
 *
 * the api's `elo` is nullable — an account that has not played has no
 * rating yet — so the answer keeps it as it comes.
 */
export async function shit_1170_chess_api_account_search_fun(
  query: string,
): Promise<
  {
    account_id: string;
    wins: number;
    losses: number;
    draws: number;
    total_games: number;
    elo: number | null;
  }[]
> {
  return quiet_fun(() => api_protocol_pawns_account_query({ query }));
}
