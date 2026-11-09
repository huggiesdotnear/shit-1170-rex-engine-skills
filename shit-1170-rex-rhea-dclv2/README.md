# shit-1170-rex-rhea-dclv2

Rhea DCL v2 concentrated-liquidity DEX for the shit-1170 rex engine.

quote a swap, add and remove liquidity, place a limit order, move the
internal balance, and register storage — all as queue payloads for a
human to sign.

see [SKILL.md](./SKILL.md) for the overview and the flow.

---

#### THE BINS

```sh
bun bin/dex_info.ts [--list-pools --limit 50] [--pool-id <id>]
bun bin/dex_check.ts --account <account_id> [--token <token_id>] [--pool-id <id> --left-point <n> --right-point <n>]
bun bin/positions.ts --account <account_id>

bun bin/swap.ts --token-in <token_id> --amount <unit_amount> --pool-ids <pool_id_csv> --output-token <token_id> [--slippage 0.5]
bun bin/liquidity.ts add --pool-id <id> --left-point <n> --right-point <n> --amount-x <unit> --amount-y <unit>
bun bin/liquidity.ts remove --lpt-id <pool_id#index> --amount <liquidity_amount>
bun bin/balance.ts deposit --token <token_id> --amount <unit_amount>
bun bin/balance.ts withdraw --token <token_id> [--amount <unit_amount>]
bun bin/limit_order.ts --sell-token <token_id> --amount <unit_amount> --pool-id <id> --buy-token <token_id> --point <n> [--with-swap]
bun bin/storage.ts register|withdraw|unregister|status [--account <account_id>]
```

every bin prints JSON on stdout and JSON errors on stderr with a
non-zero exit code.

---

#### THE THREE KINDS OF CALL

the DEX is reached in three ways, and mixing them up is the most
common mistake:

1. a **view** — a read. free, no signer.
2. a **contract method** on the DEX — `add_liquidity`,
   `remove_liquidity`, `withdraw_asset`, `cancel_order`, the storage
   methods.
3. an **`ft_transfer_call` on the token** — with the DEX as
   `receiver_id` and the DEX call inside `msg`. swaps, internal
   deposits and limit orders.

**the DEX has no `swap` method, no `deposit` method and no
`place_order` method.** those three flows are `ft_transfer_call` on
the token, so the payload's `contractId` is the **token**, not the
DEX.

---

#### THE INTERNAL BALANCE

`add_liquidity` pulls from the DEX's per-user internal balance, and
`withdraw_asset` pays out of it. so the LP flow is three steps:

1. `balance.ts deposit` — an `ft_transfer_call` with msg `"Deposit"`
2. `liquidity.ts add` — a contract method on the DEX
3. `balance.ts withdraw` — a contract method on the DEX

a swap does **not** touch the internal balance.

---

#### THE POINTS

a pool's `point_delta` comes from its fee: 100→1, 400→8, 2000→40,
10000→200.

- an LP range must sit on multiples of `point_delta`, else
  `E200: invalid endpoint`
- a limit order's point must also sit on the correct side of
  `current_point` for the token being sold, else `E202: illegal
  point`

`current_point` is generally not a multiple of `point_delta`, so round
to it. the bins read the pool and report the aligned edges.

---

#### THE GAS

| flow | gas |
| --- | --- |
| deposit | 1000 Tgas |
| swap | 180 Tgas |
| limit order | 300 Tgas |
| the contract methods | 300 Tgas |

an `ft_transfer_call` attaches exactly 1 yoctoNEAR. the contract
methods take no deposit, except the storage ones: `storage_deposit`
attaches 0.5 NEAR and the two releases attach 1 yoctoNEAR.

---

#### THE FULL REFERENCE

the method reference, with every view and every call, is in
[RHEA.DCLV2.md](./DOCS/RHEA.DCLV2.md).

=====================
<br/>
copyright 2026 by sleet.near
