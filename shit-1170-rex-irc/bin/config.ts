#!/usr/bin/env bun
// read and write the local store.
//
// the store is at ${HOME}/.shit-1170-rex-engine/irc/ — the same place
// the other skills keep theirs.
//
// this bin is the way to set a default once, so the other bins do not
// need the flags every time.
//
// --- THE MODES ---
//   --show          print the config and where the store lives
//   --set k=v       set one value
//   --save          write the config to disk
//   --save-credentials <password>   store the account password
//   --history       print what was seen
//   --forget        clear the history
//
// the config is NOT written unless --save is given, so a `--set` can
// be inspected before it is kept.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "../src/bin_stuff";
import {
  shit_1170_irc_config_default_fun,
  shit_1170_irc_config_read_fun,
  shit_1170_irc_config_write_fun,
  shit_1170_irc_credential_fun,
  shit_1170_irc_credentials_read_fun,
  shit_1170_irc_credentials_write_fun,
  shit_1170_irc_dir_fun,
  shit_1170_irc_history_clear_fun,
  shit_1170_irc_history_read_fun,
  type SHIT_1170_IRC_CONFIG,
} from "../src/store";

const SETTABLE = ["server", "port", "nick", "realname", "tls", "bot"] as const;

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "show", "save", "history", "forget", "bot", "no-bot"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "config [--show] [--set key=value] [--save] [--save-credentials <password>] [--history] [--forget]",
    );
    return;
  }

  const dir = shit_1170_irc_dir_fun();
  const config = shit_1170_irc_config_read_fun();
  const dirty = { ...config };

  // --set key=value, repeatable.
  //
  // the flags are a MAP, so `--set nick=x --set bot=true` would leave
  // only the last one. so the sets are collected from the raw argv
  // instead, which keeps every one of them.
  const sets = process.argv
    .slice(2)
    .flatMap((arg, index, all) => {
      const is_set = arg === "--set" || arg.startsWith("--set=");
      if (!is_set) return [];
      if (arg.startsWith("--set=")) return [arg.slice("--set=".length)];
      const next = all[index + 1];
      return next && !next.startsWith("--") ? [next] : [];
    });

  for (const set of sets) {
    const equals = set.indexOf("=");
    if (equals === -1) {
      throw new Error(`--set needs key=value, got "${set}"`);
    }
    const key = set.slice(0, equals).trim();
    const raw = set.slice(equals + 1);

    if (!(SETTABLE as readonly string[]).includes(key)) {
      throw new Error(
        `"${key}" is not a setting. the settings are: ${SETTABLE.join(", ")}`,
      );
    }

    if (key === "port") {
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--set port= must be a port number, got "${raw}"`);
      }
      dirty.port = port;
    } else if (key === "tls") {
      dirty.tls = raw === "true" || raw === "1" || raw === "yes";
    } else if (key === "bot") {
      dirty.bot = raw === "true" || raw === "1" || raw === "yes";
    } else {
      (dirty as Record<string, unknown>)[key] = raw;
    }
  }

  // --save
  let saved = false;
  if (args_bool_fun(args, "save")) {
    shit_1170_irc_config_write_fun(dirty);
    saved = true;
  }

  // --save-credentials <password>
  const password = args_string_fun(args, "save-credentials");
  let credentials_saved = false;
  if (password) {
    const nick = args_string_fun(args, "nick") ?? dirty.nick;
    const all = shit_1170_irc_credentials_read_fun();
    all[nick] = { password };
    shit_1170_irc_credentials_write_fun(all);
    credentials_saved = true;
  }

  // --forget
  let history_cleared = false;
  if (args_bool_fun(args, "forget")) {
    shit_1170_irc_history_clear_fun();
    history_cleared = true;
  }

  // --history
  let history: unknown[] | null = null;
  if (args_bool_fun(args, "history")) {
    history = shit_1170_irc_history_read_fun();
  }

  // the answer never carries a password.
  const stored = shit_1170_irc_credential_fun(dirty.nick);

  print_json_fun({
    ok: true,
    dir,
    config: dirty,
    saved,
    credentials_saved,
    // only whether there IS a credential, never the credential itself.
    has_credentials: stored !== undefined,
    history_cleared,
    history_count: history?.length ?? null,
    history: history && history.length > 0 ? history.slice(-20) : null,
    defaults: shit_1170_irc_config_default_fun(),
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
