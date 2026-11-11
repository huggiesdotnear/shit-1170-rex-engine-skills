#!/usr/bin/env bun
// list the channels, and who is in them.
//
// the server's `LIST` answers with the channels and their member
// counts. `NAMES` answers with who is actually in one.
//
// this is the bin to use before joining something, so an agent knows
// where the conversation is.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
} from "../src/bin_stuff";
import { shit_1170_irc_names_fun, shit_1170_irc_run_fun, sleep_fun } from "../src/bin_stuff";

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "no-tls"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_error_fun(
      "channels [--names <#channel>] [--server <host>] [--nick <nick>]",
    );
    return;
  }

  const names_for = args_string_fun(args, "names");
  const timeout = args_number_fun(args, "timeout") ?? 20_000;

  await shit_1170_irc_run_fun(args, async (connection) => {
    // LIST gives the channels and their counts.
    connection.send_fun("LIST");
    await sleep_fun(1200);

    const list: { channel: string; count: number }[] = [];
    for (const message of connection.messages) {
      // 322 is "channel name count :topic"
      if (message.command === "322") {
        const channel = message.params[1] ?? "";
        const count = Number(message.params[2] ?? "0");
        list.push({ channel, count: Number.isFinite(count) ? count : 0 });
      }
    }

    // the channels this client is in, with their names.
    let names: Record<string, string[]> = {};
    if (names_for) {
      await connection.join_fun(names_for);
      connection.send_fun(`NAMES ${names_for}`);
      await sleep_fun(900);
      names = shit_1170_irc_names_fun(connection);
    }

    return {
      ok: true,
      count: list.length,
      channels: list,
      names,
      joined: [...connection.channels],
    };
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
