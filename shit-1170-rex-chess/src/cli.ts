// the bits every bin shares: the flags, the json, and the errors.
//
// --- WHY THE BINS PRINT JSON ---
// an agent reads the output and repeats it. json is what it can read
// without guessing, and a bin that printed prose would have its
// output paraphrased — which is how a number becomes a wrong number.
//
// every answer is json on stdout. every error is json on stderr, with
// a non-zero exit code. a bin that fails says WHY in a shape a reader
// can act on.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

export {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
};

/**
 * the game id, as the bins take it.
 *
 * the contract takes a game id as a json array:
 *   `[113689871,"within4d45.near","marior.near"]`
 *
 * so the bin takes it the same way — `--game-id '<json array>'` — and
 * the loose flags `--height`, `--white` and `--black` build it
 * instead. the loose flags are friendlier to type and they cannot
 * produce a half-written game id.
 */
export function shit_1170_chess_game_id_fun(
  gameId: string | undefined,
  height: number | undefined,
  white: string | undefined,
  black: string | undefined,
): [number, string, string | null] {
  if (gameId) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(gameId);
    } catch {
      throw new Error(
        `--game-id must be a json array, e.g. '[113689871,"a.near","b.near"]'. got: ${gameId}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length !== 3) {
      throw new Error(
        `--game-id must be a json array of three values: [block_height, white, black|null]. got: ${gameId}`,
      );
    }
    const [h, w, b] = parsed as [unknown, unknown, unknown];
    if (typeof h !== "number" || typeof w !== "string") {
      throw new Error(
        `--game-id must start with a block height and an account id. got: ${gameId}`,
      );
    }
    if (b !== null && typeof b !== "string") {
      throw new Error(
        `--game-id's third value is the black player, or null for a game against the ai. got: ${gameId}`,
      );
    }
    return [h, w, b];
  }

  if (height === undefined || !white) {
    throw new Error(
      "--game-id is required, or the loose flags --height and --white.",
    );
  }
  return [height, white, black ?? null];
}

/**
 * the network a bin runs against.
 *
 * the chess contract is MAINNET ONLY — there is no testnet
 * deployment — so a testnet flag is refused rather than silently
 * pointed at nothing.
 */
export function shit_1170_chess_network_fun(
  network: string | undefined,
): "mainnet" {
  if (network === "testnet") {
    throw new Error(
      "the chess contract is mainnet only — app.chess-game.near has no testnet deployment.",
    );
  }
  return "mainnet";
}

/**
 * run a bin's main, and turn any error into a json error on stderr.
 */
export async function shit_1170_chess_main_fun(
  main: () => Promise<void>,
): Promise<void> {
  try {
    await main();
  } catch (error) {
    print_error_fun(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
