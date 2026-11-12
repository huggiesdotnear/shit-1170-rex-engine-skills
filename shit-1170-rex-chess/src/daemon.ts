// the daemon — a long-lived process that plays.
//
// --- WHAT IT IS ---
// it holds the protocol pawns sse stream open and plays the moment it
// is the agent's turn. it is a plain process, not a server: nobody
// talks to it, so there is no http api and no hono.
//
// it differs from the irc daemon in the one way that matters. the irc
// daemon IS a server, because a human has to talk to it WHILE it
// holds the connection open — read a channel while posting to it.
// the chess daemon has nobody to talk to.
//
// --- THE LOOP ---
//   1. open the stream for the account
//   2. on `play_move`, read the game and move if it is the agent's turn
//   3. on `create_game`, the contract matched the agent — play it
//   4. on `challenge`, ACCEPT it — autonomous mode plays every game
//   5. on `heartbeat`, the stream is alive. one is missing for about
//      ten seconds and the stream is dead
//   6. on a disconnect, reconnect with a backoff
//
// --- WHY THE MATCHMAKING QUEUE NEEDS NO POLLING ---
// the daemon joins the queue ONCE, and the contract's `create_game`
// event arrives on the stream it is already watching. so matchmaking
// and playing need one connection, not two.
//
// --- THE GAS ---
// a move's gas follows the opponent, and it is read from the game
// every time. a wrong gas can run the first leg of the call and not
// the second.

import { api_protocol_pawns_events } from "@sleet-js/middleman-protocol-pawns-api";
import { quiet_fun } from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_chess_account_fun,
  shit_1170_chess_game_info_fun,
  shit_1170_chess_game_ids_fun,
  shit_1170_chess_is_queued_fun,
} from "./chain";
import {
  shit_1170_chess_api_position_fen_fun,
} from "./api";
import {
  shit_1170_chess_choose_move_for_fen_fun,
  shit_1170_chess_choose_move_for_game_fun,
} from "./move";
import {
  shit_1170_chess_move_gas_tgas_fun,
  shit_1170_chess_game_read_fun,
  shit_1170_chess_is_my_turn_fun,
} from "./game";
import type { SHIT_1170_CHESS_GAME } from "./game";
import {
  shit_1170_chess_accept_challenge_payload_fun,
  shit_1170_chess_join_matchmaking_payload_fun,
  shit_1170_chess_play_move_payload_fun,
  shit_1170_chess_resign_payload_fun,
} from "./payload";
import {
  shit_1170_chess_send_fun,
  shit_1170_chess_signer_find_fun,
} from "./signer";
import type { SHIT_1170_CHESS_SIGNER } from "./signer";
import {
  shit_1170_chess_games_close_fun,
  shit_1170_chess_games_db_open_fun,
  shit_1170_chess_games_open_fun,
  shit_1170_chess_games_put_fun,
  shit_1170_chess_log_append_fun,
  shit_1170_chess_state_write_fun,
} from "./store";
import type {
  SHIT_1170_CHESS_DAEMON_STATE,
  SHIT_1170_CHESS_GAME_ID,
} from "./types";

/**
 * how the daemon is set up.
 */
export interface SHIT_1170_CHESS_DAEMON_OPTIONS {
  /** the account the daemon plays as. */
  account_id: string;
  /** the spread of the elo band it queues at. default 200. */
  band: number;
  /** join the matchmaking queue on start. default true. */
  matchmake: boolean;
  /** accept challenges. default true. */
  accept: boolean;
}

/**
 * the api sends a heartbeat every five seconds. one is missing for
 * about ten seconds and the stream is dead.
 */
const SHIT_1170_CHESS_HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * the reconnect backoff: one second, doubling, to a maximum of thirty.
 */
const SHIT_1170_CHESS_BACKOFF_MIN_MS = 1_000;
const SHIT_1170_CHESS_BACKOFF_MAX_MS = 30_000;

/**
 * how often the chain is polled for the agent's turn.
 *
 * the stream is the fast path, and the chain is the truth. the api's
 * indexer can stop delivering game events for an account — the stream
 * keeps sending heartbeats and nothing else — and a daemon that only
 * listens to the stream then sits there with a game waiting on it.
 *
 * so the daemon also asks the chain directly: on every tick it reads
 * the account's active games, and for each one whose turn it is, it
 * plays. the poll is deliberately unhurried. it is a safety net under
 * the stream, not a replacement for it.
 */
const SHIT_1170_CHESS_POLL_INTERVAL_MS = 15_000;

/**
 * the daemon.
 */
export class SHIT_1170_CHESS_DAEMON {
  private readonly options: SHIT_1170_CHESS_DAEMON_OPTIONS;
  private readonly signer: SHIT_1170_CHESS_SIGNER;
  private readonly db = shit_1170_chess_games_db_open_fun();

  private reconnects = 0;
  private connected = false;
  private lastHeartbeat = Date.now();
  private stopped = false;
  private currentGame: SHIT_1170_CHESS_GAME_ID | null = null;
  private lastEvent: string | null = null;
  private lastError: string | null = null;
  private pollTask: Promise<void> | null = null;

  constructor(options: SHIT_1170_CHESS_DAEMON_OPTIONS) {
    this.options = options;
    // the key is found once, at the start. a key that is not there is
    // a refusal, not a retry — the human has to sign the add_key.
    this.signer = shit_1170_chess_signer_find_fun(options.account_id);
  }

  /**
   * write what the daemon is doing, right now.
   */
  private write_state_fun(status: SHIT_1170_CHESS_DAEMON_STATE["status"]): void {
    const active = shit_1170_chess_games_open_fun(this.db);
    shit_1170_chess_state_write_fun({
      account_id: this.options.account_id,
      updated_at: Date.now(),
      status,
      band: this.options.band,
      connected: this.connected,
      reconnects: this.reconnects,
      current_game: this.currentGame,
      active_games: active,
      last_event: this.lastEvent,
      last_error: this.lastError,
    });
  }

  /**
   * ask the chain for the account's active games, and play each one
   * that is waiting on the agent.
   *
   * this is the safety net under the stream. the api's indexer can
   * stop delivering game events for an account, and when it does the
   * stream carries heartbeats and nothing else — the game sits there
   * waiting for a move that never comes. the chain knows who is to
   * move, so the chain is asked.
   */
  private async poll_games_fun(): Promise<void> {
    if (this.stopped) return;

    let game_ids: SHIT_1170_CHESS_GAME_ID[];
    try {
      game_ids = await shit_1170_chess_game_ids_fun(this.options.account_id);
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : String(error);
      shit_1170_chess_log_append_fun({
        at: Date.now(),
        event: "poll_failed",
        detail: { error: this.lastError },
      });
      return;
    }

    for (const game_id of game_ids) {
      if (this.stopped) return;

      // the agent plays only its own games. the contract's list is the
      // account's, but the guard costs nothing.
      const white = game_id[1];
      const black = game_id[2];
      if (
        white !== this.options.account_id &&
        black !== this.options.account_id
      ) {
        continue;
      }

      await this.play_game_fun(game_id);
    }
  }

  /**
   * the poll loop. it runs for the life of the daemon.
   */
  private async poll_loop_fun(): Promise<void> {
    while (!this.stopped) {
      await sleep_fun(SHIT_1170_CHESS_POLL_INTERVAL_MS);
      if (this.stopped) return;
      await this.poll_games_fun();
    }
  }

  /**
   * run the daemon until it is stopped.
   */
  async run_fun(): Promise<void> {
    this.write_state_fun("starting");

    if (this.options.matchmake) {
      await this.join_matchmaking_fun();
    }

    // the poll loop runs beside the stream, not inside it, so a slow
    // chain read never stalls the event handling.
    this.pollTask = this.poll_loop_fun();

    let backoff = SHIT_1170_CHESS_BACKOFF_MIN_MS;

    while (!this.stopped) {
      try {
        this.connected = true;
        this.lastHeartbeat = Date.now();
        this.write_state_fun("watching");
        this.reconnects = 0;

        const stream = await quiet_fun(() =>
          api_protocol_pawns_events({
            account_id: this.options.account_id,
          }),
        );

        for await (const event of stream) {
          if (this.stopped) break;
          this.lastHeartbeat = Date.now();
          await this.handle_event_fun(event);
        }

        // the stream ended on its own.
        this.connected = false;
        if (this.stopped) break;
        this.lastError = "the stream ended";
        this.write_state_fun("reconnecting");
      } catch (error) {
        this.connected = false;
        if (this.stopped) break;
        this.lastError =
          error instanceof Error ? error.message : String(error);
        shit_1170_chess_log_append_fun({
          at: Date.now(),
          event: "stream_error",
          detail: { error: this.lastError },
        });
        this.write_state_fun("reconnecting");
      }

      if (this.stopped) break;

      this.reconnects += 1;
      await sleep_fun(backoff);
      backoff = Math.min(backoff * 2, SHIT_1170_CHESS_BACKOFF_MAX_MS);
    }

    this.connected = false;
    this.write_state_fun("stopped");
  }

  /**
   * stop the daemon.
   */
  stop_fun(): void {
    this.stopped = true;
    // the poll loop sleeps between ticks, so it is not stopped by the
    // flag alone — it finishes its sleep and sees the flag.
    void this.pollTask;
  }

  /**
   * join the matchmaking queue.
   *
   * the band is the agent's OWN rating plus or minus the spread, and
   * the elo test is MUTUAL — the opponent's band has to accept the
   * agent too. so a narrow band waits, and a wide one finds a match
   * faster and plays a weaker opponent.
   */
  private async join_matchmaking_fun(): Promise<void> {
    try {
      // the queue entry is not always needed — one may already be open
      // from an earlier run, and the contract refuses a second one.
      // asking first turns a panic into a quiet skip.
      const already_queued = await quiet_fun(() =>
        shit_1170_chess_is_queued_fun(this.options.account_id),
      );
      if (already_queued) {
        shit_1170_chess_log_append_fun({
          at: Date.now(),
          event: "already_queued",
          detail: { account_id: this.options.account_id },
        });
        return;
      }

      const account = await quiet_fun(() =>
        shit_1170_chess_account_fun(this.options.account_id),
      );
      const elo = account.elo;

      const min_elo = Math.max(0, elo - this.options.band);
      const max_elo = elo + this.options.band;

      const payload = shit_1170_chess_join_matchmaking_payload_fun(
        min_elo,
        max_elo,
      );

      const sent = await shit_1170_chess_send_fun(this.signer, payload);
      shit_1170_chess_log_append_fun({
        at: Date.now(),
        event: "joined_matchmaking",
        detail: { min_elo, max_elo, elo, tx_hash: sent.tx_hash },
      });

      // the game id is in the outcome, when the contract matched the
      // agent on the spot.
      const matched = this.game_id_from_outcome_fun(sent.outcome);
      if (matched) {
        await this.play_game_fun(matched);
      }
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : String(error);
      shit_1170_chess_log_append_fun({
        at: Date.now(),
        event: "matchmaking_failed",
        detail: { error: this.lastError },
      });
    }
  }

  /**
   * handle one event from the stream.
   */
  private async handle_event_fun(event: {
    event_type: string;
    event_data: Record<string, unknown>;
  }): Promise<void> {
    this.lastEvent = event.event_type;

    switch (event.event_type) {
      case "heartbeat":
        return;

      case "play_move": {
        const game_id = event.event_data["game_id"] as
          | SHIT_1170_CHESS_GAME_ID
          | undefined;
        if (!game_id) return;
        await this.play_game_fun(game_id);
        return;
      }

      case "create_game": {
        const game_id = event.event_data["game_id"] as
          | SHIT_1170_CHESS_GAME_ID
          | undefined;
        if (!game_id) return;
        shit_1170_chess_games_put_fun(this.db, game_id, Date.now());
        await this.play_game_fun(game_id);
        return;
      }

      case "challenge": {
        if (!this.options.accept) return;
        const challenge_id = event.event_data["id"];
        if (typeof challenge_id !== "string") return;

        // a challenge WITH a wager is not accepted — a wager moves
        // money, and the human signs every one of those.
        const wager = event.event_data["wager"];
        if (wager) {
          shit_1170_chess_log_append_fun({
            at: Date.now(),
            event: "challenge_skipped_wagered",
            detail: { challenge_id },
          });
          return;
        }

        const payload =
          shit_1170_chess_accept_challenge_payload_fun(challenge_id);
        const sent = await shit_1170_chess_send_fun(this.signer, payload);
        shit_1170_chess_log_append_fun({
          at: Date.now(),
          event: "accepted_challenge",
          detail: { challenge_id, tx_hash: sent.tx_hash },
        });
        return;
      }

      case "resign_game":
      case "cancel_game": {
        const game_id = event.event_data["game_id"] as
          | SHIT_1170_CHESS_GAME_ID
          | undefined;
        if (!game_id) return;
        shit_1170_chess_games_close_fun(
          this.db,
          game_id,
          Date.now(),
          event.event_type,
          null,
        );
        return;
      }

      default:
        return;
    }
  }

  /**
   * play a game — make a move if it is the agent's turn.
   */
  private async play_game_fun(game_id: SHIT_1170_CHESS_GAME_ID): Promise<void> {
    this.currentGame = game_id;
    this.write_state_fun("playing");

    try {
      const game = await shit_1170_chess_game_read_fun(game_id);

      if (!shit_1170_chess_is_my_turn_fun(game, this.options.account_id)) {
        return;
      }

      const fen = await shit_1170_chess_api_position_fen_fun(game_id);
      const chosen = fen
        ? shit_1170_chess_choose_move_for_fen_fun(fen)
        : shit_1170_chess_choose_move_for_game_fun(game);

      if (!chosen) {
        // no legal move — the game is over.
        shit_1170_chess_games_close_fun(
          this.db,
          game_id,
          Date.now(),
          "no_legal_move",
          null,
        );
        return;
      }

      const gas_tgas = shit_1170_chess_move_gas_tgas_fun(
        game,
        this.options.account_id,
      );
      const payload = shit_1170_chess_play_move_payload_fun(
        game_id,
        chosen.mv,
        gas_tgas,
      );

      shit_1170_chess_games_put_fun(this.db, game_id, Date.now());
      const sent = await shit_1170_chess_send_fun(this.signer, payload);

      shit_1170_chess_log_append_fun({
        at: Date.now(),
        event: "played_move",
        detail: {
          game_id,
          mv: chosen.mv,
          san: chosen.san,
          gas_tgas,
          tx_hash: sent.tx_hash,
        },
      });
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : String(error);
      shit_1170_chess_log_append_fun({
        at: Date.now(),
        event: "play_failed",
        detail: { game_id, error: this.lastError },
      });
    }
  }

  /**
   * read a game id out of a transaction outcome.
   *
   * the contract returns the game id from `join_matchmaking` when it
   * matched the agent on the spot, and null when the agent is queued.
   */
  private game_id_from_outcome_fun(outcome: unknown): SHIT_1170_CHESS_GAME_ID | null {
    if (!outcome || typeof outcome !== "object") return null;
    const logs = (outcome as { logs?: unknown[] }).logs;
    if (!Array.isArray(logs)) return null;

    for (const log of logs) {
      const bytes = (log as { bytes?: unknown }).bytes;
      if (!Array.isArray(bytes)) continue;
      try {
        const text = Buffer.from(bytes as number[]).toString("utf8");
        const parsed = JSON.parse(text) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.length === 3 &&
          typeof parsed[0] === "number" &&
          typeof parsed[1] === "string"
        ) {
          return parsed as SHIT_1170_CHESS_GAME_ID;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * the account's open games, from the chain.
   */
  async open_games_fun(): Promise<SHIT_1170_CHESS_GAME_ID[]> {
    return shit_1170_chess_game_ids_fun(this.options.account_id);
  }

  /**
   * the account's info, for the current game.
   */
  async game_info_fun(
    game_id: SHIT_1170_CHESS_GAME_ID,
  ): Promise<ReturnType<typeof shit_1170_chess_game_info_fun>> {
    return shit_1170_chess_game_info_fun(game_id);
  }
}

/**
 * sleep, for the reconnect backoff.
 */
function sleep_fun(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
