---
name: shit-1170-rex-engine
description: "Propose, verify, queue, and track NEAR transactions and swaps with the shit-1170 rex engine. Use this skill whenever the user mentions shit-1170, shit-1170-rex-engine, the rex engine, a tx queue, a swap queue, queuing a transaction, proposing a transaction for signing, checking a queued transaction's outcome, or using @huggies/shit-1170-rex-engine-middleman — including when the user wants the agent to prepare NEAR contract calls without sending them. Also use it for the rex engine's website data: token holders, direct balances, internal DEX balances, token metadata, or account balances, and for waiting on the live feed when a human is about to sign — the transaction hash comes from the engine, so the human never has to paste one. Queue work for a human to sign; do not sign or send transactions yourself."
---

# shit-1170 rex engine

the engine is a feed and a transaction queue for NEAR. agents prepare
work; humans sign it in their wallet.

- live site: <https://shit-1170.com/>
- code: <https://github.com/huggiesdotnear/shit-1170-rex-engine>
- typed client: `@huggies/shit-1170-rex-engine-middleman`

this skill owns the queueing mechanics. the token and contract skills
own the facts about their contracts and link here for the rest.

---

#### THE ONE RULE

**the agent NEVER calls a contract.**

every state-changing call goes through the engine as a QUEUED generic
function call, and a human signs it in the web app with their wallet.
the agent prepares the transaction and queues it. it does not sign, send,
or wait for a signature.

so:

- **reads** go to the near-kit tool box, directly. a view is a read: no
  API key, no engine account, and a typed helper for most of them.
- **writes** emit a QUEUE PAYLOAD — `{ contractId, method, args, gas,
  deposit }` — the exact shape the engine's tx-queue accepts. it is NOT
  a near-kit transaction and NOT a `near.call`.

never call `near.call`, `generic_contract_call_fun`, or
`generic_contract_call_wallet` from a skill bin. the tool box's
`*_fun_json` helpers that CALL are reference material: take the
argument shape, the gas, and the deposit from them, but emit a queue
payload instead of sending. `generic_contract_call_wallet` needs a
browser wallet — a skill bin runs in a terminal and must never sign.

**the tool box supplies the facts; the queue helpers carry the action.**

**why a queue and not a transaction.** the engine's queue is a batch of
calls for a human to sign in one wallet popup. that gives three things
a normal transaction does not:

- the human sees the whole batch before any of it runs
- several calls that depend on each other run in one transaction, so
  the receipt tree holds together
- the proposal stays visible in a feed until somebody acts on it

so the agent's job is to prepare the batch and the human's job is to
sign it. an agent that waits for a signature has misunderstood its
role.

---

#### THE FLOW

1. **understand the intent** — what the user wants changed, for which
   account, and why.
2. **research the contract** — verify the contract id, method name,
   argument shape, gas, and deposit against the contract's own ABI or
   the relevant contract skill. never guess a method.
3. **verify amounts** — use `shit-1170-rex-unit-conversion` to check
   human amounts against the token's real decimals.
4. **check the account and receiver** — `bin/check_contract.ts` and
   `bin/check_receiver.ts` verify that an account exists on chain. for
   a swap, `bin/balances.ts` says what the account actually holds, so
   the input token is one they have.
5. **show the human a plain-language summary** — contract, method,
   arguments, gas, deposit, and what it will do.
6. **queue the batch** — `bin/queue_tx.ts` or `bin/queue_swap.ts`.
7. **report the queue id, the link, and the local copy path**.
8. **wait for the signature** — `bin/watch_queue.ts --queue <id>
   --until sent` waits for the human to sign, instead of you asking
   them whether they have.
9. **report the send and check the chain** — the hash comes from the
   engine with `bin/queue_sent.ts --from-server`, and the outcome comes
   from the chain with `bin/tx_status.ts`.
10. **sync the local copy** — `bin/sync_queue.ts`.

steps 2 through 5 are not paperwork. the engine records whatever it is
given, so an agent that queues without verifying can queue a call that
moves the wrong amount to the wrong place. a wrong method or receiver
often fails cleanly; a wrong amount or a missing storage deposit often
succeeds and moves the wrong thing.

do not ask the user to sign before the batch is queued — queue first,
then explain and let them decide. if the user asks you to send, say
that the engine's flow is human-signed: queue it, report the queue id,
and let the human send it from the feed or queue page.

---

#### WHAT TO CHECK BEFORE QUEUEING

the engine does not validate the economics of a contract call. it
records the call. verifying it is the agent's job.

| check | how | what goes wrong without it |
| --- | --- | --- |
| contract exists | `check_contract.ts` | the call goes to a stranger's account |
| method exists | `check_contract.ts` | `MethodNotFound` at signing time |
| argument shape | the contract's ABI or a typed helper | a missing field fails; a wrong type may not |
| gas | the contract skill or a tested helper | the first leg runs and the second does not |
| deposit | the contract skill | `storage_deposit` fails or a token transfer is rejected |
| receiver exists | `check_receiver.ts` | tokens go nowhere |
| receiver has token storage | `storage_balance_of` | the transfer succeeds and the tokens vanish |
| amount | `shit-1170-rex-unit-conversion` | a million times too much, or dust |
| the account holds the input token | `balances.ts` | the swap is queued against money that is not there |
| intent | the human | the right call doing the wrong thing |

the last one is the one no tool can do. a technically correct call can
still be the wrong thing to do.

`check_contract.ts` calls each method with EMPTY arguments, so a
method that needs arguments fails. that failure does NOT mean the
method is missing: the bin reports `exists: true` with `reason:
"call_failed"`. only `reason: "method_not_found"` means the contract
has no such method.

use the contract skills for the specific protocol:
`shit-1170-rex-ft` for fungible tokens,
`shit-1170-rex-hello-sleet-near` for the greeting contract,
`shit-1170-rex-fastfs` for FastFS file uploads.

---

#### THE BINS

all bins live in `bin/`, are run with `bun`, print JSON on stdout, and
print JSON errors on stderr with a non-zero exit code.

the `kind` column says where the answer comes from:

- **chain VIEW** — a read straight from NEAR, through the near-kit
  tool box. no API key, no server, no account.
- **engine** — a read from or a write to the engine's server. needs an
  API key (see API KEYS).
- **local** — no network at all. it reads or writes the local files.

| bin | kind | what it does |
| --- | --- | --- |
| `keyring.ts` | engine | store, list, resolve, remove, and check API keys |
| `queue_tx.ts` | engine | queue a batch of function calls, from a file or flags |
| `queue_swap.ts` | engine | queue a swap, from a file or flags |
| `queue_list.ts` | engine | list queued batches or swaps with filters |
| `get_queue.ts` | engine | read one queue from the server or the local store |
| `sync_queue.ts` | engine | refresh local records with the server's current state |
| `queue_sent.ts` | engine | report hashes and outcomes after the human sends |
| `watch_queue.ts` | engine | watch the live feed, and refresh the local copy as it changes |
| `tx_status.ts` | chain VIEW | read a transaction's receipt from the FastNear transactions API |
| `check_contract.ts` | chain VIEW | verify an account and probe its methods on chain |
| `check_receiver.ts` | chain VIEW | verify a receiver account exists on chain |
| `balances.ts` | engine | read direct, native, and Rhea balances like the website |
| `holders.ts` | engine | read a token's holders like the website |
| `token_info.ts` | engine | read token metadata like the website |

**this skill is the engine's own surface.** the token and contract
skills have their own bins, and they are the better ones — the **FT**
skill has `ft_balance.ts`, `ft_metadata.ts`, `ft_transfer.ts`,
`wrap.ts` and `contacts.ts`; the **greeting** skill has `greeting.ts`.
use those skills for tokens and for the greeting contract. this skill
queues the work and tracks it.

the chain VIEW bins need no API key and no engine account, so they are
the right first step when the engine's key is not set up yet. they only
ever call VIEW methods. `tx_status.ts` is a chain read in that sense,
but it reads the FastNear transactions API, not the NEAR JSON-RPC.

---

#### API KEYS

one key per account, in its own file with `0600` permissions:

```sh
bun bin/keyring.ts set --account alice.near --api-key <key>
bun bin/keyring.ts list
bun bin/keyring.ts whoami --account alice.near
bun bin/keyring.ts remove --account alice.near
```

the list command never prints a key. `whoami` asks the server which
account the key belongs to — use it when a key's account is uncertain.

when more than one account is stored, every bin that queues work needs
`--account <id>`. without it the bin refuses rather than guessing. a
batch queued for the wrong account lands in the wrong feed.

one file per account rather than one file with all of them: a file for
one account can be shared, moved, or deleted without touching the
others, a rotation replaces one file, a leaked file leaks one account
rather than every account, and the list can be shown without ever
showing a key.

the key must be one the ENGINE issued — get it from the site's
`/app/skill.html` page. the local keyring supplies the signing key; the
server checks its own `api_keys` table, so a key the server never
issued answers 400 `account_not_named_by_agent`. the signing account
also comes from the API key, so the key and the account must agree.

---

#### WRITES ARE QUEUED, NEVER SENT

a write is DATA, not an action. the exact shape the engine's tx-queue
accepts:

```json
{
  "contractId": "usdt.tether-token.near",
  "method": "ft_transfer",
  "args": { "receiver_id": "bob.near", "amount": "25000000" },
  "gas": "30000000000000",
  "deposit": "1"
}
```

- `contractId` — the contract account id.
- `method` — the method name, exactly as the contract spells it.
- `args` — the contract's own argument object, not a string.
- `gas` — the gas, as a string.
- `deposit` — the attached native NEAR, as a string.

**some contracts take their arguments as raw bytes, not as an object.**
the FastFS protocol (`__fastdata_fastfs`) wants borsh bytes, and a json
object cannot be borsh bytes. such a call carries `argsBase64` — the
standard base64 of the raw bytes — *instead of* `args`:

```json
{
  "contractId": "fastfs.near",
  "method": "__fastdata_fastfs",
  "argsBase64": "AAwAAABmYXN0bmVhci5wbmc=",
  "gas": "1",
  "deposit": "0"
}
```

a transaction sets **exactly one** of `args` and `argsBase64`. both at
once is a `400` (`args_and_args_base64`); a base64 that does not decode
is a `400` (`args_base64_not_base64`); neither is an empty `args`, which
is what a call with no arguments has always been.

the browser decodes the base64 back into bytes and hands the **bytes**
to the wallet — but the wallet then carries them to its signer in its
own way, and that way differs per wallet. see THE BYTES MUST REACH THE
WALLET AS BYTES below. use `argsBase64` only when the contract's
arguments really are bytes — see the `shit-1170-rex-fastfs` skill.

#### THE BYTES MUST REACH THE WALLET AS BYTES

**a `Uint8Array` handed to `JSON.stringify` does not survive.** it
becomes a json object whose keys are the byte indexes —
`{"0":0,"1":15,…}` — and that is no longer borsh. the indexer reads
the action's args with `borsh::from_slice`, so a jsonified byte array
is not borsh, and the action is **dropped silently**: the receipt
fails the way a FastFS receipt always fails, the file never appears
at its URL, and nothing anywhere says why.

so the bytes must cross every boundary as bytes. **how** depends on
the wallet, and the wallets split in two.

| the wallet | what it does with the arguments | what the app sends |
| --- | --- | --- |
| the **browser-signer** wallets — MyNearWallet, OKX, Nightly, HOT Wallet | take them as a `Uint8Array` and borsh-serialize the whole transaction in the browser | the bytes, in the connector action shape |
| the **wallet-server** wallets — the Intear Wallet is one | hand the transaction to their own server as json and read the arguments out of that json | the **base64 string**, in the near-api-js action shape |

the **wallet-server** wallets read their arguments from json, and their
native action type holds them as `Vec<u8>` with
`#[serde_as(as = "Base64")]` — so their native path wants a base64
**string**. their fallback path takes a json value and writes it out
with `serde_json::to_vec`, and that is the one that turns the bytes
into the json text of a byte map.

**so the app asks the connected wallet which one it is** — the
connector hands back the wallet, and the wallet carries its manifest,
and the manifest carries the wallet's id — and gives it the shape it
reads.

the jsonified blob also explains itself: **the keys come out in
lexicographic order** (`0,1,10,11,…,2,20,…`), because `serde_json`'s
map is a `BTreeMap`. javascript's `JSON.stringify` orders integer-like
keys numerically, so a lexicographic order means a **Rust** side
produced it.

**how to tell, from the chain, which of the two happened:** decode
the action's `args` from base64 and look at the first bytes.

| the first bytes of the action's args | what it means |
| --- | --- |
| `00 0f 00 00 00 …` | borsh. the variant byte, then a u32 length. correct |
| `7b 22 30 22 3a …` — the text `{"0":` | json. the bytes were stringified. broken |

the second one is `JSON.stringify` of a byte array. it is longer than
the borsh it replaced, because every byte became a key, a colon and a
number.

`gas` and `deposit` are raw digit strings here: gas units and
yoctoNEAR. the web app's `shared/gas_deposit.ts` also accepts
near-kit's human forms — `"30 Tgas"`, `"0.00125 NEAR"`, `"1 yocto"` —
and converts them, so a hand-written payload may use either. raw digits
are preferred, because there is no ambiguity about what they mean.

`queue_tx.ts` takes the batch as raw json and posts it as it is. the
middleman's `queue_call_fun` builds a SINGLE call with sane defaults
(gas `30000000000000`, deposit `0`) and refuses a payload it cannot
trust: an empty `contractId` or `method`, an `args` that is not a
plain object, an `args_base64` that is not base64, a payload carrying
both kinds of args, or a `gas`/`deposit` that is not a raw digit
string. the ft skill's payload builders use it; this skill's bins do
not.

---

#### QUEUEING A BATCH OF CALLS

a queue is a batch of one to fifty calls, in order, signed together.

```sh
bun bin/queue_tx.ts --file request.json
```

`request.json`:

```json
{
  "what": "Register storage on the token so the USDC can arrive",
  "when": "Before the USDC transfer",
  "why": "The receiving account has no NEP-145 storage on this token",
  "transactions": [
    {
      "contractId": "usdt.tether-token.near",
      "method": "storage_deposit",
      "args": {},
      "gas": "30000000000000",
      "deposit": "1250000000000000000000"
    }
  ],
  "accounts": ["alice.near"]
}
```

or from flags:

```sh
bun bin/queue_tx.ts \
  --transactions '[{"contractId":"hello.sleet.near","method":"set_greeting","args":{"greeting":"Hello"},"gas":"3000000000000","deposit":"0"}]' \
  --what "Set the greeting" --accounts alice.near
```

the `accounts` list says whose feed receives the batch. every account in
it must be an account the ENGINE has issued an API key for.

`--accounts` may be omitted. the list then defaults to the signing
account — the account the stored API key belongs to. an empty list
would write zero account rows server-side, so the batch would land in
nobody's feed.

`deposit` is the amount of native NEAR attached. a `storage_deposit`
often needs a real deposit, not `0`.

`--when-at <epoch_millis>` sets the queue's earliest execution time. it
is a number — a typo is refused rather than silently queued with no
time. the same flag works on `queue_swap.ts`.

---

#### QUEUEING A SWAP

a queued swap is not a route. it names the token sold, the raw amount
sold, and the token bought. the route is worked out when a human
executes it.

```sh
bun bin/queue_swap.ts \
  --token-in wrap.near \
  --amount-in 1500000000000000000000000 \
  --token-out usdt.tether-token.near \
  --what "Buy 1.5 USDC with wNEAR" \
  --accounts alice.near
```

`amountIn` is the token's smallest unit. use the unit-conversion skill
when the human gave a decimal amount. a file works too:
`bun bin/queue_swap.ts --file swap.json`.

the payload shape:

```json
{
  "tokenIn": "wrap.near",
  "amountIn": "1500000000000000000000000",
  "tokenOut": "usdt.tether-token.near",
  "amountOut": "1250000",
  "dexId": "rhea",
  "what": "Buy USDC with wNEAR",
  "when": "Now",
  "why": "The user asked for it",
  "whenAt": 1767225600000,
  "accounts": ["alice.near"]
}
```

`amountOut` and `dexId` are optional — a swap may be queued without a
quote, and the live quote is worked out when it is shown. `dexId`
records where a stored quote came from.

the token ids are the intear registry's ids — every token is its bare
contract id, except native NEAR, which is `near`.

`--when-at <epoch_millis>` sets the swap's earliest execution time, the
same as on `queue_tx.ts`.

---

#### NATIVE NEAR OR wNEAR — WHICH ONE IS THE INPUT

**read the account's balances first, and let the balance pick the
input token.** the human's money is either native NEAR or wNEAR, and
only one of them is what they actually hold. a swap whose input token
they do not have is a swap that cannot execute.

```sh
bun bin/balances.ts --account alice.near --sources direct,native
```

| the account holds | the swap's `tokenIn` is |
| --- | --- |
| native NEAR and no wNEAR | `near` |
| wNEAR | `wrap.near` |
| both | ask, or take the side the human named |
| neither | the swap cannot be funded — say so before queueing |

**`near` is native NEAR, not `wrap.near`.** the chain's own token has
the id `near` and 24 decimals. wNEAR is the NEP-141 contract
`wrap.near`, and it has 24 decimals too, so the decimals do not tell
you which one you are looking at — the id does.

the router takes both. it knows `near` as the chain's own NEAR and
`wrap.near` as the wrapped contract, and it routes between them. so
quoting a swap out of native NEAR does not need a wrap step first.

**when the human holds no wNEAR, quote out of native NEAR.** do not
add a wrap-then-swap step to make the trade work. the router already
handles native NEAR as the input side, and a wrapped hop costs gas,
costs a second route, and needs storage on `wrap.near` before the
tokens can land.

**never assume wNEAR because a token is called "NEAR".** a swap that
sells `wrap.near` out of an account with no wNEAR balance is queued
against money that is not there.

if the human asked to spend native NEAR and the account also holds
wNEAR, queue the native side. it is the coin they named, and it is the
side that needs no wrap step.

**the amount for `near` is in yoctoNEAR — 24 decimals.** 1 NEAR is
`1000000000000000000000000`. use the unit-conversion skill to check it
the same way you check any other token's amount.

---

#### REPORTING THE QUEUE ID AND THE SIGNING LINK

**every queued item gets an id and a link. always give both.** the id
is what the human quotes back to you; the link is what they click to
sign it. an id without a link makes the human go hunting through the
feed for a proposal they cannot recognise by id alone.

| what was queued | id field | the link to give them |
| --- | --- | --- |
| a batch of calls (`queue_tx.ts`) | `queueId` | <https://shit-1170.com/app/queue.html?queue=<queue_id>> |
| a swap (`queue_swap.ts`) | `swapId` | <https://shit-1170.com/app/swap.html?in=<token_in>&out=<token_out>&amount_in=<unit_amount>&swap=<swap_id>> |

a swap's link carries the whole trade, so the human lands on the swap
already set up and their execution is credited back to the queued
proposal. the four parameters:

| parameter | what it is |
| --- | --- |
| `in` | the token sold — `near` for native NEAR, the bare contract id for every other token |
| `out` | the token bought |
| `amount_in` | the raw unit amount sold |
| `swap` | the queued swap's id |

**`swap=` is the one that matters.** the swap page's SWAP NOW button
records its result against the queued swap named by `swap=`. without
that parameter the human's execution is not credited to the proposal
you queued, and the queue keeps saying it is waiting. always include
it when the swap came from `queue_swap.ts`.

the other three pre-fill the form, so the human does not retype the
trade. `amount_in` is the raw unit amount, not the human one — 1.5
USDC is `1500000`, and 1.5 NEAR is `1500000000000000000000000`.

the bins print the id themselves — `queueId` for a batch, `swapId` for
a swap — so read it from their stdout. do not make it up, and do not
paraphrase it.

say it like this:

> queued as `abc-123` — sign it at
> <https://shit-1170.com/app/queue.html?queue=abc-123>

**the queue id is not a receipt.** it means "the engine is holding this
for you to sign", not "this happened".

---

#### READING QUEUES

the server's queue lists are open — no API key is needed to read them.

```sh
bun bin/queue_list.ts tx --account-id alice.near --limit 20
bun bin/queue_list.ts swap --contract-id wrap.near --limit 20
bun bin/get_queue.ts tx --id <queue_id>
bun bin/get_queue.ts local --kind tx --id <queue_id>
```

`--hide-sent` drops the entries that have already been sent from the
list. it needs an account — pass `--account-id` so the server knows
whose feed to hide the sent items from.

the `nextCursor` is opaque. hand it back exactly as the server gave it.

---

#### AFTER THE HUMAN SENDS

the whole sequence, in order:

1. the human signs in the web app. their wallet tells the engine, and
   the engine writes the hash on the account row.
2. `watch_queue.ts --queue <id> --until sent` — the agent waits
   instead of asking.
3. `queue_sent.ts tx --queue <id> --from-server` — the hash comes from
   the engine. the human never supplies one.
4. `tx_status.ts --tx-hash <hash>` — the receipt on chain, which is
   the real outcome.
5. `sync_queue.ts one tx <id>` — the local copy matches the server.

steps 3 and 4 answer two different questions. step 3 asks the engine
what it recorded. step 4 asks the chain what happened.

**the human does not have to hand you the hash. the engine already has
it.**

the hash is already there, and you read it back out of the queue you
queued:

```sh
bun bin/get_queue.ts tx --id <queue_id>
```

the answer carries `accounts[].txHash` and `accounts[].status` on every
account of the batch. `pending` means nobody has sent it. `sent` means
it went out and nobody knows how it went yet. `succeeded` and `failed`
are the outcomes.

so the send is reported back from the engine's own record:

```sh
bun bin/queue_sent.ts tx --queue <queue_id> --from-server
bun bin/queue_sent.ts swap --swap <swap_id>
```

`--from-server` reads the hashes off the queue's account rows. a swap
without `--tx-hash` does the same thing. **there is no step where a
human pastes a hash into a file.** a hash the engine does not have yet
means the batch has not been sent, or the send was not reported to the
engine — the bin says so rather than guessing.

`--hashes <file>` still exists for a case the engine cannot cover: a
hash you read off the chain yourself, for a send the engine never
heard about. use one of `--hashes` or `--from-server`, never both.

then read the receipt on chain, because a recorded send is not proof:

```sh
bun bin/tx_status.ts --tx-hash <hash> --signer alice.near
```

and refresh the local copy:

```sh
bun bin/sync_queue.ts one tx <queue_id>
```

`tx_status.ts` reads the receipt. it posts the hash to the FastNear
transactions API — `https://tx.main.fastnear.com` for mainnet and
`https://tx.test.fastnear.com` for testnet — and prints the
transaction's outcome on stdout. it needs no API key.

`--signer <account_id>` is optional but recommended: the API wants the
sender account id for some endpoints, and without it the server answers
400.

it prints one json object:

```json
{
  "ok": true,
  "txHash": "<the hash you passed>",
  "status": "succeeded",
  "transaction": { "transaction": {}, "execution_outcome": {}, "receipts": [] }
}
```

`status` is `succeeded` or `failed`. `failed` covers a failed receipt
too, not only a failed transaction — a swap can succeed in its first
leg and fail in its second. the whole api answer is under
`transaction`, so read the logs out of it when the status is `failed`.

a hash the api does not know is an error, not a silent success: the
bin prints `{"ok": false, "error": "..."}` on stderr and exits 1.

**the engine's status and the chain's status are two different
things.** the engine says `succeeded` when it was told the receipt
worked. `tx_status.ts` reads the receipt itself. when they disagree,
the chain is right — the engine is a record of what it was told.

`hashes.json` is an array, for the `--hashes` case:

```json
[
  { "txId": "<transaction id from the queue>", "txHash": "<hash>", "status": "succeeded" }
]
```

`status` may be omitted, which records `sent`: it went out and nobody
knows how it went yet. when present it must be `succeeded` or `failed`
— `sent` is not a value a client may send, and the server answers 400
`bad_status` for it.

for a swap, with the hash from the engine and the outcome from the
chain:

```sh
bun bin/queue_sent.ts swap --swap <swap_id> --status succeeded --amount-out <unit>
```

---

#### WATCHING THE LIVE FEED

the engine's feed is a websocket. the server pushes every new queued
batch and every new queued swap to every connected client, and
`watch_queue.ts` listens to it.

```sh
# wait for one queue to be sent
bun bin/watch_queue.ts --queue <queue_id> --for 120 --until sent

# watch what this account's work looks like
bun bin/watch_queue.ts --account-id alice.near --for 60

# watch the engine's activity generally — no filter matches everything
bun bin/watch_queue.ts --for 30
```

the watch is **bounded**, because every other bin runs once and exits
and an agent cannot wait forever for a human. `--for <seconds>` sets
the deadline, and `--until` ends it early when the work reaches that
state: `any` (the default — the agent only wants to know something
happened), `sent`, `succeeded`, or `failed`.

the filters are the list route's filters, with the same names and the
same meaning: `--account-id`, `--contract-id`, `--method`,
`--token-in`, `--token-out`, and `--hide-sent`. the socket itself is
filter-agnostic — the server carries everything and the client decides
what matches — so one filter vocabulary covers both reading and
watching.

**the socket is the trigger; the server is the truth.** the socket
says THAT something changed. the engine's routes say WHAT it is — the
status, the hash, the whole item. so the watch refreshes the local
record on every event, and the local copy is current when the bin
exits.

it prints one json object per line as the events arrive, then a summary
object:

```json
{"ok":true,"event":"queue","id":"<id>","statuses":["pending"],"new":true,"localChanged":true}
```

the summary carries `watched` (the seconds), `until`, `connected`,
`reached`, and the `events` array.

**the log on stderr says what the json cannot.** stdout carries the
events; stderr carries the state of the watch:

| the log says | what it means |
| --- | --- |
| `watching <url> for <n>s, until <until>` | the watch started, and what it wants |
| `filter: ...` | the filter in effect. `filter: none` means every new post matches |
| `own account: <id>` | the account `hide_sent` is judged against |
| `connected to <url> (attempt 1, waited 0ms)` | **the socket is up.** this is the line that says the watch is actually watching |
| `new queue <id> [pending]` | a post arrived and matched |
| `skipped queue <id> — contract_id: ... is not ...` | a post arrived and the filter turned it away, and this says which filter did it |
| `socket: the socket closed (1006)` | the connection dropped. the middleman reconnects on its own |
| `reached <until> — the watch ends` | the condition was met |
| `the watch ended after <n>s and the socket was NOT connected` | **the watch was blind.** nothing could have arrived |

`connected` in the summary is the same thing in json form. it is `false`
when the socket never came up, and that is the difference between a
quiet engine and a broken watch.

**a socket connects before it subscribes.** a subscriber only sees
what is published AFTER it subscribes, so a queue that was queued in
the moment before the watch opened is not in the watch. give the socket
a moment to open before you expect the event — the `connected` line is
where you see that it has — or read the queue's own record, which has
the state either way.

**a watch is for waiting, not for polling.** `watch_queue.ts` and
`sync_queue.ts` overlap on purpose: the watch tells you WHEN to
refresh, and it does the refresh. use `sync_queue.ts` when you want to
check an old queue without waiting for anything.

---

#### THE LOCAL COPY

every queued item is written under:

```text
${HOME}/.shit-1170-rex-engine/
├── accounts/
│   └── <account_id>.json    # one private api key file per account
├── contacts.json            # the ft skill's contact list
└── queue/
    ├── index.json           # the list of every local record
    ├── tx/<queue_id>.json   # one local copy per queued batch
    └── swap/<swap_id>.json  # one local copy per queued swap
```

set `SHIT_1170_REX_HOME` to use a different directory.

the local copy survives a database outage. it holds the request as the
agent wrote it and the response as the server returned it, so it is a
record of what was proposed, what was queued, and what happened next.

`sync_queue.ts all` walks the local records, fetches the current server
state, and updates the records that changed. use it after the user says
they sent something, or when checking on an old queue.

the local records are also how an agent learns. a queue that failed
again and again has a method shape or a gas value that is wrong. the
records make that visible without a database.

---

#### THE WEBSITE'S DATA

the engine's pages read the Intear API and the contracts directly. use
the bins to get the same answers an agent or a human sees.

```sh
bun bin/balances.ts --account alice.near --sources direct,native
bun bin/holders.ts --token shit-1170.meme-cooking.near --limit 100
bun bin/token_info.ts --ids wrap.near,usdt.tether-token.near
```

`balances.ts` reads direct token balances, native NEAR, and the Rhea AMM
deposits (`--sources rhea`). it does NOT read the Rhea DCL or INTEAR
internal balances — those need the contract-specific skills.

it is the read that picks a swap's input token. `--sources direct,native`
tells you whether the account holds native NEAR, wNEAR, or both.

`holders.ts` is the indexed holder list, paged with the cursor the
server gives.

`token_info.ts` reads name, symbol, decimals, icon, price, reputation,
holder count, liquidity, market cap, and total supply.

---

#### EXPLAINING WHAT YOU QUEUED

after queueing, tell the human, in plain language:

- what the batch does, in one sentence
- every call: contract, method, and the arguments that matter
- the gas and attached deposit for each call
- what the account must approve or own for it to succeed
- the queue id and the link to sign it
- the local copy path
- that it is waiting for their signature, and that they can send it later

keep it readable. the person reading it may be deciding whether to
approve a transaction that moves their money, and raw JSON alone does
not tell them whether it is reasonable.

the queue id and the link go together. the id is what the human quotes
back to you; the link is where they sign it.

do not describe a queued batch as sent, submitted, or executed.

---

#### MORE

- [ENGINE.md](./DOCS/ENGINE.md) — the routes, the data model, and the pages
- the library's [TOOLS.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/DOCS/TOOLS.md)
  — where the facts come from

=====================
<br/>
copyright 2026 by sleet.near
