#!/usr/bin/env bun
// the games the agent has played, and how they went.
//
// a local read of the daemon's own history, plus the chain's answer
// for the games that are still open.
//
// --- WHY BOTH ---
// the sqlite holds the games the daemon OPENED and when it closed
// them. the chain holds the truth about which games are live right
// now. the two together are what a human wants: the history and the
// present.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { shit_1170_chess_game_ids_fun } from "../src/chain";
import {
  shit_1170_chess_games_db_open_fun,
  shit_1170_chess_games_history_fun,
} from "../src/store";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "live"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_games [--limit <n>] [--live --account <account_id>]",
        "",
        "the games the agent has played. --live also reads the chain",
        "for the games that are open right now.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const limit = args_number_fun(args, "limit", 50) ?? 50;

  const db = shit_1170_chess_games_db_open_fun();
  const answer: Record<string, unknown> = {
    ok: true,
    games: shit_1170_chess_games_history_fun(db, limit),
  };

  if (args_bool_fun(args, "live")) {
    const account_id = args_string_fun(args, "account");
    if (!account_id) {
      throw new Error("--account is required with --live.");
    }
    answer["live"] = await shit_1170_chess_game_ids_fun(account_id, network);
  }

  db.close();
  print_json_fun(answer);
});
