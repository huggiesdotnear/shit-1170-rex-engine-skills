// the shapes this skill reads and writes.
//
// --- WHY THE TYPES ARE WRITTEN HERE AND NOT IMPORTED ---
// the tool box's zod types describe the CHAIN's answers, and the
// protocol pawns middleman describes the API's answers. those are the
// right types for the wire.
//
// these are the types for the SKILL's own shapes — the game state the
// skill reasons about, the move it chose, the payload it builds. they
// are what the bins print and what the daemon holds in memory, so
// they are written here where they can be read without reaching into
// two packages.

/**
 * a chess game's id on the chain.
 *
 * a tuple of three values:
 *   - the block height the game was created at
 *   - the white player, always an account id
 *   - the black player, or null for a game against the ai
 *
 * the contract takes it as a json array, so this mirrors that shape
 * exactly.
 */
export type SHIT_1170_CHESS_GAME_ID = [number, string, string | null];

/**
 * one side of a game.
 *
 * the contract returns the two sides as a tagged object:
 *   `{ "type": "Human", "value": "player1.near" }`
 *   `{ "type": "Ai", "value": "Hard" }`
 */
export interface SHIT_1170_CHESS_PLAYER {
  /** `"Human"` or `"Ai"`. */
  type: string;
  /** the account id for a human, or the ai difficulty for the ai. */
  value: string;
}

/**
 * the players, whose turn it is, and whether the game carries bets.
 *
 * the answer of the `game_info` view.
 */
export interface SHIT_1170_CHESS_GAME_INFO {
  white: SHIT_1170_CHESS_PLAYER;
  black: SHIT_1170_CHESS_PLAYER;
  /** `"White"` or `"Black"`. */
  turn_color: string;
  last_block_height: number;
  has_bets: boolean;
}

/**
 * the board, as the contract answers it.
 *
 * eight strings, one per rank. row 0 is rank 8 — black's back rank —
 * and row 7 is rank 1, white's back rank.
 *
 * the pieces are letters: `K` king, `Q` queen, `R` rook, `B` bishop,
 * `N` knight, `P` pawn, uppercase for white and lowercase for black.
 * a space is an empty square.
 */
export type SHIT_1170_CHESS_BOARD = string[];

/**
 * an account's registration, rating, points and stats.
 *
 * the answer of the `get_account` view.
 */
export interface SHIT_1170_CHESS_ACCOUNT {
  near_amount: string;
  is_agent: boolean;
  points: string;
  elo: number;
  wins: number;
  win_streak: number;
  max_win_streak: number;
  bets_placed: number;
  bets_won: number;
  wagers_played: number;
  wager_wins: number;
  challenges_sent: number;
  pending_points: string;
}

/**
 * the ai difficulties the contract plays against.
 */
export type SHIT_1170_CHESS_DIFFICULTY =
  | "Easy"
  | "Medium"
  | "Hard"
  | "VeryHard";

/**
 * the colour of a side, as the contract spells it.
 */
export type SHIT_1170_CHESS_COLOR = "White" | "Black";

/**
 * a move in the contract's own notation.
 *
 * COORDINATE NOTATION, not san. the accepted forms are:
 *   - `"e2e4"`     compact
 *   - `"e2 e4"`    separated
 *   - `"e2 to e4"` explicit
 *   - `"O-O"`      kingside castle
 *   - `"O-O-O"`    queenside castle
 *   - `"e7 to e8 Q"` a promotion
 *
 * `"Nf3"` and `"Qxe4"` FAIL.
 */
export type SHIT_1170_CHESS_MOVE = string;

/**
 * a queued transaction, in the shape the engine's tx-queue accepts.
 *
 * the same shape the engine skill and the ft skill build. `args` is
 * the contract's own argument object, not a string.
 */
export interface SHIT_1170_CHESS_QUEUE_CALL {
  /** the contract account id. */
  contractId: string;
  /** the method name, exactly as the contract spells it. */
  method: string;
  /** the contract's own argument object. */
  args: Record<string, unknown>;
  /** the gas, as a raw digit string in gas units. */
  gas: string;
  /** the attached native NEAR, as a raw digit string in yoctoNEAR. */
  deposit: string;
}

/**
 * what the daemon is doing right now.
 *
 * the daemon writes this to a file, because the daemon is not a server
 * and nothing can ask it.
 */
export interface SHIT_1170_CHESS_DAEMON_STATE {
  /** the account the daemon plays as. */
  account_id: string;
  /** when the state was written. milliseconds since the epoch. */
  updated_at: number;
  /** the daemon's own status. */
  status: "starting" | "watching" | "playing" | "reconnecting" | "stopped";
  /** the spread of the elo band the daemon queues at. */
  band: number;
  /** the sse stream's state. */
  connected: boolean;
  /** how many times the stream has been rebuilt. */
  reconnects: number;
  /** the game the daemon is playing right now, if any. */
  current_game: SHIT_1170_CHESS_GAME_ID | null;
  /** the games the daemon has open. */
  active_games: SHIT_1170_CHESS_GAME_ID[];
  /** the last thing that happened. */
  last_event: string | null;
  /** the last error, if there was one. */
  last_error: string | null;
}
