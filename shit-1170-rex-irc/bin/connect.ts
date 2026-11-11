#!/usr/bin/env bun
// connect, and report what the server said.
//
// this is the "does it work" bin. it opens the websocket, registers,
// and answers with the server's identity, its capabilities, the motd
// and who is online.
//
// it is also the bin to use when something is not working, because
// the answer holds the numerics that say why.

import {
  args_bool_fun,
  parse_args_fun,
  print_error_fun,
  shit_1170_irc_numerics_fun,
  shit_1170_irc_run_fun,
} from "../src/bin_stuff";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-tls"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "connect [--server <host>] [--nick <nick>] [--port <port>] [--sasl-user <u> --sasl-pass <p>]",
    );
    return;
  }

  await shit_1170_irc_run_fun(args, async (connection) => ({
    ok: true,
    server: connection.server,
    url: connection.url,
    nick: connection.nick,
    registered: connection.registered,
    sasl: connection.sasl_ok,
    network: connection.isupport["NETWORK"]?.[0] ?? null,
    channels: [...connection.channels],
    motd: connection.motd,
    isupport: connection.isupport,
    numerics: shit_1170_irc_numerics_fun(connection),
  }));
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
