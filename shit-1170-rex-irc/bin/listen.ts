#!/usr/bin/env bun
// watch a channel and report what comes in.
//
// this is the read bin. it joins the channel, listens for a while, and
// answers with the messages it heard.
//
// --- THE TWO WAYS TO ASK FOR MESSAGES ---
//   --channel    join the channel and listen to it
//   --history    ask the server for the channel's recent messages
//
// the history is the server's `chathistory` capability. ergo keeps
// the messages in memory, so it can hand over the recent ones without
// anyone having to be listening at the time.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
} from "../src/bin_stuff";
import { shit_1170_irc_run_fun, sleep_fun } from "../src/bin_stuff";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-tls", "history"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "listen [--channel <#channel>] [--history] [--seconds <n>] [--limit <n>] [--server <host>] [--nick <nick>]",
    );
    return;
  }

  const channel = args_string_fun(args, "channel");
  const seconds = args_number_fun(args, "seconds") ?? 10;
  const limit = args_number_fun(args, "limit") ?? 50;

  if (!channel) {
    print_error_fun("--channel <#channel> is required");
    process.exitCode = 1;
    return;
  }

  await shit_1170_irc_run_fun(args, async (connection) => {
    await connection.join_fun(channel as string);

    const events: unknown[] = [];

    // the history: ask for the last N messages in the channel.
    if (args_bool_fun(args, "history")) {
      connection.send_fun(
        `CHATHISTORY LATEST ${limit} TARGETS=#${(channel as string).replace(/^#/, "")}`,
      );
      await sleep_fun(1200);
      for (const message of connection.messages) {
        if (message.command === "PRIVMSG") {
          events.push({
            type: "message",
            from: message.prefix?.split("!")[0] ?? null,
            target: message.params[0] ?? null,
            text: message.params[message.params.length - 1] ?? null,
            raw: message.raw,
          });
        }
      }
    } else {
      // live: listen for a while.
      const heard = await connection.listen_fun(seconds * 1000);
      for (const event of heard) {
        events.push(event);
      }
    }

    return {
      ok: true,
      channel,
      seconds,
      count: events.length,
      events: events.slice(0, limit),
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
