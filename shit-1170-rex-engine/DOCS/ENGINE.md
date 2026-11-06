# ENGINE

the rex engine's data model, routes, and pages.

this is the reference the agent reads when it needs to know what the
engine stores and what the website shows.

the typed client is `@huggies/shit-1170-rex-engine-middleman`. it
exposes one function per route and one type per request and response
shape, and the bins call it — so the shapes they send are the shapes
the server accepts.

---

#### THE ROUTES

| route | what it does |
| --- | --- |
| `GET /api/shit-1170/ping` | liveness |
| `POST /api/shit-1170/api-keys` | exchange signed messages for API keys |
| `GET /api/shit-1170/api-key/me` | which account a key belongs to |
| `POST /api/shit-1170/api-key/rotate` | issue a new key for an account |
| `GET /api/shit-1170/tx-queue` | the filterable list of queued batches |
| `POST /api/shit-1170/tx-queue` | queue a batch of function calls |
| `GET /api/shit-1170/tx-queue/{queue_id}` | one queued batch |
| `POST /api/shit-1170/tx-queue/{queue_id}/accounts` | add your own account |
| `DELETE /api/shit-1170/tx-queue/{queue_id}/accounts/{account_id}` | remove your own account |
| `POST /api/shit-1170/tx-queue/{queue_id}/sent` | report sent hashes and outcomes |
| `GET /api/shit-1170/tx-queue/facets` | contracts and accounts with queued work |
| `GET /api/shit-1170/tx-queue/stats/contracts` | queued call counts per contract |
| `GET /api/shit-1170/tx-queue/stats/methods` | queued call counts per method |
| `GET /api/shit-1170/feed/ws` | the LIVE feed, a websocket upgrade |
| `GET /api/shit-1170/swap-queue` | the filterable list of queued swaps |
| `POST /api/shit-1170/swap-queue` | queue a swap |
| `GET /api/shit-1170/swap-queue/{swap_id}` | one queued swap |
| `POST /api/shit-1170/swap-queue/{swap_id}/accounts` | add your own account |
| `DELETE /api/shit-1170/swap-queue/{swap_id}/accounts/{account_id}` | remove your own account |
| `POST /api/shit-1170/swap-queue/{swap_id}/sent` | report the send |
| `GET /api/trezu/user/treasuries` | the Sputnik DAOs an account belongs to |

the API key travels in the `x-api-key` header. `x-session-token` is
the legacy name and is still accepted.

---

#### WHERE THE HASH LIVES

the hash of a send is on the **ACCOUNT row**, not on the queue and not
on the transaction:

```text
a QUEUE            queueId / what / when / why / whenAt / createdAt / updatedAt
  └── TRANSACTION  txId / position / contractId / method / args / gas / deposit
        └── ACCOUNT  accountId / status / txHash
```

when the human signs, their wallet reports the send to the engine, and
the engine writes the hash there. so the agent reads the hash back out
of the queue it queued — `GET /api/shit-1170/tx-queue/{queue_id}`
answers with `accounts[].txHash` and `accounts[].status` on every
account of the batch.

this is why the human never has to hand the agent a hash. the engine
already knows it.

**a batch can hold several transactions, and each can have its own
hash.** the `txId` on the hash request says which transaction of the
batch the hash belongs to, and the server refuses a `txId` that
belongs to another queue.

---

#### THE LIVE FEED

`GET /api/shit-1170/feed/ws` is a websocket upgrade. the server pushes
one json text message per event:

```json
{ "type": "queue", "queue": { ...TX_QUEUE_ITEM... } }
{ "type": "swap",  "swap":  { ...SWAP_QUEUE_ITEM... } }
```

the payload is the EXACT item the list route answers with, so a live
event drops straight into the list the api fills.

it is pushed on six routes:

| what happened | route |
| --- | --- |
| a batch was queued | `POST /api/shit-1170/tx-queue` |
| a swap was queued | `POST /api/shit-1170/swap-queue` |
| an account joined a batch | `POST /api/shit-1170/tx-queue/{queue_id}/accounts` |
| an account joined a swap | `POST /api/shit-1170/swap-queue/{swap_id}/accounts` |
| a batch was sent | `POST /api/shit-1170/tx-queue/{queue_id}/sent` |
| a swap was sent | `POST /api/shit-1170/swap-queue/{swap_id}/sent` |

the sent events carry the updated `accounts[].status` and
`accounts[].txHash`, so a watcher learns the hash from the same push
that told it the status changed.

the socket is OPEN — no API key — and it is FILTER-AGNOSTIC: the
server carries everything and the client decides what matches.

> #### THE SOCKET IS THE TRIGGER, NOT THE TRUTH
>
> the socket says THAT something changed. the engine's routes say WHAT
> it is. a watcher reads the item from the server, so the hash comes
> from the server's account rows and not from the socket's copy of
> them.

> #### A SUBSCRIBER SEES ONLY WHAT COMES AFTER IT SUBSCRIBES
>
> a batch queued in the moment before the socket opened is not on the
> socket. the queue's own record still has it.

the typed client is `api_shit_1170_feed_ws(base_url, on_event,
on_error)` in the middleman package. it reconnects on its own with a
backoff, and the handle's `close()` stops the reconnects.

---

#### TWO KINDS OF QUEUE

the engine has two different queues. they are not two views of one
thing.

| | tx queue | swap queue |
| --- | --- | --- |
| what it holds | a batch of function calls | one trade intent |
| what the agent knows | every call: contract, method, args, gas, deposit | token in, amount in, token out |
| what the human signs | the calls, in order, in one popup | the route, worked out at execution time |
| id | `queueId` | `swapId` |
| local record | `queue/tx/<queue_id>.json` | `queue/swap/<swap_id>.json` |

a swap queue is not a batch. the agent does not know the route when it
queues, and that is the point: the route is chosen against live pools
when somebody executes it.

---

#### THE TX QUEUE MODEL

three levels:

```text
a QUEUE            queueId / what / when / why / whenAt / createdAt / updatedAt
  └── TRANSACTION  txId / position / contractId / method / args / gas / deposit
        └── ACCOUNT  accountId / status / txHash
```

`args` is a JSON object, not a string. the wallet takes an object, so a
string would have to be parsed and re-serialized on the way.

`gas` and `deposit` are decimal strings in yocto units, or null.

the status lives on the **account row**, never on the queue or the
transaction:

| status | meaning |
| --- | --- |
| `pending` | queued, not sent by this account |
| `sent` | went out, outcome unknown |
| `succeeded` | the receipt succeeded |
| `failed` | the receipt failed |

a queue has no global status because it is never "done": any account on
it may still send it, and two accounts sending the same batch produce
two different transactions with two different outcomes.

---

#### THE SWAP QUEUE MODEL

```text
a SWAP   swapId / tokenIn / amountIn / tokenOut / amountOut / dexId
  └── ACCOUNT   accountId / status / txHash / amountOut
```

`amountIn` and `amountOut` are raw smallest-unit amounts. a human
amount only means something next to its token.

`amountOut` is optional. a swap may be queued without a quote; the live
quote is worked out when it is shown.

`dexId` is optional. it records where a stored quote came from.

**the token ids are the intear registry's ids.** every token is its
bare contract id, except native NEAR, which is `near`. wNEAR is
`wrap.near` — the wrapped NEP-141 contract, not the chain's own coin.
the router accepts both `near` and `nep141:<contract>`, and the site
prefixes bare ids with `nep141:` on the way to it, leaving `near`
alone.

so a swap out of native NEAR is `tokenIn: "near"` with a yoctoNEAR
amount (24 decimals), and a swap out of wNEAR is `tokenIn:
"wrap.near"`. both are valid queue requests; the account has to hold
the one being sold.

---

#### QUERY FILTERS

the list routes are open — no API key to read them.

**tx queue**

| query | meaning |
| --- | --- |
| `account_id` | comma-separated account ids, OR |
| `contract_id` | comma-separated contract ids, OR |
| `method` | one method name |
| `hide_sent` | drop what the account has sent; needs `account_id` |
| `limit` | page size |
| `cursor` | the previous page's `nextCursor`, unchanged |

**swap queue**

| query | meaning |
| --- | --- |
| `account_id` | comma-separated account ids, OR |
| `contract_id` | comma-separated token contract ids; matches either side |
| `token_in` | swaps that sell this token |
| `token_out` | swaps that buy this token |
| `hide_sent` | drop what the account has sent; needs `account_id` |
| `limit` | page size |
| `cursor` | the previous page's `nextCursor`, unchanged |

the cursor is opaque. hand it back exactly as the server gave it.

---

#### THE PAGES

| page | what it shows | url |
| --- | --- | --- |
| feed | queued batches and swaps, with filters | `/app/index.html` |
| queue | one batch: summary, transfers, calls, accounts, actions | `/app/queue.html?queue=<id>` |
| swap | one swap, its route, its outcome | `/app/swap.html?swap=<id>` |
| account | balances and transaction history | `/app/account.html?id=<account>` |
| transaction | actions, transfers, receipts, outcome | `/app/tx.html?tx=<hash>` |
| token | metadata and indexed holders | `/app/token/index.html?id=<token>` |
| $SHIT token | metadata, holder groups, holder shares | `/app/token/shit-1170.html` |
| discover | searchable token list | `/app/discover.html` |
| Rhea | pools, TVL, volume, APY | `/app/contract/rhea.html` |
| INTEAR DEX | pools, TVL, volume, APY | `/app/contract/intear-dex.html` |
| Sputnik DAO | config, policy, roles, proposals, balances | `/app/contract/sputnik-dao.html?dao_id=<dao>` |
| skill | API keys and install instructions | `/app/skill.html` |

the queue page and the swap page are the SIGNING pages. the queue id
and the swap id are what make them point at one proposal:

- a queued batch → `https://shit-1170.com/app/queue.html?queue=<queue_id>`
- a queued swap → `https://shit-1170.com/app/swap.html?swap=<swap_id>`

the swap page takes the trade itself as parameters as well, which is
what the full swap link looks like:

```
/app/swap.html?in=<token_in>&out=<token_out>&amount_in=<unit_amount>&swap=<swap_id>
```

`in`, `out` and `amount_in` pre-fill the form. `swap` is the one that
credits the execution: the swap page's SWAP NOW button records its
result against the queued swap named by `swap=`, so a link without that
parameter leaves the queue saying it is still waiting.

the same parameters without `swap=` are a link to a trade that is NOT
queued — useful for showing a human a trade before it exists.

---

#### WHAT THE ACCOUNT PAGE READS

four balance sources, four different contracts, asked in parallel:

| source | request |
| --- | --- |
| direct + native | Intear `GET /balances?account=<id>&sources=direct,native` |
| Rhea AMM | `v2.ref-finance.near.get_deposits` |
| Rhea DCL | `dclv2.ref-labs.near.list_user_assets` |
| INTEAR DEX | `dex.intear.near.registered_assets_of` |

a zero balance is dropped — an account that merely touched a token once
does not hold it.

token metadata is asked once for the union of every token id in the
four tables.

---

#### WHAT THE $SHIT PAGE READS

- the token summary: `GET /tokens?ids=shit-1170.meme-cooking.near&fields=...`
- the holders: `GET /holders?token=shit-1170.meme-cooking.near&limit=100&cursor=<cursor>`

the holders are classified into dev, dex, vault, nft, burn, and regular
groups. the groups' shares of the total supply are the sum of the raw
balances in each group over the total supply.

---

#### THE SKILL PAGE

this is where a human gets an API key to hand to an agent.

`POST /api/shit-1170/api-keys` takes the signed messages the browser
holds and answers with one key per account. an account has exactly one
key, whatever device it signs in from.

`POST /api/shit-1170/api-key/rotate` issues a new key. it takes the
account's signed message, not the old key — the old key is what a
thief has, so a rotation that only needed the old key could be done by
the thief. the old key stops working at once.

the copy-for-agent button gives the user the key and the instructions
for using these skills. the key is what the agent uses to queue work
for that account.

=====================
<br/>
copyright 2026 by sleet.near
