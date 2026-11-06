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
- [shit-1170-rex-ft](./shit-1170-rex-ft/SKILL.md) — NEP-141 token transfers, contact list, receiver checks, wrapping and unwrapping NEAR through wrap.near
  - [WRAP.NEAR.md](./shit-1170-rex-ft/DOCS/WRAP.NEAR.md) — the wrap.near contract, the payloads, and the conditional storage registration
- [shit-1170-rex-hello-sleet-near](./shit-1170-rex-hello-sleet-near/SKILL.md) — the hello.sleet.near greeting contract
- [shit-1170-rex-unit-conversion](./shit-1170-rex-unit-conversion/SKILL.md) — human amounts to chain units, using the token's real decimals

## the local store

```text
${HOME}/.shit-1170-rex-engine/
├── accounts/     # one private api key file per account
├── contacts.json # the ft skill's contact list
└── queue/        # a local copy of every queued batch and swap
```

set `SHIT_1170_REX_HOME` to use another directory.

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
