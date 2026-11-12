// the game's state, as the skill reasons about it.
//
// --- WHY THERE IS A GAME MODEL AT ALL ---
// the chain answers questions about a game one at a time: the board,
// the info, the account. the skill needs all three at once, every time
// it decides what to do, and it needs them in one shape.
//
// so the reads are gathered into a `SHIT_1170_CHESS_GAME`, and every
// decision in the skill — whose turn it is, what move to make, what
// gas to attach — is made against that one object.

import {
  shit_1170_chess_account_fun,
  shit_1170_chess_board_fun,
  shit_1170_chess_game_info_fun,
} from "./chain";
import type {
  SHIT_1170_CHESS_ACCOUNT,
  SHIT_1170_CHESS_BOARD,
  SHIT_1170_CHESS_COLOR,
  SHIT_1170_CHESS_GAME_ID,
  SHIT_1170_CHESS_GAME_INFO,
  SHIT_1170_CHESS_PLAYER,
} from "./types";

/**
 * everything the skill knows about one game.
 */
export interface SHIT_1170_CHESS_GAME {
  game_id: SHIT_1170_CHESS_GAME_ID;
  info: SHIT_1170_CHESS_GAME_INFO;
  board: SHIT_1170_CHESS_BOARD;
}

/**
 * is this side the ai?
 */
export function shit_1170_chess_is_ai_fun(
  player: SHIT_1170_CHESS_PLAYER,
): boolean {
  return player.type === "Ai";
}

/**
 * the account id on one side of a game, or null for the ai.
 */
export function shit_1170_chess_player_account_fun(
  player: SHIT_1170_CHESS_PLAYER,
): string | null {
  return shit_1170_chess_is_ai_fun(player) ? null : player.value;
}

/**
 * which colour is this account playing?
 *
 * null when the account is in neither game — the game is not theirs.
 */
export function shit_1170_chess_color_of_fun(
  game: SHIT_1170_CHESS_GAME,
  account_id: string,
): SHIT_1170_CHESS_COLOR | null {
  if (game.info.white.type === "Human" && game.info.white.value === account_id) {
    return "White";
  }
  if (game.info.black.type === "Human" && game.info.black.value === account_id) {
    return "Black";
  }
  return null;
}

/**
 * is it this account's turn?
 *
 * the contract enforces it — `play_move` panics when it is not your
 * turn — so the skill checks it first and never sends a call that
 * would fail.
 */
export function shit_1170_chess_is_my_turn_fun(
  game: SHIT_1170_CHESS_GAME,
  account_id: string,
): boolean {
  return game.info.turn_color === shit_1170_chess_color_of_fun(game, account_id);
}

/**
 * the opponent of this account in this game.
 *
 * null when the opponent is the ai.
 */
export function shit_1170_chess_opponent_fun(
  game: SHIT_1170_CHESS_GAME,
  account_id: string,
): string | null {
  const color = shit_1170_chess_color_of_fun(game, account_id);
  if (color === null) return null;
  const other = color === "White" ? game.info.black : game.info.white;
  return shit_1170_chess_player_account_fun(other);
}

/**
 * the gas a move in this game needs, in Tgas.
 *
 * the gas follows the opponent:
 *   - the `Easy` ai needs 50
 *   - the `Medium` ai and a human game need 150
 *   - the `Hard` ai needs 250
 *   - the `VeryHard` ai needs 400
 *
 * a wrong gas is not a small thing: the first leg of the call can run
 * and the second not, so the move lands half-done.
 */
export function shit_1170_chess_move_gas_tgas_fun(
  game: SHIT_1170_CHESS_GAME,
  account_id: string,
): number {
  const color = shit_1170_chess_color_of_fun(game, account_id);
  if (color === null) return 150;

  const opponent = color === "White" ? game.info.black : game.info.white;
  if (!shit_1170_chess_is_ai_fun(opponent)) return 150;

  switch (opponent.value) {
    case "Easy":
      return 50;
    case "Hard":
      return 250;
    case "VeryHard":
      return 400;
    case "Medium":
    default:
      return 150;
  }
}

/**
 * read a game — its info and its board — off the chain.
 */
export async function shit_1170_chess_game_read_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<SHIT_1170_CHESS_GAME> {
  const [info, board] = await Promise.all([
    shit_1170_chess_game_info_fun(game_id, network),
    shit_1170_chess_board_fun(game_id, network),
  ]);
  return { game_id, info, board };
}

/**
 * read an account's rating.
 *
 * an account that is not registered has no rating, so the default of
 * 1000 is what the contract itself uses for an account it cannot
 * find.
 *
 * the name says "rating" and not "elo" because the chain's
 * `get_elo_ratings` is the LEADERBOARD, and this is one account's
 * number.
 */
export async function shit_1170_chess_account_rating_fun(
  account_id: string,
  network: "mainnet" | "testnet" = "mainnet",
): Promise<number> {
  const account: SHIT_1170_CHESS_ACCOUNT = await shit_1170_chess_account_fun(
    account_id,
    network,
  );
  return account.elo;
}
