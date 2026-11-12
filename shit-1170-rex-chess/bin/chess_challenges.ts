#!/usr/bin/env bun
// the open challenges — the pending ones across the whole platform.
//
// a chain VIEW for the chain's own list, and the protocol pawns api
// for the indexed one.
//
// --- WHY BOTH ---
// the chain's `get_challenges` answers for ONE account, and it needs
// to know whether the list is the sent one or the received one. the
// api's `GET /challenges` answers with the GLOBAL list — every pending
// challenge on the platform — which is the list an agent polls to find
// a game to accept.
//
// the api is the default because the global list is what a playing
// agent needs. `--mine` reads the chain's own list for one account.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { shit_1170_chess_challenges_fun } from "../src/chain";
import { shit_1170_chess_api_challenges_fun } from "../src/api";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "mine"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_challenges [--limit <n>] [--mine --account-id <account_id>] [--challenger]",
        "--network mainnet",
        "",
        "the pending challenges on the platform. --mine reads the chain's",
        "own list for one account. --challenger picks the sent list.",
      ],
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const limit = Number(args_string_fun(args, "limit") ?? "25");

  if (args_bool_fun(args, "mine")) {
    const account_id = args_string_fun(args, "account-id");
    if (!account_id) {
      throw new Error("--account-id is required with --mine.");
    }
    const is_challenger = args_bool_fun(args, "challenger");
    print_json_fun({
      ok: true,
      account_id,
      is_challenger,
      challenges: await shit_1170_chess_challenges_fun(
        account_id,
        is_challenger,
        network,
      ),
    });
    return;
  }

  const page = await shit_1170_chess_api_challenges_fun(limit);
  print_json_fun({
    ok: true,
    count: page.length,
    challenges: page,
  });
});
