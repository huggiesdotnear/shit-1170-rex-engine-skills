// the bits every irc bin shares.
//
// the bins promise pure JSON on stdout, so the connection is built
// here rather than in each bin, and the answer is printed here too.

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

export {
  shit_1170_irc_names_fun,
  shit_1170_irc_numerics_fun,
  sleep_fun,
};

export {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
};
export type { ARGS };

/**
 * build a connection from the flags.
 *
 * the server flag is the HOSTNAME ONLY — no scheme, no port, no path.
 * the websocket url is built from it, and the server resolves that
 * name over DNS.
 */
export function shit_1170_irc_connection_fun(
  args: ARGS,
): SHIT_1170_IRC_CONNECTION {
  const server = (args_string_fun(args, "server") ?? SHIT_1170_IRC_DEFAULT_SERVER).trim();

  if (server.includes("://")) {
    throw new Error(
      `--server must be a hostname only, with no scheme. use "${server.replace(
        /^\w+:\/\//,
        "",
      )}"`,
    );
  }
  if (server.includes("/")) {
    throw new Error(`--server must be a hostname only, with no path. use "${server.split("/")[0]}"`);
  }

  const nick = args_string_fun(args, "nick") ?? SHIT_1170_IRC_DEFAULT_NICK;
  const timeout_ms =
    args_number_fun(args, "timeout") ?? SHIT_1170_IRC_DEFAULT_TIMEOUT_MS;

  return new SHIT_1170_IRC_CONNECTION({
    server,
    port: args_number_fun(args, "port") ?? SHIT_1170_IRC_DEFAULT_PORT,
    tls: !args_bool_fun(args, "no-tls"),
    path: args_string_fun(args, "path") ?? "/",
    nick,
    realname: args_string_fun(args, "realname") ?? nick,
    sasl_user: args_string_fun(args, "sasl-user"),
    sasl_pass: args_string_fun(args, "sasl-pass"),
    timeout_ms,
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
// ========================================
// copyright 2026 by sleet.near
