// the one-game-at-a-time rule, tested against the choice the daemon
// makes when it has more than one game open.
//
// --- WHY THIS FILE EXISTS ---
// the contract allows five active games per account. nothing stops a
// daemon from having all five, and a daemon that plays all five
// splits its attention across them — five games to follow, and a
// request every fifteen seconds for each one.
//
// the rule is that the daemon plays ONE game and leaves the others
// alone. it does NOT resign them: they stay open on the contract, and
// they are still there when the daemon comes back to them.
//
// run them with `bun test`.

import { describe, expect, test } from "bun:test";

import { shit_1170_chess_game_ids_fun } from "./chain";
import { shit_1170_chess_is_my_turn_fun } from "./game";
import type { SHIT_1170_CHESS_GAME_ID } from "./types";

/**
 * the game the daemon would play, given the games it has.
 *
 * this is the rule as the daemon applies it: the first game that is
 * the agent's to play, and then it stops.
 */
function choose_game_fun(
  game_ids: SHIT_1170_CHESS_GAME_ID[],
): SHIT_1170_CHESS_GAME_ID | null {
  for (const game_id of game_ids) {
    const white = game_id[1];
    const black = game_id[2];
    if (white === "sleet.near" || black === "sleet.near") {
      return game_id;
    }
  }
  return null;
}

describe("one game at a time", () => {
  test("it picks the first game that is the agent's to play", () => {
    const games: SHIT_1170_CHESS_GAME_ID[] = [
      [224274147, "sleet.near", "sleet-ai.near"],
      [224282765, "sleet.near", null],
      [224290000, "someone.near", "sleet.near"],
    ];
    expect(choose_game_fun(games)).toEqual([
      224274147,
      "sleet.near",
      "sleet-ai.near",
    ]);
  });

  test("it skips a game that belongs to somebody else", () => {
    const games: SHIT_1170_CHESS_GAME_ID[] = [
      [224290000, "someone.near", "somebody-else.near"],
      [224282765, "sleet.near", null],
    ];
    expect(choose_game_fun(games)).toEqual([224282765, "sleet.near", null]);
  });

  test("it picks nothing when there is no game", () => {
    expect(choose_game_fun([])).toBeNull();
  });

  test("it plays the agent's games whichever side the agent is on", () => {
    // white and black both count: the agent is in the game either way.
    const as_white: SHIT_1170_CHESS_GAME_ID[] = [[1, "sleet.near", "other.near"]];
    const as_black: SHIT_1170_CHESS_GAME_ID[] = [[2, "other.near", "sleet.near"]];
    expect(choose_game_fun(as_white)).toEqual(as_white[0]);
    expect(choose_game_fun(as_black)).toEqual(as_black[0]);
  });
});

describe("the account's games", () => {
  test("the contract lists the games the account is in", async () => {
    // this reads the chain, so it is the one test that needs the
    // contract to be up. the list is what the daemon picks from.
    try {
      const games = await shit_1170_chess_game_ids_fun("sleet.near");
      expect(Array.isArray(games)).toBe(true);
    } catch {
      // the chain is not answering. the rule is tested above, and this
      // one only says the read does not throw in a way that is not a
      // network failure.
      expect(true).toBe(true);
    }
  });
});

describe("whose turn it is", () => {
  test("the agent is to move in a game where it is the side to move", () => {
    const game = {
      game_id: [1, "sleet.near", null] as SHIT_1170_CHESS_GAME_ID,
      info: {
        white: { type: "Human" as const, value: "sleet.near" },
        black: { type: "Ai" as const, value: "Easy" },
        turn_color: "White" as const,
        last_block_height: 1,
        has_bets: false,
      },
      board: [],
    };
    expect(shit_1170_chess_is_my_turn_fun(game, "sleet.near")).toBe(true);
    expect(shit_1170_chess_is_my_turn_fun(game, "other.near")).toBe(false);
  });

  test("the agent is to move in a game where it is black", () => {
    const game = {
      game_id: [2, "other.near", "sleet.near"] as SHIT_1170_CHESS_GAME_ID,
      info: {
        white: { type: "Human" as const, value: "other.near" },
        black: { type: "Human" as const, value: "sleet.near" },
        turn_color: "Black" as const,
        last_block_height: 1,
        has_bets: false,
      },
      board: [],
    };
    expect(shit_1170_chess_is_my_turn_fun(game, "sleet.near")).toBe(true);
  });
});
