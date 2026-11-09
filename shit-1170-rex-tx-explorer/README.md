# shit-1170-rex-tx-explorer

transaction history and transaction details for the shit-1170 rex engine.

two questions, two endpoints: **what did this account do?** and **what
did THIS transaction do?** the history endpoint answers the first with a
list of minimal rows, and the transaction endpoint answers the second
with the transaction itself — its actions, its receipts, its gas, its
logs.

**everything here is a read.** there is nothing to sign.

- the skill: [SKILL.md](./SKILL.md)
- the engine skill, for the queueing mechanics:
  [shit-1170-rex-engine](../shit-1170-rex-engine/SKILL.md)

## the bins

```sh
# what did this account do?
bun bin/account_txs.ts --account-id alice.near --limit 50

# the next page
bun bin/account_txs.ts --account-id alice.near --resume-token <token>

# what did this transaction do?
bun bin/tx.ts --tx-hash <hash>

# several at once
bun bin/tx.ts --tx-hash <hash1> <hash2> <hash3>
```

**both print the endpoint's own JSON, unreshaped.** what comes back is
what the api sent — the rows, the fields, the names. nothing is
renamed, dropped, or added on top.

## the local store

every transaction this skill reads is kept, so the same one is never
looked up twice:

```text
${HOME}/.shit-1170-rex-engine/
└── tx/
    └── explorer.sqlite
```

set `SHIT_1170_REX_HOME` to use a different directory.

the store is asked first. a hash that is in it is answered from disk
and no request is made; the hashes that are missing are fetched in one
request. the payload is the api's own, untouched, so a cached
transaction prints exactly what a fresh fetch would.

**a transaction on chain never changes**, so a stored one is never
stale — and the fastnear api rate limits at about five requests a
second, so a repeated lookup is not merely wasted.

**the account's history is never cached.** a history grows: every read
of it may find a new transaction at the top. a stored copy would be a
history that stops at the moment it was saved.

`--refresh` skips the local copy when a reader wants the endpoint's
answer right now rather than the copy from earlier.

## the two endpoints are not interchangeable

a history row is **minimal**. it carries the hash, the block, the
timestamp and the flags that say how the account was involved —
`is_signer`, `is_receiver`, `is_real_signer` and the rest. there are no
actions, no receipts and no gas in it.

so reading a history gives you the hashes, and reading a transaction
gives you what it did. **get the hash first, then the transaction.**

`is_real_signer` is the one to trust for "did this account actually
send it" — `is_signer` is also true for a relayer.

## the sources

the facts come from the primary sources:

- `docs.fastnear.com/tx/account` — the history endpoint, its filters
  and its paging
- `docs.fastnear.com/tx/transactions` — the transaction endpoint and
  its batch size
- `github.com/fastnear/builder-docs` — the pages above, in source
- the api itself, checked against live mainnet responses

=====================
<br/>
copyright 2026 by sleet.near
