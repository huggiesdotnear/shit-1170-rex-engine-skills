// the live feed socket, for the agent.
//
// --- WHAT THIS IS ---
// the engine's feed is a websocket at GET /api/shit-1170/feed/ws. the
// server pushes one json text message per event:
//
//   { "type": "queue", "queue": { ...TX_QUEUE_ITEM... } }
//   { "type": "swap",  "swap":  { ...SWAP_QUEUE_ITEM... } }
//
// the socket is OPEN — no api key, no engine account — and it carries
// EVERY new post. it is FILTER-AGNOSTIC on purpose: the server does
// not know what the reader is looking at, so the CLIENT decides what
// matches. that is why the matching lives here and not on the wire.
//
// --- WHY THE SERVER IS STILL THE SOURCE OF TRUTH ---
// the socket tells the agent THAT something changed. it does not tell
// the agent what to do about it. the authoritative record — the
// status, the tx hash, the whole item — comes from the engine's own
// routes. so a watching agent waits on the socket and then reads the
// item from the server. the socket is the trigger, not the truth.
//
// --- WHY THE MATCH MIRRORS THE LIST ROUTES ---
// the list routes take account_id, contract_id, method, token_in and
// token_out. a filter here uses the same names and the same meaning,
// so one filter vocabulary covers both reading and watching. the
// backend's own sql decides what the list shows, and this match is
// written to agree with it — a live post and a refetch must not
// disagree about what belongs in the feed.
//
// --- WHY hide_sent IS ABOUT THE READER'S OWN ACCOUNT ---
// the `hide_sent` filter hides the entries the READER has sent. so it
// needs to know who the reader is, and the reader may have signed in
// after the watch began. the account is read at the moment the event
// arrives, not captured when the socket opened.

import {
  api_shit_1170_feed_ws,
  type SHIT_1170_FEED_WS_CONNECT,
  type SHIT_1170_FEED_WS_EVENT,
  type SHIT_1170_FEED_WS_HANDLE,
} from "@huggies/shit-1170-rex-engine-middleman";

/** the kinds of post the feed carries. */
export type SHIT_1170_WATCH_KIND = "queue" | "swap";

/**
 * what the agent wants to watch.
 *
 * every field is optional. with none of them set, the agent watches
 * everything the engine queues — the general case, when the agent
 * only wants to know that work is happening.
 */
export interface SHIT_1170_WATCH_FILTER {
  /** the account ids to match. a comma-separated list, as on the list routes. */
  account_id?: string;
  /** the contract ids to match. a comma-separated list. */
  contract_id?: string;
  /** the method name to match. */
  method?: string;
  /** the token sold, for a swap. */
  token_in?: string;
  /** the token bought, for a swap. */
  token_out?: string;
  /** drop the entries the reader's own account has sent. */
  hide_sent?: boolean;
  /** only the posts of this one queue or swap. */
  id?: string;
}

/** the statuses a queue or a swap account row can hold. */
export type SHIT_1170_WATCH_STATUS =
  | "pending"
  | "sent"
  | "succeeded"
  | "failed";

/**
 * the status a watch stops on.
 *
 * `any` is the default: the agent wants to know that SOMETHING
 * happened. the others stop the watch when the work reaches that
 * state — `sent` means the human signed, `succeeded` means the chain
 * says it worked.
 */
export type SHIT_1170_WATCH_UNTIL =
  | "any"
  | "sent"
  | "succeeded"
  | "failed";

function split_list_fun(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

/**
 * the accounts of a queue or a swap.
 *
 * the status lives on the ACCOUNT row, never on the item itself: a
 * queue is never "done", because any account on it may still send it.
 */
export interface SHIT_1170_WATCH_ACCOUNT {
  accountId: string;
  status: SHIT_1170_WATCH_STATUS;
  txHash: string | null;
}

function read_accounts_fun(value: unknown): SHIT_1170_WATCH_ACCOUNT[] {
  if (!Array.isArray(value)) return [];
  const out: SHIT_1170_WATCH_ACCOUNT[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const accountId = record.accountId;
    if (typeof accountId !== "string" || accountId.length === 0) continue;
    const status = record.status;
    out.push({
      accountId,
      status:
        status === "pending" ||
        status === "sent" ||
        status === "succeeded" ||
        status === "failed"
          ? status
          : "pending",
      txHash: typeof record.txHash === "string" ? record.txHash : null,
    });
  }
  return out;
}

/** the account ids of a queue or a swap, from the item's own rows. */
function read_account_ids_fun(item: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const account of read_accounts_fun(item.accounts)) {
    ids.add(account.accountId);
  }
  // the transactions carry their own account rows, and a batch can
  // name an account on a transaction that is not on the top-level
  // list. both are the same account.
  const transactions = item.transactions;
  if (Array.isArray(transactions)) {
    for (const transaction of transactions) {
      if (typeof transaction !== "object" || transaction === null) continue;
      const record = transaction as Record<string, unknown>;
      for (const account of read_accounts_fun(record.accounts)) {
        ids.add(account.accountId);
      }
    }
  }
  return [...ids];
}

/** the contract ids a queue's calls touch. */
function read_contract_ids_fun(item: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const transactions = item.transactions;
  if (Array.isArray(transactions)) {
    for (const transaction of transactions) {
      if (typeof transaction !== "object" || transaction === null) continue;
      const record = transaction as Record<string, unknown>;
      if (typeof record.contractId === "string" && record.contractId.length > 0) {
        ids.add(record.contractId);
      }
    }
  }
  return [...ids];
}

/** the method names a queue's calls use. */
function read_methods_fun(item: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const transactions = item.transactions;
  if (Array.isArray(transactions)) {
    for (const transaction of transactions) {
      if (typeof transaction !== "object" || transaction === null) continue;
      const record = transaction as Record<string, unknown>;
      if (typeof record.method === "string" && record.method.length > 0) {
        names.add(record.method);
      }
    }
  }
  return [...names];
}

/**
 * does this post match the filter?
 *
 * a filter with no fields set matches everything — that is the
 * general watch, where the agent only wants to know that work is
 * happening.
 */
export function shit_1170_watch_matches_fun(
  event: SHIT_1170_FEED_WS_EVENT,
  filter: SHIT_1170_WATCH_FILTER,
  own_account_id: string | null,
): boolean {
  const item =
    event.type === "queue"
      ? (event.queue as unknown as Record<string, unknown>)
      : (event.swap as unknown as Record<string, unknown>);

  if (filter.id) {
    const id =
      event.type === "queue" ? event.queue.queueId : event.swap.swapId;
    if (id !== filter.id) return false;
  }

  const accounts = read_account_ids_fun(item);

  const account_ids = split_list_fun(filter.account_id);
  if (account_ids.length > 0) {
    if (!accounts.some((one) => account_ids.includes(one))) return false;
  }

  const contract_ids = split_list_fun(filter.contract_id);
  if (contract_ids.length > 0) {
    const contracts = read_contract_ids_fun(item);
    if (!contracts.some((one) => contract_ids.includes(one))) return false;
  }

  if (filter.method) {
    const methods = read_methods_fun(item);
    if (!methods.includes(filter.method)) return false;
  }

  if (filter.token_in) {
    const tokenIn = item.tokenIn;
    if (typeof tokenIn !== "string" || tokenIn !== filter.token_in) {
      return false;
    }
  }

  if (filter.token_out) {
    const tokenOut = item.tokenOut;
    if (typeof tokenOut !== "string" || tokenOut !== filter.token_out) {
      return false;
    }
  }

  if (filter.hide_sent && own_account_id) {
    // the reader's own rows that have already gone out.
    const own = read_accounts_fun(item).filter(
      (one) =>
        one.accountId === own_account_id &&
        (one.status === "sent" ||
          one.status === "succeeded" ||
          one.status === "failed"),
    );
    if (own.length > 0) return false;
  }

  return true;
}

/**
 * why an event did not match, or null when it did.
 *
 * the reason is for the WATCH, which is a debugging tool: a post that
 * arrives and is not shown looks exactly like a post that never
 * arrived, and the difference is the whole question when a watch is
 * quiet. so the reason says which filter turned it away.
 */
export function shit_1170_watch_reason_fun(
  event: SHIT_1170_FEED_WS_EVENT,
  filter: SHIT_1170_WATCH_FILTER,
  own_account_id: string | null,
): string | null {
  const item =
    event.type === "queue"
      ? (event.queue as unknown as Record<string, unknown>)
      : (event.swap as unknown as Record<string, unknown>);

  if (filter.id) {
    const id =
      event.type === "queue" ? event.queue.queueId : event.swap.swapId;
    if (id !== filter.id) return `id: ${id} is not ${filter.id}`;
  }

  const accounts = read_account_ids_fun(item);
  const account_ids = split_list_fun(filter.account_id);
  if (account_ids.length > 0) {
    if (!accounts.some((one) => account_ids.includes(one))) {
      return `account_id: ${accounts.join(", ") || "(none)"} is not ${account_ids.join(", ")}`;
    }
  }

  const contract_ids = split_list_fun(filter.contract_id);
  if (contract_ids.length > 0) {
    const contracts = read_contract_ids_fun(item);
    if (!contracts.some((one) => contract_ids.includes(one))) {
      return `contract_id: ${contracts.join(", ") || "(none)"} is not ${contract_ids.join(", ")}`;
    }
  }

  if (filter.method) {
    const methods = read_methods_fun(item);
    if (!methods.includes(filter.method)) {
      return `method: ${methods.join(", ") || "(none)"} is not ${filter.method}`;
    }
  }

  if (filter.token_in) {
    const tokenIn = item.tokenIn;
    if (typeof tokenIn !== "string" || tokenIn !== filter.token_in) {
      return `token_in: ${String(tokenIn)} is not ${filter.token_in}`;
    }
  }

  if (filter.token_out) {
    const tokenOut = item.tokenOut;
    if (typeof tokenOut !== "string" || tokenOut !== filter.token_out) {
      return `token_out: ${String(tokenOut)} is not ${filter.token_out}`;
    }
  }

  if (filter.hide_sent && own_account_id) {
    const own = read_accounts_fun(item).filter(
      (one) =>
        one.accountId === own_account_id &&
        (one.status === "sent" ||
          one.status === "succeeded" ||
          one.status === "failed"),
    );
    if (own.length > 0) return `hide_sent: ${own_account_id} already sent it`;
  }

  return null;
}

/**
 * the statuses the item's accounts hold.
 *
 * the item is "sent" when every account row has left `pending`. a
 * queue with no account rows at all has not been sent by anybody.
 */
export function shit_1170_watch_statuses_fun(
  event: SHIT_1170_FEED_WS_EVENT,
): SHIT_1170_WATCH_STATUS[] {
  const item =
    event.type === "queue"
      ? (event.queue as unknown as Record<string, unknown>)
      : (event.swap as unknown as Record<string, unknown>);
  return read_accounts_fun(item.accounts).map((one) => one.status);
}

/**
 * has the item reached the state the watch is waiting for?
 *
 * `any` is reached by every event — the agent asked to be told that
 * something happened.
 */
export function shit_1170_watch_reached_fun(
  event: SHIT_1170_FEED_WS_EVENT,
  until: SHIT_1170_WATCH_UNTIL,
): boolean {
  if (until === "any") return true;
  const statuses = shit_1170_watch_statuses_fun(event);
  if (statuses.length === 0) return false;
  if (until === "sent") {
    return statuses.every((one) => one !== "pending");
  }
  return statuses.includes(until);
}

/** one event the watch saw, with the id it belongs to. */
export interface SHIT_1170_WATCH_EVENT {
  kind: SHIT_1170_WATCH_KIND;
  id: string;
  statuses: SHIT_1170_WATCH_STATUS[];
  event: SHIT_1170_FEED_WS_EVENT;
}

/**
 * open the live feed and hand every matching event to the callback.
 *
 * the handle is returned so the caller can stop the reconnects. the
 * middleman reconnects on its own when the socket drops — a socket
 * dies on a phone all the time — and `close()` stops that.
 *
 * the connection is reported too, because a caller that cannot see the
 * connection cannot tell a quiet feed from a dead one.
 */
export function shit_1170_watch_open_fun(
  baseUrl: string,
  filter: SHIT_1170_WATCH_FILTER,
  own_account_id: string | null,
  on_event: (seen: SHIT_1170_WATCH_EVENT) => void,
  on_error?: (message: string) => void,
  on_connect?: (info: SHIT_1170_FEED_WS_CONNECT) => void,
  on_skip?: (info: {
    kind: SHIT_1170_WATCH_KIND;
    id: string;
    reason: string;
  }) => void,
): SHIT_1170_FEED_WS_HANDLE {
  return api_shit_1170_feed_ws(
    baseUrl,
    (event) => {
      const reason = shit_1170_watch_reason_fun(event, filter, own_account_id);
      if (reason !== null) {
        // --- WHY --- A POST THAT DID NOT MATCH IS REPORTED: a watch
        // that filters things away is silent by default, and a post
        // that arrived and was turned away looks exactly like a post
        // that never arrived. the reason says which filter did it.
        if (on_skip) {
          const id =
            event.type === "queue" ? event.queue.queueId : event.swap.swapId;
          on_skip({ kind: event.type, id, reason });
        }
        return;
      }
      const id =
        event.type === "queue" ? event.queue.queueId : event.swap.swapId;
      on_event({
        kind: event.type,
        id,
        statuses: shit_1170_watch_statuses_fun(event),
        event,
      });
    },
    on_error,
    on_connect,
  );
}
