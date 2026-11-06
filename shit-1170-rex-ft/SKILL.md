---
name: shit-1170-rex-ft
description: Prepare NEAR fungible token (NEP-141 / NEP-145) transfers with the shit-1170 rex engine — the standard method shapes, the gas and deposit for each call, a local contact list, receiver-existence checks, and NEP-145 token-storage checks. Use this skill whenever the user mentions an FT, fungible token, NEP-141, NEP-145, ft_transfer, ft_transfer_call, ft_balance_of, ft_metadata, ft_total_supply, storage_deposit, storage_balance_of, storage_balance_bounds, storage_withdraw, wNEAR, USDC, USDT, token decimals, the contacts list, or wants to send or transfer tokens to a NEAR account — including checking whether a receiver exists and can hold the token. Also use it whenever a transfer amount must be converted from decimals to the token's raw unit amount. Use it for wrapping and unwrapping NEAR — wrap.near, wNEAR, near_deposit, near_withdraw, converting native NEAR to wNEAR or back. Emit a queue payload for a human to sign; never send it yourself.
---

# shit-1170 rex FT

the NEP-141 / NEP-145 fungible token standard, with the safety checks
a token transfer needs.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture. this skill holds the token-specific
parts.

**the rules that apply here too:** the agent never calls a contract. a
read goes to the near-kit tool box (`@near-kit-tool-box/fun`); a write
emits a QUEUE PAYLOAD for the engine to queue for a human to sign.
never `near.call`, never `generic_contract_call_fun`, never
`generic_contract_call_wallet`.

---

#### THE STANDARD

a token contract's account id is the token id. there is no registry
entry to look up — `wrap.near` is wNEAR, `usdt.tether-token.near` is
USDT, and a custom token is its own account id.

not every token implements every method. the standard says what a
token may have; the token's own ABI says what it has.

**the gas and the deposit are two different kinds of claim.** the
standard fixes some of them and says nothing about the rest. where it
says nothing, this skill says "not documented" and the bins use the
engine's own working values. do not present a working value as a
guarantee.

the chain reads go through the near-kit tool box:
`@near-kit-tool-box/fun` for the typed helpers
(`ft_balance_of_fun_json`, `ft_metadata_fun_json`,
`ft_total_supply_fun_json`, and `generic_contract_view_fun_json` for
the views that have no dedicated helper) and `near-kit` for the client,
built with `new Near({ network })` so the default is MAINNET.
`@near-kit-tool-box/env` defaults to testnet, which is why the skills
do not use its client directly.

---

#### THE METHODS

### ft_metadata - VIEW

no arguments. gas: none — a view call. attached deposit: 0.

returns `spec`, `name`, `symbol`, `icon?`, `reference?`,
`reference_hash?`, `decimals`.

**the decimals come from here.** a raw amount is meaningless without
them. read them with `bin/ft_metadata.ts` and convert the human
amount with `shit-1170-rex-unit-conversion`.

### ft_total_supply - VIEW

no arguments. gas: none. attached deposit: 0.

### ft_balance_of - VIEW

```json
{ "account_id": "sleet.near" }
```

gas: none. attached deposit: 0.

### storage_balance_of - VIEW

```json
{ "account_id": "sleet.near" }
```

gas: none. attached deposit: 0.

returns `{ total, available }` in yoctoNEAR, or `null` when the
account has no storage on the token.

**that `null` is the important one.** it means the account cannot
hold the token. a transfer to such an account can succeed as a
transaction and deliver nothing, because the token contract has
nowhere to put the balance. it does not fail. it goes nowhere, and it
says so nowhere.

**always check it before a transfer.** `bin/ft_check.ts` does, and
warns when the receiver has no storage.

### storage_balance_bounds - VIEW

no arguments. gas: none. attached deposit: 0.

returns `{ min, max }` — the token's own storage minimum and maximum,
in yoctoNEAR. use `min` for the `storage_deposit` deposit. 0.00125
NEAR is the standard's floor, not this token's number. USDT's `min` is
exactly 0.00125 NEAR, but other tokens differ, so read the token's own
bounds rather than assuming.

### storage_deposit - CALL

no arguments.

- gas: not documented by the standard
- attached deposit: 0.00125 NEAR — the standard's minimum, though
  some tokens require more; check `storage_balance_bounds` and use the
  token's own `min`

### storage_withdraw - CALL

no arguments.

- gas: not documented by the standard
- attached deposit: 1 yoctoNEAR

### ft_transfer - CALL

```json
{
  "receiver_id": "sleet.near",
  "amount": "1000000000000000000000000"
}
```

- gas: not documented by the standard — the engine's working value is
  30 Tgas
- attached deposit: exactly 1 yoctoNEAR — the contract requires
  exactly this
- `memo` is optional

### ft_transfer_call - CALL

```json
{
  "receiver_id": "sleet.near",
  "amount": "1000000000000000000000000",
  "msg": ""
}
```

- gas: 50 Tgas
- attached deposit: exactly 1 yoctoNEAR
- `memo` is optional

`ft_transfer_call` is how a token enters a DEX, a vault, or any other
contract that takes tokens in. the receiver's method and arguments
live inside `msg` as a JSON string.

**the gas that is documented and the gas that is not.** `ft_transfer`
gas is not documented by the standard — the standard fixes only
`ft_transfer_call`'s 50 Tgas. when you queue a plain transfer, use a
gas value with room for the token's own receipt; when you queue a
`ft_transfer_call`, the receiver's callback runs inside the 50 Tgas,
so a heavy receiver may need more.

**the amount is always the raw unit amount.** a decimal amount like
`1.5` is not an `ft_transfer` argument. convert it with
`shit-1170-rex-unit-conversion` using the token's real decimals from
`ft_metadata`, and verify the result before it goes anywhere near a
transaction.

---

#### THE WRITE PAYLOADS

every CALL method above produces a QUEUE PAYLOAD — data, not an
action. the engine queues it and a human signs it.

| method | args | gas | deposit |
| --- | --- | --- | --- |
| `ft_transfer` | `{ receiver_id, amount, memo? }` | not documented by the standard (engine working value: 30 Tgas) | exactly 1 yoctoNEAR |
| `ft_transfer_call` | `{ receiver_id, amount, msg, memo? }` | 50 Tgas | exactly 1 yoctoNEAR |
| `storage_deposit` | `{}` | not documented by the standard (engine working value: 30 Tgas) | the token's own `storage_balance_bounds.min` (0.00125 NEAR for USDT) |
| `storage_withdraw` | `{}` | not documented by the standard | 1 yoctoNEAR |

`contractId` is the token contract's account id. `method` is the
method name, exactly as the contract spells it. `args` is the
contract's own argument object. `gas` and `deposit` are raw digit
strings — gas units and yoctoNEAR. the web app's `shared/gas_deposit.ts`
also accepts near-kit's human forms (`"30 Tgas"`, `"0.00125 NEAR"`,
`"1 yocto"`) and converts them, so a hand-written payload may use
either. raw digits are preferred, because there is no ambiguity about
what they mean.

---

#### THE CONTACT LIST

```text
${HOME}/.shit-1170-rex-engine/contacts.json
```

**this skill owns the contact list.** the contact check is the FT
skill's safety check, and the transfer is what it guards. the engine
skill reads the same file — there is one list, and a contact added
here is the contact the engine skill sees.

**a transfer to an account that is not on the list is refused unless
the human explicitly approves it and `--force` is passed.**

the reason is simple: a mistyped NEAR account id is usually a valid
account id belonging to somebody else, and the transfer succeeds. the
contact list is a deliberate act — an account id the human has read
and agreed to.

**confirm the address with the human before adding it.** read it back
in full, character for character, and show it to them. a contact list
built from guesses is worse than no list.

```sh
bun bin/contacts.ts list
bun bin/contacts.ts add --account sleet.near --label "Sleet"
bun bin/contacts.ts has --account sleet.near
bun bin/contacts.ts remove --account sleet.near
```

`--force` is not a warning silencer. it records that a human looked
at the address and said yes.

**a contract receiver is not a contact.** the check refuses any
receiver that is not on the list, including a DEX or a vault that the
tokens are meant to go into. that is the rule working as intended:
add the contract to the list once the human has confirmed it, and
then it stops blocking. do not reach for `--force` on a contract
address just because the transfer is "obviously" meant for a DEX —
confirm the contract id the same way as any other address.

---

#### THE TRANSFER FLOW

1. **get the exact token id** — ask, or read it from the user's own
   source. never guess a token from its symbol.
2. **read the token's decimals** — `bin/ft_metadata.ts`. the raw
   amount depends on them.
3. **convert the amount** — use `shit-1170-rex-unit-conversion` to turn
   `1.5` into `1500000000000000000000000` with the token's real
   decimals.
4. **check the receiver** — `bin/ft_check.ts` reads, in one call:
   - does the receiver account exist on chain?
   - is it on the contact list?
   - does it have NEP-145 storage on this token?
   - what are the token's decimals?
5. **confirm the address with the human** — show the full account id.
6. **prepare the transfer** — `bin/ft_transfer.ts` produces the exact
   queue payload the engine queues.
7. **queue it** — pass the payload to the general skill's
   `queue_tx.ts`.
8. **explain** — token, amount in human and raw units, receiver, gas,
   deposit, the queue id, the link to sign it, and the fact that it
   waits for a signature.

### the storage trap

if the receiver has no storage on the token, registering it is part of
the batch. two queue payloads, in this order:

```json
[
  {
    "contractId": "usdt.tether-token.near",
    "method": "storage_deposit",
    "args": {},
    "gas": "30000000000000",
    "deposit": "1250000000000000000000"
  },
  {
    "contractId": "usdt.tether-token.near",
    "method": "ft_transfer",
    "args": { "receiver_id": "sleet.near", "amount": "1500000" },
    "gas": "30000000000000",
    "deposit": "1"
  }
]
```

the two calls run in one batch, in that order. the transfer only gets
tokens after the deposit lands.

use the token's own `storage_balance_bounds` for the exact minimum —
0.00125 NEAR is the standard floor, not a promise.

### native NEAR is not a token

**NEAR the coin is not wNEAR the token.** the chain's own coin has the
id `near` and is NOT a NEP-141 contract — there is no `ft_transfer` for
it, no `ft_metadata`, and no storage to register. wNEAR is the wrapped
contract `wrap.near`, and it IS a NEP-141 token.

so:

- to TRANSFER wNEAR, use this skill. the token is `wrap.near`.
- to SPEND native NEAR, use the general skill's `queue_swap.ts` with
  `tokenIn: "near"`. the router routes native NEAR directly.
- never send native NEAR with `ft_transfer` — there is no contract to
  send it through.

`bin/ft_metadata.ts --token wrap.near` gives wNEAR's decimals, which
are 24, the same as native NEAR's. the decimals do not tell you which
one you have; the id does.

when the human wants to buy something with NEAR and the account holds
no wNEAR, quote the swap out of native NEAR (`tokenIn: "near"`). do
not add a wrap step to make it work — it costs gas, costs a second
route, and needs storage on `wrap.near` before the tokens can land.
see NATIVE NEAR OR wNEAR in the general skill.

### wrapping and unwrapping

`wrap.near` is the wNEAR contract, and it has two methods of its own
for turning the coin into the token and back. they are not the
standard's `ft_transfer`, and they are not a swap.

| intent | method | args | attached deposit | gas |
| --- | --- | --- | --- | --- |
| NEAR → wNEAR | `near_deposit` | `{}` | **the amount to wrap** | 30 Tgas |
| wNEAR → NEAR | `near_withdraw` | `{ "amount": "<unit>" }` | exactly 1 yoctoNEAR | 30 Tgas |

**the deposit on `near_deposit` IS the amount** — it is not a fee, it
becomes the wNEAR. **a wrap is queued as a BATCH, not as a swap**,
because these are direct calls to the contract rather than a route.

**the storage registration is CONDITIONAL.** `near_deposit` mints wNEAR
to the caller, so the account needs NEP-145 storage on `wrap.near` to
hold it. but only an account that is NOT registered yet needs the
registration — a second one on a registered account wastes 0.00125 NEAR
and a call. so the bin reads the chain and includes the registration
only when it is missing.

```sh
bun bin/wrap_check.ts --account sleet.near
bun bin/wrap.ts --direction wrap --amount 1500000000000000000000000
bun bin/wrap.ts --direction unwrap --amount 1500000000000000000000000
```

**never wrap to feed a swap** — the router takes native NEAR directly.

the whole reference, with the payloads and the conditional rule, is in
[WRAP.NEAR.md](./DOCS/WRAP.NEAR.md).

---

#### THE BINS

| bin | what it does |
| --- | --- |
| `ft_transfer.ts` | prepare an `ft_transfer` or `ft_transfer_call` queue payload, with the contact-list check |
| `ft_check.ts` | receiver existence, contact membership, token storage, decimals |
| `ft_balance.ts` | one account's balance of one token, with the decimals |
| `ft_metadata.ts` | a token's metadata, total supply, and storage bounds |
| `wrap.ts` | prepare a `near_deposit` or `near_withdraw` queue payload, with the storage registration in the wrap batch |
| `wrap_check.ts` | an account's native NEAR, wNEAR balance, storage registration on `wrap.near`, and what it can wrap |
| `contacts.ts` | manage the local contact list |

all of them print JSON on stdout and JSON errors on stderr with a
non-zero exit code. a refusal — a receiver that is not on the contact
list — exits 2.

`ft_transfer.ts` takes `--token`, `--receiver`, and `--amount` (the raw
unit amount). `--memo <text>` adds the optional memo, `--gas` and
`--deposit` override the gas (in gas units) and the attached deposit
(in yoctoNEAR), both as raw digit strings, and `--msg <json>` makes it
an `ft_transfer_call`. `--force` overrides the contact-list refusal,
and `--with-storage-deposit` adds the token's storage registration to
the batch.

the general skill has the rest: `balances.ts`, `holders.ts`,
`token_info.ts`, `check_contract.ts`, `check_receiver.ts`.

---

#### EXAMPLES

prepare a transfer:

```sh
bun bin/ft_transfer.ts \
  --token usdt.tether-token.near \
  --receiver sleet.near \
  --amount 1500000
```

check the receiver first:

```sh
bun bin/ft_check.ts --token usdt.tether-token.near --receiver sleet.near
```

a transfer to somebody not on the list, after the human approved it:

```sh
bun bin/ft_transfer.ts --token wrap.near --receiver alice.near --amount 1000000000000000000000 --force
```

a transfer into a contract, with the storage registration in the same
batch:

```sh
bun bin/ft_transfer.ts \
  --token wrap.near \
  --receiver dex.intear.near \
  --amount 1000000000000000000000 \
  --msg '{"method":"swap","args":{"pool_id":0}}' \
  --with-storage-deposit
```

read a balance and the token's decimals:

```sh
bun bin/ft_balance.ts --token usdt.tether-token.near --account sleet.near
bun bin/ft_metadata.ts --token usdt.tether-token.near
```

check what an account can wrap, then prepare the wrap:

```sh
bun bin/wrap_check.ts --account sleet.near
bun bin/wrap.ts --direction wrap --amount 1500000000000000000000000
```

the wrap payload is a batch of two calls — the registration, then the
deposit — and it goes to the general skill's `queue_tx.ts`.

---

#### WHEN NOT TO USE THIS SKILL

- a swap between tokens through the engine's own swap queue: use the
  general skill's `queue_swap.ts`. a swap made *through* a DEX
  contract is different — that is an `ft_transfer_call` into the DEX,
  and it belongs here. a wrap is different again: it is a direct call
  to `wrap.near`, so it is a batch of calls, and it belongs here.
- an NFT: NEP-171 is a different standard with a different transfer
  shape.
- a multi-token contract: NEP-245 has its own interface.
- a contract call that happens to move tokens: use the contract's own
  skill for the method and arguments.

---

#### MORE

- [WRAP.NEAR.md](./DOCS/WRAP.NEAR.md) — the wrap.near contract, the wrap
  and unwrap payloads, and the conditional storage registration

=====================
<br/>
copyright 2026 by sleet.near
