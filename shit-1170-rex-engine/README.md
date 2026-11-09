# shit-1170-rex-engine

the general skill for interacting with the shit-1170 rex engine.

an agent uses this to:

- propose and queue a batch of function calls for a human to sign
- propose and queue a swap for a human to execute
- keep a local copy of every queue under `${HOME}/.shit-1170-rex-engine/`
- store per-account API keys so several accounts can be worked with safely
- sync a local queue record with the server after a human sends it

the token reads — holders, balances, token metadata — live in the
[shit-1170-rex-ft](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-ft/SKILL.md)
skill.

see [SKILL.md](./SKILL.md) for the workflow and the bins.

---

#### INSTALL

```sh
bun i
```

#### EXAMPLE

```sh
bun bin/keyring.ts set --account alice.near --api-key <key>
bun bin/queue_tx.ts --file request.json
bun bin/sync_queue.ts all
```

the bins print JSON on stdout and JSON errors on stderr.

=====================
<br/>
copyright 2026 by sleet.near
