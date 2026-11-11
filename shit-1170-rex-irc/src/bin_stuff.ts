// the bits every irc bin shares.
//
// the bins promise pure JSON on stdout, so the connection is built
// here rather than in each bin, and the answer is printed here too.
//
// --- THE ORDER OF THE SOURCES ---
// the flags win over the config file, and the config file wins over
// the built-in defaults. so:
//
//   1. the defaults
//   2. the config file at ${HOME}/.shit-1170-rex-engine/irc/config.json
//   3. the flags on the command line
//
// that way an agent can set a default once and still override it for
// one call.

import {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
  type ARGS,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  SHIT_1170_IRC_CONNECTION,
  SHIT_1170_IRC_DEFAULT_NICK,
  SHIT_1170_IRC_DEFAULT_PORT,
  SHIT_1170_IRC_DEFAULT_SERVER,
  SHIT_1170_IRC_DEFAULT_TIMEOUT_MS,
  shit_1170_irc_names_fun,
  shit_1170_irc_numerics_fun,
  sleep_fun,
} from "./irc";

import {
  shit_1170_irc_credential_fun,
  shit_1170_irc_config_read_fun,
  type SHIT_1170_IRC_CONFIG,
} from "./store";

export {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
  shit_1170_irc_names_fun,
  shit_1170_irc_numerics_fun,
  sleep_fun,
};
export type { ARGS };

/**
 * the settings a bin resolved: the flags over the config over the
 * defaults.
 */
export interface SHIT_1170_IRC_SETTINGS {
  server: string;
  port: number;
  nick: string;
  realname: string;
  tls: boolean;
  bot: boolean;
  channels: string[];
}

/**
 * the settings for this call.
 */
export function shit_1170_irc_settings_fun(args: ARGS): SHIT_1170_IRC_SETTINGS {
  const config = shit_1170_irc_config_read_fun();

  const server = (args_string_fun(args, "server") ?? config.server).trim();

  if (server.includes("://")) {
    throw new Error(
      `--server must be a hostname only, with no scheme. use "${server.replace(
        /^\w+:\/\//,
        "",
      )}"`,
    );
  }
  if (server.includes("/")) {
    throw new Error(
      `--server must be a hostname only, with no path. use "${server.split("/")[0]}"`,
    );
  }

  return {
    server,
    port: args_number_fun(args, "port") ?? config.port,
    nick: args_string_fun(args, "nick") ?? config.nick,
    realname: args_string_fun(args, "realname") ?? config.realname,
    tls: args_bool_fun(args, "no-tls") ? false : config.tls,
    bot: args_bool_fun(args, "bot") ? true : args_bool_fun(args, "no-bot") ? false : config.bot,
    channels: config.channels,
  };
}

/**
 * build a connection from the flags and the config.
 */
export function shit_1170_irc_connection_fun(
  args: ARGS,
): SHIT_1170_IRC_CONNECTION {
  const settings = shit_1170_irc_settings_fun(args);

  // the SASL credentials come from the flags, or from the store for
  // this nick.
  const sasl_user = args_string_fun(args, "sasl-user");
  const sasl_pass = args_string_fun(args, "sasl-pass");
  const stored = sasl_user ? undefined : shit_1170_irc_credential_fun(settings.nick);

  return new SHIT_1170_IRC_CONNECTION({
    server: settings.server,
    port: settings.port,
    tls: settings.tls,
    path: args_string_fun(args, "path") ?? "/",
    nick: settings.nick,
    realname: settings.realname,
    sasl_user: sasl_user ?? stored?.account ?? (stored ? settings.nick : undefined),
    sasl_pass: sasl_pass ?? stored?.password,
    bot: settings.bot,
    timeout_ms:
      args_number_fun(args, "timeout") ?? SHIT_1170_IRC_DEFAULT_TIMEOUT_MS,
  });
}

/**
 * run a bin: build the connection, hand it to the body, print the
 * answer.
 *
 * the connection is always closed, even when the body throws.
 */
export async function shit_1170_irc_run_fun(
  args: ARGS,
  body: (connection: SHIT_1170_IRC_CONNECTION) => Promise<unknown>,
): Promise<void> {
  const connection = shit_1170_irc_connection_fun(args);
  try {
    await connection.connect_fun();
    const answer = await body(connection);
    print_json_fun(answer);
  } finally {
    connection.close_fun();
  }
}
export type { SHIT_1170_IRC_CONFIG };
// ========================================
// copyright 2026 by sleet.near
