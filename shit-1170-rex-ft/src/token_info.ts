// the token information the FT bins read from the intear API.
//
// --- WHAT THIS IS FOR ---
// the chain answers `ft_metadata`, and the chain is authoritative for
// a token's own metadata — its name, its symbol and its decimals.
//
// the intear API adds what the chain does not know: a token's PRICE,
// its liquidity and its market cap, and the pool it trades in. that
// is the reason to ask it.
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

// the fields the skill asks for. the API answers with the columns it
// was asked for, in the order it was asked.
const SHIT_1170_TOKEN_INFO_FIELDS = [
  "symbol",
  "name",
  "decimals",
  "price_usd",
  "liquidity_usd",
  "market_cap_usd",
  "total_supply",
  "main_pool",
  "reference",
] as const;

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
  // the pool the token trades in, e.g. `REF-5767`.
  mainPool: string | null;
  reference: string | null;
}

export interface SHIT_1170_TOKEN_INFO_ANSWER {
  // the tokens the index knew about.
  tokens: SHIT_1170_TOKEN_INFO[];
  // the ids it had no row for.
  missing: string[];
  // the block the data was read at.
  height: number | null;
}

/**
 * the token information for a list of token account ids.
 *
 * `missing` holds the ids the index had no row for — a token that is
 * missing is not a broken token, it is one the indexer has not seen.
 */
export async function shit_1170_token_info_fun(
  token_ids: string[],
): Promise<SHIT_1170_TOKEN_INFO_ANSWER> {
  const ids = token_ids.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) {
    return { tokens: [], missing: [], height: null };
  }

  // the middleman logs to stdout, so the banner moves to stderr for
  // the length of the call.
  const result = await quiet_fun(() =>
    api_intear_tokens_get({
      fields: SHIT_1170_TOKEN_INFO_FIELDS,
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

    const pick = (field: string): unknown => byField[field];

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
      mainPool: (pick("main_pool") as string | undefined) ?? null,
      reference: (pick("reference") as string | undefined) ?? null,
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
