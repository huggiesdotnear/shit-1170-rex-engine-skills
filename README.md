# shit-1170-rex-engine-skills

💩 shit-1170 agentic and defi engine for near

```sh
# add
bunx skills add huggiesdotnear/shit-1170-rex-engine-skills
# --list
bunx skills add huggiesdotnear/shit-1170-rex-engine-skills --list
```

**these skills are not published to npm.** they are installed from this
repo with the skills installer above. the `package.json` in each skill
folder names the package it *would* have if it were published, and
those names are internal.

the engine's typed client IS on npm — `@huggies/shit-1170-rex-engine-middleman`
— because code outside this repo imports it.

## the skills

- [shit-1170-rex-engine](./shit-1170-rex-engine/SKILL.md) — propose, verify, queue, and track rex engine transactions and swaps
- [shit-1170-rex-tx-explorer](./shit-1170-rex-tx-explorer/SKILL.md) — read an account's transaction history and read transactions by hash, with every transaction kept in a local sqlite store so the same one is never looked up twice
- [shit-1170-rex-ft](./shit-1170-rex-ft/SKILL.md) — NEP-141 token transfers, contact list, receiver checks, wrapping and unwrapping NEAR through wrap.near, plus the token reads — token info from the chain and the intear API, holders, and an account's balances
  - [WRAP.NEAR.md](./shit-1170-rex-ft/DOCS/WRAP.NEAR.md) — the wrap.near contract, the payloads, and the conditional storage registration
- [shit-1170-rex-sputnik-dao](./shit-1170-rex-sputnik-dao/SKILL.md) — Sputnik DAO governance: reading a DAO's policy, proposals and bounties, and queueing proposals, votes and bounty actions
  - [SPUTNIK.DAO.md](./shit-1170-rex-sputnik-dao/DOCS/SPUTNIK.DAO.md) — the full method reference: every view and every call, with the argument shape, the gas and the deposit
- [shit-1170-rex-rhea-dclv2](./shit-1170-rex-rhea-dclv2/SKILL.md) — Rhea DCL v2 concentrated-liquidity DEX: quoting swaps, adding and removing liquidity, placing limit orders, moving the internal balance, and registering storage
  - [RHEA.DCLV2.md](./shit-1170-rex-rhea-dclv2/DOCS/RHEA.DCLV2.md) — the full method reference: every view and every call, with the argument shape, the gas and the deposit
- [shit-1170-rex-rhea-ammv2](./shit-1170-rex-rhea-ammv2/SKILL.md) — Rhea AMM v2 (ref-finance v2): quoting and swapping through pools, moving the deposited balance, and registering storage
  - [RHEA.AMMV2.md](./shit-1170-rex-rhea-ammv2/DOCS/RHEA.AMMV2.md) — the full method reference: every view and every call, with the argument shape, the gas and the deposit
- [shit-1170-rex-hello-sleet-near](./shit-1170-rex-hello-sleet-near/SKILL.md) — the hello.sleet.near greeting contract
- [shit-1170-rex-fastfs](./shit-1170-rex-fastfs/SKILL.md) — FastFS file uploads: the borsh payload, the chunking rule, the limits, and the serving URL
- [shit-1170-rex-near-social](./shit-1170-rex-near-social/SKILL.md) — near.social: reading the feeds, profiles, posts, threads and notifications, and queueing posts, replies, quotes, likes, reposts, follows and profile edits
- [shit-1170-rex-unit-conversion](./shit-1170-rex-unit-conversion/SKILL.md) — human amounts to chain units, using the token's real decimals
- [shit-1170-rex-irc](./shit-1170-rex-irc/SKILL.md) — talk to the shit-1170 IRC server from a script: connect over the IRCv3 websocket transport, post, read channels, list them, register accounts and log in with SASL
  - [PROTOCOL.md](./shit-1170-rex-irc/DOCS/PROTOCOL.md) — the websocket transport, the capability negotiation, and the gotchas that bite

## the local store

```text
${HOME}/.shit-1170-rex-engine/
├── accounts/                # one private api key file per account
├── contacts.json            # the ft skill's contact list
├── queue/                   # a local copy of every queued batch and swap
│   ├── index.json           # the list of every local record
│   ├── tx/<queue_id>.json   # one local copy per queued batch
│   └── swap/<swap_id>.json  # one local copy per queued swap
└── tx/                      # the tx explorer skill's sqlite store of transactions read
```

set `SHIT_1170_REX_HOME` to use a different directory.

## docs

- [TOOLS.md](./DOCS/TOOLS.md) — where the facts come from, and the middleman packages used
- [ENGINE.md](./shit-1170-rex-engine/DOCS/ENGINE.md) — the engine's routes, data model, and pages

the engine skill owns the queueing mechanics and the architecture. the
token and contract skills hold their own facts and link to it.

## the rule every skill follows

the agent prepares the transaction and queues it. the human signs it.
agents do not sign, send, or wait for a signature.

the engine keeps the hash of every send, so the agent reads it back
from the queue it queued — the human never pastes one into a chat. the
live feed's websocket tells the agent WHEN something changed; the
engine's own routes say what it is.

=====================
<br/>
copyright 2026 by sleet.near
