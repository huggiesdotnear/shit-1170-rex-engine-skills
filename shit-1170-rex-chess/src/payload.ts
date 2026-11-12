// building the queue payloads.
//
// --- WHY THE PAYLOADS ARE BUILT HERE AND NOT IN THE BINS ---
// the same payload is built by three different bins — the propose
// bins — and they must agree on the gas, the deposit and the argument
// shape. so the shapes are written down once, here.
//
// --- THE ENGINE'S SHAPE ---
// a write is DATA, not an action. the exact shape the engine's
// tx-queue accepts:
//
//   {
//     "contractId": "app.chess-game.near",
//     "method": "play_move",
//     "args": { "game_id": [...], "mv": "e2e4" },
//     "gas": "150000000000000",
//     "deposit": "1"
//   }
//
// `gas` and `deposit` are RAW DIGIT STRINGS — gas units and
// yoctoNEAR. the web app's `gas_deposit.ts` also accepts near-kit's
// human forms ("30 Tgas", "0.00125 NEAR"), but raw digits are
// preferred, because there is no ambiguity about what they mean.

import { SHIT_1170_CHESS_CONTRACT_ID } from "./chain";
import type {
  SHIT_1170_CHESS_GAME_ID,
  SHIT_1170_CHESS_QUEUE_CALL,
} from "./types";

// --- THE GAS ---
//
// the gas follows the opponent, and the values come from the tool
// box's own constants:
//
//   Easy      50 Tgas
//   Medium   150 Tgas
//   Hard     250 Tgas
//   VeryHard 400 Tgas
//   a human  150 Tgas
//
// a wrong gas is not a small thing: the first leg of the call can run
// and the second not, so the move lands half-done.

/** the gas a `play_move` against the ai needs, in Tgas. */
export const SHIT_1170_CHESS_DIFFICULTY_GAS_TGAS = {
  Easy: 50,
  Medium: 150,
  Hard: 250,
  VeryHard: 400,
} as const;

/** the gas a game against a human needs, in Tgas. */
export const SHIT_1170_CHESS_HUMAN_GAME_GAS_TGAS = 150;

/** the gas the other calls need, in Tgas. */
export const SHIT_1170_CHESS_DEFAULT_GAS_TGAS = 30;

/**
 * Tgas as the raw gas digit string the engine wants.
 *
 * one Tgas is 1e12 gas units, so 150 Tgas is "150000000000000".
 */
export function shit_1170_chess_gas_string_fun(tgas: number): string {
  return String(Math.round(tgas * 1_000_000_000_000));
}

/**
 * the deposit for a call that attaches no native NEAR.
 *
 * "1" — one yoctoNEAR — is what the contract's own calls attach when
 * they need a deposit at all. the chess calls attach nothing, and
 * "0" is the honest value.
 */
export const SHIT_1170_CHESS_NO_DEPOSIT = "0";

/**
 * the deposit for a call that must attach one yoctoNEAR.
 *
 * `set_is_agent` and `withdraw_token` both need this.
 */
export const SHIT_1170_CHESS_ONE_YOCTO = "1";

/**
 * the deposit for registering an account.
 *
 * at least 0.05 NEAR — 50000000000000000000000 yoctoNEAR. the exact
 * minimum is readable with the `storage_balance_bounds` view.
 */
export const SHIT_1170_CHESS_STORAGE_DEPOSIT =
  "50000000000000000000000";

// --- THE LIMITED ACCESS KEY ---
//
// the methods the agent's key may call on the chess contract, and the
// allowance it needs.
//
// --- THE METHOD LIST ---
// every method this skill calls, minus the ones that move money.
// `withdraw_token`, `cancel_bet`, `ft_transfer` and `ft_transfer_call`
// are on the contract and are NOT here: a token deposit moves money, and
// the human signs every one of those.
//
// the list covers the whole skill: the game methods, the challenge
// methods, the matchmaking methods and `create_ai_game`. a key that
// leaves one of them out is refused by the contract with
// `MethodNameMismatch`, so the list is complete on purpose.
//
// --- THE ALLOWANCE ---
// the allowance is NOT the deposit. it is the prepaid gas:
// `gas_limit x gas_price`, and the gas price on mainnet is
// 1000000000 yoctoNEAR per gas unit.
//
//   30 Tgas  -> 0.03 NEAR
//   150 Tgas -> 0.15 NEAR
//   400 Tgas -> 0.40 NEAR
//
// the contract PREPAYS the gas from the key's allowance before the
// call runs, so an allowance of 0 is refused with
// `NotEnoughAllowance` before the contract is even reached. 1 NEAR
// covers the largest gas this skill uses with room to spare.

/** the methods the agent's limited key may call on the chess contract. */
export const SHIT_1170_CHESS_KEY_METHODS = [
  "play_move",
  "resign",
  "cancel",
  "challenge",
  "accept_challenge",
  "reject_challenge",
  "claim_points",
  "set_is_agent",
  "join_matchmaking",
  "cancel_matchmaking",
  "create_ai_game",
] as const;

/**
 * the allowance the agent's limited key needs, in yoctoNEAR.
 *
 * 1 NEAR. it covers the prepaid gas of the largest call this skill
 * makes — 400 Tgas, against a VeryHard ai — with room to spare.
 */
export const SHIT_1170_CHESS_KEY_ALLOWANCE = "1000000000000000000000000";

/**
 * the command the human runs to add the narrow key.
 *
 * the keys skill queues it and the human signs it in the web app.
 */
export function shit_1170_chess_key_command_fun(): string {
  return (
    `bun bin/key_queue_add.ts --receiver-id ${SHIT_1170_CHESS_CONTRACT_ID} ` +
    `--methods ${SHIT_1170_CHESS_KEY_METHODS.join(",")} ` +
    `--allowance ${SHIT_1170_CHESS_KEY_ALLOWANCE}`
  );
}

/**
 * the command the human runs to add the whole-contract key.
 *
 * the whole-contract scope also carries the money-shaped methods, so
 * it is the bigger key of the two.
 */
export function shit_1170_chess_key_whole_contract_command_fun(): string {
  return (
    `bun bin/key_queue_add.ts --receiver-id ${SHIT_1170_CHESS_CONTRACT_ID} ` +
    `--allowance ${SHIT_1170_CHESS_KEY_ALLOWANCE}`
  );
}

// --- THE PAYLOADS ---

/**
 * a `play_move` call.
 */
export function shit_1170_chess_play_move_payload_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
  mv: string,
  gas_tgas: number,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "play_move",
    args: { game_id, mv },
    gas: shit_1170_chess_gas_string_fun(gas_tgas),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `create_ai_game` call.
 *
 * the gas follows the difficulty, because the ai thinks on its reply
 * to the first move rather than here.
 */
export function shit_1170_chess_create_ai_game_payload_fun(
  difficulty: "Easy" | "Medium" | "Hard" | "VeryHard",
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "create_ai_game",
    args: { difficulty },
    gas: shit_1170_chess_gas_string_fun(
      SHIT_1170_CHESS_DIFFICULTY_GAS_TGAS[difficulty],
    ),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `storage_deposit` call — the registration.
 *
 * `account_id` registers ANOTHER account. omit it to register the
 * caller.
 */
export function shit_1170_chess_storage_deposit_payload_fun(
  account_id?: string,
  registration_only = true,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "storage_deposit",
    args: {
      account_id: account_id ?? null,
      registration_only,
    },
    gas: shit_1170_chess_gas_string_fun(SHIT_1170_CHESS_DEFAULT_GAS_TGAS),
    deposit: SHIT_1170_CHESS_STORAGE_DEPOSIT,
  };
}

/**
 * a `set_is_agent` call.
 *
 * the flag is public and visible through `get_account`. it does not
 * change how the contract behaves — it says that the account is
 * played by a program.
 */
export function shit_1170_chess_set_is_agent_payload_fun(
  is_agent: boolean,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "set_is_agent",
    args: { is_agent },
    gas: shit_1170_chess_gas_string_fun(10),
    deposit: SHIT_1170_CHESS_ONE_YOCTO,
  };
}

/**
 * a `challenge` call.
 */
export function shit_1170_chess_challenge_payload_fun(
  challenged_id: string,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "challenge",
    args: { challenged_id },
    gas: shit_1170_chess_gas_string_fun(SHIT_1170_CHESS_DEFAULT_GAS_TGAS),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * an `accept_challenge` call.
 *
 * the challenge id is the two accounts joined with `-vs-`.
 */
export function shit_1170_chess_accept_challenge_payload_fun(
  challenge_id: string,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "accept_challenge",
    args: { challenge_id },
    gas: shit_1170_chess_gas_string_fun(SHIT_1170_CHESS_DEFAULT_GAS_TGAS),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `reject_challenge` call.
 */
export function shit_1170_chess_reject_challenge_payload_fun(
  challenge_id: string,
  is_challenger: boolean,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "reject_challenge",
    args: { challenge_id, is_challenger },
    gas: shit_1170_chess_gas_string_fun(SHIT_1170_CHESS_DEFAULT_GAS_TGAS),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `join_matchmaking` call.
 *
 * the band is the range of opponent ratings that will be accepted.
 * the contract attaches NO deposit for this — the queue entry costs
 * the contract nothing to store.
 */
export function shit_1170_chess_join_matchmaking_payload_fun(
  min_elo: number,
  max_elo: number,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "join_matchmaking",
    args: { min_elo, max_elo },
    gas: shit_1170_chess_gas_string_fun(SHIT_1170_CHESS_DEFAULT_GAS_TGAS),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `cancel_matchmaking` call.
 */
export function shit_1170_chess_cancel_matchmaking_payload_fun(): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "cancel_matchmaking",
    args: {},
    gas: shit_1170_chess_gas_string_fun(10),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `resign` call.
 */
export function shit_1170_chess_resign_payload_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "resign",
    args: { game_id },
    gas: shit_1170_chess_gas_string_fun(300),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `cancel` call.
 *
 * a cancel is only allowed when it is NOT the caller's turn, and only
 * after the game has been stale for a few days. check `turn_color`
 * before sending this.
 */
export function shit_1170_chess_cancel_payload_fun(
  game_id: SHIT_1170_CHESS_GAME_ID,
): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "cancel",
    args: { game_id },
    gas: shit_1170_chess_gas_string_fun(300),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * a `claim_points` call.
 *
 * the ppp points are non-transferable, so there is no money here.
 */
export function shit_1170_chess_claim_points_payload_fun(): SHIT_1170_CHESS_QUEUE_CALL {
  return {
    contractId: SHIT_1170_CHESS_CONTRACT_ID,
    method: "claim_points",
    args: {},
    gas: shit_1170_chess_gas_string_fun(SHIT_1170_CHESS_DEFAULT_GAS_TGAS),
    deposit: SHIT_1170_CHESS_NO_DEPOSIT,
  };
}

/**
 * the challenge id the contract uses for a pair of accounts.
 *
 * the two accounts joined with `-vs-`.
 */
export function shit_1170_chess_challenge_id_fun(
  challenger_id: string,
  challenged_id: string,
): string {
  return `${challenger_id}-vs-${challenged_id}`;
}
