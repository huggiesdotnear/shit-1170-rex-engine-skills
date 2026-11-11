#!/usr/bin/env bun
// send a message to a channel or a nick.
//
// this is the write bin. it joins the channel if it is not in it,
// sends the message, and answers with what the server said.
//
// --- WHY IT WAITS ---
// a PRIVMSG sent before the server has finished registering is
// dropped. so the bin registers, joins, and only then sends.
//
// --- WHY THE ANSWER HAS THE ECHO ---
// ergo advertises `echo-message`, so the server sends the message back
// to the sender. that echo is the proof the message landed, and it is
// in the answer so the caller does not have to take it on trust.

import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
} from "../src/bin_stuff";
import { shit_1170_irc_run_fun, sleep_fun } from "../src/bin_stuff";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-tls", "no-join"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "send --target <#channel|nick> --message <text> [--server <host>] [--nick <nick>] [--no-join]",
    );
    return;
  }

  const target = args_require_string_fun(args, "target");
  const message = args_require_string_fun(args, "message");

  await shit_1170_irc_run_fun(args, async (connection) => {
    // join the channel first, unless the target is a nick.
    const joined: string[] = [];
    if (target.startsWith("#") && !args_bool_fun(args, "no-join")) {
      await connection.join_fun(target);
      joined.push(target);
    }

    connection.say_fun(target, message);

    // give the echo a moment to come back.
    await sleep_fun(600);

    const echo = connection.messages.find(
      (item) =>
        item.command === "PRIVMSG" &&
        item.params[0] === target &&
        (item.params[item.params.length - 1] ?? "") === message,
    );

    return {
      ok: true,
      target,
      message,
      joined,
      // the echo is the proof. its absence is not a failure — the
      // message may still have been delivered — so it is reported
      // rather than treated as an error.
      echoed: echo !== undefined,
      echo: echo?.raw ?? null,
      numeric: (() => {
        const numeric = connection.messages.find(
          (item) =>
            item.command === "404" ||
            item.command === "401" ||
            item.command === "403" ||
            item.command === "404" ||
            item.command === "411" ||
            item.command === "412" ||
            item.command === "413",
        );
        return numeric ? numeric.raw : null;
      })(),
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
