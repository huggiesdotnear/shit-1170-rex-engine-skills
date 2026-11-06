#!/usr/bin/env bun
import {
  args_bool_fun,
  args_number_fun,
  args_require_string_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import {
  SHIT_1170_FASTFS_DEFAULT_RECEIVER,
  shit_1170_fastfs_url_fun,
} from "../src/index";

// poll the URL a FastFS file is served at.
//
// --- WHY THE CACHE-BUSTING QUERY ---
// the FastFS CDN CACHES 404s. a request for a file that does not
// exist yet comes back 404, and Cloudflare stores that answer and
// serves it again from its cache afterwards. so a poll of the clean
// URL can keep seeing a 404 for a file that was indexed a minute
// ago — the CDN is answering from its own memory of a miss.
//
// so every request carries a `?v=<random>` query. it makes the URL
// unique, so the CDN asks the origin instead of answering from the
// cache, and the 404 that comes back is a FRESH one.
//
// --- WHY THE POLL IS BOUNDED ---
// an agent cannot wait forever for a human, and a file that never
// appears is a real answer. `--for` sets the deadline.
//
// --- THE RECEIPT IS NOT THE ANSWER ---
// a FastFS upload's receipt FAILS by design — the receiver has no
// contract. the answer to "is the file there?" is this URL, not the
// receipt.

const SHIT_1170_FASTFS_STATUS_MAX_SECONDS = 600;
const SHIT_1170_FASTFS_STATUS_DEFAULT_SECONDS = 60;
const SHIT_1170_FASTFS_STATUS_DEFAULT_INTERVAL_MS = 3000;

function shit_1170_fastfs_sleep_fun(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help"],
  });
  if (args.positional[0] === "help" || args_bool_fun(args, "help")) {
    print_json_fun({
      ok: true,
      usage: [
        "fastfs_status --url <url> [--for <seconds>] [--interval <ms>]",
        "fastfs_status --predecessor <account_id> [--receiver <account_id>] --relative-path <path> [--for <seconds>] [--interval <ms>]",
      ],
    });
    return;
  }

  const urlFlag = args_string_fun(args, "url");
  const predecessor = args_string_fun(args, "predecessor");
  const receiver = args_string_fun(args, "receiver") ?? SHIT_1170_FASTFS_DEFAULT_RECEIVER;
  const relativePath = args_string_fun(args, "relative-path");

  let url: string;
  if (urlFlag) {
    url = urlFlag;
  } else {
    if (!predecessor) {
      throw new Error("--url is required, or --predecessor with --relative-path");
    }
    if (!relativePath) {
      throw new Error("--url is required, or --predecessor with --relative-path");
    }
    url = shit_1170_fastfs_url_fun(predecessor, receiver, relativePath);
  }

  const forSeconds = Math.min(
    args_number_fun(args, "for", SHIT_1170_FASTFS_STATUS_DEFAULT_SECONDS) ??
      SHIT_1170_FASTFS_STATUS_DEFAULT_SECONDS,
    SHIT_1170_FASTFS_STATUS_MAX_SECONDS,
  );
  const intervalMs = Math.max(
    250,
    args_number_fun(args, "interval", SHIT_1170_FASTFS_STATUS_DEFAULT_INTERVAL_MS) ??
      SHIT_1170_FASTFS_STATUS_DEFAULT_INTERVAL_MS,
  );

  const deadline = Date.now() + forSeconds * 1000;
  const attempts: Array<{
    at: string;
    status: number | null;
    error: string | null;
  }> = [];

  let found = false;
  let lastStatus: number | null = null;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    // the cache-busting query. a fresh random value on every request,
    // so the CDN never answers from a cached miss.
    const busted = `${url}${url.includes("?") ? "&" : "?"}v=${Math.random()
      .toString(36)
      .slice(2)}`;

    try {
      const response = await fetch(busted, {
        method: "GET",
        headers: { "cache-control": "no-cache" },
      });
      lastStatus = response.status;
      lastError = null;
      attempts.push({
        at: new Date().toISOString(),
        status: response.status,
        error: null,
      });
      if (response.status === 200) {
        found = true;
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      attempts.push({
        at: new Date().toISOString(),
        status: null,
        error: lastError,
      });
    }

    await shit_1170_fastfs_sleep_fun(intervalMs);
  }

  print_json_fun({
    ok: found,
    action: "fastfs_status",
    url,
    found,
    status: lastStatus,
    error: lastError,
    attempts: attempts.length,
    forSeconds,
    intervalMs,
    history: attempts,
    note: found
      ? "the file is served. the failed receipt of the upload is expected and means nothing."
      : "the file is not served yet. the indexer needs the final block, then about 2-3 seconds. a 404 here is not a broken upload.",
  });

  if (!found) process.exitCode = 1;
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
