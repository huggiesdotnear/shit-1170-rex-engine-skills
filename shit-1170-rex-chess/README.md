# shit-1170-rex-chess

the chess skill for the shit-1170 rex engine.

it plays on-chain chess on `app.chess-game.near` — the protocol pawns
contract on near mainnet — in two modes:

- **propose** — the agent picks the move, queues it, and the human
  signs it in the web app. this is the default, and it follows the
  library's rule: the agent never signs.
- **autonomous** — the agent signs its own moves with a limited access
  key the human approved. it is a named exception to that rule, scoped
  to one key and one contract.

```sh
bunx skills add huggiesdotnear/shit-1170-rex-engine-skills
```

**this skill is not published to npm.** it is installed from the
skills repo with the installer above. the `package.json` in this
folder names the package it *would* have if it were published, and
that name is internal.

---

## the bins

| bin | kind | what it does |
| --- | --- | --- |
| `chess_board.ts` | chain VIEW | the board, the players, whose turn it is |
| `chess_account.ts` | chain VIEW | an account's rating, points and stats |
| `chess_elo.ts` | api | the elo leaderboard, sorted |
| `chess_challenges.ts` | api | the open challenges across the platform |
| `chess_propose_move.ts` | queue | build a play_move payload for a human |
| `chess_register.ts` | queue | build the registration and the agent flag |
| `chess_key_add.ts` | local | show the limited key, and how to add one |
| `chess_play_move.ts` | key | the agent signs a play_move |
| `chess_match.ts` | key | join the matchmaking queue, or leave it |
| `chess_challenge.ts` | key | challenge, accept, or reject |
| `chess_games.ts` | local | the games the agent has played |
| `chess_daemon.ts` | key | the long-lived autonomous player |

all bins print JSON on stdout and JSON errors on stderr.

---

## the docs

- [SKILL.md](./SKILL.md) — the overview and the index
- [MOVES.md](./DOCS/MOVES.md) — the board, the fen, coordinate notation, and the chooser
- [MODES.md](./DOCS/MODES.md) — propose against autonomous, and the exception
- [COMMANDS.md](./DOCS/COMMANDS.md) — every bin, every flag, every answer shape
- [DAEMON.md](./DOCS/DAEMON.md) — the sse watch, the heartbeat, the reconnect

---

## the tests

```sh
bun test
```

the move chooser is tested against known positions. it is the one
piece of this skill that can burn gas silently, so it is the one piece
that is tested.

---

## the local store

```text
${HOME}/.shit-1170-rex-engine/
├── accounts/                # one private api key file per account
├── keys/                    # the keys skill's store of limited access keys
│   ├── keys.sqlite          # every key pair ever generated, and the seed phrases
│   └── added/               # one json file per key that was offered to an account
└── chess/                   # this skill's folder
    ├── daemon.json          # what the daemon is doing right now
    ├── log.jsonl            # one line per event
    └── games.sqlite         # the games it plays, and how they went
```

set `SHIT_1170_REX_HOME` to use a different directory.

---

## the contract

`app.chess-game.near`, **mainnet only** — there is no testnet
deployment, so the bins refuse `--network testnet`.

the method list is verified against the deployed contract:

```sh
near contract inspect app.chess-game.near network-config mainnet now
```

the typed helpers are in `@near-kit-tool-box/fun`, and the indexed api
has its own typed client, `@sleet-js/middleman-protocol-pawns-api`.

=====================
<br/>
copyright 2026 by sleet.near
