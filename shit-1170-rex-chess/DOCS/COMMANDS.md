# COMMANDS

every bin, every flag, every answer shape.

all bins live in `bin/`, are run with `bun`, print JSON on stdout, and
print JSON errors on stderr with a non-zero exit code.

```sh
bun bin/<bin>.ts --help
```

**stdout is pure JSON.** the middleman logs its requests to stderr, so
`bun bin/chess_elo.ts | jq .` works.

---

#### THE GAME ID

the bins take the game id two ways.

```sh
# the json array the contract takes
--game-id '[206540279,"kcameau.near","crans.near"]'

# or the loose flags
--height 206540279 --white kcameau.near --black crans.near
```

the third value is `null` for a game against the ai.

---

#### CHESS_BOARD.TS

the board, the players, whose turn it is, and the gas a move needs.

```sh
bun bin/chess_board.ts --game-id '[206540279,"kcameau.near","crans.near"]'
```

```json
{
  "ok": true,
  "game_id": [206540279, "kcameau.near", "crans.near"],
  "info": {
    "white": { "type": "Human", "value": "kcameau.near" },
    "black": { "type": "Human", "value": "crans.near" },
    "turn_color": "Black",
    "last_block_height": 207502116,
    "has_bets": false
  },
  "board": ["R  QK  R", " BPP  PP", "PPNBPN  ", "     P  ", "  pp    ", "p   p  p", " p  npp ", "r bqkbnr"],
  "rendered": "8♜⬜♝♛♚♝♞♜\n7⬜♟⬜♛♞♟♟⬛\n...",
  "gas_tgas": { "easy_ai": 50, "medium_ai": 150, "hard_ai": 250, "very_hard_ai": 400, "human": 150 },
  "gas_tgas_for_account": { "white": 150, "black": 150 }
}
```

| flag | what it does |
| --- | --- |
| `--game-id <json array>` | the game. required, or use the loose flags. |
| `--height <n>` | the block height. |
| `--white <account_id>` | the white player. |
| `--black <account_id>` | the black player. |
| `--network mainnet` | the network. testnet is refused. |

---

#### CHESS_ACCOUNT.TS

an account's rating, points and stats.

```sh
bun bin/chess_account.ts --account-id kcameau.near --games
```

```json
{
  "ok": true,
  "account_id": "kcameau.near",
  "account": {
    "near_amount": "50000000000000000000000",
    "is_agent": false,
    "points": "28414500",
    "pending_points": "0",
    "elo": 1032.5935807926685,
    "wins": 4,
    "win_streak": 1,
    "max_win_streak": 2,
    "bets_placed": 0,
    "bets_won": 0,
    "wagers_played": 0,
    "wager_wins": 0,
    "challenges_sent": 8
  },
  "games": [[203702264, "marior.near", "kcameau.near"], [206540279, "kcameau.near", "crans.near"]]
}
```

| flag | what it does |
| --- | --- |
| `--account-id <account_id>` | the account. required. |
| `--games` | also list its active games. |

---

#### CHESS_ELO.TS

the elo leaderboard, **sorted**.

```sh
bun bin/chess_elo.ts --limit 5
```

```json
{
  "ok": true,
  "skip": 0,
  "limit": 5,
  "source": "api",
  "total": 17,
  "elo": [
    { "rank": 1, "account_id": "wspshubham.tg", "elo": 1083.58, "ppp": "55592500", "wins": 7, "losses": 1, "draws": 0, "total_games": 8 }
  ]
}
```

**the api is the default because the contract's own `get_elo_ratings`
answers in STORAGE ORDER.** `--chain` reads the contract's list, for
when the raw order is what is wanted.

| flag | what it does |
| --- | --- |
| `--skip <n>` | the offset. default 0. |
| `--limit <n>` | how many. default 25. |
| `--accounts` | also list every registered account id. |
| `--chain` | read the contract's own list, in storage order. |

---

#### CHESS_CHALLENGES.TS

the open challenges.

```sh
# the platform's pending challenges
bun bin/chess_challenges.ts --limit 25

# one account's own list, from the chain
bun bin/chess_challenges.ts --mine --account-id marior.near
bun bin/chess_challenges.ts --mine --account-id marior.near --challenger
```

```json
{
  "ok": true,
  "count": 2,
  "challenges": [
    {
      "id": "socialgood.near-vs-frichard5.near",
      "challenger": "socialgood.near",
      "challenged": "frichard5.near",
      "wager_token": null,
      "wager_amount": null,
      "status": "pending",
      "game_id": null,
      "created_at": "2024-05-18T18:56:46.561Z",
      "resolved_at": null
    }
  ]
}
```

| flag | what it does |
| --- | --- |
| `--limit <n>` | how many. default 25. |
| `--mine` | read the chain's list for one account. |
| `--account-id <account_id>` | the account. needed with `--mine`. |
| `--challenger` | the sent list rather than the received one. |

---

#### CHESS_PROPOSE_MOVE.TS

build the play_move payload for a human to sign.

```sh
bun bin/chess_propose_move.ts --account kcameau.near --game-id '[206540279,"kcameau.near","crans.near"]'
```

```json
{
  "ok": true,
  "game_id": [206540279, "kcameau.near", "crans.near"],
  "turn_color": "Black",
  "payload": {
    "contractId": "app.chess-game.near",
    "method": "play_move",
    "args": { "game_id": [206540279, "kcameau.near", "crans.near"], "mv": "f7f6" },
    "gas": "150000000000000",
    "deposit": "0"
  },
  "chosen": { "san": "f6", "from": "f7", "to": "f6" },
  "fen": "r1bqkbnr/1p2npp1/p3p2p/2pp4/5P2/PPNBPN2/1BPP2PP/R2QK2R b - - 0 9",
  "fen_source": "api",
  "gas_tgas": 150,
  "what": "play f7f6 in game [206540279,\"kcameau.near\",\"crans.near\"]"
}
```

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account, so the gas follows the right side. |
| `--game-id <json array>` | the game. required, or use the loose flags. |
| `--mv <move>` | the move. without it, the skill picks one. |
| `--network mainnet` | the network. |

**the payload goes to the engine's queue, and a human signs it.** see
[MODES.md](./MODES.md).

---

#### CHESS_REGISTER.TS

build the registration and the agent flag.

```sh
bun bin/chess_register.ts --agent-flag
```

```json
{
  "ok": true,
  "transactions": [
    {
      "contractId": "app.chess-game.near",
      "method": "storage_deposit",
      "args": { "account_id": null, "registration_only": true },
      "gas": "30000000000000",
      "deposit": "50000000000000000000000"
    },
    {
      "contractId": "app.chess-game.near",
      "method": "set_is_agent",
      "args": { "is_agent": true },
      "gas": "10000000000000",
      "deposit": "1"
    }
  ],
  "what": "Register on app.chess-game.near and mark the account as an agent",
  "why": "the registration attaches 0.05 NEAR, and the agent flag is the honest label for an account played by a program"
}
```

| flag | what it does |
| --- | --- |
| `--account-id <account_id>` | register ANOTHER account. omit to register the caller. |
| `--agent-flag` | also build the `set_is_agent` payload. |
| `--no-register` | only the agent flag. |

**the registration attaches 0.05 NEAR**, so it is queued for the human
to sign.

---

#### CHESS_KEY_ADD.TS

show the limited key the agent signs with, and the command to add one.

```sh
bun bin/chess_key_add.ts --account kcameau.near
```

```json
{
  "ok": true,
  "account_id": "kcameau.near",
  "contract_id": "app.chess-game.near",
  "keys": [
    {
      "public_key": "ed25519:...",
      "method_names": [],
      "scope": "every method",
      "held_by_agent": true
    }
  ],
  "has_signing_key": true,
  "commands": {
    "whole_contract": "bun bin/key_queue_add.ts --receiver-id app.chess-game.near --allowance 1000000000000000000000000",
    "narrower": "bun bin/key_queue_add.ts --receiver-id app.chess-game.near --methods play_move,resign,cancel,challenge,accept_challenge,reject_challenge,claim_points,set_is_agent,join_matchmaking,cancel_matchmaking,create_ai_game --allowance 1000000000000000000000000"
  }
}
```

**the allowance covers the prepaid gas**, not the deposit — a 30 Tgas
call needs 0.03 NEAR of it, so an allowance of 0 makes every call fail.

**this bin never signs anything.** the keys skill queues the add_key
and the human approves it.

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account the key is for. required. |

---

#### CHESS_PLAY_MOVE.TS

the agent signs a move.

```sh
bun bin/chess_play_move.ts --account crans.near --game-id '[206540279,"kcameau.near","crans.near"]'
```

```json
{
  "ok": true,
  "game_id": [206540279, "kcameau.near", "crans.near"],
  "mv": "f7f6",
  "chosen": { "san": "f6", "from": "f7", "to": "f6" },
  "gas_tgas": 150,
  "tx_hash": "...",
  "public_key": "ed25519:...",
  "receiver_id": "app.chess-game.near"
}
```

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account the key signs for. required. |
| `--game-id <json array>` | the game. required, or use the loose flags. |
| `--mv <move>` | the move. without it, the skill picks one. |
| `--dry-run` | build the payload and sign nothing. |
| `--network mainnet` | the network. |

**the bin refuses a move that is not the agent's turn**, because the
contract would reject it and a rejected call still costs gas.

---

#### CHESS_MATCH.TS

join the matchmaking queue, or leave it.

```sh
bun bin/chess_match.ts --account kcameau.near --band 200
bun bin/chess_match.ts --account kcameau.near --min-elo 900 --max-elo 1100
bun bin/chess_match.ts --account kcameau.near --leave
```

```json
{
  "ok": true,
  "action": "joined_matchmaking",
  "min_elo": 832.5935807926685,
  "max_elo": 1232.5935807926685,
  "tx_hash": "...",
  "public_key": "ed25519:..."
}
```

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account the key signs for. required. |
| `--band <n>` | the spread around the agent's own rating. default 200. |
| `--min-elo <n>` | the band's lower bound, given directly. |
| `--max-elo <n>` | the band's upper bound, given directly. |
| `--leave` | leave the queue instead of joining it. |
| `--dry-run` | build the payload and sign nothing. |

**the elo test is mutual** — see [DAEMON.md](./DAEMON.md).

---

#### CHESS_CHALLENGE.TS

challenge somebody, accept a challenge, or reject one.

```sh
bun bin/chess_challenge.ts --account kcameau.near --opponent crans.near
bun bin/chess_challenge.ts --account kcameau.near --challenge-id 'a.near-vs-b.near' --accept
bun bin/chess_challenge.ts --account kcameau.near --challenge-id 'a.near-vs-b.near' --reject --challenger
```

```json
{
  "ok": true,
  "action": "challenged",
  "challenge_id": "kcameau.near-vs-crans.near",
  "payload": {
    "contractId": "app.chess-game.near",
    "method": "challenge",
    "args": { "challenged_id": "crans.near" },
    "gas": "30000000000000",
    "deposit": "0"
  },
  "tx_hash": "...",
  "public_key": "ed25519:..."
}
```

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account the key signs for. required. |
| `--opponent <account_id>` | who to challenge. |
| `--challenge-id <id>` | the challenge to accept or reject. |
| `--accept` | accept it. |
| `--reject` | reject it. |
| `--challenger` | on a rejection, the rejecting side is the challenger. |
| `--dry-run` | build the payload and sign nothing. |

**a wagered challenge is never signed here.** a wager is an
`ft_transfer_call` with a token deposit, and it is the human's to
sign.

---

#### CHESS_GAMES.TS

the games the agent has played.

```sh
bun bin/chess_games.ts --limit 50
bun bin/chess_games.ts --live --account kcameau.near
```

```json
{
  "ok": true,
  "games": [
    {
      "game_id": [206540279, "kcameau.near", "crans.near"],
      "opened_at": 1762965400000,
      "closed_at": null,
      "outcome": null,
      "result": null
    }
  ],
  "live": [[206540279, "kcameau.near", "crans.near"]]
}
```

| flag | what it does |
| --- | --- |
| `--limit <n>` | how many. default 50. |
| `--live` | also read the chain for the open games. |
| `--account <account_id>` | the account. needed with `--live`. |

---

#### CHESS_DAEMON.TS

the long-lived autonomous player.

```sh
bun bin/chess_daemon.ts --account kcameau.near --band 200
bun bin/chess_daemon.ts --state
```

see [DAEMON.md](./DAEMON.md) for the whole of it.

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account the daemon plays as. required. |
| `--band <n>` | the spread of the elo band it queues at. default 200. |
| `--no-matchmaking` | do not join the queue on start. |
| `--no-accept` | do not accept challenges. |
| `--agent-decides` | ask an agent to choose the moves. the daemon writes the decision to a file and waits. |
| `--agent-timeout <ms>` | how long it waits for the agent's answer. default 120000. |
| `--state` | read the last written state instead of running. |

---

#### CHESS_DECIDE.TS

the decision package: the position and every legal move, for an agent
to choose from.

```sh
bun bin/chess_decide.ts --game-id '[206540279,"kcameau.near","crans.near"]' --account kcameau.near
```

```json
{
  "ok": true,
  "game_id": [206540279, "kcameau.near", "crans.near"],
  "position": {
    "fen": "r1bqkbnr/1p2npp1/p3p2p/2pp4/5P2/PPNBPN2/1BPP2PP/R2QK2R b - - 0 9",
    "board": ["R  QK  R", " BPP  PP", "PPNBPN  ", "     P  ", "  pp    ", "p   p  p", " p  npp ", "r bqkbnr"],
    "turn": "Black",
    "white": "kcameau.near",
    "black": "crans.near",
    "account_id": "kcameau.near",
    "material": 60
  },
  "game": {
    "has_bets": false,
    "opponent_is_ai": false,
    "moves_played": 8
  },
  "recommended": { "mv": "f7f6", "san": "f6", "from": "f7", "to": "f6" },
  "candidates": [
    { "mv": "f7f6", "san": "f6", "from": "f7", "to": "f6", "score": -12, "rank": 1 }
  ],
  "candidate_count": 19
}
```

**the scores are the program's opinion**, from the side to move's point
of view. they are there so an agent can see what the program thought
before it overrides it.

| flag | what it does |
| --- | --- |
| `--game-id <json array>` | the game. required, or use the loose flags. |
| `--account <account_id>` | the account the agent plays as. required. |
| `--full` | list every candidate. without it only the top ten are listed. |

---

#### CHESS_DECIDE_MOVE.TS

make the move an agent chose. the move is **checked against the legal
list before it is signed**, so an illegal choice costs nothing.

```sh
bun bin/chess_decide_move.ts --game-id '[206540279,"kcameau.near","crans.near"]' --account kcameau.near --mv f7f6
```

```json
{
  "ok": true,
  "game_id": [206540279, "kcameau.near", "crans.near"],
  "mv": "f7f6",
  "san": "f6",
  "gas_tgas": 150,
  "tx_hash": "...",
  "public_key": "ed25519:...",
  "receiver_id": "app.chess-game.near"
}
```

a move that is not legal is refused, with the legal moves listed, and
**nothing is signed**:

```json
{
  "ok": false,
  "error": "\"f7f7\" is not a legal move in this position. it was not sent, and nothing was signed.",
  "legal_moves": ["f7f6", "f7f5", "f7f8", "..."]
}
```

| flag | what it does |
| --- | --- |
| `--game-id <json array>` | the game. required, or use the loose flags. |
| `--account <account_id>` | the account the key signs for. required. |
| `--mv <move>` | the move. the contract's notation, san, or the two squares. |
| `--dry-run` | check the move and build the payload without signing. |

---

#### CHESS_AGENT_DECIDE.TS

the decisions waiting for an agent, and the answer to one.

```sh
bun bin/chess_agent_decide.ts --list
bun bin/chess_agent_decide.ts --id '[206540279,"kcameau.near","crans.near"]' --mv f7f6
```

the id is the request's id, which is the game's json array.

| flag | what it does |
| --- | --- |
| `--list` | the decisions waiting for an answer. |
| `--id <game_id>` | which decision to answer. required. |
| `--mv <move>` | the move to play. checked against the legal moves first. |
| `--note <text>` | why this move. the daemon logs it. |

---

#### CHESS_AGENT_PLAY.TS

the agent itself. it reads the requests the daemon writes, works out
the move, and writes the answer back.

```sh
bun bin/chess_agent_play.ts --play
```

it uses an alpha-beta search with a time budget, so it goes as deep as
it can in the time it has and always returns a move.

| flag | what it does |
| --- | --- |
| `--play` | watch for decisions and answer them. without it, one pass. |

| env | what it does |
| --- | --- |
| `CHESS_AGENT_DEPTH` | the deepest the search goes. default 6. |
| `CHESS_AGENT_BUDGET_MS` | how long the search may take. default 8000. |

---

#### THE TESTS

```sh
bun test
```

the move chooser is tested against known positions. it is the one
piece of this skill that can burn gas silently, so it is the one piece
that is tested.

=====================
<br/>
copyright 2026 by sleet.near
