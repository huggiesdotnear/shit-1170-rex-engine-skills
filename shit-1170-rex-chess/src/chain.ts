// the chain reads this skill needs.
//
// --- THE ARCHITECTURE ---
// the agent NEVER calls a contract in propose mode. every
// state-changing call is queued in the shit-1170 rex engine as a
// generic function call, and a HUMAN signs it in the web app with
// their wallet. so the only chain access in propose mode is VIEW
// reads.
//
// AUTONOMOUS MODE IS THE EXCEPTION, and it lives in `signer.ts`, not
// here. this module stays read-only.
//
// these reads go through the near-kit tool box:
//   `@near-kit-tool-box/fun` — typed helpers, Zod-validated answers
//
// the client is built here rather than taken from the env package,
// because the env package defaults to testnet and this skill's
// contract is MAINNET ONLY — there is no testnet deployment of
// `app.chess-game.near` at all. `new Near({ network })` says what we
// mean.
//
// near-kit builds the json-rpc request correctly: the parameters are
// a json OBJECT with a `request_type` field, never the array shape
// `params: [ { ... } ]` that the rpc answers with "expected struct
// RpcQueryRequest" and nothing else.

import { Near } from "near-kit";
import {
  chess_game_get_account_fun_json,
  chess_game_get_accounts_fun_json,
  chess_game_get_board_fun_json,
  chess_game_get_elo_ratings_by_ids_fun_json,
  chess_game_get_elo_ratings_fun_json,
  chess_game_game_info_fun_json,
  chess_game_get_game_ids_fun_json,
  chess_game_render_board_fun_json,
  generic_contract_view_fun_json,
} from "@near-kit-tool-box/fun";

import type {
  SHIT_1170_CHESS_ACCOUNT,
  SHIT_1170_CHESS_BOARD,
  SHIT_1170_CHESS_GAME_ID,
  SHIT_1170_CHESS_GAME_INFO,
} from "./types";

// the contract this skill plays on.
//
// MAINNET ONLY. there is no testnet deployment, so the id is the same
// on both networks and `--network testnet` is refused by the bins
// rather than silently pointed at nothing.
export const SHIT_1170_CHESS_CONTRACT_ID = "app.chess-game.near";

export type SHIT_1170_NETWORK = "mainnet" | "testnet";

/**
 * the network a flag named.
 *
 * anything that is not "testnet" is mainnet — the skill defaults to
 * mainnet because the chess contract lives there and nowhere else.
 */
export function shit_1170_network_fun(
  network: string | undefined,
): SHIT_1170_NETWORK {
  return network === "testnet" ? "testnet" : "mainnet";
}

/**
 * the contract id for a network.
 *
 * the chess contract is mainnet only, so both networks give the same
 * id — but the bins still refuse testnet, because a testnet call
 * against a mainnet contract id is a call into nothing.
 */
export function shit_1170_chess_contract_id_fun(
  network: SHIT_1170_NETWORK = "mainnet",
): string {
  return SHIT_1170_CHESS_CONTRACT_ID;
}

/**
 * a NEAR client for one network.
 *
 * the client is read-only here: it has no signer and no private key,
 * so it can only answer views.
 */
export function shit_1170_near_client_fun(
  network: SHIT_1170_NETWORK = "mainnet"): Near {
  return new Near({ network });
}

// --- THE MISSING-METHOD QUESTION ---
//
// a probe that fails because the ARGUMENTS were wrong still proves
// the method exists: the contract resolved it and ran it. only a
// method the contract does not have at all means the method is
// missing.
//
//   missing:   "wasm execution failed with error: MethodResolveError(MethodNotFound)"
//   wrong args: "HostError(GuestPanic { panic_msg: "Failed to deserialize
//                input from JSON..." })"
const SHIT_1170_METHOD_MISSING = /MethodNotFound|MethodResolveError/i;

/**
 * a view call that ran and failed.
 *
 * `missing` is true only when the contract does not have the method
 * at all. a call that failed because the ARGUMENTS were wrong is NOT
 * missing: the method resolved and ran, so it exists.
 */
export class SHIT_1170_VIEW_CALL_ERROR extends Error {
  readonly missing: boolean;

  constructor(message: string, missing: boolean) {
    super(message);
    this.name = "SHIT_1170_VIEW_CALL_ERROR";
    this.missing = missing;
  }
}

function shit_1170_error_message_fun(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * a view call, with the args written as json for you.
 *
 * the escape hatch for the views that have no dedicated tool box
 * helper. the helpers are the stronger evidence — they prove the
 * argument shape — so they are used wherever they exist.
 */
export async function shit_1170_view_fun<T>(
  network: SHIT_1170_NETWORK,
  contract_id: string,
  method_name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await generic_contract_view_fun_json<T>(
      shit_1170_near_client_fun(network),
      contract_id,
      method_name,
      args,
    );
  } catch (error) {
    const message = shit_1170_error_message_fun(error);
    throw new SHIT_1170_VIEW_CALL_ERROR(
      message,
      SHIT_1170_METHOD_MISSING.test(message),
    );
  }
}

// --- THE READS ---

/**
 * the board of a game.
 *
 * eight strings, one per rank. row 0 is rank 8 and row 7 is rank 1.
 */
export async function shit_1170_chess_board_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<SHIT_1170_CHESS_BOARD> {
  return chess_game_get_board_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    game_id,
  );
}

/**
 * the board, drawn.
 *
 * the contract's own `render_board` view, with unicode pieces and the
 * chessboard squares. this is what a human reads.
 */
export async function shit_1170_chess_rendered_board_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<string> {
  return chess_game_render_board_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    game_id,
  );
}

/**
 * the players, whose turn it is, and whether the game carries bets.
 */
export async function shit_1170_chess_game_info_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<SHIT_1170_CHESS_GAME_INFO> {
  return chess_game_game_info_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    game_id,
  );
}

/**
 * the active games of one account, as game ids.
 */
export async function shit_1170_chess_game_ids_fun(
  account_id: string,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<SHIT_1170_CHESS_GAME_ID[]> {
  return chess_game_get_game_ids_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    account_id,
  );
}

/**
 * an account — its rating, its points and its stats.
 */
export async function shit_1170_chess_account_fun(
  account_id: string,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<SHIT_1170_CHESS_ACCOUNT> {
  return chess_game_get_account_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    account_id,
  );
}

/**
 * the registered account ids, paginated.
 */
export async function shit_1170_chess_accounts_fun(
  skip: number,
  limit: number,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<string[]> {
  return chess_game_get_accounts_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    skip,
    limit,
  );
}

/**
 * the elo leaderboard, paginated.
 *
 * the answer is a list of `[account_id, elo]` pairs.
 */
export async function shit_1170_chess_elo_fun(
  skip: number,
  limit: number,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<[string, number][]> {
  return chess_game_get_elo_ratings_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    skip,
    limit,
  );
}

/**
 * the elo rating of specific accounts.
 *
 * the answer is a list of `[account_id, elo]` pairs, and it holds only
 * the accounts that have a rating.
 */
export async function shit_1170_chess_elo_by_ids_fun(
  account_ids: string[],
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<[string, number][]> {
  return chess_game_get_elo_ratings_by_ids_fun_json(
    shit_1170_near_client_fun(network),
    shit_1170_chess_contract_id_fun(network),
    account_ids,
  );
}

/**
 * is the account in the matchmaking queue?
 *
 * the daemon checks this before it joins, because an account that is
 * already in the queue gets `AlreadyInMatchmaking` and the call
 * fails.
 */
export async function shit_1170_chess_is_queued_fun(
  account_id: string,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<boolean> {
  return shit_1170_view_fun<boolean>(
    network,
    shit_1170_chess_contract_id_fun(network),
    "is_queued",
    { account_id },
  );
}

/**
 * the open challenges of one account.
 *
 * `is_challenger` picks the direction: true for the challenges the
 * account sent, false for the ones it received.
 */
export async function shit_1170_chess_challenges_fun(
  account_id: string,
  is_challenger: boolean,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<string[]> {
  return shit_1170_view_fun<string[]>(
    network,
    shit_1170_chess_contract_id_fun(network),
    "get_challenges",
    { account_id, is_challenger },
  );
}

/**
 * one challenge's details.
 */
export async function shit_1170_chess_challenge_fun(
  challenge_id: string,
  network: SHIT_1170_NETWORK = "mainnet",
): Promise<{
  id: string;
  challenger: string;
  challenged: string;
  wager: unknown;
}> {
  return shit_1170_view_fun(
    network,
    shit_1170_chess_contract_id_fun(network),
    "get_challenge",
    { challenge_id },
  );
}
