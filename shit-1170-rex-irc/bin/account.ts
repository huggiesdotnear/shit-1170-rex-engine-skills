#!/usr/bin/env bun
// register an account, or log in to one.
//
// the server keeps its account database in the container's writable
// layer, and there is no volume behind it. so an account does NOT
// survive a restart of the ircd — see the skill's README.
//
// --- THE TWO MODES ---
//   --register <password>   create the account
//   --identify <password>   log in to an existing one
//
// neither needs a nick to be taken. `allow-before-connect` is on, so
// the REGISTER can be sent before the registration finishes.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
} from "../src/bin_stuff";
import { shit_1170_irc_run_fun, sleep_fun } from "../src/bin_stuff";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-tls"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "account --register <password> | --identify <password> [--nick <nick>] [--server <host>]",
    );
    return;
  }

  const register = args_string_fun(args, "register");
  const identify = args_string_fun(args, "identify");

  if (!register && !identify) {
    print_error_fun(
      "one of --register <password> or --identify <password> is required",
    );
    process.exitCode = 1;
    return;
  }

  await shit_1170_irc_run_fun(args, async (connection) => {
    const command = register
      ? `PRIVMSG NickServ :REGISTER ${register}`
      : `PRIVMSG NickServ :IDENTIFY ${identify}`;

    connection.send_fun(command);
    await sleep_fun(1200);

    // nickserv answers with a NOTICE. the good one says the account
    // is registered or that you are logged in; the bad one says the
    // password is wrong or the account is taken.
    const notices = connection.messages
      .filter((message) => message.command === "NOTICE")
      .map((message) => message.params[message.params.length - 1] ?? "");

    const success = notices.some((text) =>
      /successfully|now registered|is your password|logged in|identified/i.test(
        text,
      ),
    );

    return {
      ok: true,
      action: register ? "register" : "identify",
      nick: connection.nick,
      success,
      notices,
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
