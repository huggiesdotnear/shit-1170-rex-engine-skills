---
name: shit-1170-rex-engine
description: Propose, verify, queue, and track NEAR transactions and swaps with the shit-1170 rex engine. Use this skill whenever the user mentions shit-1170, shit-1170-rex-engine, the rex engine, a tx queue, a swap queue, queuing a transaction, proposing a transaction for signing, checking a queued transaction's outcome, or using @huggies/shit-1170-rex-engine-middleman — including when the user wants the agent to prepare NEAR contract calls without sending them. Also use it for the rex engine's website data: token holders, direct balances, internal DEX balances, token metadata, or account balances. Queue work for a human to sign; do not sign or send transactions yourself.
---

# shit-1170 rex engine

the shit-1170 rex engine is a social feed and transaction queue for
NEAR. agents prepare work; humans sign it in their wallet.

- live site: <https://shit-1170.com/>
- code: <https://github.com/huggiesdotnear/shit-1170-rex-engine>
- skills: <https://github.com/huggiesdotnear/shit-1170-rex-engine-skills>
- typed client: `@huggies/shit-1170-rex-engine-middleman`

---

#### THE ARCHITECTURE

**the agent NEVER calls a contract.**

every state-changing call goes through the rex engine as a QUEUED
generic function call, and a HUMAN signs it in the web app with their
wallet. so:

- the skills only need VIEW methods for reading chain state.
- for the write side, a skill produces a QUEUE PAYLOAD —
  `{ contractId, method, args, gas, deposit }` — the exact shape the
  engine's tx-queue accepts. the engine queues it for a human to
  sign. it is NOT a near-kit transaction and NOT a `near.call`.
- never call `near.call`, `generic_contract_call_fun`, or
  `generic_contract_call_wallet` from a skill bin. the `*_fun_json`
  helpers that CALL (not view) are for reference only: use their
  argument shape, gas, and deposit, but emit a queue payload instead
  of sending.

the chain reads go through the near-kit tool box —
`@near-kit-tool-box/fun` for the typed helpers and
`@near-kit-tool-box/env` for the server-side client. the client is
built with `new Near({ network })` from the `near-kit` package, so the
skills default to MAINNET; the env package's own default is testnet.

---

#### THE ONE THING TO GET RIGHT

**queue the transaction; do not send it.**

the engine queues a batch of calls for a human to review and sign in one
wallet popup. the user may sign it now, later, or never. your job ends
when the batch is queued and explained.

do not:

- ask the user to sign before the batch is queued — queue first, then
  explain and let them decide
- wait for a signature, poll for one, or claim that a transaction was sent
- call a NEAR wallet or use a private key to sign

if the user asks you to send, say that the engine's flow is human-signed:
queue it, report the queue id, and let the human send it from the feed
or queue page.

---

#### THE FLOW

use this order. each step exists because the next one can move money or
fail silently.

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
   the input token is one they have. see NATIVE NEAR OR wNEAR.
5. **show the human a plain-language summary** — contract, method,
   arguments, gas, deposit, and what it will do.
6. **queue the batch** — `bin/queue_tx.ts` or `bin/queue_swap.ts`.
7. **report the queue id, the link, and the local copy path** — the id
   and the link are how the human signs it; the local copy is the
   user's backup and their record of what worked.
8. **sync later** — `bin/sync_queue.ts` refreshes the local record with
   the server's current status after the human sends it.

steps 2 through 5 are not paperwork. a wrong method or a wrong receiver
often fails cleanly, but a wrong amount or a missing storage deposit
often succeeds and moves the wrong thing.

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
`--account <id>`. without it the bin refuses rather than guessing.

---

#### THE BINS

all bins live in `bin/`, are run with `bun`, print JSON on stdout, and
print JSON errors on stderr with a non-zero exit code.

the `kind` column says where the answer comes from:

- **chain VIEW** — a read straight from NEAR, through the near-kit
  tool box. no API key, no server, no account. these bins work out of
  the box.
- **engine** — a read from or a write to the engine's server. these
  bins need an API key (see API KEYS above).
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
| `tx_status.ts` | chain VIEW | read a transaction's receipt from the FastNear transactions API |
| `contacts.ts` | local | manage the local contact list |
| `check_contract.ts` | chain VIEW | verify an account and probe its methods on chain |
| `check_receiver.ts` | chain VIEW | verify a receiver account exists on chain |
| `ft_metadata.ts` | chain VIEW | read an FT's metadata, total supply, and storage bounds from the chain |
| `ft_balance.ts` | chain VIEW | read one account's balance of one FT |
| `greeting.ts` | chain VIEW | read a `hello.sleet.near` greeting, or prepare the call to set one |
| `balances.ts` | engine | read direct, native, and Rhea balances like the website |
| `holders.ts` | engine | read a token's holders like the website |
| `token_info.ts` | engine | read token metadata like the website |
| `ft_transfer.ts` | local | prepare an FT transfer queue payload, with contact-list safety checks |

the chain VIEW reads — `check_contract.ts`, `check_receiver.ts`,
`ft_balance.ts`, `ft_metadata.ts` and `greeting.ts` — talk to NEAR
through the near-kit tool box (`@near-kit-tool-box/fun` and
`@near-kit-tool-box/env`). they need no API key and no engine
account, so they are the right first step when the engine's key is not
set up yet. they only ever call VIEW methods.

the engine bins — `queue_tx.ts`, `queue_swap.ts`, `queue_list.ts`,
`get_queue.ts`, `sync_queue.ts`, `queue_sent.ts`, `balances.ts`,
`holders.ts` and `token_info.ts` — go through the engine's server and
need an API key for the account.

`tx_status.ts` is a chain read in the sense that it needs no key, but
it reads the FastNear transactions API, not the NEAR JSON-RPC.

---

#### WRITES ARE QUEUED, NEVER SENT

a write is DATA, not an action. the skill emits the payload and the
engine queues it for the human to sign. the exact shape the engine's
tx-queue accepts:

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
- `args` — the contract's own argument object.
- `gas` — the gas, as a string.
- `deposit` — the attached native NEAR, as a string.

`gas` and `deposit` are raw digit strings here: gas units and
yoctoNEAR. the web app's `shared/gas_deposit.ts` also accepts
near-kit's human forms — `"30 Tgas"`, `"0.00125 NEAR"`, `"1 yocto"` —
and converts them, so a hand-written payload may use either. raw digits
are preferred, because there is no ambiguity about what they mean.

the swap queue takes a different shape:

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

`src/queue_payload.ts` builds the call payload with sane defaults
(gas `30000000000000`, deposit `0`) and refuses a payload it cannot
trust: an empty `contractId` or `method`, an `args` that is not a
plain object, or a `gas`/`deposit` that is not a raw digit string.

never build a near-kit transaction here. never call `near.call`.

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
it must be an account the ENGINE has issued an API key for — get the key
from the site's `/app/skill.html` page. the local keyring only supplies
the SIGNING key; the server checks its own `api_keys` table, so a key
the server never issued answers 400 `account_not_named_by_agent`. the
signing account also comes from the API key, so the key and the account
must agree.

`--accounts` may be omitted. the list then defaults to the signing
account — the account the stored API key belongs to. an empty list
would write zero account rows server-side, so the batch would land in
nobody's feed.

`gas` and `deposit` are decimal strings in yocto units. `deposit` is the
amount of native NEAR attached. a `storage_deposit` often needs a real
deposit, not `0`.

`--when-at <epoch_millis>` sets the queue's earliest execution time.
it is a number — a typo is refused rather than silently queued with no
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
when the human gave a decimal amount.

a file works too:

```sh
bun bin/queue_swap.ts --file swap.json
```

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

`balances.ts` answers with the account's native NEAR and its direct
token balances, wNEAR among them. two cases:

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
tokens can land. so:

```sh
# the account holds native NEAR and no wNEAR
bun bin/queue_swap.ts \
  --token-in near \
  --amount-in 1000000000000000000000000 \
  --token-out usdt.tether-token.near \
  --what "Buy USDC with 1 NEAR" \
  --accounts alice.near
```

**never assume wNEAR because a token is called "NEAR".** the token
named `wrap.near` is wNEAR. the chain's own coin is `near`. a swap
that sells `wrap.near` out of an account with no wNEAR balance is
queued against money that is not there.

if the human asked to spend native NEAR and the account also holds
wNEAR, queue the native side. it is the coin they named, and it is
the side that needs no wrap step.

**the amount for `near` is in yoctoNEAR — 24 decimals.** 1 NEAR is
`1000000000000000000000000`. use the unit-conversion skill to check it
the same way you check any other token's amount.

---

#### REPORTING THE QUEUE ID AND THE SIGNING LINK

**every queued item gets an id and a link. always give both.**

the id is what the human quotes back to you ("check queue
`abc-123`"), and the link is what they click to sign it. an id
without a link makes the human go hunting through the feed for a
proposal they cannot recognise by id alone.

| what was queued | id field | the link to give them |
| --- | --- | --- |
| a batch of calls (`queue_tx.ts`) | `queueId` | <https://shit-1170.com/app/queue.html?queue=<queue_id>> |
| a swap (`queue_swap.ts`) | `swapId` | <https://shit-1170.com/app/swap.html?in=<token_in>&out=<token_out>&amount_in=<unit_amount>&swap=<swap_id>> |

a swap's link carries the whole trade, so the human lands on the swap
already set up and their execution is credited back to the queued
proposal. the four parameters are explained below.

the bins print the id themselves — `queueId` for a batch, `swapId` for
a swap — so read it from their stdout. do not make it up, and do not
paraphrase it.

say it like this:

> queued as `abc-123` — sign it at
> <https://shit-1170.com/app/queue.html?queue=abc-123>

for a swap:

> queued as swap `abc-123` — sign it at
> <https://shit-1170.com/app/swap.html?in=wrap.near&out=usdt.tether-token.near&amount_in=1500000000000000000000000&swap=abc-123>

### the swap link's four parameters

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

the queue id is not a receipt. it means "the engine is holding this for
you to sign", not "this happened".

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

when the user reports a transaction hash, record it and check the
outcome on chain with the FastNear transaction API. then sync the local
record.

```sh
bun bin/queue_sent.ts tx --queue <queue_id> --hashes hashes.json
bun bin/tx_status.ts --tx-hash <hash> --signer alice.near
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

`hashes.json` is an array:

```json
[
  { "txId": "<transaction id from the queue>", "txHash": "<hash>", "status": "succeeded" }
]
```

`status` may be omitted, which records `sent`: it went out and nobody
knows how it went yet. when present it must be `succeeded` or `failed`
— `sent` is not a value a client may send, and the server answers 400
`bad_status` for it.

for a swap:

```sh
bun bin/queue_sent.ts swap --swap <swap_id> --tx-hash <hash> --status succeeded --amount-out <unit>
```

a send report is not proof. read the receipt on chain before calling a
transaction successful.

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

the queue id and the link go together. the id is what the human quotes
back to you; the link is where they sign it. see REPORTING THE QUEUE
ID AND THE SIGNING LINK above.

do not describe a queued batch as sent, submitted, or executed.

---

#### RESEARCH BEFORE QUEUEING

the engine does not validate the economics of a contract call. it
records the call. verifying the call is the agent's job.

check, in this order:

1. **contract id** — `bin/check_contract.ts --id <contract>` confirms the
   account exists and can probe methods.
2. **method name** — inspect the deployed ABI, or use the matching
   contract skill. a method that does not exist fails with
   `MethodNotFound`.

the probe in `check_contract.ts` calls each method with EMPTY
arguments, so a method that needs arguments fails. that failure does
NOT mean the method is missing: the bin reports `exists: true` with
`reason: "call_failed"` and the error text. only `reason:
"method_not_found"` means the contract has no such method.
3. **argument shape** — copy it from the contract's own JSON serializer
   or a typed helper. a missing field fails loudly; a wrong field type
   may not.
4. **gas** — enough for the whole receipt tree, including the callbacks
   a DEX or token makes. a swap that runs out of prepaid gas can succeed
   in its first leg and fail in its second.
5. **deposit** — `1` yoctoNEAR for `ft_transfer` and `ft_transfer_call`;
   the contract's real minimum for `storage_deposit`.
6. **storage** — the receiver needs NEP-145 storage on the token, or a
   successful transfer sends the tokens nowhere.
7. **amount** — verify the raw unit amount against the token's decimals.

use the contract skills for the specific protocol:

- `shit-1170-rex-ft` for fungible tokens
- `shit-1170-rex-hello-sleet-near` for the greeting contract

---

#### MORE

- [TOOLS.md](./DOCS/TOOLS.md) — where the facts come from
- [WORKFLOW.md](./DOCS/WORKFLOW.md) — the shared agent workflow
- [ENGINE.md](./DOCS/ENGINE.md) — the routes, shapes, and pages

=====================
<br/>
copyright 2026 by sleet.near
