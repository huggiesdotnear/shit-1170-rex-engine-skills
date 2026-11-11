#!/usr/bin/env bun
// send a raw irc line.
//
// this is the escape hatch. anything the other bins do not cover goes
// through here.
//
// it registers first, then sends the line, then waits a moment and
// reports what came back. so it can be used for `WHOIS`, `MODE`,
// `WHO`, `TOPIC`, `NAMES`, or anything else.
//
// --- A NOTE ON TIMING ---
// irc is a request/response protocol with no ids. a line sent and a
// line that answers it cannot be matched up except by reading them in
// order. so this bin answers with EVERYTHING the server said after
// the line was sent, and lets the caller pick out what it wanted.

import {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
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
      "raw --line <irc line> [--wait <ms>] [--server <host>] [--nick <nick>]",
    );
    return;
  }

  const line = args_require_string_fun(args, "line");
  const wait = args_number_fun(args, "wait") ?? 1200;

  await shit_1170_irc_run_fun(args, async (connection) => {
    // the index is taken AFTER the registration, so the answer holds
    // only what came back for this line and not the whole welcome
    // burst.
    const before = connection.messages.length;
    connection.send_fun(line);
    await sleep_fun(wait);

    const after = connection.messages.slice(before);
    return {
      ok: true,
      sent: line,
      count: after.length,
      // the replies, one per line, in order.
      replies: after.map((message) => ({
        command: message.command,
        prefix: message.prefix,
        params: message.params,
        raw: message.raw,
      })),
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
