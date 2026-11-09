// the token information the FT bins read from the intear API.
//
// --- WHAT THIS IS FOR ---
// the chain answers `ft_metadata`, and the chain is authoritative for
// a token's own metadata — its name, its symbol and its decimals.
//
// the intear API adds what the chain does not know: a token's PRICE,
// its liquidity and its market cap, the pool it trades in, how many
// holders it has, and its reputation. that is the reason to ask it.
//
// so the bins read BOTH and label which is which. when they disagree,
// the chain wins for the metadata and the API wins for the price.
//
// --- THE API ---
// `@sleet-js/middleman-intear-api` talks to `https://api.intea.rs`,
// no API key. the middleman logs every request to STDOUT with
// `console.log`, which would break a bin that promises pure JSON on
// stdout — so every call here goes through `quiet_fun`, which moves
// that banner to stderr for the length of the call.
//
// --- THE SHAPE ---
// the API answers with COLUMNS and ROWS, not objects:
//
//   { "columns": ["account_id", "symbol", "decimals", ...],
//     "rows": [["wrap.near", "wNEAR", 24, ...]] }
//
// so the rows are zipped against the columns to make objects.
//
// --- THE MISSING TOKENS ---
// the API's index does not know every token. `missing` lists the ids
// it had no row for, and `total` counts what it has. a token that is
// missing from the index is not a broken token — it is just a token
// the indexer has not seen.

import { api_intear_tokens_get } from "@sleet-js/middleman-intear-api";
import { quiet_fun } from "@huggies/shit-1170-rex-engine-middleman";
import type { token_requested_field } from "@sleet-js/intear-api-tool-box";

// the fields the skill asks for by default.
//
// `holders` is the COUNT of holders, not the holder list — that is
// `holders.ts`. `reputation` is the indexer's read of the token.
//
// `icon_hash` is the small one. `icon` is also valid but it returns a
// large inline data uri.
export const SHIT_1170_TOKEN_INFO_DEFAULT_FIELDS = [
  "symbol",
  "name",
  "decimals",
  "price_usd",
  "liquidity_usd",
  "market_cap_usd",
  "total_supply",
  "holders",
  "reputation",
  "main_pool",
  "reference",
] as const;

// every field the API serves for a token. a bin may ask for any of
// them by name.
export const SHIT_1170_TOKEN_INFO_FIELDS = [
  "name",
  "symbol",
  "decimals",
  "reference",
  "icon_hash",
  "price_usd",
  "reputation",
  "holders",
  "liquidity_usd",
  "market_cap_usd",
  "total_supply",
  "main_pool",
] as const satisfies readonly token_requested_field[];

export interface SHIT_1170_TOKEN_INFO {
  // the token's account id.
  accountId: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  // the price in USD, as a decimal string.
  priceUsd: string | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  totalSupply: string | null;
  // how many holders the index knows about.
  holders: number | null;
  // the indexer's reputation read on the token.
  reputation: string | null;
  // the pool the token trades in, e.g. `REF-5767`.
  mainPool: string | null;
  reference: string | null;
  // the fields that were asked for and came back, as the API gave
  // them. a bin that asked for a field it does not know about finds
  // it here.
  raw: Record<string, unknown>;
}

export interface SHIT_1170_TOKEN_INFO_ANSWER {
  // the tokens the index knew about.
  tokens: SHIT_1170_TOKEN_INFO[];
  // the ids it had no row for.
  missing: string[];
  // the block the data was read at.
  height: number | null;
}

// the API's column name for each field this module names.
const SHIT_1170_FIELD_COLUMNS: Record<string, string> = {
  symbol: "symbol",
  name: "name",
  decimals: "decimals",
  price_usd: "price_usd",
  liquidity_usd: "liquidity_usd",
  market_cap_usd: "market_cap_usd",
  total_supply: "total_supply",
  holders: "holders",
  reputation: "reputation",
  main_pool: "main_pool",
  reference: "reference",
};

/**
 * the token information for a list of token account ids.
 *
 * `missing` holds the ids the index had no row for — a token that is
 * missing is not a broken token, it is one the indexer has not seen.
 */
export async function shit_1170_token_info_fun(
  token_ids: string[],
  fields: readonly token_requested_field[] = SHIT_1170_TOKEN_INFO_DEFAULT_FIELDS,
): Promise<SHIT_1170_TOKEN_INFO_ANSWER> {
  const ids = token_ids.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) {
    return { tokens: [], missing: [], height: null };
  }

  // the middleman logs to stdout, so the banner moves to stderr for
  // the length of the call.
  const result = await quiet_fun(() =>
    api_intear_tokens_get({
      fields,
      ids,
    }),
  );

  const columns = result.columns ?? [];
  const tokens: SHIT_1170_TOKEN_INFO[] = [];

  for (const row of result.rows ?? []) {
    const values = row as readonly unknown[];
    // the first column is always the account id.
    const accountId = String(values[0] ?? "");
    if (!accountId) continue;

    // zip the row against the columns the API echoed back.
    const byField: Record<string, unknown> = {};
    for (let i = 1; i < columns.length; i++) {
      byField[columns[i]] = values[i];
    }

    const pick = (field: string): unknown =>
      byField[SHIT_1170_FIELD_COLUMNS[field] ?? field];

    tokens.push({
      accountId,
      symbol: (pick("symbol") as string | undefined) ?? null,
      name: (pick("name") as string | undefined) ?? null,
      decimals:
        typeof pick("decimals") === "number"
          ? (pick("decimals") as number)
          : null,
      priceUsd: (pick("price_usd") as string | undefined) ?? null,
      liquidityUsd:
        typeof pick("liquidity_usd") === "number"
          ? (pick("liquidity_usd") as number)
          : null,
      marketCapUsd:
        typeof pick("market_cap_usd") === "number"
          ? (pick("market_cap_usd") as number)
          : null,
      totalSupply: (pick("total_supply") as string | undefined) ?? null,
      holders:
        typeof pick("holders") === "number"
          ? (pick("holders") as number)
          : null,
      reputation: (pick("reputation") as string | undefined) ?? null,
      mainPool: (pick("main_pool") as string | undefined) ?? null,
      reference: (pick("reference") as string | undefined) ?? null,
      // everything the API gave, under the column names it used.
      raw: byField,
    });
  }

  return {
    tokens,
    missing: [...(result.missing ?? [])],
    height: result.height ?? null,
  };
}

/**
 * the token information for one token.
 *
 * `null` when the index has no row for it.
 */
export async function shit_1170_token_info_one_fun(
  token_id: string,
): Promise<SHIT_1170_TOKEN_INFO | null> {
  const answer = await shit_1170_token_info_fun([token_id]);
  return answer.tokens[0] ?? null;
}
