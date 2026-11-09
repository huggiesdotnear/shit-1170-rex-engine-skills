---
name: shit-1170-rex-tx-explorer
description: "Read NEAR account transaction histories and transaction details with the shit-1170 rex engine, from the FastNear transactions API, with every transaction kept in a local sqlite store so the same one is never looked up twice. Use this skill whenever the user mentions looking up a transaction, a tx hash, a transaction hash, a receipt, an account's transactions, transaction history, what an account did, whether a transaction succeeded, gas burnt, transaction logs, or a transaction explorer — including when the user pastes a NEAR tx hash and wants to know what it did. Also use it to find an account's recent transactions and to check whether a transaction the engine queued actually went through. The engine skill's tx_status.ts reads one known hash; this skill lists an account's history and caches what it reads."
---

# shit-1170 rex transaction explorer

read the chain's transaction history and the transactions themselves.

use the general `shit-1170-rex-engine` skill for the queueing
mechanics and the architecture. this skill holds the transaction
reads.

**the rules that apply here too:** the agent never calls a contract.
everything in this skill is a READ. there is nothing to sign here.

---

#### THE TWO ENDPOINTS, AND WHY THERE ARE TWO

the fastnear transactions API answers two different questions, and
they are not interchangeable.

| question | endpoint | what it gives |
| --- | --- | --- |
| what did this account do? | `POST /v0/account` | a LIST of transactions, as metadata rows |
| what did THIS transaction do? | `POST /v0/transactions` | the transaction ITSELF: actions, receipts, gas, logs |

the history endpoint's rows are **minimal**. each one carries the hash,
the block, the timestamp, and a set of flags saying how the account was
involved — `is_signer`, `is_receiver`, `is_real_signer`, and the rest.
there are no actions, no receipts and no gas in a history row. so
reading an account's history gives you the hashes, and reading a
transaction gives you what it did.

**get the hash first, then the transaction.** that is the order the
two bins are meant to be used in.

---

#### THE BINS

all bins live in `bin/`, are run with `bun`, print JSON on stdout, and
print JSON errors on stderr with a non-zero exit code.

| bin | what it does |
| --- | --- |
| `account_txs.ts` | read an account's transaction history |
| `tx.ts` | read transactions by hash, and keep them locally |

**both print the endpoint's own JSON, unreshaped.** what comes back
is what the api sent — the rows, the fields, the names. nothing is
renamed, nothing is dropped, and nothing is added on top. an agent
that needs a field gets the field, because the field is there.

### --- ACCOUNT_TXS.TS ---

```sh
bun bin/account_txs.ts --account-id alice.near --limit 50
```

the account's history, newest first. the answer is the api's own
object — `account_txs` with the rows, `resume_token` when there is
more, and `txs_count`:

```json
{
  "account_txs": [
    {
      "account_id": "alice.near",
      "transaction_hash": "Csf8Bqoqmj6fEFB2RoYv99dkUFHVzLxrRoo2c8GT7d2h",
      "tx_block_height": 222106076,
      "tx_block_timestamp": "1793265946912334711",
      "tx_index": 4,
      "is_signer": false,
      "is_receiver": false,
      "is_success": true
    }
  ],
  "resume_token": "953938319777988612",
  "txs_count": 1376
}
```

| flag | what it does |
| --- | --- |
| `--account-id <id>` | the account. required |
| `--limit <n>` | rows per page. default `50`, max `1000` |
| `--asc` | oldest first. newest first is the default |
| `--resume-token <token>` | the next page, with the `resume_token` from the last one |
| `--network mainnet\|testnet` | the network. default `mainnet` |

**the `resume_token` is opaque.** hand it back exactly as the api gave
it. a page with no `resume_token` is the last page.

**`txs_count` comes with the first page only.** the api omits it from
the pages after it, so keep the count you already have rather than
dropping it when a later page has none.

**the flags are worth reading.** `is_real_signer` is the one to trust
for "did this account actually send it" — `is_signer` is also true for
a relayer. `is_success` is the transaction's own outcome.

### --- TX.TS ---

```sh
bun bin/tx.ts --tx-hash Csf8Bqoqmj6fEFB2RoYv99dkUFHVzLxrRoo2c8GT7d2h
```

one or more transactions, in full. the answer is the api's own object
— a `transactions` array, each entry the transaction with its
execution outcome and its receipts:

```json
{
  "transactions": [
    {
      "transaction": { "signer_id": "neffertiti85.near", "actions": [] },
      "execution_outcome": { "outcome": { "gas_burnt": 310777471755 } },
      "receipts": []
    }
  ]
}
```

| flag | what it does |
| --- | --- |
| `--tx-hash <hash>` | a transaction hash. may be repeated as bare arguments |
| `--refresh` | ignore the local copy and ask the api again |
| `--network mainnet\|testnet` | the network. default `mainnet` |

many hashes at once:

```sh
bun bin/tx.ts --tx-hash <hash1> <hash2> <hash3>
```

at most 20 per call — that is the api's batch size.

**a hash the api does not know is not a crash.** the answer carries
`not_answered` with the hashes it had no record of, and the bin exits
non-zero. the hash may be wrong, or the transaction may not be indexed
yet.

---

#### THE LOCAL STORE

**every transaction this skill reads is kept**, so the same one is
never looked up twice.

```text
${HOME}/.shit-1170-rex-engine/
└── tx/
    └── explorer.sqlite
```

set `SHIT_1170_REX_HOME` to use a different directory — the same
override the engine skill uses.

the store holds the api's payload for each hash, untouched, so a
cached transaction prints exactly what a fresh fetch would.

**the store is asked first.** a hash that is already in it is
answered from disk and no request is made. a hash that is not in it
is fetched — and the missing ones are fetched in ONE request, so ten
new hashes cost one call and not ten.

**a transaction on chain never changes**, so a stored one is never
wrong. the fastnear api rate limits at about five requests a second,
so a repeated lookup is not merely wasted — it can push the other bins
off the limit.

**the account's history is NOT cached, and never will be.** an
account's history grows: every read of it may find a new transaction
at the top. a stored copy would be a history that stops at the moment
it was saved, and nothing would say that the account has moved on. so
`account_txs.ts` always asks the api.

`--refresh` skips the local copy when a reader wants the endpoint's
answer right now rather than the copy from earlier.

---

#### THE FLOW

1. **find the transaction** — `account_txs.ts` for the hashes of an
   account's recent transactions, or use the hash the user gave.
2. **read the transaction** — `tx.ts` for what it actually did.
3. **read the outcome** — the `execution_outcome` and the receipts.
   a failed receipt counts as a failure even when the transaction
   itself succeeded: a swap can succeed in its first leg and fail in
   its second.

**the engine skill has its own `tx_status.ts`**, which reads the
status of a transaction the engine already knows the hash of. use that
one when the hash came from a queue. use this skill's `tx.ts` when the
hash came from somewhere else, or when you want the whole transaction
rather than just its status.

---

#### EXPLAINING WHAT A TRANSACTION DID

after reading one, tell the human:

- what it did, in one sentence
- who sent it and who received it
- what it called, and on which contract
- what moved, and how much
- whether it succeeded, and what the logs say when it did not
- the block it landed in

keep it readable. raw JSON alone does not tell a person whether a
transaction did what they meant.

---

#### MORE

- the library's [TOOLS.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/DOCS/TOOLS.md)
  — where the facts come from
- the engine skill's
  [SKILL.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md)
  — the queueing mechanics

=====================
<br/>
copyright 2026 by sleet.near
