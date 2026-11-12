#!/usr/bin/env bun
// the daemon — a long-lived process that plays.
//
// it holds the protocol pawns sse stream open and plays the moment it
// is the agent's turn.
//
// it is NOT a server. there is no http api and nothing talks to it.
// its state is written to a file, and that file is how a human — or
// another bin — finds out what it is doing.
//
// put it in a tmux session and leave it up:
//
//   tmux new -s chess
//   bun bin/chess_daemon.ts --account <account_id> --band 200
//
// the key it signs with is the LIMITED access key the human signed
// onto the account. without that key the daemon refuses to start —
// the human has to sign the add_key first.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
  shit_1170_chess_network_fun,
} from "../src/cli";
import { SHIT_1170_CHESS_DAEMON } from "../src/daemon";
import { shit_1170_chess_signer_find_fun } from "../src/signer";
import { shit_1170_chess_state_read_fun, shit_1170_chess_lock_claim_fun } from "../src/store";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: [
      "help",
      "no-matchmaking",
      "no-accept",
      "state",
      "agent-decides",
      "all-games",
    ],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_daemon --account <account_id> [--band <n>] [--no-matchmaking] [--no-accept]",
        "chess_daemon --state",
        "",
        "runs the daemon in the foreground. it does not return.",
        "--state reads the last written state instead of running.",
        "--band is the spread of the elo band it queues at. default 200.",
        "--agent-decides asks an agent to choose the moves. the daemon writes",
        "  the decision to a file and waits; the agent answers with the move.",
        "--agent-timeout is how long it waits, in ms. default 120000.",
        "--all-games plays every open game. the default is ONE game at a time.",
      ],
    });
    return;
  }

  // --state is the way to see what the daemon is doing without
  // interrupting it.
  if (args_bool_fun(args, "state")) {
    const state = shit_1170_chess_state_read_fun();
    print_json_fun({
      ok: true,
      running: state !== null,
      state,
    });
    return;
  }

  const network = shit_1170_chess_network_fun(args_string_fun(args, "network"));
  const account_id = args_string_fun(args, "account");
  if (!account_id) {
    throw new Error("--account is required. it is the account the daemon plays as.");
  }

  const band = args_number_fun(args, "band", 200) ?? 200;

  // the key is looked up BEFORE anything else, so a missing key is
  // said plainly rather than after the daemon has started doing things.
  const signer = shit_1170_chess_signer_find_fun(account_id);

  // the lock is taken before the daemon starts playing. one daemon
  // plays one account: two of them would each read the board, each
  // pick a move, and one of those moves would be stale by the time it
  // landed — the contract would refuse it, and it would cost gas.
  const lock = shit_1170_chess_lock_claim_fun(account_id);

  const daemon = new SHIT_1170_CHESS_DAEMON({
    account_id,
    band,
    matchmake: !args_bool_fun(args, "no-matchmaking"),
    accept: !args_bool_fun(args, "no-accept"),
    agent_decides: args_bool_fun(args, "agent-decides"),
    agent_timeout_ms:
      args_number_fun(args, "agent-timeout", 120_000) ?? 120_000,
    one_game_at_a_time: !args_bool_fun(args, "all-games"),
  });

  // the daemon writes its state to a file, so the details go to stderr
  // and the file is the answer.
  console.error(
    JSON.stringify({
      ok: true,
      account_id,
      band,
      network,
      public_key: signer.public_key,
      receiver_id: signer.receiver_id,
      method_names: signer.method_names,
      state_file: `${process.env.SHIT_1170_REX_HOME ?? `${process.env.HOME}/.shit-1170-rex-engine`}/chess/daemon.json`,
    }),
  );

  // the daemon runs until it is stopped. ctrl-c ends it.
  const stop = () => {
    daemon.stop_fun();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // the lock goes when the daemon goes, however it goes. a signal
  // ends the process without the `exit` handler running, so the
  // signal handlers release it too.
  const release = () => lock.release();
  process.on("exit", release);
  process.on("SIGINT", release);
  process.on("SIGTERM", release);

  await daemon.run_fun();
  release();
});
