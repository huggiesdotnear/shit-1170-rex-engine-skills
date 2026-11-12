#!/usr/bin/env bun
// the people to play — the elo leaderboard, and the registered accounts.
//
// a chain VIEW for the contract's own list, and the protocol pawns api
// for the RANKED one.
//
// --- WHY THE API IS THE DEFAULT ---
// the contract's `get_elo_ratings` answers in STORAGE ORDER, not in
// rating order. it is a list of `[account_id, elo]` pairs and nothing
// sorts them, so the first page is not the top page.
//
// the api's `/leaderboard/elo` answers SORTED, with the rank and the
// win/loss/draw record beside the rating. that is the list a human
// reads and the list an agent picks an opponent from.
//
// so the api is the default. `--chain` reads the contract's own list,
// for when the api is not reachable and for when the raw storage order
// is what is wanted.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import {
  shit_1170_chess_accounts_fun,
  shit_1170_chess_elo_fun,
} from "../src/chain";
import { shit_1170_chess_api_leaderboard_fun } from "../src/api";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "accounts", "chain"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_elo [--skip <n>] [--limit <n>] [--accounts] [--chain]",
        "--network mainnet",
        "",
        "the elo leaderboard, sorted. --accounts also lists every",
        "registered account id. --chain reads the contract's own list,",
        "which is in storage order rather than rating order.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const skip = args_number_fun(args, "skip", 0) ?? 0;
  const limit = args_number_fun(args, "limit", 25) ?? 25;

  const answer: Record<string, unknown> = {
    ok: true,
    skip,
    limit,
  };

  if (args_bool_fun(args, "chain")) {
    answer["source"] = "chain";
    answer["elo"] = await shit_1170_chess_elo_fun(skip, limit, network);
  } else {
    const page = await shit_1170_chess_api_leaderboard_fun(1, limit);
    answer["source"] = "api";
    answer["total"] = page.total;
    answer["elo"] = page.entries;
  }

  if (args_bool_fun(args, "accounts")) {
    answer["accounts"] = await shit_1170_chess_accounts_fun(skip, limit, network);
  }

  print_json_fun(answer);
});
