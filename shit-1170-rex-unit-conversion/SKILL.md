---
name: shit-1170-rex-unit-conversion
description: Convert NEAR token amounts between human decimals ("1.5") and the chain's unit amount ("1500000000000000000000000") using the token's real decimals from the Intear API. Use this skill whenever the user mentions unit conversion, decimal places, token decimals, amount conversion, yoctoNEAR, the smallest unit of a token, or asks what amount to put in an ft_transfer — including when they are preparing, verifying or sending a NEAR transfer, swap, or DEX trade and the amount must be exactly right. Also use it when the user pastes a contract address and an amount and asks what the chain sees, or gives an amount and asks how many units that is. This is the agent friendly version of the shit-1170 unit conversion page.
---

# shit-1170 rex unit conversion

Turn a human amount into the chain's unit amount, and back, using the
token's real decimals.

- live page: <https://shit-1170.com/unit-conversion.html>
- code: <https://github.com/huggiesdotnear/huggies-rex-engine>

---

#### WHY THIS SKILL EXISTS

A NEAR token amount has two forms, and they are not interchangeable:

- the **decimal amount** a person reads — `1.5`
- the **unit amount** the chain trades — `1500000000000000000000000`

The chain only knows the unit amount. `ft_transfer` takes a unit
amount. A router takes a unit amount. An amount that is wrong by a
factor of `10**decimals` is not a rounding error — it is a
24-decimal token paying out a million times too much, or a dust
amount that transfers nothing at all.

So the decimals are not a detail. They are the whole conversion.

---

#### THE BIN

The bin takes a contract address and ONE amount, and answers with the
amount in both forms. JSON on stdout, errors as JSON on stderr with a
non-zero exit code.

```sh
bun bin/unit_conversion.ts --ca <contract_address> (--decimal <amount> | --unit <amount>) [--decimals n]
```

| flag | meaning |
| --- | --- |
| `--ca <id>` | the token's contract address / account id, e.g. `wrap.near` |
| `--decimal <amt>` | the amount in human decimals, e.g. `1.5` → answers with the unit amount |
| `--unit <amt>` | the amount in the chain's smallest unit → answers with the decimal amount |
| `--decimals <n>` | the token's decimals when they are already known — skips the api call |
| `--help` | the usage text |

```sh
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5
bun bin/unit_conversion.ts --ca wrap.near --unit 1500000000000000000000000
bun bin/unit_conversion.ts --ca usdt.tether-token.near --decimal 0.5
bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5 --decimals 24
```

The answer:

```json
{
  "ok": true,
  "ca": "wrap.near",
  "symbol": "wNEAR",
  "decimals": 24,
  "decimals_source": "api",
  "input": { "side": "decimal", "amount": "1.5" },
  "human": "1.5",
  "unit": "1500000000000000000000000",
  "human_exact": "1.500000000000000000000000"
}
```

- `human` — the decimal amount, trailing zeros trimmed
- `unit` — the exact amount the chain trades
- `human_exact` — the decimal amount with every trailing zero kept, so
  the figure the chain sees is never in doubt
- `decimals_source` — where the decimals came from: `api` (fetched
  from Intear), `local` (a known constant of the chain's own token),
  or `given` (the caller passed `--decimals`)

Report the source when you report the decimals. "the api says 24" and
"NEAR always has 24" are different claims, and an agent that cannot
tell them apart cannot tell which one it is relying on.

---

#### WHY THE SIDE IS EXPLICIT

`--decimal` and `--unit` say which side the amount is on. There is no
heuristic and no guessing.

The reason is the failure mode. A bin that guesses from the string
picks the wrong side for a plain whole number — `1000` is a
legitimate decimal amount and a legitimate unit amount — and the
answer then differs by a factor of `10**decimals`. The number still
looks plausible. The transfer still goes through. It just moves the
wrong amount of money.

Saying which side it is costs one flag and removes that failure
entirely. When an amount comes from a conversation and the side is
genuinely ambiguous, ask — do not guess.

---

#### THE DECIMALS

The decimals come from the Intear API (`https://api.intea.rs`) through
`@sleet-js/middleman-intear-api`, fetched per token. They are not
hard-coded here, because there are thousands of tokens and a list
would go stale the moment a new one is listed.

- `--decimals n` skips the api call when the caller already knows
  them. It must still be the token's real decimals or the answer is
  wrong — the api is the default source.
- `near` is described locally at 24 decimals, because the Intear token
  registry has no `near` entry and the api can never answer for it.
  `wrap.near` (wNEAR) trades 1:1 with NEAR and has the same 24. The
  answer says `decimals_source: "local"` for it, so the difference
  between "the registry says" and "the protocol says" stays visible.
- A token that is not in the registry is an error, not a guess. A
  conversion with guessed decimals is worse than no conversion: the
  amount would look right and be wrong on the chain.

---

#### THE RULES THE MATH FOLLOWS

These are the same rules the shit-1170 page runs, so an agent and the
page never disagree about what an amount is.

- **Truncate, never round.** A fraction longer than the token's
  decimals is cut, not rounded up. The unit amount is what the chain
  will trade, so it must never be MORE than the caller asked for.
  Rounding up would spend more than they typed.
- **Exact integers, not floats.** A 24-decimal amount is far beyond
  JavaScript's exact integer range, so a float round trip loses the
  low digits of a large balance. The math is done on `BigInt`.
- **A unit amount is a plain whole number.** No dot, no sign, no
  exponent. Anything else is rejected rather than parsed loosely.
- **A decimal amount is plain digits and at most one dot.** No
  exponent, no sign, no thousands separators.
- **Trailing zeros are trimmed for reading, kept for the chain.**
  `0.0004` reads as `0.0004`, never as `0.00` — a display formatter
  that drops small amounts is wrong for an amount about to be sent.

---

#### USE IT WHEN

- the user wants to convert an amount, or asks how many units an
  amount is
- the user is preparing a transfer, a swap or a DEX trade and the
  amount has to be exact
- the user wants to check an amount someone else gave them — a unit
  amount from a contract call, a balance, a block explorer row
- the user asks what the decimals of a token are
- the user wants to confirm a pasted contract address is a real token

The last two are worth doing before a transfer: a wrong contract
address and a wrong amount fail the same way, quietly, if the address
happens to be a real contract with different decimals.

---

#### READING THE RESULT IN A SCRIPT

The output is JSON on stdout, so a shell pipeline can read it without
parsing prose:

```sh
UNIT=$(bun bin/unit_conversion.ts --ca wrap.near --decimal 1.5 2>/dev/null | grep '"unit"' | cut -d'"' -f4)
```

The api's own log frame goes to stderr, so stdout stays pure JSON.

---

#### WHEN THE TOKEN IS NOT IN THE REGISTRY

Some tokens are real, on chain, and simply not listed in the Intear
registry. For those, pass the decimals you already know — from the
contract's `ft_metadata`, from an explorer, from the token's docs:

```sh
bun bin/unit_conversion.ts --ca some.token.near --decimal 1.5 --decimals 18
```

Read the decimals from the token's own `ft_metadata` view when you
can. It is the token itself that decides, not any registry.

---

#### LIBRARY USE

The same math is importable, for when a script needs the conversion
inline rather than through the bin:

```ts
import {
  human_to_unit_fun,
  unit_to_human_fun,
  unit_to_raw_human_fun,
  unit_conversion_token_info_fun,
} from "@huggies/shit-1170-rex-unit-conversion";

const info = await unit_conversion_token_info_fun("wrap.near");
const unit = human_to_unit_fun("1.5", info.decimals);
```

---

=====================
<br/>
copyright 2026 by sleet.near
