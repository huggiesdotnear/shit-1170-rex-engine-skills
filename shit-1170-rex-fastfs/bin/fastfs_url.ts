#!/usr/bin/env bun
import {
  args_bool_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  SHIT_1170_FASTFS_DEFAULT_RECEIVER,
  shit_1170_fastfs_url_fun,
  shit_1170_fastfs_uri_fun,
} from "../src/index";

// the URL a FastFS file is served at.
//
// --- WHY THE PREDECESSOR IS THE HOST ---
// the file lives under the account that SIGNED the transaction — the
// receipt's predecessor id — and the receiver is the namespace inside
// it. the real mainnet upload was signed by `mob.near` to
// `fastfs.near`, and the file is at
// `https://mob.near.fastfs.io/fastfs.near/fastnear.png`.
//
// the predecessor is NOT the receiver, and it is not the file's
// owner in any other sense: it is whichever account the human signed
// with. a different signer means a different URL for the same path.

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "fastfs_url --predecessor <account_id> [--receiver <account_id>] --relative-path <path>",
      ],
    });
    return;
  }

  const predecessor = args_require_string_fun(args, "predecessor");
  const receiver = args_string_fun(args, "receiver") ?? SHIT_1170_FASTFS_DEFAULT_RECEIVER;
  const relativePath = args_require_string_fun(args, "relative-path");

  const url = shit_1170_fastfs_url_fun(predecessor, receiver, relativePath);
  const uri = shit_1170_fastfs_uri_fun(predecessor, receiver, relativePath);

  print_json_fun({
    ok: true,
    predecessor,
    receiver,
    relativePath,
    url,
    uri,
    note:
      "the predecessor is the account that signed the transaction. the file is served only after the indexer has processed the final block, and the CDN caches 404s — poll with a cache-busting query.",
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
