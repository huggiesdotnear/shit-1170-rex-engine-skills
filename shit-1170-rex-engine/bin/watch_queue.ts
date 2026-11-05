#!/usr/bin/env bun
// watch the live feed.
//
// the engine's feed is a websocket. the server pushes every new
// queued batch and every new queued swap to every connected client.
// this bin listens, prints each matching event as json on its own
// line, and refreshes the local copy as the items change.
//
// --- WHY THE WATCH IS BOUNDED ---
// every other bin runs once and exits with one json object. a socket
// that never ends does not fit that shape, and an agent cannot wait
// forever for a human. so the watch has a deadline, and it prints a
// summary when the deadline arrives.
//
// --- WHY THE SOCKET IS NOT THE SOURCE OF TRUTH ---
// the socket says THAT something changed. the engine's own routes say
// WHAT it is — the status, the hash, the whole item. so the watch
// refreshes the local record from the server on every event, and the
// local copy is current when the bin exits.
//
// --- WHY THE FILTERS ARE THE LIST ROUTE'S FILTERS ---
// the engine's list routes take account_id, contract_id, method,
// token_in and token_out. the socket is filter-agnostic — the server
// carries everything and the client decides — so the same names and
// the same meaning are used here. one filter vocabulary covers both
// reading and watching.
//
// --- WHY A WATCH WITH NO FILTERS IS THE GENERAL CASE ---
// an agent that only wants to know that work is happening does not
// care what the work is. with no filter, every new post matches.

import {
  args_bool_fun,
  args_number_fun,
  args_string_fun,
  parse_args_fun,
  print_error_fun,
  print_json_fun,
} from "@huggies/shit-1170-rex-engine-middleman";

import { shit_1170_base_url_fun } from "../src/engine";
import {
  shit_1170_queue_record_get_fun,
  shit_1170_queue_record_put_fun,
} from "../src/local_queue";
import {
  shit_1170_watch_open_fun,
  shit_1170_watch_reached_fun,
  type SHIT_1170_WATCH_UNTIL,
  type SHIT_1170_WATCH_FILTER,
} from "../src/watch";
import { shit_1170_account_resolve_fun } from "../src/keyring";

/** the default how long a watch listens. */
const SHIT_1170_WATCH_DEFAULT_SECONDS = 60;

// the states a watch can stop on.
const SHIT_1170_WATCH_UNTILS: SHIT_1170_WATCH_UNTIL[] = [
  "any",
  "sent",
  "succeeded",
  "failed",
];

function parse_until_fun(value: string | undefined): SHIT_1170_WATCH_UNTIL {
  if (value === undefined) return "any";
  if (!(SHIT_1170_WATCH_UNTILS as string[]).includes(value)) {
    throw new Error(
      `--until must be one of ${SHIT_1170_WATCH_UNTILS.join(", ")}`,
    );
  }
  return value as SHIT_1170_WATCH_UNTIL;
}

/**
 * refresh one local record from the server.
 *
 * the local record keeps the request as the agent wrote it and the
 * response as the server last answered. a changed response is
 * evidence that something happened — the human sent it, or another
 * account did.
 */
async function refresh_fun(
  kind: "tx" | "swap",
  id: string,
  server: Record<string, unknown>,
): Promise<boolean> {
  const existing = await shit_1170_queue_record_get_fun(kind, id);
  const changed =
    JSON.stringify(existing?.response ?? null) !== JSON.stringify(server);
  if (existing) {
    await shit_1170_queue_record_put_fun({
      kind,
      id,
      request: existing.request,
      response: server,
    });
  }
  return changed;
}

async function main_fun(): Promise<void> {
  const args = parse_args_fun(process.argv.slice(2), {
    boolean_flags: ["help", "hide-sent"],
  });

  // --- WHY THERE IS NO COMMAND WORD ---
  // every other bin takes a command as its first word. this one does
  // not: a watch is a filter, and a filter is flags. so the bin watches
  // unless it was asked for help. the only positional that means
  // anything is `help`.
  const wants_help =
    args.positional[0] === "help" || args_bool_fun(args, "help");
  if (wants_help) {
    print_json_fun({
      ok: true,
      usage: [
        "watch_queue [--queue <id>] [--for <seconds>] [--until any|sent|succeeded|failed]",
        "watch_queue [--account-id a,b] [--contract-id c,d] [--method m]",
        "watch_queue [--token-in <id>] [--token-out <id>] [--hide-sent]",
        "watch_queue --for <seconds>   # no filter: watch everything the engine queues",
        "prints one json event per line on stdout, then a summary object",
      ],
    });
    return;
  }

  const profile = await shit_1170_account_resolve_fun(
    args_string_fun(args, "account"),
  );
  const baseUrl = shit_1170_base_url_fun(
    args_string_fun(args, "base-url") ?? profile.baseUrl,
  );

  const seconds = args_number_fun(
    args,
    "for",
    SHIT_1170_WATCH_DEFAULT_SECONDS,
  );
  if (seconds === undefined || seconds <= 0) {
    throw new Error("--for must be a positive number of seconds");
  }

  const until = parse_until_fun(args_string_fun(args, "until"));

  const filter: SHIT_1170_WATCH_FILTER = {
    account_id: args_string_fun(args, "account-id"),
    contract_id: args_string_fun(args, "contract-id"),
    method: args_string_fun(args, "method"),
    token_in: args_string_fun(args, "token-in"),
    token_out: args_string_fun(args, "token-out"),
    hide_sent: args_bool_fun(args, "hide-sent"),
    id: args_string_fun(args, "queue"),
  };

  // --- THE OWN ACCOUNT ------------------
  // the `hide_sent` filter is about the reader's OWN account, so the
  // account has to be known. the keyring knows it without a round
  // trip to the server.
  const ownAccountId = profile.accountId ?? null;

  // --- THE SEEN ------------------------
  // the ids already seen, so the same post is not printed twice when
  // the server pushes it again — a send pushes the same id.
  const seen = new Set<string>();
  const events: Record<string, unknown>[] = [];

  // --- THE LOG -------------------------
  // the log goes to stderr, and stdout stays pure json for the events.
  //
  // --- WHY --- THE LOG SAYS EVERYTHING: a watch that is quiet is
  // ambiguous. it can mean the engine is quiet, the filter is wrong,
  // or the socket never connected — and those need different fixes.
  // so the log says which filter is in effect, when the socket came up,
  // and why a post that arrived was not shown.
  const log = (message: string): void => {
    process.stderr.write(`[watch_queue] ${message}\n`);
  };

  const filterText = Object.entries(filter)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");

  log(`watching ${baseUrl} for ${seconds}s, until ${until}`);
  log(
    filterText.length > 0
      ? `filter: ${filterText}`
      : "filter: none — every new post matches",
  );
  if (ownAccountId) {
    log(`own account: ${ownAccountId}`);
  }

  let reached = false;
  let done = false;
  let connected = false;

  const handle = shit_1170_watch_open_fun(
    baseUrl,
    filter,
    ownAccountId,
    (seen_event) => {
      const key = `${seen_event.kind}:${seen_event.id}`;
      const isNew = !seen.has(key);
      if (isNew) seen.add(key);

      // --- THE LOCAL COPY IS REFRESHED ---
      // the socket says something changed; the server says what. so the
      // record is refreshed from the server, and the local copy is
      // current the moment the watch ends.
      const item =
        seen_event.event.type === "queue"
          ? (seen_event.event.queue as unknown as Record<string, unknown>)
          : (seen_event.event.swap as unknown as Record<string, unknown>);

      // the wire says `queue`; the local record says `tx`. the local
      // store names a batch `tx`, so that is what it is called there.
      const kind = seen_event.kind === "queue" ? "tx" : "swap";

      log(
        `${isNew ? "new" : "again"} ${seen_event.kind} ${seen_event.id} ` +
          `[${seen_event.statuses.join(", ") || "no accounts"}]`,
      );

      void refresh_fun(kind, seen_event.id, item).then((changed) => {
        const line = {
          ok: true,
          event: seen_event.kind,
          id: seen_event.id,
          statuses: seen_event.statuses,
          new: isNew,
          localChanged: changed,
        };
        events.push(line);
        // one json object per line, so a reader can take them one at
        // a time while the watch is still running.
        process.stdout.write(`${JSON.stringify(line)}\n`);
      });

      if (shit_1170_watch_reached_fun(seen_event.event, until)) {
        reached = true;
        done = true;
        log(`reached ${until} — the watch ends`);
      }
    },
    (message) => {
      // a socket that dies is a socket the middleman reconnects with
      // a backoff. the reader does not need to be told about a
      // dropped connection that is already being repaired — but it
      // DOES need to know the socket is not up right now, because that
      // is the difference between a quiet engine and a dead watch.
      connected = false;
      log(`socket: ${message}`);
      process.stderr.write(
        `${JSON.stringify({ ok: false, warning: message })}\n`,
      );
    },
    (info) => {
      // --- WHY --- THE CONNECTION IS ANNOUNCED: this is the line that
      // tells a reader the watch is actually watching. without it, a
      // quiet watch and a dead socket look the same.
      connected = true;
      log(
        `connected to ${info.url} ` +
          `(attempt ${info.attempt}, waited ${info.waited_ms}ms)`,
      );
    },
    (skipped) => {
      // --- WHY --- A FILTERED-OUT POST IS LOGGED: it arrived, and the
      // filter turned it away. saying so is the difference between
      // "the engine is quiet" and "the filter is too narrow".
      log(`skipped ${skipped.kind} ${skipped.id} — ${skipped.reason}`);
    },
  );

  // --- THE DEADLINE --------------------
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      done = true;
      resolve();
    }, seconds * 1000);

    const poll = setInterval(() => {
      if (done) {
        clearInterval(timer);
        clearInterval(poll);
        resolve();
      }
    }, 100);
  });

  handle.close();

  // --- THE LAST WORD -------------------
  // the summary says whether the socket was up when the watch ended. a
  // watch that never connected is not a quiet engine — it is a broken
  // watch, and the reader has to be able to tell the two apart.
  log(
    connected
      ? `the watch ended after ${seconds}s with ${events.length} event(s)`
      : `the watch ended after ${seconds}s and the socket was NOT connected — nothing could have arrived`,
  );

  print_json_fun({
    ok: true,
    watched: seconds,
    until,
    connected,
    reached,
    events,
  });
}

main_fun().catch((err) => {
  print_error_fun(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
