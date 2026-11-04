#!/usr/bin/env python3
# ========================================
# UNIT_CONVERSION
# the agent friendly unit conversion, in python.
#
# the same conversion as the bun bin, for agents and scripts that have
# python but no bun and no node. it uses only the standard library —
# no pip install, no venv — so it runs anywhere python runs.
#
# it takes a token's contract address and ONE amount, and answers with
# the amount in both forms: the human decimal amount ("1.5") and the
# chain's unit amount ("1500000000000000000000000").
#
# the amount's side is said EXPLICITLY with --decimal or --unit, never
# guessed: a guess that picks the wrong side produces a number that
# looks right and is wrong by a factor of 10**decimals, and that is
# the worst possible failure for an amount about to be transferred.
#
# usage:
#   python3 unit_conversion.py --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]
#
# examples:
#   python3 unit_conversion.py --ca wrap.near --decimal 1.5
#   python3 unit_conversion.py --ca wrap.near --unit 1500000000000000000000000
#   python3 unit_conversion.py --ca usdt.tether-token.near --decimal 0.5
#   python3 unit_conversion.py --ca wrap.near --decimal 1.5 --decimals 24
#
# the output is JSON on stdout, so an agent can read it without
# parsing prose. errors are JSON on stderr with a non-zero exit code.
# ========================================

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# ========================================
# --- CONFIG -----------------------------
# the intear api's base url. no api key.
INTEAR_BASE_URL = "https://api.intea.rs"

# the chain's own token.
#
# --- WHY IT IS DESCRIBED HERE AND NOT FETCHED: the intear token
# registry has no "near" entry — asking for it comes back in the
# response's "missing" list — so the api can never answer for it.
# near has 24 decimals, which is a near protocol constant, not a
# fetched value, and wnear (wrap.near) trades 1:1 with it.
NEAR_ID = "near"
NEAR_DECIMALS = 24
NEAR_SYMBOL = "NEAR"

# how long to wait on the api, in seconds.
HTTP_TIMEOUT_SECONDS = 20


# ========================================
# --- ERRORS ----------------------------
class UnitConversionError(Exception):
    """A failure the caller can be told about, in plain words."""


# ========================================
# --- MATH -------------------------------
# split a plain decimal string into its whole part and its fraction.
#
# --- WHY ONLY A PLAIN DECIMAL IS ACCEPTED: digits, one dot, digits.
# no exponent, no sign, no thousands separators. an amount that
# reaches the chain has to be unambiguous, and "1e18" or "1,000" is
# not a number the chain would accept either.
def parse_decimal_parts(value: str) -> tuple[int, str] | None:
    trimmed = value.strip()
    if len(trimmed) == 0:
        return None
    if re.fullmatch(r"\d*\.?\d*", trimmed) is None:
        return None
    whole_part, _, fraction_part = trimmed.partition(".")
    if len(whole_part) == 0 and len(fraction_part) == 0:
        return None
    return (int(whole_part) if len(whole_part) > 0 else 0, fraction_part)


def human_to_unit(human: str, decimals: int) -> str | None:
    """The human amount as the unit amount.

    Returns None when the human amount is not a plain decimal, or when
    the decimals are not a whole non-negative number.

    --- WHY THE FRACTION IS TRUNCATED AND NOT ROUNDED: the unit amount
    is what the chain will trade, so it must never be MORE than the
    reader asked for. rounding up would spend more than they typed.

    --- WHY ARITHMETIC IS DONE ON INTEGERS AND NOT FLOATS: a 24-decimal
    amount is far beyond a float's exact integer range, so a float
    round trip loses the low digits of a large balance. python's
    ints are arbitrary precision, so the whole thing stays exact.
    """
    if decimals < 0 or isinstance(decimals, bool):
        return None
    parts = parse_decimal_parts(human)
    if parts is None:
        return None
    whole, fraction = parts
    total = whole * (10**decimals)
    if len(fraction) == 0:
        return str(total)
    # the fraction is scaled to the token's decimals. a fraction LONGER
    # than the decimals is cut, not rounded — see above.
    kept = fraction[:decimals].ljust(decimals, "0")
    fraction_value = int(kept) if len(kept) > 0 else 0
    return str(total + fraction_value)


def unit_to_human(unit: str, decimals: int) -> str:
    """The unit amount as the human amount.

    --- WHY THIS DOES NOT USE A DISPLAY FORMATTER: a display formatter
    trims trailing zeros and drops anything under 0.01, which is right
    for a row of balances and wrong for an amount about to be traded. a
    transfer of 0.0004 usdc must read as 0.0004, not as "0.00".
    """
    trimmed = unit.strip()
    if re.fullmatch(r"\d+", trimmed) is None:
        return ""
    if decimals <= 0:
        return trimmed
    padded = trimmed.rjust(decimals + 1, "0")
    whole = padded[: len(padded) - decimals]
    fraction = padded[len(padded) - decimals :].rstrip("0")
    if len(fraction) == 0:
        return whole
    return f"{whole}.{fraction}"


def unit_to_raw_human(unit: str, decimals: int) -> str:
    """The unit amount as the human amount, keeping the trailing zeros.

    --- WHY A SEPARATE FUNCTION: the tidied amount ("1.5") is what a
    person reads, while the exact figure ("1.500000000000000000000000")
    is what the chain sees. trimming zeros off the exact figure would
    hide the trailing zeros that make it the same number of units as the
    token's decimals.
    """
    trimmed = unit.strip()
    if re.fullmatch(r"\d+", trimmed) is None:
        return ""
    if decimals <= 0:
        return trimmed
    padded = trimmed.rjust(decimals + 1, "0")
    whole = padded[: len(padded) - decimals]
    fraction = padded[len(padded) - decimals :]
    return f"{whole}.{fraction}"


# ========================================
# --- TOKEN ------------------------------
def fetch_token_info(ca: str) -> dict:
    """The token's symbol and decimals, from the intear api.

    Raises UnitConversionError when the token is unknown, because a
    conversion with guessed decimals is worse than no conversion: the
    amount would look right and be wrong on the chain.
    """
    trimmed = ca.strip()
    if len(trimmed) == 0:
        raise UnitConversionError("no token given")

    # the chain's own token is described locally — see the note above.
    if trimmed == NEAR_ID:
        return {
            "id": NEAR_ID,
            "symbol": NEAR_SYMBOL,
            "decimals": NEAR_DECIMALS,
            "source": "local",
        }

    query = urllib.parse.urlencode({"ids": trimmed, "fields": "symbol,decimals"})
    url = f"{INTEAR_BASE_URL}/tokens?{query}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise UnitConversionError(
            f"the intear api returned {err.code} for token \"{trimmed}\""
        ) from err
    except urllib.error.URLError as err:
        raise UnitConversionError(
            f"could not reach the intear api: {err.reason}"
        ) from err
    except json.JSONDecodeError as err:
        raise UnitConversionError(
            "the intear api returned something that is not json"
        ) from err

    rows = payload.get("rows") or []
    if len(rows) == 0:
        missing = payload.get("missing") or []
        reason = (
            "not in the intear token registry"
            if trimmed in missing
            else "not found"
        )
        raise UnitConversionError(
            f'token "{trimmed}" is {reason}. check the contract address — '
            f'it must be the token\'s own account id, e.g. "wrap.near"'
        )

    row = rows[0]
    # the row is [account_id, symbol, decimals].
    symbol = row[1] if len(row) > 1 else None
    decimals = row[2] if len(row) > 2 else None
    if not isinstance(decimals, int) or isinstance(decimals, bool):
        raise UnitConversionError(
            f'token "{trimmed}" has no decimals in the registry, '
            f"so it cannot be converted"
        )

    return {
        "id": trimmed,
        "symbol": symbol if isinstance(symbol, str) else None,
        "decimals": decimals,
        "source": "api",
    }


# ========================================
# --- CLI -------------------------------
# the usage text, printed on a bad call.
#
# --- WHY IT MATCHES THE BUN BIN'S USAGE WORD FOR WORD: the two bins
# are two ways to run the same thing, and an agent that reads one of
# them should be able to hand the other the same command. a different
# usage text invites a mistake about which flags exist.
USAGE = """usage: python3 bin/unit_conversion.py --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]

  --ca <id>        the token's contract address / account id (e.g. wrap.near)
  --decimal <amt>  the amount in human decimals (e.g. 1.5) -> unit amount
  --unit <amt>     the amount in the chain's smallest unit (e.g. 1500000000000000000000000) -> decimal amount
  --decimals <n>   the token's decimals, when they are already known (skips the api call)
  --help           show this message"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="unit_conversion.py",
        description=(
            "convert a near token amount between human decimals and the "
            "chain's unit amount, using the token's real decimals"
        ),
        add_help=True,
        epilog=USAGE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--ca", required=True, help="the token's contract address")
    parser.add_argument("--decimal", default=None, help="the amount in human decimals")
    parser.add_argument("--unit", default=None, help="the amount in the chain's smallest unit")
    parser.add_argument(
        "--decimals",
        default=None,
        help="the token's decimals, when they are already known (skips the api call)",
    )
    return parser.parse_args(argv)


def fail(message: str, **extra: object) -> None:
    """Print a json error and leave with a non-zero code."""
    body = {"ok": False, "error": message}
    body.update(extra)
    # --- WHY ensure_ascii IS OFF: the bun bin writes the em dash as
    # itself, and a caller diffing the two outputs should not see a
    # difference that is only in the json escaping.
    print(json.dumps(body, indent=2, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)


def main(argv: list[str]) -> None:
    args = parse_args(argv)

    if args.decimal is not None and args.unit is not None:
        fail(
            "give ONE of --decimal or --unit, not both — "
            "they are two views of the same amount"
        )
    if args.decimal is None and args.unit is None:
        fail(
            "one of --decimal or --unit is required: which side is the amount?",
            usage=USAGE,
        )

    symbol: str | None = None
    source = "given"

    if args.decimals is not None:
        try:
            decimals = int(args.decimals)
        except ValueError:
            fail(f'--decimals must be a whole number, got "{args.decimals}"')
        if decimals < 0:
            fail(f'--decimals must be a whole number, got "{args.decimals}"')
    else:
        source = "api"
        try:
            info = fetch_token_info(args.ca)
        except UnitConversionError as err:
            fail(str(err))
        decimals = info["decimals"]
        symbol = info["symbol"]
        # the source comes from the lookup, so the answer never claims
        # the api said something the api was never asked.
        source = info["source"]

    if args.decimal is not None:
        side = "decimal"
        amount = args.decimal
        unit = human_to_unit(amount, decimals)
        if unit is None:
            fail(
                f'"{amount}" is not a plain decimal amount — '
                f"use digits and one dot, no exponent and no sign",
                amount=amount,
                side=side,
            )
        human = amount.strip()
    else:
        side = "unit"
        amount = args.unit or ""
        human = unit_to_human(amount, decimals)
        if len(human) == 0:
            fail(
                f'"{amount}" is not a unit amount — a unit amount is the '
                f"token's smallest unit, a plain whole number with no dot",
                amount=amount,
                side=side,
            )
        unit = amount.strip()

    print(
        json.dumps(
            {
                "ok": True,
                "ca": args.ca,
                "symbol": symbol,
                "decimals": decimals,
                "decimals_source": source,
                "input": {"side": side, "amount": amount},
                "human": human,
                "unit": unit,
                # the human amount with every trailing zero kept, so the
                # exact figure the chain sees is never in doubt.
                "human_exact": unit_to_raw_human(unit, decimals),
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main(sys.argv[1:])
# ========================================
# copyright 2026 by sleet.near
