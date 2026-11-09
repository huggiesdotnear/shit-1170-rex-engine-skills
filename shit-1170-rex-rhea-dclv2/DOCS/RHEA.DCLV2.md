# Rhea DCL v2 — the full method reference

every view and every call this skill uses, with the argument shape, the
gas and the attached deposit.

the shapes and the values come from the near-kit tool box's
`rhea_dclv2_*_fun_json` helpers, which build and send the exact JSON,
and from the live mainnet contract.

---

#### THE ACCOUNTS

| | mainnet | testnet |
| --- | --- |
| the DEX | `dclv2.ref-labs.near` | `dclv2.ref-dev.testnet` |

---

#### THE VIEWS

a view is a read. it needs no key, no signer and no deposit, and it
changes nothing on the chain.

| method | args | returns |
| --- | --- | --- |
| `get_metadata` | `{}` | the version, the owner, the wNEAR id, the state, the pool and user counts |
| `get_pool` | `{ pool_id }` | one pool |
| `get_pools` | `{ from_index, limit }` | a page of pools |
| `list_pools` | `{ from_index, limit }` | a page of pools |
| `get_liquidity` | `{ lpt_id }` | one position |
| `list_liquidities` | `{ owner_id, from_index, limit }` | an account's positions |
| `list_liquidity_views` | `{ owner_id, from_index, limit }` | the positions with their current token amounts and fees |
| `get_user_asset` | `{ token_id, account_id }` | one token's internal balance, as a bare decimal string |
| `list_user_assets` | `{ account_id }` | every token in the internal balance, as a map |
| `quote` | `{ pool_ids, input_token, output_token, input_amount, tag }` | `{ amount, tag }` |
| `quote_by_output` | `{ pool_ids, input_token, output_token, output_amount }` | `{ amount, tag }` — the INPUT needed |
| `predict_add_liquidity` | the add args | what the range would need |
| `predict_remove_liquidity` | `{ lpt_id, amount }` | what the removal would return |
| `get_marketdepth` | `{ pool_id, depth }` | the pool's depth, with the live `orders` |
| `get_market_depth_list` | the depth args | the depth as a list |
| `get_order` | `{ order_id }` | one order |
| `find_order` | the find args | the orders matching a query |
| `list_active_orders` | `{ owner_id, from_index, limit }` | an account's live orders |
| `list_history_orders` | `{ owner_id, from_index, limit }` | an account's past orders |
| `storage_balance_of` | `{ account_id }` | `{ total, available }`, or `null` |
| `storage_balance_bounds` | `{}` | `{ min, max }` |
| `get_user_storage_detail` | `{ user_id }` | the locked NEAR, the slot price, the slots in use |

**the `quote` args.** `pool_ids` is the ordered **route** through the
pools. `input_amount` is in yocto units of the input token. `tag` is
an optional opaque label echoed back.

**`quote_by_output` returns the INPUT** needed for that exact output —
the opposite sense of `quote`.

**`predict_remove_liquidity` takes `amount`,** not `liquidity` — the
contract expects the burned amount under the key `amount`.

**`get_user_asset` answers with a BARE decimal string**, not an
object. the token and the account are both in the request.

**`storage_balance_bounds` answers with `{ min, max }`** — the live
`min` on mainnet is 0.5 NEAR.

---

#### THE CONTRACT METHODS

a call on the DEX itself. the payload's `contractId` is the **DEX**.

| method | args | gas | deposit |
| --- | --- | --- | --- |
| `add_liquidity` | `{ pool_id, left_point, right_point, amount_x, amount_y, min_amount_x, min_amount_y }` | 300 Tgas | 0 |
| `remove_liquidity` | `{ lpt_id, amount, min_amount_x, min_amount_y }` | 300 Tgas | 0 |
| `withdraw_asset` | `{ token_id, amount? }` | 300 Tgas | 0 |
| `cancel_order` | `{ order_id, amount? }` | 300 Tgas | 0 |
| `storage_deposit` | `{ registration_only }` | 300 Tgas | 0.5 NEAR |
| `storage_withdraw` | `{}` | 300 Tgas | 1 yoctoNEAR |
| `storage_unregister` | `{}` | 300 Tgas | 1 yoctoNEAR |

**these storage methods are calls on the DEX contract itself**, so their
gas and deposit are the DEX's own — 300 Tgas and 0.5 NEAR. they are not
the NEP-145 token-standard numbers, and not the same as the AMM v2
DEX's storage methods. a token's own `storage_deposit`, where the
deposit comes from `storage_balance_bounds.min`, is in the
`shit-1170-rex-ft` skill.

### add_liquidity

```json
{
  "pool_id": "a0b86991c6218b36c1d19b4a2e9eb0ce3606eb48.factory.bridge.near|wrap.near|2000",
  "left_point": 401640,
  "right_point": 401680,
  "amount_x": "1000000000000000000000000",
  "amount_y": "0",
  "min_amount_x": "0",
  "min_amount_y": "0"
}
```

`min_amount_x` and `min_amount_y` are **required fields** — the
slippage guards. `None` is sent as `"0"`. set them above zero before
using this with value.

the points must be multiples of the pool's `point_delta`, else
`E200: invalid endpoint`.

a range entirely above `current_point` only consumes `amount_x`; a
range entirely below only consumes `amount_y`; a range straddling
`current_point` needs both.

**attaching a deposit fails** with "Method add_liquidity doesn't
accept deposit".

### remove_liquidity

```json
{
  "lpt_id": "nearvember-337.meme-cooking.near|wrap.near|10000#17677",
  "amount": "1000",
  "min_amount_x": "0",
  "min_amount_y": "0"
}
```

`amount` is the **liquidity amount**, not a token amount.

an amount of `"0"` claims the accrued fees and removes **no**
liquidity — the position stays open. there is no `claim_fee` method.

the tokens land in the signer's internal balance — pull them out with
`withdraw_asset`.

### withdraw_asset

```json
{ "token_id": "wrap.near", "amount": "1000000000000000000000000" }
```

omit `amount` to withdraw the whole balance of that token — the call
shape is then just `{ token_id }`.

### cancel_order

```json
{ "order_id": "1:0", "amount": "0" }
```

omit `amount` for a full cancel. pass `"0"` to claim the filled
amount (`unclaimed_amount`) without cancelling the remainder.

### storage_deposit

```json
{ "registration_only": true }
```

the deposit is 0.5 NEAR. the bare `storage_balance_bounds` minimum is
**not** enough in practice — the DEX charges per liquidity and per
order slot on top of it.

---

#### THE TOKEN INFLOWS

these are calls on the **token** contract, with the DEX as the
`receiver_id`. the payload's `contractId` is the **token**.

each attaches exactly 1 yoctoNEAR.

### ft_transfer_call — deposit

```json
{
  "receiver_id": "dclv2.ref-labs.near",
  "amount": "1000000000000000000000000",
  "msg": "\"Deposit\""
}
```

the `msg` is the JSON string `"Deposit"`, including its quotes.

- gas: 1000 Tgas

### ft_transfer_call — swap

```json
{
  "receiver_id": "dclv2.ref-labs.near",
  "amount": "1000000000000000000000000",
  "msg": "{\"Swap\":{\"pool_ids\":[\"a0b86991c6218b36c1d19b4a2e9eb0ce3606eb48.factory.bridge.near|wrap.near|2000\"],\"output_token\":\"a0b86991c6218b36c1d19b4a2e9eb0ce3606eb48.factory.bridge.near\",\"min_output_amount\":\"3561477\"}}"
}
```

- `pool_ids` is the ordered route through the pools
- `min_output_amount` is the floor — take the quote amount and shave
  the tolerance off it. `"0"` accepts any output price
- the output token must have storage registered for the signer or the
  swap fails
- gas: 180 Tgas

### ft_transfer_call — limit order

```json
{
  "receiver_id": "dclv2.ref-labs.near",
  "amount": "1000000000000000000000000",
  "msg": "{\"LimitOrder\":{\"pool_id\":\"<token_x>|<token_y>|<fee>\",\"buy_token\":\"<token_bought>\",\"point\":401640,\"client_id\":\"\"}}"
}
```

`LimitOrderWithSwap` is the same shape with that name — it fills what
it can right away, then rests the remainder.

- `buy_token` is the token being bought — the one you do **not** send
- `point` must be a multiple of the pool's `point_delta` and inside
  the pool's legal point range, else `E202: illegal point`. selling
  `token_y` wants a point below `current_point`; selling `token_x`
  wants one above
- `client_id` is required — pass `""`
- do **not** pass `referral_id: ""`; the contract parses it as an
  account id and an empty string fails with
  `E600: invalid msg: Error("the account ID is invalid")`. omit the
  field entirely
- gas: 300 Tgas

**the DEX must be an FT holder of the token.** every inflow is an
`ft_transfer_call` on the token into the DEX, and a token contract
refuses to transfer to an unregistered receiver — the call panics with
`The account <dcl_id> is not registered` and the tokens are refunded.
check it with `ft_storage_balance_of` on the token contract — a `null`
means "not registered".

---

#### THE POINTS

a pool's `point_delta` comes from its fee:

| fee | point_delta |
| --- | --- |
| 100 | 1 |
| 400 | 8 |
| 2000 | 40 |
| 10000 | 200 |

an LP range must sit on multiples of it, else `E200: invalid
endpoint`.

a limit order's point must also sit on the correct side of
`current_point` for the token being sold, else `E202: illegal point`.

`current_point` is generally not a multiple of `point_delta`, so round
to it. the aligned edges around it are
`floor(current_point / point_delta) * point_delta` and that plus
`point_delta`.

---

#### THE ID FORMATS

a **pool id** is `<token_x_account_id>|<token_y_account_id>|<fee>` —
the tokens' NEAR account ids, sorted, and the fee in basis points.

an **lpt id** is the pool id plus the owner's liquidity index:
`<pool_id>#<index>`.

a **token id** may be written either way — a named account
(`wrap.near`) or an implicit one, the bare 64-hex public key with no
`.near` suffix. both forms are live.

---

#### THE INTERNAL BALANCE

the DEX keeps a per-user internal balance of every token it has seen.
`add_liquidity` pulls from it and `withdraw_asset` pays out of it.

a swap does **not** touch it — a swap goes straight in and straight
out to the wallet.

`get_user_asset` answers with a bare decimal string. `list_user_assets`
answers with a `{ token_id: balance }` map.

---

#### THE FEES

there is **no `claim_fee` method**. the fees are claimed by calling
`remove_liquidity` with an `amount` of `"0"` — that claims the fees
and removes **no** liquidity, so the position stays open. the claimed
fees go **straight to the wallet**, not the internal balance.

the fees accrue only while the price trades through the range.

`get_liquidity` and `list_liquidities` answer with
`unclaimed_fee_x` and `unclaimed_fee_y`. the **views**
(`list_liquidity_views`) answer with `token_x` / `token_y` — the
current token amount on each side — and `fee_x` / `fee_y`.

---

#### THE SOURCE

the DEX is the ref-finance concentrated-liquidity DEX v2. the live
mainnet build answers `get_metadata` with version `2.4.2`.

```sh
near contract inspect dclv2.ref-labs.near network-config mainnet now
near contract inspect dclv2.ref-dev.testnet network-config testnet now
```

=====================
<br/>
copyright 2026 by sleet.near
