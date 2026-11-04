// ========================================
// TOKEN DECIMALS
// the token's decimals, fetched from the intear api through the
// middleman package.
//
// the decimals are the one fact a unit conversion cannot be done
// without: "1.5" of an 18-decimal token and "1.5" of a 6-decimal one
// are different numbers of the chain's smallest unit.
//
// --- WHY THE API IS THE SOURCE AND NOT A HARD-CODED LIST: decimals
// are fixed for a token's life, but there are thousands of tokens and
// a list here would go stale the moment a new one is listed.
// ========================================

import { api_intear_tokens_get } from "@sleet-js/middleman-intear-api";
// ========================================
// --- CONFIG -----------------------------
// the chain's own token.
//
// --- WHY IT IS DESCRIBED HERE AND NOT FETCHED: the intear token
// registry has no "near" entry — asking for it comes back in the
// response's "missing" list — so the api can never answer for it.
// near has 24 decimals, which is a neAR protocol constant, not a
// fetched value, and wNEAR (wrap.near) trades 1:1 with it.
export const UNIT_CONVERSION_NEAR_ID = "near";
export const UNIT_CONVERSION_NEAR_DECIMALS = 24;
export const UNIT_CONVERSION_WRAP_ID = "wrap.near";

// ========================================
// --- TYPES ------------------------------
// what the api says about one token.
export interface UNIT_CONVERSION_TOKEN_INFO {
  // the contract address / account id.
  id: string;
  // the token's symbol, when the registry knows it.
  symbol: string | null;
  // how many decimals the token has.
  decimals: number;
  // where the decimals came from.
  //
  // --- WHY THIS IS REPORTED: an answer that says "the api says 24
  // decimals" when the api was never asked is a small lie, and a small
  // lie about a source of truth is how an agent ends up trusting a
  // number it never verified. "local" says the decimals are a known
  // constant of the chain's own token, and "api" says they were
  // fetched.
  source: "api" | "local";
}

// the api answers with rows whose first column is always the account
// id, then one column per requested field.
type TOKEN_ROW = readonly [string, string | null, number | null];

// ========================================
// --- QUIET LOG -------------------------
// the middleman logs its framed request and response with console.log.
//
// --- WHY IT IS SILENCED: this package's bin prints its answer as JSON
// on stdout, and an agent reads that stdout by parsing it. a log frame
// in the middle of the JSON makes it unparseable, and the conversion
// silently fails downstream.
//
// --- WHY THE FRAME IS DROPPED AND NOT MOVED TO STDERR: stderr carries
// this bin's json errors, and a caller reads those by parsing them too.
// a frame in front of the error json breaks that the same way. the
// frame is useful when a call goes wrong, so it is kept behind a
// switch: set UNIT_CONVERSION_LOG=1 to see it.
const UNIT_CONVERSION_LOG = process.env.UNIT_CONVERSION_LOG === "1";

async function api_intear_tokens_get_with_quiet_log<
  t extends Parameters<typeof api_intear_tokens_get>[0],
>(params: t): Promise<Awaited<ReturnType<typeof api_intear_tokens_get>>> {
  if (UNIT_CONVERSION_LOG) {
    return await api_intear_tokens_get(params);
  }
  const original = console.log;
  console.log = () => {};
  try {
    return await api_intear_tokens_get(params);
  } finally {
    console.log = original;
  }
}

// ========================================
// --- GET -------------------------------
// the decimals and symbol for one token.
//
// throws when the token is unknown, because a conversion with guessed
// decimals is worse than no conversion: the amount would look right
// and be wrong on the chain.
export async function unit_conversion_token_info_fun(
  id: string,
): Promise<UNIT_CONVERSION_TOKEN_INFO> {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error("no token given");
  }

  // the chain's own token is described locally — see the note above.
  if (trimmed === UNIT_CONVERSION_NEAR_ID) {
    return {
      id: UNIT_CONVERSION_NEAR_ID,
      symbol: "NEAR",
      decimals: UNIT_CONVERSION_NEAR_DECIMALS,
      source: "local",
    };
  }

  const response = await api_intear_tokens_get_with_quiet_log({
    ids: [trimmed],
    fields: ["symbol", "decimals"] as never,
  });

  const row = response.rows[0] as TOKEN_ROW | undefined;
  if (row === undefined) {
    const missing = response.missing ?? [];
    const reason = missing.includes(trimmed)
      ? "not in the intear token registry"
      : "not found";
    throw new Error(
      `token "${trimmed}" is ${reason}. check the contract address — ` +
        `it must be the token's own account id, e.g. "wrap.near"`,
    );
  }

  const [, symbol, decimals] = row;
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) {
    throw new Error(
      `token "${trimmed}" has no decimals in the registry, so it cannot be converted`,
    );
  }

  return {
    id: trimmed,
    symbol: typeof symbol === "string" ? symbol : null,
    decimals,
    source: "api",
  };
}
// ========================================
// copyright 2026 by sleet.near
