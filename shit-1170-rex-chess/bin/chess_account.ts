#!/usr/bin/env bun
// an account on the chess contract — its rating, its points, its stats.
//
// a chain VIEW. no api key, no engine account, no signature.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import {
  shit_1170_chess_account_fun,
  shit_1170_chess_game_ids_fun,
} from "../src/chain";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "games"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_account --account-id <account_id> [--games]",
        "--network mainnet",
        "",
        "the account's rating, points and stats. --games also lists its",
        "active games.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account-id");
  if (!account_id) {
    throw new Error("--account-id is required.");
  }

  const account = await shit_1170_chess_account_fun(account_id, network);

  const answer: Record<string, unknown> = {
    ok: true,
    account_id,
    account,
  };

  if (args_bool_fun(args, "games")) {
    answer["games"] = await shit_1170_chess_game_ids_fun(account_id, network);
  }

  print_json_fun(answer);
});
