# WRAP.NEAR

the `wrap.near` contract, the wNEAR token, and how to wrap and unwrap
native NEAR through it.

this is the reference the agent reads when the task is turning NEAR
into wNEAR or back. the SKILL.md has the short version; this file has
the whole thing.

---

#### WHAT wrap.near IS

`wrap.near` is a NEP-141 token contract whose whole job is to hold
wrapped NEAR.

**it is not the chain's own coin.** native NEAR is the coin, with the
id `near`. wNEAR is this contract's token, with the id `wrap.near` on
mainnet and `wrap.testnet` on testnet.

both are 24 decimals, so the decimals never tell you which one you are
looking at. the id does.

| network | contract id |
| --- | --- |
| mainnet | `wrap.near` |
| testnet | `wrap.testnet` |

a NEP-141 token's contract id IS its token id. there is no registry
entry to look up.

---

#### THE TWO METHODS

| intent | method | args | attached deposit | gas |
| --- | --- | --- | --- | --- |
| NEAR → wNEAR | `near_deposit` | `{}` | **the amount to wrap** | 30 Tgas |
| wNEAR → NEAR | `near_withdraw` | `{ "amount": "<unit>" }` | exactly 1 yoctoNEAR | 30 Tgas |

**the deposit on `near_deposit` IS the amount.** there are no
arguments — the attached deposit is how much NEAR goes in, and it
becomes the wNEAR. it is not a fee and it is not refunded.

**the deposit on `near_withdraw` is 1 yoctoNEAR.** that is a security
deposit against a restricted function-call key, not a fee, and it is
refunded. the amount to unwrap is the `amount` argument, in wNEAR's
smallest unit.

**the gas is not documented by the contract.** 30 Tgas is the engine's
working value, not the contract's promise. the one deposit the contract
does fix is `near_withdraw`'s 1 yoctoNEAR.

---

#### A WRAP IS A BATCH, NOT A SWAP

the engine's swap queue names a token sold and a token bought, and a
router works the route out at execution time. `near_deposit` and
`near_withdraw` are direct calls to `wrap.near`, so they go through the
general skill's `queue_tx.ts` with a batch of calls.

never queue a wrap as a swap. the router routes native NEAR directly,
so a swap with `tokenIn: "near"` needs no wrap at all.

---

#### THE STORAGE REGISTRATION IS CONDITIONAL

**this is the part to get right.**

`near_deposit` mints wNEAR to the caller, and the contract needs
somewhere to put the balance. an account with no NEP-145 storage
registered on `wrap.near` cannot hold the mint.

**so the registration goes in the SAME batch as the mint, in front of
it** — but ONLY when the account is not registered yet.

the check is one view call:

```sh
bun bin/wrap_check.ts --account sleet.near
```

`hasStorage` says it. `storage_balance_of` answers `null` for an
account with no registration, and the standard says such an account
cannot hold the token.

| `hasStorage` | the wrap's batch |
| --- | --- |
| `false` | `storage_deposit`, then `near_deposit` — two calls |
| `true` | `near_deposit` alone — one call |

**a second `storage_deposit` on an account that is already registered
wastes 0.00125 NEAR and a call.** the standard says a registration
with `registration_only: true` refunds the excess, but the plain
`storage_deposit` this skill queues does not ask for that — so the
deposit stays on the contract, and the batch does a job that was
already done.

so the registration is CONDITIONAL, and the condition comes from the
chain, not from a flag somebody remembered to pass.

**the order matters.** the registration lands first, and the batch runs
as one transaction, so the receipt tree holds together — if the
registration fails, the mint does not run either.

**an unwrap never needs the registration.** the account already holds
wNEAR, so it already has the storage that holds it.

---

#### THE PAYLOADS

the wrap, for an account that is NOT registered — two calls, in this
order:

```json
[
  {
    "contractId": "wrap.near",
    "method": "storage_deposit",
    "args": {},
    "gas": "30000000000000",
    "deposit": "1250000000000000000000"
  },
  {
    "contractId": "wrap.near",
    "method": "near_deposit",
    "args": {},
    "gas": "30000000000000",
    "deposit": "1500000000000000000000000"
  }
]
```

the wrap, for an account that IS registered — one call:

```json
[
  {
    "contractId": "wrap.near",
    "method": "near_deposit",
    "args": {},
    "gas": "30000000000000",
    "deposit": "1500000000000000000000000"
  }
]
```

the unwrap — one call, always:

```json
[
  {
    "contractId": "wrap.near",
    "method": "near_withdraw",
    "args": { "amount": "1500000000000000000000000" },
    "gas": "30000000000000",
    "deposit": "1"
  }
]
```

the registration on its own:

```json
[
  {
    "contractId": "wrap.near",
    "method": "storage_deposit",
    "args": {},
    "gas": "30000000000000",
    "deposit": "1250000000000000000000"
  }
]
```

`gas` and `deposit` are raw digit strings. the web app also accepts
the human forms — `"30 Tgas"`, `"0.00125 NEAR"`, `"1 yocto"` — and
converts them, but raw digits are preferred, because there is no
ambiguity about what they mean.

---

#### THE BINS

```sh
# what does the account hold, and can it wrap?
bun bin/wrap_check.ts --account sleet.near

# the queue payload for a wrap
bun bin/wrap.ts --direction wrap --amount 1500000000000000000000000

# the queue payload for an unwrap
bun bin/wrap.ts --direction unwrap --amount 1500000000000000000000000

# the registration on its own
bun bin/wrap.ts --direction storage
```

`wrap_check.ts` reads, in one call:

- does the account exist on chain?
- how much **native NEAR** does it hold? this is what a wrap spends
- how much **wNEAR** does it hold? this is what an unwrap spends
- is it **registered for NEP-145 storage** on `wrap.near`? `hasStorage`
  is the fact that decides whether the wrap's batch has one call or
  two
- what is the contract's **live storage minimum**? this is
  `storage_minimum_balance`, not the standard's floor

it answers with `canWrap` and `canUnwrap`, and the warnings say what
is missing.

`wrap.ts` prints the queue payload and sends nothing. `--amount` is in
the SMALLEST UNIT — native NEAR and wNEAR are both 24 decimals, so
use `shit-1170-rex-unit-conversion` to convert and to check.

---

#### THE CONDITION, IN THE BIN

`wrap.ts` takes the condition as `--with-storage-deposit`, and the
default is **auto**: the bin reads the account's storage registration
itself, and includes the registration only when the account does not
have it.

```
--with-storage-deposit auto     # the default: read the chain, include only if needed
--with-storage-deposit yes      # force it in
--with-storage-deposit no       # force it out
--no-storage-deposit            # shorthand for the above "no"
```

so the common case — an account that has wrapped before — produces a
one-call batch, and a first-time account produces a two-call batch,
with nobody remembering a flag. the payload says which it did:

```json
{
  "account": "sleet.near",
  "accountHasStorage": true,
  "storageMinimum": "1250000000000000000000",
  "includesStorageDeposit": false,
  "storageReason": "sleet.near is already registered on wrap.near",
  "transactions": [ ... ]
}
```

**the read needs no key and no account.** `storage_balance_of` is a
public view, so the auto mode works on a fresh machine with nothing
configured. `--account` says whose registration to read, and it
defaults to the one stored account.

**the forced flags exist for the case the chain cannot answer** — a
read that failed, or a batch the human wants to register ahead of
time. `--with-storage-deposit yes` is how you queue the registration
when you already know the account needs it.

**an account that does not exist is refused.** a mint to a
nonexistent account cannot run, so the bin says so rather than
queueing a batch that will fail at signing time.

---

#### NEVER WRAP TO FEED A SWAP

the router takes native NEAR as the input side directly. a wrap hop
costs gas, costs a second route, and needs storage on `wrap.near`.

quote the swap out of native NEAR (`tokenIn: "near"`) and wrap only
when the human actually wants wNEAR — to hold it, to send it, or to put
it somewhere the router cannot take native NEAR.

---

#### THE THREE TRAPS

1. **`near` is not `wrap.near`.** native NEAR is the chain's own coin.
   wNEAR is the `wrap.near` contract. both are 24 decimals, so only
   the id tells them apart.
2. **the deposit on `near_deposit` is the money.** it is not a fee.
   `deposit: "0"` fails, and a wrong deposit wraps the wrong amount.
3. **an amount that is off by a factor of a million succeeds.** native
   NEAR and wNEAR are both 24 decimals, so a decimal amount worked out
   by hand is not a rounding error — it is a million NEAR. convert
   with `shit-1170-rex-unit-conversion` and check the number.

---

#### THE FACTS, AND WHERE THEY CAME FROM

read off the deployed contract on mainnet:

| fact | value |
| --- | --- |
| the contract | `wrap.near`, code hash `DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1` |
| `storage_minimum_balance` | `1250000000000000000000` |
| `storage_balance_bounds` | `{ min: 1250000000000000000000, max: 1250000000000000000000 }` |
| `ft_metadata` | `wNEAR`, 24 decimals, spec `ft-1.0.0` |
| `storage_balance_of` on an unregistered account | `null` |
| `near_deposit` with no deposit | panics `Requires positive attached deposit` |
| `near_withdraw` with no amount | panics `missing field 'amount'` |

the methods exist on the deployed contract, checked with the general
`shit-1170-rex-engine` skill's `check_contract.ts`:
`check_contract.ts --id wrap.near --methods near_deposit,near_withdraw,storage_deposit,storage_minimum_balance,storage_balance_bounds`.

`near_deposit`'s deposit requirement and `near_withdraw`'s argument
shape come from the tool box's fun helpers, which build and send the
exact JSON:

- `wrap_near_deposit_fun_json` — the attached deposit is the amount
- `wrap_near_withdraw_fun_json` — the amount is a string in the
  token's smallest unit, and the deposit is `"1 yocto"`

=====================
<br/>
copyright 2026 by sleet.near
