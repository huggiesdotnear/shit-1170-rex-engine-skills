# DAEMON

the daemon as a long-lived process: the stream it holds, the heartbeat
it watches, the reconnect it makes, and the games it plays.

---

#### WHY A DAEMON AT ALL

**the daemon is the connection.** the protocol pawns api serves an
event stream at `GET /events?account={account_id}`, and it pushes
`create_game`, `play_move`, `resign_game`, `cancel_game`,
`challenge`, `accept_challenge` and `reject_challenge` as they happen.

a one-shot command that polls would work, but it would be polling: it
would ask the chain what it already knew, on a timer, forever.

**the daemon holds the stream open and reacts to what arrives.** the
game comes to the agent.

---

#### WHY IT IS NOT A SERVER

the irc skill's daemon IS a server. it holds the irc connection open
**and** serves an http api, because a human has to talk to it *while*
it holds the connection — read a channel while posting to it, over
one socket.

**the chess daemon has nobody to talk to.** it watches, it decides, it
plays. nothing needs to reach it mid-game.

so it is the irc daemon's **daemon half without the api half**. there
is no http api, no hono, and no port to fight over.

**its state is a file.** that is how a human — or another bin — finds
out what it is doing:

```sh
bun bin/chess_daemon.ts --state
```

```json
{
  "ok": true,
  "running": true,
  "state": {
    "account_id": "kcameau.near",
    "updated_at": 1762965482113,
    "status": "watching",
    "band": 200,
    "connected": true,
    "reconnects": 0,
    "current_game": null,
    "active_games": [],
    "last_event": "heartbeat",
    "last_error": null
  }
}
```

the `status` is one of `starting`, `watching`, `playing`,
`reconnecting` or `stopped`.

---

#### THE LOOP

1. open the stream for the account
2. on `play_move` — read the game, and move if it is the agent's turn
3. on `create_game` — the contract paired the agent with an opponent.
   play the game.
4. on `challenge` — **accept it**. autonomous mode plays every game
   it can. a challenge **with a wager** is skipped: a token deposit
   moves money, and the human signs every one of those.
5. on `heartbeat` — the stream is alive
6. on `resign_game` or `cancel_game` — close the game in the history
7. on a disconnect — reconnect with a backoff

**the daemon does not poll for a match.** it joins the matchmaking
queue once, and the contract's `create_game` event arrives on the
stream it is already watching. so matchmaking and playing need **one
connection**, not two.

---

#### THE POLL

**the daemon also asks the chain, every fifteen seconds.**

the stream is the fast path, and the chain is the truth. the api's
indexer can stop delivering game events for an account — the stream
keeps sending heartbeats and nothing else — and a daemon that only
listens to the stream then sits there with a game waiting on it.

so on every tick the daemon reads the account's active games off the
chain, and for each one whose turn it is, it plays. the poll is a
**safety net under the stream**, not a replacement for it: when the
stream works, the poll finds nothing to do and costs one view call.

the poll does not change what a game is, or who is to move — it reads
the same board the stream would have told it about.

---

#### THE HEARTBEAT

**the api sends a heartbeat every five seconds.** one is missing for
about **ten seconds** and the stream is dead.

the daemon treats every event — heartbeat included — as proof of life,
and rebuilds the stream when it breaks. a stream that dies silently
is the failure that matters, because the agent would simply stop
playing and nothing would say why.

---

#### THE RECONNECT

a long-lived connection dies for reasons that are not the agent's
fault: the api restarts, the network blinks, a tunnel drops.

**the backoff is one second, doubling, to a maximum of thirty**, and
it resets when a connection succeeds.

```text
1s → 2s → 4s → 8s → 16s → 30s → 30s → ...
```

the `reconnects` counter in the state file says how many times the
stream has been rebuilt.

---

#### THE BAND

the daemon joins the matchmaking queue **once**, at the start.

the band is the agent's **own rating ± the spread**, and `--band` is
the spread. default 200.

**the elo test is MUTUAL.** the agent's band and the opponent's band
must both accept the other player:

```text
joiner_elo >= entry.min_elo && joiner_elo <= entry.max_elo
  && queued_elo >= min_elo && queued_elo <= max_elo
```

so a band of `900–1100` does **not** match a `1200` opponent, even if
that opponent's band is wide. **a band is an agreement between two
players, not a search range.**

a narrow band finds a fair opponent and can leave the agent queued
for an hour, until the entry expires. a wide one finds a match fast
and plays a weaker opponent.

**the band only governs matchmaking.** a challenge from somebody
outside the band is still played — the agent does not refuse people
because their elo does not fit.

---

#### THE GAMES

**the daemon accepts every challenge it can, and plays every game the
queue pairs it in.** that is what autonomous mode means.

the contract allows **5 active games**. the daemon plays them all, and
the history in `games.sqlite` keeps track of which are open.

the history:

```sh
bun bin/chess_games.ts
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
  ]
}
```

---

#### THE STORE

```text
${HOME}/.shit-1170-rex-engine/chess/
├── daemon.json      # what the daemon is doing right now
├── daemon.lock      # the claim that says one daemon plays this account
├── log.jsonl        # one line per event
└── games.sqlite     # the games it plays, and how they went
```

the log is a **jsonl** file, because the daemon appends to it while it
runs and a json file would be rewritten whole on every line.

```json
{"at":1762965482113,"event":"played_move","detail":{"game_id":[206540279,"kcameau.near","crans.near"],"mv":"f7f6","san":"f6","gas_tgas":150,"tx_hash":"..."}}
{"at":1762965482200,"event":"joined_matchmaking","detail":{"min_elo":832.6,"max_elo":1232.6,"elo":1032.6}}
```

the events are `joined_matchmaking`, `already_queued`,
`matchmaking_failed`, `accepted_challenge`,
`challenge_skipped_wagered`, `played_move`, `play_failed`,
`poll_failed`, `stream_error` and `no_legal_move`.

`already_queued` means the account already had a queue entry open —
from an earlier run, or a previous daemon that was not stopped — so
the daemon left it alone instead of asking for a second one. the
contract refuses a second entry.

when the daemon is asking an agent, three more events appear:
`asked_agent`, `agent_played_move` and `agent_no_answer`. and
`agent_move_illegal` when the answer named a move that is not legal.

the folder is `0700` and the files are `0600`. the state is not a
secret the way the keys store is, but it says which account the agent
is playing as.

---

#### RUNNING IT

put it in a tmux session and leave it up:

```sh
tmux new -s chess
bun bin/chess_daemon.ts --account kcameau.near --band 200
```

**the key is looked up before anything else.** a missing key is said
plainly and the daemon refuses to start — the human has to sign the
`add_key` first. that is deliberate: a daemon that starts without a
key and then fails on every move is worse than one that refuses.

```json
{
  "ok": false,
  "error": "no key for app.chess-game.near was offered to kcameau.near. the human signs the add_key — the keys skill queues it with key_queue_add.ts --receiver-id app.chess-game.near."
}
```

the flags:

| flag | what it does |
| --- | --- |
| `--account <account_id>` | the account the daemon plays as. required. |
| `--band <n>` | the spread of the elo band it queues at. default 200. |
| `--no-matchmaking` | do not join the queue on start. |
| `--no-accept` | do not accept challenges. |
| `--state` | read the last written state instead of running. |

---

#### THE LOCK

**one daemon plays one account.** the daemon claims `daemon.lock` when
it starts, and a second daemon on the same account refuses to start
and says which pid holds it.

the reason is the race. two daemons on one account each read the
board, each pick a move, and each send it. the contract checks the
move against the board as it is at the moment the move lands, so one
of the two moves is stale, and the contract refuses it with "Illegal
move" — a failed transaction that still costs gas.

a lock left behind by a daemon that died is taken over rather than
blocking the account forever, so a crash does not need a human.

---

#### THE AGENT DECIDES

**the daemon can be told to propose, and let an agent choose.**

```sh
bun bin/chess_daemon.ts --account kcameau.near --agent-decides --agent-timeout 300000
```

the split is deliberate:

- choosing a **legal** move is mechanical. `chess.js` already knows
  about check, pins, stalemate and the rest.
- choosing a **good** move is judgement. which move to play against an
  opponent that is shuffling its king is not a search question.

so in this mode the daemon does not choose. it writes the position
and the legal moves to a file, and waits:

```text
${HOME}/.shit-1170-rex-engine/chess/decisions/
├── [206540279,"kcameau.near","crans.near"].request.json
└── [206540279,"kcameau.near","crans.near"].answer.json
```

an agent reads the request, decides, and writes the answer:

```sh
bun bin/chess_agent_decide.ts --list
bun bin/chess_agent_decide.ts --id '[206540279,"kcameau.near","crans.near"]' --mv f7f6
```

**the answer is checked against the legal list before it is signed.**
an answer that names a move the contract would reject is refused, and
the daemon plays its own move instead. that is the point of the
split: a wrong answer costs nothing, because it never reaches the
chain.

**if nobody answers in time, the daemon plays its own move.** a game
that waits for an agent that is not there is a game that never ends.

`chess_agent_play.ts` is a working agent: it reads the requests,
searches with alpha-beta under a time budget, and answers them.

---

#### THE PAUSE

**the contract can be paused.** every call fails with
`"Contract is paused"` while it is. the daemon logs the failure and
keeps watching — it does not spin on a call that cannot succeed.

=====================
<br/>
copyright 2026 by sleet.near
