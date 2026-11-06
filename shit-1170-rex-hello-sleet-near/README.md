# shit-1170-rex-hello-sleet-near

the hello.sleet.near greeting contract, as a skill.

read the current greeting, or prepare a call that sets it.

see [SKILL.md](./SKILL.md)

---

#### CONTRACT IDS

- MAINNET: `hello.sleet.near`
- TESTNET: `hello.sleet.testnet`

---

#### THE BIN

```sh
bun bin/greeting.ts get
bun bin/greeting.ts get --network testnet
bun bin/greeting.ts set --greeting "Hello from sleet"
```

the bin prints JSON on stdout and JSON errors on stderr with a
non-zero exit code.

`set` prints the queue payload to queue. queue it with the general
`shit-1170-rex-engine` skill's `queue_tx.ts`. the agent queues; a
human signs.

=====================
<br/>
copyright 2026 by sleet.near
