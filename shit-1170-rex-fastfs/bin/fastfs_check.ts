#!/usr/bin/env bun
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  SHIT_1170_FASTFS_CHUNK_SIZE,
  SHIT_1170_FASTFS_DEFAULT_RECEIVER,
  SHIT_1170_FASTFS_MAX_FULL_SIZE,
  SHIT_1170_FASTFS_MAX_MIME_LENGTH,
  SHIT_1170_FASTFS_MAX_PATH_LENGTH,
  shit_1170_fastfs_mime_guess_fun,
  shit_1170_fastfs_plan_fun,
} from "../src/index";

// inspect a file before uploading it.
//
// --- WHY THIS BIN IS STRICT ---
// the indexer DROPS what fails its validation. silently. there is no
// error, no failed receipt, nothing — the file just never appears at
// its URL, and the only evidence is a 404 that the CDN then caches.
// so every limit the indexer enforces is checked here, BEFORE the
// payload is queued, and each failure NAMES the limit it broke.
//
// a check that passes is a claim the human can rely on. a check that
// says nothing is a claim the human cannot.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "fastfs_check --file <path> [--relative-path <path>] [--mime <type>] [--receiver <account_id>]",
      ],
    });
    return;
  }

  const file = args_require_string_fun(args, "file");
  const receiver = args_string_fun(args, "receiver") ?? SHIT_1170_FASTFS_DEFAULT_RECEIVER;

  const stats = statSync(file);
  const size = stats.size;

  const relativePath =
    args_string_fun(args, "relative-path") ?? basename(file);

  const guessed = shit_1170_fastfs_mime_guess_fun(basename(file));
  const explicitMime = args_string_fun(args, "mime");
  const mime = explicitMime ?? guessed;

  // the plan: one call or a chunk per 1 MiB.
  const plan = shit_1170_fastfs_plan_fun(size);

  const errors: string[] = [];
  const warnings: string[] = [];

  // --- THE PATH ---
  if (relativePath.length === 0) {
    errors.push("the relative path is empty");
  }
  if (relativePath.length > SHIT_1170_FASTFS_MAX_PATH_LENGTH) {
    errors.push(
      `the relative path is ${relativePath.length} characters; the limit is ${SHIT_1170_FASTFS_MAX_PATH_LENGTH} characters and the indexer drops anything over it`,
    );
  }

  // --- THE MIME ---
  if (!mime) {
    errors.push(
      "the mime type could not be guessed from the file name; pass --mime <type>",
    );
  } else {
    if (mime.length === 0) {
      errors.push(
        "the mime type is empty; the limit is a non-empty mime type and the indexer drops a file with none",
      );
    }
    if (mime.length > SHIT_1170_FASTFS_MAX_MIME_LENGTH) {
      errors.push(
        `the mime type is ${mime.length} characters; the limit is ${SHIT_1170_FASTFS_MAX_MIME_LENGTH} characters and the indexer drops anything over it`,
      );
    }
    if (!explicitMime && guessed) {
      warnings.push(
        `the mime type ${mime} was guessed from the file's extension; pass --mime to state it yourself`,
      );
    }
  }

  // --- THE SIZE ---
  if (size === 0) {
    warnings.push(
      "the file is empty; a zero-byte upload is a delete, not an upload",
    );
  }
  if (size > SHIT_1170_FASTFS_MAX_FULL_SIZE) {
    errors.push(
      `the file is ${size} bytes; the limit is ${SHIT_1170_FASTFS_MAX_FULL_SIZE} bytes (32 MiB) and the indexer refuses anything over it`,
    );
  }

  const payloadSizes = plan.chunked
    ? Array.from({ length: plan.chunkCount }, (_, index) => {
        const offset = index * SHIT_1170_FASTFS_CHUNK_SIZE;
        return Math.min(
          SHIT_1170_FASTFS_CHUNK_SIZE,
          size - offset,
        );
      })
    : [size];

  print_json_fun({
    ok: errors.length === 0,
    action: "check_fastfs_upload",
    file,
    receiver,
    relativePath,
    pathLength: relativePath.length,
    mime: mime ?? null,
    mimeGuessed: !explicitMime && guessed !== null,
    size,
    fitsInOneCall: !plan.chunked,
    chunked: plan.chunked,
    chunkCount: plan.chunkCount,
    transactionCount: plan.transactionCount,
    chunkSize: SHIT_1170_FASTFS_CHUNK_SIZE,
    payloadSizes,
    maxFullSize: SHIT_1170_FASTFS_MAX_FULL_SIZE,
    errors,
    warnings,
    note:
      "the receipt of a FastFS call fails with CodeDoesNotExist by design; the FastData indexer reads the transaction, not the receipt.",
  });

  // a check that found a broken limit is a REFUSAL. the exit code
  // says so, so a script that checks a file before uploading it stops
  // on the failure instead of carrying it into the queue.
  if (errors.length > 0) process.exitCode = 2;
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
