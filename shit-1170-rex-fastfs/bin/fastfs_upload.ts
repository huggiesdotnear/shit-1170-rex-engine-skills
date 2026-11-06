#!/usr/bin/env bun
import { readFileSync } from "node:fs";
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
  shit_1170_fastfs_decode_fun,
  shit_1170_fastfs_mime_guess_fun,
  shit_1170_fastfs_plan_fun,
  shit_1170_fastfs_upload_fun,
  shit_1170_fastfs_validate_partial_fun,
  shit_1170_fastfs_validate_simple_fun,
} from "../src/index";

// prepare a FastFS upload.
//
// --- THE AGENT NEVER CALLS THE CONTRACT ---
// this bin does not queue anything and does not send anything. it
// prints the QUEUE PAYLOAD — `{ contractId, method, argsBase64, gas,
// deposit }` — which the engine queues for a HUMAN to sign in the web
// app with their wallet.
//
// --- WHY THE RECEIPT WILL FAIL ---
// the receiver has no contract, so the call cannot succeed and the
// receipt fails with `CodeDoesNotExist`. that is the EXPECTED shape
// of a FastFS upload: the FastData indexer reads the transaction, not
// the receipt. do not read the failed receipt as a broken upload —
// verify through the serving URL instead.
//
// --- WHY THE BYTES GO IN `argsBase64` ---
// a FastFS call has no argument object. its args are RAW BORSH BYTES,
// and the indexer does `borsh::from_slice(&action.args)` on them
// directly. JSON cannot carry raw bytes, so the queue payload carries
// them base64-encoded in `argsBase64` and the engine decodes them
// back before the action is built.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "fastfs_upload --file <path> [--relative-path <path>] [--receiver <account_id>] [--mime <type>] [--gas <n>] [--deposit <n>]",
      ],
    });
    return;
  }

  const file = args_require_string_fun(args, "file");
  const receiver = args_string_fun(args, "receiver") ?? SHIT_1170_FASTFS_DEFAULT_RECEIVER;
  const gas = args_string_fun(args, "gas");
  const deposit = args_string_fun(args, "deposit");

  const bytes = new Uint8Array(readFileSync(file));

  // the path inside the namespace. it defaults to the file's base
  // name, which is what a person means by "upload this picture".
  const relativePath =
    args_string_fun(args, "relative-path") ?? basename(file);

  // the mime type. the guess is a convenience over a small table;
  // `--mime` always wins, and a file whose extension is not in the
  // table needs it.
  const guessed = shit_1170_fastfs_mime_guess_fun(basename(file));
  const mime = args_string_fun(args, "mime") ?? guessed;
  if (!mime) {
    throw new Error(
      `the mime type of ${basename(file)} could not be guessed; pass --mime <type>`,
    );
  }

  // the plan: one `Simple` call, or one `Partial` call per chunk.
  const plan = shit_1170_fastfs_plan_fun(bytes.length);

  // --- THE CHECKS THAT SAVE A BAD UPLOAD ---
  // the indexer DROPS what fails these, silently. there is no failed
  // receipt, no error, nothing. so they are checked here, before the
  // payload is queued, where the human can still be told which limit
  // was broken.
  const errors: string[] = [];

  if (relativePath.length === 0) {
    errors.push("the relative path is empty");
  }
  if (relativePath.length > SHIT_1170_FASTFS_MAX_PATH_LENGTH) {
    errors.push(
      `the relative path is ${relativePath.length} characters; the indexer drops anything over ${SHIT_1170_FASTFS_MAX_PATH_LENGTH}`,
    );
  }
  if (mime.length === 0) {
    errors.push("the mime type is empty; the indexer drops a file with no mime type");
  }
  if (mime.length > SHIT_1170_FASTFS_MAX_MIME_LENGTH) {
    errors.push(
      `the mime type is ${mime.length} characters; the indexer drops anything over ${SHIT_1170_FASTFS_MAX_MIME_LENGTH}`,
    );
  }
  if (bytes.length > SHIT_1170_FASTFS_MAX_FULL_SIZE) {
    errors.push(
      `the file is ${bytes.length} bytes; the indexer refuses anything over ${SHIT_1170_FASTFS_MAX_FULL_SIZE} (32 MiB)`,
    );
  }

  if (errors.length > 0) {
    print_error_fun(errors.join("; "));
    process.exitCode = 2;
    return;
  }

  const uploads: ReturnType<typeof shit_1170_fastfs_upload_fun>[] = [];

  if (!plan.chunked) {
    // one whole file in one transaction.
    const validation = shit_1170_fastfs_validate_simple_fun(
      relativePath,
      mime,
      true,
    );
    if (!validation.ok) {
      print_error_fun(validation.errors.join("; "));
      process.exitCode = 2;
      return;
    }
    uploads.push(
      shit_1170_fastfs_upload_fun({
        receiver,
        relative_path: relativePath,
        mime_type: mime,
        bytes,
        gas,
        deposit,
      }),
    );
  } else {
    // one transaction per 1 MiB chunk. every chunk carries the SAME
    // full size and the SAME nonce — that is what tells the indexer
    // the chunks belong to one file. a fresh nonce is what makes a
    // re-upload of the same path a different file.
    for (let index = 0; index < plan.chunkCount; index += 1) {
      const offset = index * SHIT_1170_FASTFS_CHUNK_SIZE;
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + SHIT_1170_FASTFS_CHUNK_SIZE, bytes.length),
      );
      const validation = shit_1170_fastfs_validate_partial_fun(
        relativePath,
        offset,
        plan.fullSize,
        mime,
        chunk.length,
        plan.nonce,
      );
      if (!validation.ok) {
        print_error_fun(
          `chunk ${index} at offset ${offset}: ${validation.errors.join("; ")}`,
        );
        process.exitCode = 2;
        return;
      }
      uploads.push(
        shit_1170_fastfs_upload_fun({
          receiver,
          relative_path: relativePath,
          mime_type: mime,
          bytes: chunk,
          offset,
          full_size: plan.fullSize,
          nonce: plan.nonce,
          gas,
          deposit,
        }),
      );
    }
  }

  // the decoded payload is printed alongside the base64, so the human
  // can see what was actually encoded without decoding it by hand.
  const decoded = uploads.map((upload) => {
    const data = shit_1170_fastfs_decode_fun(upload.bytes);
    if (data.kind === "simple") {
      return {
        kind: data.kind,
        relativePath: data.relativePath,
        mimeType: data.content?.mimeType ?? null,
        contentLength: data.content?.content.length ?? 0,
        isDelete: data.content === null,
      };
    }
    return {
      kind: data.kind,
      relativePath: data.relativePath,
      offset: data.offset,
      fullSize: data.fullSize,
      mimeType: data.mimeType,
      contentLength: data.contentChunk.length,
      nonce: data.nonce,
    };
  });

  print_json_fun({
    ok: true,
    action: "queue_fastfs_upload",
    file,
    receiver,
    relativePath,
    mime,
    mimeGuessed: !args_string_fun(args, "mime") && guessed !== null,
    size: bytes.length,
    chunked: plan.chunked,
    chunkCount: plan.chunkCount,
    nonce: plan.nonce,
    transactions: uploads.map((upload) => upload.transaction),
    transaction: uploads[0]?.transaction,
    decoded,
    note:
      "the receipt of this call fails with CodeDoesNotExist by design; the FastData indexer reads the transaction, not the receipt. verify through the serving URL.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
