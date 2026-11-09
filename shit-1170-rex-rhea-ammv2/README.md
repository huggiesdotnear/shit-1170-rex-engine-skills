# shit-1170-rex-rhea-ammv2

Rhea AMM v2 (ref-finance v2) for the shit-1170 rex engine.

quote a swap, swap through pools, move the deposited balance, and
register storage — all as queue payloads for a human to sign.

see [SKILL.md](./SKILL.md) for the overview and the flow.

---

#### THE BINS

```sh
bun bin/dex_info.ts [--list-pools --limit 50] [--pool-id <n>]
bun bin/dex_check.ts --account <account_id> [--pool-id <n> --token-in <t> --token-out <t> --amount <u>] [--token <t>]
bun bin/balance.ts check --account <account_id> [--pool-id <n>]

bun bin/swap.ts --pool-id <n[,n,...]> --token-in <t[,t,...]> --token-out <t> --amount <unit_amount> [--slippage 0.5]
bun bin/balance.ts deposit --token <token_id> --amount <unit_amount>
bun bin/balance.ts withdraw --token-id <inner_token_id> --amount <unit_amount>
bun bin/storage.ts register [--account <account_id>] [--deposit <yocto>]
```

every bin prints JSON on stdout and JSON errors on stderr with a
non-zero exit code.

---

#### THE CONTRACT

| | mainnet | testnet |
| --- | --- | --- |
| the DEX | `v2.ref-finance.near` | `ref-finance-101.testnet` |

**this is the AMM, not the concentrated-liquidity DEX.** for
`dclv2.ref-labs.near` and its ranges, points and positions, use
`shit-1170-rex-rhea-dclv2`.

---

#### THE POOL

a pool answers with exactly six keys: `pool_kind`,
`token_account_ids`, `amounts`, `total_fee`, `shares_total_supply`
and `amp`.

**the pool id is a NUMBER here**, not a composite string.

a pool only holds the tokens it lists — a swap through a pool that
does not carry the token fails on that hop with
`E102: invalid token id`.

---

#### THE SWAP

a swap is a list of **actions**, each one a hop through a pool:

```json
{ "pool_id": 0, "token_in": "wrap.near", "amount_in": "1000", "token_out": "token.skyward.near", "min_amount_out": "23474618895469086422" }
```

`amount_in` is optional — without it the contract swaps every
available balance of `token_in` up to `min_amount_out`.

**a multi-hop swap chains the pools.** two hops need three tokens:
in, middle, out. `--pool-id` and `--token-in` take comma separated
lists, one entry per hop.

the bin quotes **each hop** with `get_return` and applies the
tolerance, so every floor comes from the chain.

---

#### THE DEPOSITED BALANCE

the DEX keeps a per-account deposited balance. `withdraw` pays out of
it.

- the **deposit** is an `ft_transfer_call` on the **token** — the
  payload's `contractId` is the token
- the **withdrawal** is a contract method on the DEX, and its
  `token_id` is the DEX's inner token id for the pool — `"2794"` for
  pool 2794 — so the payload's `contractId` is the DEX

---

#### THE GAS AND THE DEPOSIT

the toolbox's swap and withdraw helpers set no gas of their own, so
the engine's default applies — 30 Tgas. the deposits are 0.

the storage registration attaches 0.00125 NEAR, the NEP-145 standard's
floor. the DEX's own `storage_balance_bounds.min` is lower — 0.00102
NEAR on mainnet.

---

#### THE FULL REFERENCE

the method reference, with every view and every call, is in
[RHEA.AMMV2.md](./DOCS/RHEA.AMMV2.md).

=====================
<br/>
copyright 2026 by sleet.near
