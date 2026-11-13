#!/usr/bin/env bun
// the decisions waiting for an agent, and the answer to one.
//
// --- WHAT THIS IS FOR ---
// the daemon can be told to ask an agent to choose the moves instead
// of choosing them itself. when it does, it writes a request file and
// waits.
//
// this bin shows what is waiting, and takes the answer.
//
// --- THE TWO COMMANDS ---
//   chess_agent_decide --list
//     the requests waiting for an answer.
//
//   chess_agent_decide --answer '<id>' --mv <move>
//     the answer. the move is checked against the request's legal
//     moves, and an illegal move is refused without anything being
//     signed.
//
// the id is the game's json array, in the form the file names use:
//   '[224274262,"sleet.near",null]'
//
// --- WHY THE MOVE IS CHECKED ---
// the contract would reject an illegal move, and a rejected move is a
// failed transaction that still costs gas. the check happens here, so
// a wrong answer costs nothing.

import {
  args_bool_fun,
  args_string_fun,
  parse_args_fun,
  print_json_fun,
  shit_1170_chess_main_fun,
} from "../src/cli";
import {
  shit_1170_chess_answer_read_fun,
  shit_1170_chess_decision_clear_fun,
  shit_1170_chess_request_write_fun,
} from "../src/store";
import {
  shit_1170_chess_decisions_dir_fun,
  shit_1170_chess_request_path_fun,
} from "../src/paths";
import { shit_1170_chess_move_matches_fun } from "../src/move";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

await shit_1170_chess_main_fun(async () => {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "list"],
  });

  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "chess_agent_decide --list",
        "chess_agent_decide --id '<game_id>' --mv <move> [--note <text>]",
        "",
        "--list shows the decisions waiting for an answer.",
        "--id is the request's id, which is the game's json array.",
        "--mv is the move. it is checked against the legal moves first.",
      ],
    });
    return;
  }

  // --- THE LIST ---
  if (args_bool_fun(args, "list")) {
    const dir = shit_1170_chess_decisions_dir_fun();
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      files = [];
    }

    const requests = files
      .filter((file) => file.endsWith(".request.json"))
      .map((file) => {
        const path = join(dir, file);
        try {
          const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
            string,
            unknown
          >;
          const answered = shit_1170_chess_answer_read_fun(
            String(parsed.id ?? ""),
          );
          return {
            id: parsed.id,
            game_id: parsed.game_id,
            asked_at: parsed.asked_at,
            answered: Boolean(answered?.mv),
            position: parsed.position,
            recommended: parsed.recommended,
            candidate_count: Array.isArray(parsed.candidates)
              ? (parsed.candidates as unknown[]).length
              : 0,
          };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );

    print_json_fun({
      ok: true,
      count: requests.length,
      requests,
      what: "the decisions waiting for an agent",
      how_to_answer:
        "chess_agent_decide --id '<game_id>' --mv <move>. the id is the game_id, in the form the file names use.",
    });
    return;
  }

  // --- THE ANSWER ---
  //
  // the id is the request's id, which is the game's json array. it
  // is taken with `--id`, and `--answer` is the flag that says this
  // is an answer rather than a listing.
  const id = args_string_fun(args, "id");
  if (!id) {
    throw new Error(
      "--id is required. it is the request's id, which is the game's json array.",
    );
  }

  const mv = args_string_fun(args, "mv");
  if (!mv) {
    throw new Error("--mv is required. it is the move to play.");
  }

  // the request is read, so the move can be checked against the legal
  // moves it offers.
  let request: Record<string, unknown>;
  try {
    request = JSON.parse(
      readFileSync(shit_1170_chess_request_path_fun(id), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new Error(
      `there is no request with the id ${id}. run with --list to see what is waiting.`,
    );
  }

  const candidates = (request.candidates ?? []) as Array<{
    mv: string;
    san: string;
    rank: number;
    score: number;
  }>;

  const match = candidates.find((candidate) =>
    shit_1170_chess_move_matches_fun(candidate, mv),
  );

  if (!match) {
    print_json_fun({
      ok: false,
      error: `"${mv}" is not one of the legal moves for this position. nothing was signed.`,
      id,
      legal_moves: candidates.map((candidate) => candidate.mv),
      note: "the legal moves are the ones the contract would accept. the notation is the contract's own: two squares joined.",
    });
    throw new Error("the move is not legal in this position.");
  }

  // the answer is written where the daemon is waiting for it.
  const note = args_string_fun(args, "note");
  const answer_path = join(
    shit_1170_chess_decisions_dir_fun(),
    `${id}.answer.json`,
  );
  await Bun.write(
    answer_path,
    `${JSON.stringify({ mv: match.mv, san: match.san, note: note ?? null }, null, 2)}\n`,
  );

  print_json_fun({
    ok: true,
    id,
    mv: match.mv,
    san: match.san,
    note: note ?? null,
    what: `answered the decision ${id} with ${match.san}`,
  });
});
