// ========================================
// THE LOCAL STORE.
//
// where this skill keeps what it remembers between runs.
//
// the store is under ${HOME}/.shit-1170-rex-engine/ — the same place
// the other skills keep theirs, so there is one folder per machine
// and not one per skill.
//
// this skill's folder is `irc/`:
//
//   ${HOME}/.shit-1170-rex-engine/irc/
//     config.json       the default server, nick and channels
//     credentials.json  the nick's account password, if there is one
//     history.jsonl     the messages seen, one per line
//
// --- WHY THE PASSWORD IS IN A FILE AND NOT IN THE CONFIG ---
// the config is the safe file. it can be read, copied and committed.
// the credentials are not. they get mode 0600, and they are never
// printed by any bin.
//
// --- WHY A HISTORY FILE ---
// an agent that read a channel and then acted on it wants to be able
// to look at what it read again. the ircd keeps messages in memory
// only, and it forgets everything when it restarts, so the client
// keeps its own copy.
//
// the history is a JSONL file — one json object per line — because
// that appends without a rewrite, and `jq` can read it without any
// tooling.
// ========================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** the folder name under the home dir. */
export const SHIT_1170_HOME_DIR_NAME = ".shit-1170-rex-engine";

/**
 * the home folder the store lives in.
 *
 * `SHIT_1170_REX_HOME` overrides it, which is what the other skills
 * do and what makes the store testable.
 */
export function shit_1170_home_dir_fun(): string {
  const from_env = process.env.SHIT_1170_REX_HOME?.trim();
  if (from_env) return from_env;
  return join(homedir(), SHIT_1170_HOME_DIR_NAME);
}

/** the irc folder inside the store. */
export function shit_1170_irc_dir_fun(): string {
  return join(shit_1170_home_dir_fun(), "irc");
}

/** the config file. it holds no secrets. */
export function shit_1170_irc_config_path_fun(): string {
  return join(shit_1170_irc_dir_fun(), "config.json");
}

/** the credentials file. it holds the account password. */
export function shit_1170_irc_credentials_path_fun(): string {
  return join(shit_1170_irc_dir_fun(), "credentials.json");
}

/** the history file, one json object per line. */
export function shit_1170_irc_history_path_fun(): string {
  return join(shit_1170_irc_dir_fun(), "history.jsonl");
}

// ------------------------------------------------------------
// THE CONFIG SHAPE
// ------------------------------------------------------------

/**
 * what the config file holds.
 */
export interface SHIT_1170_IRC_CONFIG {
  /** the hostname to talk to */
  server: string;
  /** the port */
  port: number;
  /** the nickname to register with */
  nick: string;
  /** the realname to register with */
  realname: string;
  /** the channels to join on connect */
  channels: string[];
  /** use tls (wss) */
  tls: boolean;
  /** set the +B bot mode on connect */
  bot: boolean;
}

/**
 * the config as it comes out of the box.
 */
export function shit_1170_irc_config_default_fun(): SHIT_1170_IRC_CONFIG {
  return {
    server: "irc.shit-1170.com",
    port: 443,
    nick: "sleet-agent",
    realname: "sleet agent",
    channels: ["#shit-1170"],
    tls: true,
    bot: false,
  };
}

/**
 * read the config, or the defaults if there is none.
 *
 * a config file that is not valid json is an error, not a silent
 * fallback: a typo in the config that quietly reverts to the
 * defaults would connect to the wrong place.
 */
export function shit_1170_irc_config_read_fun(): SHIT_1170_IRC_CONFIG {
  const path = shit_1170_irc_config_path_fun();
  if (!existsSync(path)) {
    return shit_1170_irc_config_default_fun();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SHIT_1170_IRC_CONFIG>;
    return { ...shit_1170_irc_config_default_fun(), ...parsed };
  } catch (err) {
    throw new Error(
      `the config at ${path} is not valid json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * write the config.
 */
export function shit_1170_irc_config_write_fun(config: SHIT_1170_IRC_CONFIG): void {
  mkdirSync(shit_1170_irc_dir_fun(), { recursive: true });
  writeFileSync(shit_1170_irc_config_path_fun(), `${JSON.stringify(config, null, 2)}\n`);
}

// ------------------------------------------------------------
// THE CREDENTIALS
// ------------------------------------------------------------

/**
 * the credentials, keyed by nick.
 */
export interface SHIT_1170_IRC_CREDENTIALS {
  [nick: string]: {
    /** the account name, when it is not the nick */
    account?: string;
    /** the account password */
    password: string;
  };
}

/**
 * read the credentials file.
 */
export function shit_1170_irc_credentials_read_fun(): SHIT_1170_IRC_CREDENTIALS {
  const path = shit_1170_irc_credentials_path_fun();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SHIT_1170_IRC_CREDENTIALS;
  } catch (err) {
    throw new Error(
      `the credentials at ${path} are not valid json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * write the credentials file, with mode 0600.
 *
 * the file holds a password, so it is made readable only by its
 * owner. the chmod is done after the write, because the mode a file
 * is created with is decided by the umask, not by us.
 */
export function shit_1170_irc_credentials_write_fun(
  credentials: SHIT_1170_IRC_CREDENTIALS,
): void {
  mkdirSync(shit_1170_irc_dir_fun(), { recursive: true });
  const path = shit_1170_irc_credentials_path_fun();
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // the filesystem does not support the mode. the file is still
    // there, and the warning is not worth failing the write for.
  }
}

/**
 * the credentials for one nick.
 */
export function shit_1170_irc_credential_fun(
  nick: string,
): { account?: string; password: string } | undefined {
  return shit_1170_irc_credentials_read_fun()[nick];
}

// ------------------------------------------------------------
// THE HISTORY
// ------------------------------------------------------------

/**
 * one remembered message.
 */
export interface SHIT_1170_IRC_HISTORY_ENTRY {
  /** when it was seen, as an ISO timestamp */
  at: string;
  /** the channel or nick it was in */
  target: string;
  /** who said it */
  from: string | null;
  /** what they said */
  text: string | null;
  /** the ircv3 msgid, when the server sent one */
  msgid?: string;
}

/**
 * append messages to the history file.
 *
 * the file is a JSONL — one json object per line — so appending does
 * not rewrite the whole file, and a reader can stream it.
 */
export function shit_1170_irc_history_append_fun(
  entries: SHIT_1170_IRC_HISTORY_ENTRY[],
): void {
  if (entries.length === 0) return;
  mkdirSync(shit_1170_irc_dir_fun(), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
  appendFileSync(shit_1170_irc_history_path_fun(), `${lines}\n`);
}

/**
 * read the history, newest last.
 *
 * `limit` keeps the LAST n entries, which is what a caller asking
 * "what did i just see" wants.
 */
export function shit_1170_irc_history_read_fun(limit?: number): SHIT_1170_IRC_HISTORY_ENTRY[] {
  const path = shit_1170_irc_history_path_fun();
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const entries: SHIT_1170_IRC_HISTORY_ENTRY[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as SHIT_1170_IRC_HISTORY_ENTRY);
    } catch {
      // a line that is not json is skipped. the history is a log, not
      // a database, and one bad line should not lose the rest.
    }
  }
  if (limit !== undefined && limit > 0 && entries.length > limit) {
    return entries.slice(entries.length - limit);
  }
  return entries;
}

/**
 * forget the history.
 */
export function shit_1170_irc_history_clear_fun(): void {
  const path = shit_1170_irc_history_path_fun();
  if (existsSync(path)) writeFileSync(path, "");
}
// ========================================
// copyright 2026 by sleet.near
