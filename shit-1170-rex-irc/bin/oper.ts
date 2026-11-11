#!/usr/bin/env bun
// log in as an operator.
//
// the server has one oper, `admin`, with the `server-admin` class —
// full control of the ircd. the password is NOT in this repo.
//
// --- WHY IT IS A SEPARATE BIN ---
// opering up is a different thing from being a user. an agent that
// only reads and posts should never need it, and a bin that does both
// makes it too easy to oper when you meant to post.
//
// --- THE PASSWORD COMES FROM THE ENVIRONMENT ---
//   SHIT_1170_IRC_OPER_PASS=...
//
// so it stays out of the shell history and out of the process list.

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
      "oper [--name <opname>] [--server <host>] [--nick <nick>]   (the password comes from SHIT_1170_IRC_OPER_PASS)",
    );
    return;
  }

  const name = args_string_fun(args, "name") ?? "admin";
  const password = process.env.SHIT_1170_IRC_OPER_PASS ?? "";

  if (!password) {
    print_error_fun(
      "SHIT_1170_IRC_OPER_PASS is not set. the oper password is not in this repo.",
    );
    process.exitCode = 1;
    return;
  }

  await shit_1170_irc_run_fun(args, async (connection) => {
    connection.send_fun(`OPER ${name} ${password}`);
    await sleep_fun(900);

    // 381 means the oper is good. 464 means the password is wrong.
    const success = connection.oper_ok === true;
    const reply = connection.messages.find(
      (message) =>
        message.command === "381" ||
        message.command === "464" ||
        message.command === "465" ||
        message.command === "381",
    );

    return {
      ok: true,
      oper: name,
      success,
      reply: reply?.raw ?? null,
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
