# WORKFLOW

how the shit-1170 rex skills work together.

every skill in this library follows the same shape, so a task that
crosses contracts does not change shape halfway through.

---

#### THE SEVEN MOVES

1. **find out** — read the contract, the chain, and the engine's state
   before deciding what to propose.
2. **prove it** — verify the method, the arguments, the gas, the
   deposit, the account, the receiver, and the amount.
3. **explain it** — say what the calls do in plain language before
   queueing them.
4. **queue it** — write the batch to the engine, for a human to sign.
5. **keep a copy** — the local record under
   `${HOME}/.shit-1170-rex-engine/` is the backup and the history.
6. **wait for it** — watch the live feed until the human signs, rather
   than asking them whether they have.
7. **follow it** — report the send from the engine's record, read the
   receipt on chain, and sync the local record.

steps 2 and 3 are what make the skill worth using. the engine records
whatever it is given, so an agent that queues without verifying can
queue a call that moves the wrong amount to the wrong place.

step 6 exists because the engine already knows when the human signs,
and a hash they have to paste into a chat is a hash that can be
mistyped. the wait replaces the question.

---

#### READING AND WRITING

the six moves above cross two different systems, and which one a step
touches decides what it may do.

| | view calls | contract interaction |
| --- | --- | --- |
| where it goes | the near-kit tool box, directly | the engine's queue |
| who does it | the agent | a human, in the web app, with their wallet |
| what it needs | nothing — no API key, no engine account | an API key for the account, and the human's signature |
| what it produces | an answer | a queue id and a link to sign |

so a step that only **reads** chain state calls the tool box: a typed
helper from `@near-kit-tool-box/fun`, or `generic_contract_view_fun_json`
for a view that has no dedicated helper. a step that **writes** builds
a queue payload — `{ contractId, method, args, gas, deposit }` — and
hands it to the queue helpers, `queue_tx.ts` or `queue_swap.ts`.

**the tool box is never used to interact with a contract.** its
`*_fun_json` helpers that CALL are reference material: take the
argument shape, the gas, and the deposit from them, but emit a queue
payload instead of sending. never `near.call`, never
`generic_contract_call_fun`, never `generic_contract_call_wallet` — the
last one needs a browser wallet, and a skill bin runs in a terminal
with no wallet and must never sign anything.

---

#### WORKING ON THE SKILLS

this library is a git repo of skills, and it is worked on like one:

`git pull` before you start, commit and push to `main` when you are
done. never create a branch — the work goes onto `main` and is pushed
from there.

the facts a skill records come from the near kit tool boxes, and each
source is a different strength of evidence. a **fun helper** — the
function that builds and sends the exact JSON — is the strongest, and
it proves the argument shape, the gas, and the deposit. a **typed
contract** is hand-written and has been wrong once, so treat it as
unconfirmed and check it. the **skill library** is the reference to
write against, and the tool boxes win on a disagreement.

verify a method against the deployed contract before writing it down:

```sh
near contract inspect <contract_id> network-config mainnet now
```

a fact in none of the sources is recorded as **not documented yet**,
never guessed. and the repo holds only truth: when something is
added or fixed, say what is true, not what the old mistake was.

---

#### WHY A QUEUE AND NOT A TRANSACTION

the engine's queue is a batch of calls for a human to sign in one
wallet popup. that gives three things a normal transaction does not:

- the human sees the whole batch before any of it runs
- several calls that depend on each other run in one transaction, so
  the receipt tree holds together
- the proposal stays visible in a feed until somebody acts on it

so an agent's job is to prepare the batch. the human's job is to sign
it. an agent that waits for a signature has misunderstood its role.

---

#### THE ACCOUNTS

an account is an NEAR account id. one account owns one API key at the
engine, whatever device it signs in from.

keys live one per file:

```text
${HOME}/.shit-1170-rex-engine/accounts/<account_id>.json
```

why one file per account rather than one file with all of them:

- a file for one account can be shared, moved, or deleted without
  touching the others
- a rotation replaces one file
- a leaked file leaks one account, not every account
- the list can be shown without ever showing a key

when more than one account is stored, every queueing bin needs
`--account`. refusing to guess is the point: a batch queued for the
wrong account lands in the wrong feed.

---

#### THE CONTACTS

the FT skill's contact list lives beside the accounts:

```text
${HOME}/.shit-1170-rex-engine/contacts.json
```

a transfer to an account that is not on the list is refused unless the
human explicitly approves and the bin is run with `--force`. the check
is there because a mistyped NEAR account id is a valid account id: it
usually belongs to somebody else, and the transfer succeeds.

adding a contact is a separate, explicit act. confirm the address with
the human before it goes on the list — a contact list built from
guesses is worse than no list.

---

#### THE LOCAL RECORDS

every queued item becomes a local record:

```text
${HOME}/.shit-1170-rex-engine/queue/tx/<queue_id>.json
${HOME}/.shit-1170_REX_HOME/queue/swap/<swap_id>.json
```

a record holds:

- the request exactly as the agent wrote it
- the response exactly as the server returned it
- the times it was created and last updated
- the path to itself

`sync_queue.ts` compares the server's current state with the stored
response and rewrites the record when it changed. a changed record is
evidence that something happened — the human sent it, or another
account did.

the local records are also how an agent learns. a queue that failed
again and again has a method shape or a gas value that is wrong. the
records make that visible without a database.

---

#### VERIFYING BEFORE QUEUEING

the checklist, in the order that catches the most expensive mistakes
first:

| check | how | what goes wrong without it |
| --- | --- | --- |
| contract exists | `check_contract.ts` | the call goes to a stranger's account |
| method exists | `check_contract.ts --methods` | `MethodNotFound` at signing time |
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

**the input token of a swap comes from the balances.** native NEAR is
`near`; wNEAR is the contract `wrap.near`. the account holds one, the
other, or both, and the swap sells whichever one it holds. when it
holds no wNEAR, quote out of native NEAR — the router routes `near`
directly, so there is no wrap step to pay for.

---

#### EXPLAINING

after queueing, the human gets:

- what the batch does, in one sentence
- each call: contract, method, the arguments that matter
- gas and attached deposit per call
- what must be true for it to succeed
- the queue id and the link to sign it
- the local copy path
- that it is waiting for their signature

keep the explanation readable. the person reading it may be deciding
whether to approve a transaction that moves their money, and raw JSON
alone does not tell them whether it is reasonable.

**the id and the link go together.** the id is what the human quotes
back to you; the link is where they sign it. an id without a link
makes the human go hunting through the feed for a proposal they cannot
recognise by id alone.

| what was queued | id field | the link |
| --- | --- | --- |
| a batch of calls | `queueId` | `/app/queue.html?queue=<queue_id>` |
| a swap | `swapId` | `/app/swap.html?in=<token_in>&out=<token_out>&amount_in=<unit_amount>&swap=<swap_id>` |

the ids are absolute paths on the site, so the full link is
`https://shit-1170.com` plus the path.

a swap's link carries the trade as well as the id, so the human lands
on the swap already filled in. the `swap=` part is what makes their
execution count against the queued proposal — the swap page reports
the result back to the queued swap named by it, and a link without it
leaves the queue still waiting.

`in=near` is native NEAR. every other token is its bare contract id.
`amount_in` is the raw unit amount, not the human one.

---

#### READING THE ENGINE'S DATA

the engine's pages are the reference for what an agent should be able
to read:

| page | data |
| --- | --- |
| feed | queued batches and queued swaps |
| queue | one batch: calls, transfers, accounts, statuses |
| swap | one swap, its live route, its outcome |
| account | direct, native, Rhea AMM, Rhea DCL, and INTEAR balances; transaction history |
| token | metadata and the indexed holders |
| $SHIT token | metadata, holder groups, holder shares |
| transaction | signer, receiver, actions, transfers, receipts, outcome |
| Sputnik DAO | config, policy, roles, proposals, balances |
| Rhea | pools, TVL, volume, APY |
| INTEAR DEX | pools, TVL, volume, APY |

the general skill's bins cover the token, account, and transaction
reads. the contract-specific skills cover the DEX and DAO reads.

---

#### AFTER THE SEND

**the human never hands the agent a hash.** when the human signs, their
wallet reports the send to the engine, and the engine writes the hash
on the account row. so the agent reads the hash back out of the queue
it queued.

1. wait for it: `watch_queue.ts --queue <id> --until sent`, or read
   the queue's own record with `get_queue.ts tx --id <id>`
2. report the send from the engine's record: `queue_sent.ts tx --queue
   <id> --from-server`
3. read the receipt on chain with the FastNear API: `tx_status.ts
   --tx-hash <hash>`
4. sync the local record: `sync_queue.ts one tx <queue_id>`
5. tell the human what actually happened

**the engine's status and the chain's status are two different
things.** step 2 asks the engine what it was told. step 3 asks the
chain what happened. the engine records `sent` when the outcome is
unknown, and a receipt can fail after the first leg succeeded — so when
the two disagree, the chain is right.

**the live feed is a trigger, not a source of truth.** the websocket
says THAT something changed; the engine's routes say WHAT it is. the
watch refreshes the local copy on every event, so the local record is
current when the watch ends, and the hash still comes from the server
rather than from the socket's copy of it.

=====================
<br/>
copyright 2026 by sleet.near
