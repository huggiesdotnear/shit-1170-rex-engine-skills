#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  shit_1170_key_generated_of_fun,
  shit_1170_key_make_fun,
  shit_1170_keys_db_open_fun,
  shit_1170_keys_db_put_fun,
  SHIT_1170_KEY_WORD_COUNTS,
} from "../src/index";

// make a LIMITED ACCESS KEY.
//
// --- WHAT THIS DOES ---
// it makes a key pair and keeps it. the key is stored in the local
// sqlite store with its private key, and — when `--seed` was asked for —
// with the seed phrase it was derived from.
//
// the key is NOT added to any account here. adding it is
// `key_queue_add.ts`, which queues the addition for a human to approve.
//
// --- WHY THE SECRET IS STORED AND NOT PRINTED ---
// the secret never leaves the machine. the answer says which public key
// was made and where it was saved. the seed phrase is printed only when
// `--show-seed` is asked for, because a phrase in a transcript is a
// phrase in a log.
//
// --- WHY `--seed` IS OPT-IN ---
// a random key is recovered by keeping the private key. a phrase-derived
// key is recovered by the phrase, which is the thing people know how to
// write down. most limited keys are thrown away when the job is done,
// and a recovery phrase for a throwaway key is a liability.

function main_fun(): void {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "seed", "show-seed"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "key_generate [--seed] [--word-count <n>] [--path <derivation-path>] [--show-seed]",
        "key_generate --seed --show-seed   # print the seed phrase too",
        "--seed derives the key from a new BIP-39 phrase; without it the key is random",
      ],
    });
    return;
  }

  const seed = args_bool_fun(args, "seed");
  const showSeed = args_bool_fun(args, "show-seed");

  if (showSeed && !seed) {
    throw new Error(
      "--show-seed needs --seed: a random key has no phrase that recovers it",
    );
  }

  const wordCountRaw = args_number_fun(args, "word-count");
  const wordCount =
    wordCountRaw === undefined ? undefined : (wordCountRaw as 12 | 15 | 18 | 21 | 24);

  if (wordCount !== undefined && !SHIT_1170_KEY_WORD_COUNTS.includes(wordCount)) {
    throw new Error(
      `--word-count must be one of ${SHIT_1170_KEY_WORD_COUNTS.join(", ")}, got ${wordCount}`,
    );
  }

  const made = shit_1170_key_make_fun({
    seed,
    ...(wordCount === undefined ? {} : { word_count: wordCount }),
    ...(args_string_fun(args, "path") === undefined
      ? {}
      : { path: args_string_fun(args, "path") as string }),
  });

  const generated = shit_1170_key_generated_of_fun(made);

  const store = shit_1170_keys_db_open_fun();
  try {
    shit_1170_keys_db_put_fun(store.db, generated);
  } finally {
    store.db.close();
  }

  print_json_fun({
    ok: true,
    public_key: generated.public_key,
    seed_phrase: showSeed ? generated.seed_phrase : null,
    derivation_path: generated.derivation_path,
    recoverable: generated.seed_phrase !== null,
    store_path: store.path,
    note: showSeed
      ? "the seed phrase is above and it is now in the store. anybody who reads it controls the key."
      : "the private key is in the store and was not printed.",
  });
}

try {
  main_fun();
} catch (err) {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
