# Rhea AMM v2 — the full method reference

every view and every call this skill uses, with the argument shape, the
gas and the attached deposit.

the shapes and the values come from the near-kit tool box's
`rhea_ammv2_*_fun_json` helpers, which build and send the exact JSON,
and from the live mainnet contract.

---

#### THE ACCOUNTS

| | mainnet | testnet |
| --- | --- | --- |
| the DEX | `v2.ref-finance.near` | `ref-finance-101.testnet` |

---

#### THE VIEWS

a view is a read. it needs no key, no signer and no deposit, and it
changes nothing on the chain.

| method | args | returns |
| --- | --- | --- |
| `metadata` | `{}` | the version, the owner, the wNEAR id, the state, the admin fee, the pool count |
| `version` | `{}` | the contract version, e.g. `1.9.21` |
| `get_number_of_pools` | `{}` | how many pools |
| `get_pools` | `{ from_index, limit }` | a page of pools |
| `get_pool` | `{ pool_id }` | one pool |
| `get_pool_by_ids` | `{ pool_ids }` | several pools |
| `get_return` | `{ pool_id, token_in, amount_in, token_out }` | the expected output, as a decimal string |
| `get_return_by_output` | `{ pool_id, token_in, token_out, amount_out }` | the INPUT needed for that output |
| `get_pool_shares` | `{ pool_id, account_id }` | an account's shares in a pool |
| `get_pool_shares_batch` | `{ pool_ids, account_id }` | an account's shares in several pools |
| `get_pool_total_shares` | `{ pool_id }` | the shares issued for a pool |
| `get_pool_share_price` | `{ pool_id }` | the share price — **not implemented on the live build** |
| `get_deposits` | `{ account_id }` | every token in the deposited balance, as a map |
| `get_deposit` | `{ account_id, token_id }` | one token's deposited balance |
| `get_account_basic_info` | `{ account_id }` | the account's NEAR balance and storage used |
| `get_pool_fee` | `{ pool_id }` | the pool's fee |
| `get_pool_volumes` | `{ pool_id }` | the pool's volumes |
| `storage_balance_of` | `{ account_id }` | `{ total, available }`, or `null` |
| `storage_balance_bounds` | `{}` | `{ min, max }` |
| `get_user_storage_state` | `{ account_id }` | the account's storage state |
| `predict_add_simple_liquidity` | the add args | what the add would need |
| `predict_remove_liquidity` | the remove args | what the removal would return |
| `predict_swap_actions` | the swap args | what the swap would return |

**`get_return` answers with a bare decimal string** — the output
amount in `token_out`'s smallest unit.

**`get_return_by_output` is the opposite sense** — it answers with the
INPUT needed for that exact output.

**`get_pool_share_price` is not implemented on the live build.** it
panics with `not implemented` at `ref-exchange/src/pool.rs:161`.

**`get_deposits` answers with a `{ token_id: balance }` map** that
holds every token the DEX has ever seen for that account, including
the zero balances.

---

#### THE CALLS

a call on the DEX. the payload's `contractId` is the **DEX**.

| method | args | gas | deposit |
| --- | --- | --- | --- |
| `swap` | `{ actions, referral_id }` | 30 Tgas | 0 |
| `withdraw` | `{ amount, token_id, unregister, skip_unwrap_near }` | 30 Tgas | 0 |
| `add_simple_pool` | `{ fee, tokens }` | 30 Tgas | 0 |
| `storage_deposit` | `{}` | 30 Tgas | 0.00125 NEAR |

**the toolbox's swap and withdraw helpers set no gas of their own**,
so the engine's default applies — 30 Tgas, the middleman's
`DEFAULT_GAS`.

### swap

```json
{
  "actions": [
    {
      "pool_id": 0,
      "token_in": "wrap.near",
      "amount_in": "1000000000000000000000000",
      "token_out": "token.skyward.near",
      "min_amount_out": "23474618895469086422"
    }
  ],
  "referral_id": ""
}
```

`amount_in` is **optional** — when it is absent the contract reads the
action as "swap every available balance of `token_in` I hold on the
DEX, up to `min_amount_out`".

`min_amount_out` is the slippage guard. `"0"` accepts any positive
amount.

`referral_id` is optional — an empty string leaves it unset.

**a multi-hop swap chains the pools.** hop one turns the input into
the middle token, hop two turns that into the output.

**a pool only holds the tokens it lists.** a hop through a pool that
does not carry the token fails with `E102: invalid token id`.

### withdraw

```json
{
  "amount": "1000000",
  "token_id": "2794",
  "unregister": false,
  "skip_unwrap_near": false
}
```

`token_id` is the DEX's **inner token id** for the pool — `"2794"` for
pool 2794, or the full `<pool_id>:<token_account>` form.

`unregister` is false, so the position is kept. `skip_unwrap_near` is
false, so a wNEAR withdrawal is unwrapped back to NEAR.

### add_simple_pool

```json
{
  "fee": 30,
  "tokens": ["token.skyward.near", "wrap.near"]
}
```

`fee` is in basis points, and `tokens` is the **ordered** list of the
pool's NEP-141 accounts — at least two.

### storage_deposit

no args. the contract infers the account from the signer.

the deposit is 0.00125 NEAR — the NEP-145 standard's floor. the DEX's
own `storage_balance_bounds.min` is lower, 0.00102 NEAR on mainnet.

---

#### THE TOKEN INFLOWS

the deposit into the DEX's per-account balance is an `ft_transfer_call`
on the **token**, with the DEX as `receiver_id`. the payload's
`contractId` is the **token**.

```json
{
  "receiver_id": "v2.ref-finance.near",
  "amount": "1000000000000000000000000",
  "msg": "\"Deposit\""
}
```

the `msg` is the JSON string `"Deposit"`, including its quotes.

- gas: 30 Tgas
- attached deposit: 1 yoctoNEAR

**the DEX must be an FT holder of the token.** the call panics with
`The account <dex> is not registered` and the tokens are refunded when
it is not.

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

**the pool id is a NUMBER**, not a composite string. `total_fee` is in
basis points. `amp` is the amplification factor, and it is `0` on a
simple pool.

---

#### THE DEPOSITED BALANCE

the DEX keeps a per-account deposited balance of every token it has
seen. `withdraw` pays out of it.

`get_deposits` answers with a `{ token_id: balance }` map holding
every token the DEX has ever seen for that account, including the
zero balances.

**the deposited balance is NOT the LP position.** the deposited
balance is tokens the account parked at the DEX; the LP position is the
account's share of a pool's reserves. they are separate, and the
deposited balance map never holds a position.

**a swap does NOT need the deposited balance** — it takes the tokens
straight from the caller's wallet.

---

#### THE LP POSITIONS

**there is NO view that lists an account's LP positions** on this DEX.
the contract has no "my positions" method. to find out what an account
holds in a pool you must already know the pool id.

| method | args | returns |
| --- | --- | --- |
| `get_pool_shares` | `{ pool_id, account_id }` | a **bare share string** |
| `get_pool_shares_batch` | `{ pool_ids, account_id }` | an **array of share strings** |
| `get_unit_share_token_amounts` | `{ pool_id }` | what **one** share is worth, per token |
| `get_unit_share_twap_token_amounts` | `{ pool_id }` | the same, time-weighted |

the shares alone do not say what they are worth. the token amounts
behind a position are the unit share amounts multiplied by the shares.

**the concentrated-liquidity DEX is different** — `dclv2.ref-labs.near`
has `list_liquidities(account_id, from_index, limit)`, which DOES list
an account's positions as full objects, with the `lpt_id`, the range
and the accrued fees. the AMM has no equivalent.

---

#### THE SOURCE

the DEX is the ref-finance AMM v2. the live mainnet build answers
`metadata` with version `1.9.21` and `pool_count` `9014`.

```sh
near contract inspect v2.ref-finance.near network-config mainnet now
near contract inspect ref-finance-101.testnet network-config testnet now
```

=====================
<br/>
copyright 2026 by sleet.near
