# ENGINE

the rex engine's data model, routes, and pages.

this is the reference the agent reads when it needs to know what the
engine stores and what the website shows.

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
