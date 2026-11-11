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
  shit_1170_irc_run_fun,
  sleep_fun,
} from "../src/bin_stuff";
import {
  shit_1170_irc_history_append_fun,
  type SHIT_1170_IRC_HISTORY_ENTRY,
} from "../src/store";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-tls", "history", "no-history"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "listen [--channel <#channel>] [--history] [--seconds <n>] [--limit <n>] [--no-history] [--server <host>] [--nick <nick>]",
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

    // --- THE HISTORY ---
    // what was heard is written to the local store, so an agent that
    // read a channel can look at it again without listening twice.
    // the ircd keeps messages in memory only, and forgets everything
    // when it restarts — so this copy is the only one that lasts.
    const entries: SHIT_1170_IRC_HISTORY_ENTRY[] = [];
    for (const event of events) {
      if (typeof event !== "object" || event === null) continue;
      const item = event as {
        type?: string;
        from?: string | null;
        target?: string | null;
        text?: string | null;
        raw?: string;
      };
      if (item.type !== "message" && item.type !== "notice") continue;
      const msgid = item.raw?.match(/msgid=([^;\s]+)/)?.[1];
      entries.push({
        at: new Date().toISOString(),
        target: item.target ?? channel,
        from: item.from ?? null,
        text: item.text ?? null,
        ...(msgid ? { msgid } : {}),
      });
    }
    if (entries.length > 0 && !args_bool_fun(args, "no-history")) {
      shit_1170_irc_history_append_fun(entries);
    }

    return {
      ok: true,
      channel,
      seconds,
      count: events.length,
      saved_to_history: entries.length,
      events: events.slice(0, limit),
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
