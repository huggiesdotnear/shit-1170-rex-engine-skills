---
name: shit-1170-rex-rhea-dclv2
description: Prepare Rhea DCL v2 concentrated-liquidity DEX calls with the shit-1170 rex engine — quoting swaps, adding and removing liquidity, placing limit orders, moving the internal balance, and registering storage, with the gas and deposit for each flow. Use this skill whenever the user mentions dclv2, ref-labs, the Rhea DEX, a concentrated liquidity DEX, a DCL quote, add_liquidity or remove_liquidity, a DCL limit order, a DCL pool or lpt id, the DCL internal balance, dclv2.ref-labs.near, or the DCL treasury — including when they want to swap, provide liquidity, place or cancel an order, or find out what a pool's points and point_delta are. Reads go to the near-kit tool box; writes emit a queue payload for a human to sign; never send it yourself.
---

# shit-1170 rex Rhea DCL v2

the ref-finance concentrated-liquidity DEX v2, as the rex engine needs
it: the reads the bins make, and the queue payloads an agent hands to a
human to sign.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture. this skill holds the DEX-specific
parts.

**the rules that apply here too:** the agent never calls a contract. a
read goes to the near-kit tool box (`@near-kit-tool-box/fun`); a write
emits a QUEUE PAYLOAD for the engine to queue for a human to sign.
never `near.call`, never `generic_contract_call_fun`, never
`generic_contract_call_wallet`.

---

#### THE CONTRACT

| | mainnet | testnet |
| --- | --- | --- |
| the DEX | `dclv2.ref-labs.near` | `dclv2.ref-dev.testnet` |

---

#### THE THREE KINDS OF CALL

the DEX is reached in three different ways, and mixing them up is the
most common mistake:

1. **a view** — a read. free, no signer needed. `quote`, `get_pool`,
   `list_pools` and the rest.
2. **a contract method** — a call on the **DEX**. `add_liquidity`,
   `remove_liquidity`, `withdraw_asset`, `cancel_order`,
   `storage_deposit` and the rest.
3. **an `ft_transfer_call` on the token** — a call on the **token
   contract**, with the DEX as `receiver_id` and the DEX call carried
   inside `msg`. swaps, internal-balance deposits and limit orders all
   work this way.

**the DEX has no `swap` method, no `deposit` method and no
`place_order` method.** those three flows are all `ft_transfer_call`
on the token.

**the payload's `contractId` tells you which kind it is.** a swap, a
deposit and a limit order carry the **token**; an add, a remove, a
withdraw and the storage methods carry the **DEX**.

**beware of taxed tokens.** some tokens take a cut on transfer, so a
taxed token arrives at the DEX with less than was sent.

---

#### THE INTERNAL BALANCE

the DEX keeps a per-user **internal balance** of every token it has
seen. `add_liquidity` pulls from it, and `withdraw_asset` pays out of
it.

so the LP flow is always three steps, never two:

1. `ft_transfer_call` on the token with `msg = "\"Deposit\""` — credit
   the internal balance
2. `add_liquidity` — a direct contract method, pulling from the
   internal balance
3. `withdraw_asset` — a direct contract method, paying out of it

**a swap does NOT touch the internal balance.** it goes straight in
and straight out to the wallet.

**removing liquidity puts the tokens back in the internal balance** —
they do not land in the wallet. pull them out with `withdraw_asset`.

---

#### THE POINTS

a pool's `point_delta` comes from its fee:

| fee | point_delta |
| --- | --- |
| 100 | 1 |
| 400 | 8 |
| 2000 | 40 |
| 10000 | 200 |

- an **LP range** (`left_point`, `right_point`) must sit on multiples
  of `point_delta`, else `E200: invalid endpoint`
- a **limit order** `point` must also sit on the correct side of
  `current_point` for the token being sold, else `E202: illegal
  point`. selling `token_y` wants a point below `current_point`,
  selling `token_x` wants one above

`current_point` is generally not a multiple of `point_delta`, so round
to it — the aligned edges around it are
`floor(current_point / point_delta) * point_delta` and that plus
`point_delta`. the bins read the pool and report them.

read the live order points of a pool from `get_marketdepth` — the
`orders` key — and pick one that already exists there.

---

#### THE ID FORMATS

a **pool id** is a composite STRING, not a number:

```
<token_x_account_id>|<token_y_account_id>|<fee>
```

both segments are the tokens' NEAR account ids and the fee is in basis
points. the tokens are sorted.

an **lpt id** is the pool id plus the owner's liquidity index:

```
<pool_id>#<index>
```

`list_pools` and `list_liquidities` are the views that expose real
ids.

**a token id may be written either way.** a named account
(`wrap.near`) or an implicit one — the bare 64-hex public key with no
`.near` suffix. both forms are live.

---

#### THE STORAGE

the DEX charges per liquidity slot and per order slot on top of the
base storage, so an account with **no storage registered on the DEX**
cannot add liquidity or place a limit order.

- the base minimum is **0.5 NEAR** on mainnet — the live
  `storage_balance_bounds.min`. the bare minimum is not enough in
  practice, because the slots are charged on top of it
- `storage_deposit` attaches 0.5 NEAR
- `storage_withdraw` and `storage_unregister` attach exactly 1
  yoctoNEAR
- `storage_unregister` while a position is open leaves the position
  stranded — withdraw the liquidity first

`get_user_storage_detail` reports the locked NEAR, the `slot_price`,
the `max_slots` and how many liquidity and order slots are in use.

---

#### THE GAS

the `ft_transfer_call` gas is the one to watch:

| flow | gas |
| --- | --- |
| deposit | 1000 Tgas |
| swap | 180 Tgas |
| limit order | 300 Tgas |

a limit order that swaps first needs more than the gas of a plain swap
— 180 Tgas runs out of prepaid gas *after* the swap already succeeded,
so the swap goes through and the order placement fails.

the contract methods use 300 Tgas. an `ft_transfer_call` attaches
exactly 1 yoctoNEAR, and the contract methods take no deposit except
the storage ones.

---

#### THE READS

all of these are views. they need no key and no engine account, and
they change nothing on the chain.

| bin | what it reads |
| --- | --- |
| `dex_info.ts` | the DEX's metadata, its pools, or one pool with its aligned points |
| `dex_check.ts` | the storage, the point alignment, the token registration, and a quote |
| `positions.ts` | an account's positions and its internal balance |

`dex_check.ts` is the bin to run **before** anything is queued. it
answers the four things that make a DCL call fail:

1. **does the account have storage on the DEX?** without it
   `add_liquidity` and the order methods fail
2. **are the range points aligned?** unaligned points fail with
   `E200: invalid endpoint`
3. **is the DEX registered as an FT holder of the token?** every token
   inflow is an `ft_transfer_call` on the token into the DEX, and a
   token contract refuses to transfer to a receiver it does not know —
   the call panics with `The account <dex> is not registered` and the
   tokens are refunded. check it with `ft_storage_balance_of` on the
   token
4. **what does the swap quote?** the floor the swap accepts comes from
   the quote with a tolerance applied

---

#### SWAPPING

the flow, and the bins to run at each step:

1. **quote it** — the `quote` view. the bin does this itself and
   applies the tolerance, so the floor is derived from the chain and
   not guessed.
2. **check the output token** — it needs NEP-145 storage registered
   for the signer, or the swap can succeed and deliver nothing.
3. **prepare it** — `bin/swap.ts`. it prints the queue payload and
   sends nothing.
4. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`.

```sh
bun bin/swap.ts \
  --token-in wrap.near \
  --amount 1000000000000000000000000 \
  --pool-ids "a0b86991c6218b36c1d19b4a2e9eb0ce3606eb48.factory.bridge.near|wrap.near|2000" \
  --output-token a0b86991c6218b36c1d19b4a2e9eb0ce3606eb48.factory.bridge.near
```

`--slippage` is a percentage, `0.5` means half a percent.
`--min-output` overrides the derived floor.

**the route is a comma separated list of pool ids**, in order.

---

#### PROVIDING LIQUIDITY

**1. fund the internal balance**

```sh
bun bin/balance.ts deposit --token wrap.near --amount 1000000000000000000000000
```

**2. check the range**

```sh
bun bin/dex_check.ts --account <account> --pool-id <pool_id> --left-point <n> --right-point <n>
```

**3. add the liquidity**

```sh
bun bin/liquidity.ts add \
  --pool-id <pool_id> \
  --left-point 401640 \
  --right-point 401680 \
  --amount-x 1000000000000000000000000 \
  --amount-y 0
```

**the three range shapes.** the shape of the range against
`current_point` decides which token is needed, and how much of it:

- a range entirely **below** `current_point` needs only `amount_y`
- a range entirely **above** `current_point` needs only `amount_x`
- a range that **straddles** `current_point` needs both, and it takes
  much more of the second token than a single-sided range of the same
  width

**deposit enough of both tokens before a two-sided add.** a two-sided
range that is short on the second token fails with `E101: insufficient
balance`.

**4. get the tokens out again**

```sh
bun bin/balance.ts withdraw --token wrap.near
```

---

#### REMOVING LIQUIDITY

**1. find the position**

```sh
bun bin/positions.ts --account <account>
```

**2. remove it**

```sh
bun bin/liquidity.ts remove --lpt-id <pool_id#index> --amount <liquidity_amount>
```

`--amount` is the **liquidity amount**, not a token amount. read it
from the position.

**the tokens land in the internal balance**, so pull them out with
`bin/balance.ts withdraw`.

**claim the fees without closing the position.** an amount of `"0"`
claims the accrued fees and removes **no** liquidity, so the position
stays open. there is **no `claim_fee` method** — this is how it is
done.

**the fees accrue only while the price trades through your range.** a
position that sits entirely on one side of the current price earns
nothing until a swap crosses it.

---

#### PLACING A LIMIT ORDER

```sh
bun bin/limit_order.ts \
  --sell-token wrap.near \
  --amount 1000000000000000000000000 \
  --pool-id <pool_id> \
  --buy-token <token_bought> \
  --point 401640
```

**`buy_token` is the token being bought** — the one you do not send.
you send the **sell** token.

`--with-swap` is true for `LimitOrderWithSwap` — it fills what it can
right away, then rests the remainder — and false for the plain
`LimitOrder`, which rests entirely.

**the point must be aligned AND on the correct side.** the bin reads
the pool and warns when it is not.

**read the live order points of a pool from `get_marketdepth`** — the
`orders` key — and pick one that already exists there.

---

#### THE BINS

| bin | what it does |
| --- | --- |
| `dex_info.ts` | the DEX's metadata, its pools, or one pool with its aligned points |
| `dex_check.ts` | the storage, the point alignment, the token registration, and a quote |
| `positions.ts` | an account's positions and its internal balance |
| `swap.ts` | prepare a swap queue payload, with the floor from a live quote |
| `liquidity.ts` | prepare an `add_liquidity` or `remove_liquidity` queue payload |
| `balance.ts` | prepare an internal-balance deposit or withdrawal queue payload |
| `limit_order.ts` | prepare a limit order queue payload |
| `storage.ts` | prepare a storage register, release or unregister queue payload |

all of them print JSON on stdout and JSON errors on stderr with a
non-zero exit code.

`swap.ts`, `liquidity.ts`, `balance.ts` and `limit_order.ts` take
`--network mainnet|testnet`. the default is mainnet.

---

#### WHEN NOT TO USE THIS SKILL

- a swap between tokens through the engine's own swap queue: use the
  general skill's `queue_swap.ts`. a swap made *through* the DEX
  contract is different — that is an `ft_transfer_call` into the DEX,
  and it belongs here.
- an NFT or a multi-token contract: NEP-171 and NEP-245 have their own
  interfaces.
- the DEX's own admin methods — pausing, whitelists, ownership: those
  are the operators' calls, not a user's.
- a contract call that happens to move tokens: use that contract's own
  skill for the method and arguments.

---

#### MORE

- [RHEA.DCLV2.md](./DOCS/RHEA.DCLV2.md) — the full method reference:
  every view and every call this skill uses, with the argument shape,
  the gas and the deposit

=====================
<br/>
copyright 2026 by sleet.near
