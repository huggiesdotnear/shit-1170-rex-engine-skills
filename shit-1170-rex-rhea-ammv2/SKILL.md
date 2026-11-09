---
name: shit-1170-rex-rhea-ammv2
description: Prepare Rhea AMM v2 (ref-finance v2) DEX calls with the shit-1170 rex engine — quoting swaps, swapping through pools, moving the deposited balance, and registering storage, with the gas and deposit for each flow. Use this skill whenever the user mentions v2.ref-finance.near, the Rhea AMM, ref-finance, an AMM swap, a simple pool, a stable swap pool, a rated pool, get_return, swap, add_simple_pool, the DEX deposited balance, or the ref-finance treasury — including when they want to swap tokens on the AMM, quote a swap, withdraw from the DEX, or find out which tokens a pool holds. Reads go to the near-kit tool box; writes emit a queue payload for a human to sign; never send it yourself.
---

# shit-1170 rex Rhea AMM v2

the ref-finance AMM v2 DEX, as the rex engine needs it: the reads the
bins make, and the queue payloads an agent hands to a human to sign.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture. this skill holds the DEX-specific
parts.

**the rules that apply here too:** the agent never calls a contract. a
read goes to the near-kit tool box (`@near-kit-tool-box/fun`); a write
emits a QUEUE PAYLOAD for the engine to queue for a human to sign.
never `near.call`, never `generic_contract_call_fun`, never
`generic_contract_call_wallet`.

**this is the AMM, not the concentrated-liquidity DEX.** for
`dclv2.ref-labs.near` and its ranges, points and positions, use
`shit-1170-rex-rhea-dclv2`.

---

#### THE CONTRACT

| | mainnet | testnet |
| --- | --- | --- |
| the DEX | `v2.ref-finance.near` | `ref-finance-101.testnet` |

the live mainnet build answers `metadata` with version `1.9.21` and
`pool_count` `9014`.

---

#### THE POOLS

a pool answers with exactly six keys:

```json
{
  "pool_kind": "SIMPLE_POOL",
  "token_account_ids": ["token.skyward.near", "wrap.near"],
  "amounts": ["79848426368936655505064", "3373321323850166573713760549"],
  "total_fee": 30,
  "shares_total_supply": "1181416561034084281406576522",
  "amp": 0
}
```

the pool kinds seen live:

| kind | what it is |
| --- | --- |
| `SIMPLE_POOL` | a constant-product pool |
| `STABLE_SWAP` | an amplified pool for like assets |
| `RATED_SWAP` | a pool with a rated token |
| `DEGEN_SWAP` | a pool with an oracle-priced token |

**the pool id is a NUMBER here**, not a composite string. that is the
big difference from the concentrated-liquidity DEX, where it is
`<token_x>|<token_y>|<fee>`.

`total_fee` is in basis points. `amp` is the amplification factor and
is `0` on a simple pool.

**a pool only holds the tokens it lists.** a swap through a pool that
does not carry the token fails on that hop with
`E102: invalid token id`. read `token_account_ids` first.

---

#### THE SWAP

a swap is a list of **actions**, each one a hop through a pool:

```json
{
  "pool_id": 0,
  "token_in": "wrap.near",
  "amount_in": "1000000000000000000000000",
  "token_out": "token.skyward.near",
  "min_amount_out": "23474618895469086422"
}
```

`amount_in` is **optional** — when it is absent the contract reads the
action as "swap every available balance of `token_in` I hold on the
DEX, up to `min_amount_out`".

`min_amount_out` is the slippage guard, in `token_out`'s smallest
unit. `"0"` accepts any positive amount.

the whole call is:

```json
{
  "actions": [ ... ],
  "referral_id": ""
}
```

**a multi-hop swap chains the pools.** hop one turns the input into
the middle token, hop two turns that into the output. so two hops
need three tokens: in, middle, out.

the bin quotes **each hop** with `get_return` and applies the
tolerance, so every floor comes from the chain and the second hop is
quoted on what the first one produced.

```sh
bun bin/swap.ts \
  --pool-id 0 \
  --token-in wrap.near \
  --token-out token.skyward.near \
  --amount 1000000000000000000000000
```

`--slippage` is a percentage, `0.5` means half a percent.

**a swap takes the tokens straight from the wallet** — the deposited
balance is not involved.

---

#### THE DEPOSITED BALANCE

the DEX keeps a per-account **deposited balance** of every token it
has seen. `withdraw` pays out of it.

the **deposit** is an `ft_transfer_call` on the **token**, with the
DEX as `receiver_id` and the msg `"Deposit"`. so the payload's
`contractId` is the TOKEN.

the **withdrawal** is a contract method on the DEX, and its
`token_id` is the DEX's **inner token id** for the pool — `"2794"` for
pool 2794, or the full `<pool_id>:<token_account>` form. so the
payload's `contractId` is the DEX.

```sh
bun bin/balance.ts deposit --token wrap.near --amount 1000000000000000000000000
bun bin/balance.ts withdraw --token-id 2794 --amount 1000000
```

`withdraw` sets `unregister` to false, so the position is kept, and
`skip_unwrap_near` to false, so a wNEAR withdrawal is unwrapped back
to NEAR.

---

#### THE STORAGE

the DEX keeps NEP-145 storage per account, and the deposit and
withdrawal methods need it.

- the standard's floor is **0.00125 NEAR** — what the payload attaches
- the DEX's own `storage_balance_bounds.min` is **lower** — 0.00102
  NEAR on mainnet. read it with `bin/dex_check.ts` and pass
  `--deposit` when the exact minimum matters

---

#### THE READS

all of these are views. they need no key and no engine account, and
they change nothing on the chain.

| bin | what it reads |
| --- | --- |
| `dex_info.ts` | the DEX's metadata, its pools, or one pool |
| `dex_check.ts` | the storage, the pool's tokens, the token registration, and a quote |
| `balance.ts` | an account's deposited balance, its info, and its LP shares |

`dex_check.ts` is the bin to run **before** anything is queued. it
answers the three things that make an AMM call fail:

1. **does the account have storage on the DEX?** without it the
   deposit and withdrawal methods fail
2. **does the pool hold the token?** a swap through a pool that does
   not carry it fails with `E102: invalid token id`
3. **is the DEX registered as an FT holder of the token?** every token
   inflow is an `ft_transfer_call` on the token into the DEX, and a
   token contract refuses to transfer to a receiver it does not know —
   the call panics with `The account <dex> is not registered` and the
   tokens are refunded

---

#### THE FLOW

1. **read the pool** — `bin/dex_info.ts --pool-id <n>`. which tokens
   it holds, its fee, its reserves.
2. **quote it** — the `get_return` view. the bin does this itself and
   applies the tolerance, so the floor is derived rather than guessed.
3. **check it** — `bin/dex_check.ts --account <acct> --pool-id <n>
   --token-in <t> --token-out <t> --amount <a> --token <t>`.
4. **explain it** — the pool, the route, the amounts in human and raw
   units, the gas, the deposit and what it will do.
5. **prepare it** — `bin/swap.ts`. it prints the queue payload and
   sends nothing.
6. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`, and report the queue id and the link to sign it.
7. **wait, then follow it** — `bin/watch_queue.ts --queue <id>
   --until sent`, then `bin/queue_sent.ts --from-server` for the hash
   and `bin/tx_status.ts` for the outcome.

---

#### THE BINS

| bin | what it does |
| --- | --- |
| `dex_info.ts` | the DEX's metadata, its pools, or one pool |
| `dex_check.ts` | the storage, the pool's tokens, the token registration, and a quote |
| `balance.ts` | read the deposited balance, or prepare a deposit or withdrawal |
| `swap.ts` | prepare a swap queue payload, with the floor from a live quote |
| `storage.ts` | prepare a storage registration, or read the storage status |

all of them print JSON on stdout and JSON errors on stderr with a
non-zero exit code.

`swap.ts`, `balance.ts` and `storage.ts` take
`--network mainnet|testnet`. the default is mainnet.

---

#### WHEN NOT TO USE THIS SKILL

- a concentrated-liquidity pool, a range, a point or an `lpt_id`: that
  is `dclv2.ref-labs.near`, and it belongs to
  `shit-1170-rex-rhea-dclv2`.
- a swap between tokens through the engine's own swap queue: use the
  general skill's `queue_swap.ts`. a swap made *through* the DEX
  contract is different — that is a `swap` call on the DEX, and it
  belongs here.
- a token transfer that is not a DEX flow: use `shit-1170-rex-ft`.
- the DEX's own admin methods — whitelists, fees, ownership, pausing:
  those are the operators' calls, not a user's.

---

#### MORE

- [RHEA.AMMV2.md](./DOCS/RHEA.AMMV2.md) — the full method reference:
  every view and every call this skill uses, with the argument shape,
  the gas and the deposit

=====================
<br/>
copyright 2026 by sleet.near
