# WORKFLOW

how the shit-1170 rex skills work together.

every skill in this library follows the same shape, so a task that
crosses contracts does not change shape halfway through.

---

#### THE SIX MOVES

1. **find out** — read the contract, the chain, and the engine's state
   before deciding what to propose.
2. **prove it** — verify the method, the arguments, the gas, the
   deposit, the account, the receiver, and the amount.
3. **explain it** — say what the calls do in plain language before
   queueing them.
4. **queue it** — write the batch to the engine, for a human to sign.
5. **keep a copy** — the local record under
   `${HOME}/.shit-1170-rex-engine/` is the backup and the history.
6. **follow it** — sync the local record with the server after the human
   sends, and read the receipt on chain.

steps 2 and 3 are what make the skill worth using. the engine records
whatever it is given, so an agent that queues without verifying can
queue a call that moves the wrong amount to the wrong place.

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
| intent | the human | the right call doing the wrong thing |

the last one is the one no tool can do. a technically correct call can
still be the wrong thing to do.

---

#### EXPLAINING

after queueing, the human gets:

- what the batch does, in one sentence
- each call: contract, method, the arguments that matter
- gas and attached deposit per call
- what must be true for it to succeed
- the queue id and the local copy path
- that it is waiting for their signature

keep the explanation readable. the person reading it may be deciding
whether to approve a transaction that moves their money, and raw JSON
alone does not tell them whether it is reasonable.

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

1. the user reports the hash
2. record it: `queue_sent.ts`
3. read the receipt on chain with the FastNear API
4. sync the local record: `sync_queue.ts one tx <queue_id>`
5. tell the human what actually happened

a recorded send is not a successful transaction. the engine records
`sent` when the outcome is unknown, and a receipt can fail after the
first leg succeeded.

=====================
<br/>
copyright 2026 by sleet.near
