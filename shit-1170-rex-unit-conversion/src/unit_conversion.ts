// ========================================
// UNIT CONVERSION
// the math that turns a human amount ("1.5") into the chain's unit
// amount ("1500000000000000000000000") and back.
//
// this is the same math the shit-1170 unit conversion page runs, so
// an agent and the page never disagree about what an amount is.
//
// --- WHY BIGINT AND NOT NUMBER: a 24-decimal near amount is far
// beyond Number's exact integer range, so a Number round trip loses
// the low digits of a large balance. the human side is a string
// ("1.5"), so it is parsed digit by digit into integers.
//
// --- WHY THE FRACTION IS TRUNCATED AND NOT ROUNDED: the unit amount
// is what the chain will trade, so it must never be MORE than the
// reader asked for. rounding up would spend more than they typed.
// ========================================

// ========================================
// --- TYPES ------------------------------
// how many decimals a token has.
export type UNIT_CONVERSION_DECIMALS = number;

// ========================================
// --- HELPERS ----------------------------
// split a plain decimal string into its whole part and its fraction.
//
// --- WHY ONLY A PLAIN DECIMAL IS ACCEPTED: digits, one dot, digits.
// no exponent, no sign, no thousands separators. an amount that
// reaches the chain has to be unambiguous, and "1e18" or "1,000" is
// not a number the chain would accept either.
function parse_decimal_parts_fun(value: string): {
  whole: bigint;
  fraction: string;
} | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const [whole_part = "", fraction_part = ""] = trimmed.split(".");
  if (whole_part.length === 0 && fraction_part.length === 0) return null;
  return {
    whole: BigInt(whole_part.length === 0 ? "0" : whole_part),
    fraction: fraction_part,
  };
}

// ========================================
// --- PUBLIC ---------------------------
// the human amount as the unit amount.
//
// returns null when the human amount is not a plain decimal, or when
// the decimals are not a whole non-negative number.
export function human_to_unit_fun(
  human: string,
  decimals: UNIT_CONVERSION_DECIMALS,
): string | null {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const parts = parse_decimal_parts_fun(human);
  if (parts === null) return null;
  const whole = parts.whole * 10n ** BigInt(decimals);
  if (parts.fraction.length === 0) return whole.toString();
  // the fraction is scaled to the token's decimals. a fraction LONGER
  // than the decimals is cut, not rounded — see the note above.
  const kept = parts.fraction.slice(0, decimals).padEnd(decimals, "0");
  const fraction_value = BigInt(kept.length === 0 ? "0" : kept);
  return (whole + fraction_value).toString();
}

// the unit amount as the human amount.
//
// --- WHY THIS DOES NOT USE A DISPLAY FORMATTER: a display formatter
// trims trailing zeros and drops anything under 0.01, which is right
// for a row of balances and wrong for an amount about to be traded. a
// transfer of 0.0004 USDC must read as 0.0004, not as "0.00".
export function unit_to_human_fun(
  unit: string,
  decimals: UNIT_CONVERSION_DECIMALS,
): string {
  const trimmed = unit.trim();
  if (!/^\d+$/.test(trimmed)) return "";
  if (!Number.isInteger(decimals) || decimals <= 0) return trimmed;
  const padded = trimmed.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  if (fraction.length === 0) return whole;
  return `${whole}.${fraction}`;
}

// the unit amount as the human amount, keeping the trailing zeros.
//
// --- WHY A SEPARATE FUNCTION: the tidied amount ("1.5") is what a
// person reads, while the exact figure ("1.500000000000000000000000")
// is what the chain sees. trimming zeros off the exact figure would
// hide the trailing zeros that make it the same number of units as the
// token's decimals.
export function unit_to_raw_human_fun(
  unit: string,
  decimals: UNIT_CONVERSION_DECIMALS,
): string {
  const trimmed = unit.trim();
  if (!/^\d+$/.test(trimmed)) return "";
  if (!Number.isInteger(decimals) || decimals <= 0) return trimmed;
  const padded = trimmed.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  return `${whole}.${fraction}`;
}
// ========================================
// copyright 2026 by sleet.near
