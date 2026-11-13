---
name: shit-1170-rex-chess
description: "Play on-chain chess on app.chess-game.near — the protocol pawns contract — with the shit-1170 rex engine. Use this skill whenever the user mentions app.chess-game.near, protocol pawns, on-chain chess, play_move, create_ai_game, challenge, accept_challenge, join_matchmaking, a chess game, an elo rating, a chess account, a chess opponent, or a chess bot or chess agent — including when the user wants to make a move, set up a game, find an opponent, queue a chess move for signing, or let an agent play chess on its own. The agent never signs in propose mode: the move is queued and the human signs it. Autonomous mode is the one exception, and it is scoped to one limited access key."
---

# shit-1170 rex chess

play chess on `app.chess-game.near`, the protocol pawns on-chain chess
contract, on near mainnet.

the contract holds the whole game: the board, the moves, the elo
ratings, the challenges, the matchmaking queue and the betting. the
skill is the agent's side of it — reading the game, choosing the
move, and putting the move in front of a human to sign.

**the contract is MAINNET ONLY.** there is no testnet deployment, so
the bins refuse `--network testnet` rather than pointing at nothing.

---

#### THE TWO MODES

| mode | who signs | how a move reaches the chain |
| --- | --- | --- |
| **propose** | the human | a queue payload, signed in the web app |
| **autonomous** | the agent, with a limited key | the agent signs it itself |

both modes share the same reads, the same move chooser and the same
game-state model. the mode decides who signs, nothing else.

**propose mode is the default, and it follows the library's rule: the
agent never signs.** a move becomes a queue payload and the human
signs it in the web app with their wallet.

**autonomous mode is a named exception**, and it is bounded by the key
it uses. see [MODES.md](./DOCS/MODES.md) for the whole of it, and
read it before running anything in autonomous mode.

---

#### THE BINS

all bins live in `bin/`, are run with `bun`, print JSON on stdout, and
print JSON errors on stderr with a non-zero exit code.

the `kind` column says where the answer comes from:

- **chain VIEW** — a read straight from NEAR. no API key, no server,
  no account.
- **api** — a read from the protocol pawns index. no auth.
- **queue** — a write that becomes a queue payload for a human.
- **key** — a write the agent signs with the limited access key.

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
| `chess_decide.ts` | local | the position and the candidates, for an agent to decide from |
| `chess_decide_move.ts` | key | make the move an agent chose, after checking it is legal |
| `chess_agent_decide.ts` | local | the decisions waiting for an agent, and the answer to one |
| `chess_agent_play.ts` | local | the agent itself: it reads the requests and answers them |

**every flag, every answer shape and the local store are in
[COMMANDS.md](./DOCS/COMMANDS.md).**

---

#### THE GAME ID

a game is identified by a tuple of three values:

```json
[206540279, "kcameau.near", "crans.near"]
```

- the first value is the block height the game was created at
- the second is the white player, always an account id
- the third is the black player, or `null` for a game against the ai

the bins take it as `--game-id '<json array>'`, or the loose flags
`--height`, `--white` and `--black`.

---

#### MOVES ARE COORDINATE NOTATION

**`"Nf3"` and `"Qxe4"` FAIL.** the contract wants coordinate notation.

| form | example |
| --- | --- |
| compact | `"e2e4"` |
| separated | `"e2 e4"` |
| explicit | `"e2 to e4"` |
| kingside castle | `"O-O"` |
| queenside castle | `"O-O-O"` |
| promotion | `"e7 to e8 queen"` |

the columns are a–h and the rows are 1–8, counted from white's side.

**a promotion spells the piece out in full.** `"e7 to e8 queen"`,
`"e7 to e8 rook"`, `"e7 to e8 bishop"` and `"e7 to e8 knight"` are the
forms the contract takes. `"e7 to e8 Q"` is refused with `invalid piece
name`.

**the move chooser, the board, the fen and the notation are in
[MOVES.md](./DOCS/MOVES.md).**

---

#### THE GAS FOLLOWS THE OPPONENT

| opponent | gas |
| --- | --- |
| `Easy` ai | 50 Tgas |
| `Medium` ai, or a human | 150 Tgas |
| `Hard` ai | 250 Tgas |
| `VeryHard` ai | 400 Tgas |

a wrong gas is not a small thing: the first leg of the call can run
and the second not, so the move lands half-done. the skill reads the
opponent and picks the gas every time.

---

#### FINDING AN OPPONENT

**the contract finds the opponent.** `join_matchmaking` puts the
account in a queue, and the contract pairs it with a similarly-rated
one.

```sh
bun bin/chess_match.ts --account kcameau.near --band 200
```

the band is the agent's **own rating ± the spread**, and the elo test
is **mutual** — both players' bands have to accept each other. so a
narrow band finds a fair opponent and can leave the agent queued for
an hour, and a wide one finds a match fast and plays a weaker
opponent.

two more ways to find somebody, both native:

| way | what it is |
| --- | --- |
| **the open challenges** | `chess_challenges.ts` — the pending challenges on the platform. an agent polls it to find a game to accept |
| **the leaderboard and the search** | `chess_elo.ts` for the ranked list. `POST /account/query` for a name prefix |

---

#### THE DAEMON

**a plain long-lived process.** it holds the protocol pawns sse stream
open and plays the moment it is the agent's turn.

```sh
# in a tmux session
bun bin/chess_daemon.ts --account kcameau.near --band 200
```

it is **not a server**. there is no http api and nothing talks to it.
its state is written to a file:

```sh
bun bin/chess_daemon.ts --state
```

**the daemon accepts every challenge it can** — that is what
autonomous mode means — and it plays every game the matchmaking queue
pairs it in. a challenge **with a wager** is skipped: a token deposit
moves money, and the human signs every one of those.

**the heartbeat, the reconnect and the whole loop are in
[DAEMON.md](./DOCS/DAEMON.md).**

---

#### THE KEY

**the human signs into the rex app**, the app issues the agent an
API key, and the human signs a **limited access key** onto the
account the agent should play as.

the two modes need different credentials:

- **propose mode** needs the **engine's API key** — the account's key
  to the rex engine, the same one every other skill uses.
- **autonomous mode** needs the **NEAR limited access key** — the key
  that lets the agent sign its own calls.

the chess skill does not generate keys and does not queue the
add_key. the **keys skill** owns that, and it owns it for a reason: a
key that was already handed to somebody else has another holder.

```sh
# the human runs this, and approves it in the web app
bun bin/key_queue_add.ts --receiver-id app.chess-game.near --allowance 1000000000000000000000000
```

no method names means every method on that contract. the narrower key
is one flag away, and it drops the money-shaped methods:

```sh
bun bin/key_queue_add.ts \
  --receiver-id app.chess-game.near \
  --methods play_move,resign,cancel,challenge,accept_challenge,reject_challenge,claim_points,set_is_agent,join_matchmaking,cancel_matchmaking,create_ai_game \
  --allowance 1000000000000000000000000
```

**the allowance is not the deposit — it is the prepaid gas.** the
contract takes `gas_limit x gas_price` from the key's allowance before
the call runs, and mainnet's gas price is 1000000000 yoctoNEAR per gas
unit. a 30 Tgas call needs 0.03 NEAR of allowance, so a key with an
allowance of 0 is refused with `NotEnoughAllowance` before the
contract is reached. 1 NEAR covers every call this skill makes.

**the method list is the whole skill.** a key that leaves out
`join_matchmaking` or `create_ai_game` cannot queue for a match or
open a game against the ai, and the contract refuses the call with
`MethodNameMismatch`.

`chess_key_add.ts` shows the key that is already there and the
command to add one.

---

#### THE LIMITS

| limit | value |
| --- | --- |
| active games per account | 5 |
| open challenges per account | 25 |
| open bets per bettor | 10 |
| bets per game | 250 |
| matchmaking queue entries | 500 |
| a matchmaking entry expires after | 1 hour |
| a cancel is allowed when it is not the caller's turn, after | ~3 days |

---

#### BETTING

**the betting surface is not this skill's job.** a bet is an
`ft_transfer_call` on the token contract, it attaches a token
deposit, and the human signs every one of those — in both modes.

the bets read: `GET /bets`, `GET /game/{game_id}/bets`,
`GET /account/{account_id}/bets`. the fee is `get_fees`, in basis
points, and only the whitelisted tokens work.

---

#### THE LOCAL STORE

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

set `SHIT_1170_REX_HOME` to use a different directory — the same
override every skill uses.

---

#### THE DOCS

each one is self-contained. read the one that answers the question in
front of you.

| file | what it covers |
| --- | --- |
| [MOVES.md](./DOCS/MOVES.md) | the board, the fen, coordinate notation, and the chooser |
| [MODES.md](./DOCS/MODES.md) | propose against autonomous, and the exception |
| [COMMANDS.md](./DOCS/COMMANDS.md) | every bin, every flag, every answer shape |
| [DAEMON.md](./DOCS/DAEMON.md) | the sse watch, the heartbeat, the reconnect |

---

#### MORE

- the engine skill's
  [SKILL.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-engine/SKILL.md)
  — the queueing mechanics
- the keys skill's
  [SKILL.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/shit-1170-rex-keys/SKILL.md)
  — the limited access keys
- the library's
  [TOOLS.md](https://github.com/huggiesdotnear/shit-1170-rex-engine-skills/blob/main/DOCS/TOOLS.md)
  — where the facts come from

=====================
<br/>
copyright 2026 by sleet.near
