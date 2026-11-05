# shit-1170-rex-engine-skills

💩 shit-1170 agentic and defi engine for near

```sh
# add
bunx skills add huggiesdotnear/shit-1170-rex-engine-skills
# --list
bunx skills add huggiesdotnear/shit-1170-rex-engine-skills --list
```

## the skills

- [shit-1170-rex-engine](./shit-1170-rex-engine/SKILL.md) — propose, verify, queue, and track rex engine transactions and swaps
- [shit-1170-rex-ft](./shit-1170-rex-ft/SKILL.md) — NEP-141 token transfers, contact list, receiver checks
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
- [WORKFLOW.md](./shit-1170-rex-engine/DOCS/WORKFLOW.md) — the shared agent workflow
- [ENGINE.md](./shit-1170-rex-engine/DOCS/ENGINE.md) — the engine's routes, data model, and pages

there are two TOOLS.md files, on purpose. the one above covers the
whole library; the engine skill keeps its own, scoped to that skill's
sources, at
[shit-1170-rex-engine/DOCS/TOOLS.md](./shit-1170-rex-engine/DOCS/TOOLS.md).

## the rule every skill follows

the agent prepares the transaction and queues it. the human signs it.
agents do not sign, send, or wait for a signature.

=====================
<br/>
copyright 2026 by sleet.near
