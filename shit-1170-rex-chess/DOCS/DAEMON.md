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

#### THE REPETITION

**the contract has NO repetition rule.** a position seen three times
does not end the game — it just goes on, forever. an agent that loops
plays forever and never wins.

so the daemon keeps a record of the positions each game has been
through, and the chooser treats a move that returns to one of them as
worth less.

**the record holds BOTH sides' positions.** that is the whole trick,
and it was a bug for a long time.

the chooser penalises a candidate move by looking at the position the
move **leads to** — and the position a move leads to is, by
construction, a position where the **opponent** is to move. so a
daemon that recorded only the positions where *it* was to move held a
set that could never contain the target of any of its own candidates,
and the repetition penalty could never fire, no matter how big it
was.

on the live mainnet game `[224274147,"sleet.near","sleet-ai.near"]` the
daemon shuffled its rook between **c8 and d8** for twenty moves,
spending about **0.03 NEAR** each time, because nothing ended the
loop.

so the daemon now records **every position it observes**, on every
pass, whichever turn it is. the record and the turn check are one
function, so that a change that puts the check first is not easy to
make by accident.

the seen set is also the **union** of two sources:

- the **api's history**, which covers the whole game but is an index,
  and an index can lag behind the chain — then it has nothing at all;
- the **daemon's own record**, which is always there but only holds
  what the daemon happened to observe.

neither one alone is the whole game, and choosing between them throws
half of it away. a position in either one is a position the game has
been through.

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

`played_move` carries `landed_without_answer` — true when the move went
through but the rpc never said so. see THE SAFE SEND below.

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
| `--decides-itself` | choose the moves on its own instead of asking an agent. |
| `--agent-timeout <ms>` | how long it waits for the agent's answer. default 120000. |
| `--all-games` | play every open game. the default is ONE game at a time. |

**the daemon asks an agent to choose the moves by default.** see THE
AGENT DECIDES below. `--decides-itself` is the opt-out, for when there
is no agent to ask.

---

#### ONE GAME AT A TIME

**the daemon plays one game, and leaves the others alone.**

the contract allows **five active games** per account, and nothing
stops a daemon from having all five of them. that is rarely what
anybody wants: five games means five games to follow, and the agent's
attention is split across them. the daemon asks for a decision on
every game it is playing, so five games means five requests every
fifteen seconds.

so the daemon plays the first game it has and stops there. the others
are **not** resigned — they stay open on the contract, and they are
still there when the daemon comes back to them.

`--all-games` plays every open game instead.

---

#### THE SAFE SEND

**a failed send is not proof that the move did not land.**

the rpc answers with HTTP 429 when it is rate-limited, and it
sometimes does that AFTER the transaction has already gone through. the
move is on the chain, and the answer that says so never arrived.

that leaves two bad options:

- treating it as a failure and retrying sends the SAME MOVE TWICE. a
  move played twice is a move the contract refuses, and a refused move
  is a failed transaction that still costs gas.
- treating it as a success leaves the caller not knowing whether the
  move happened.

so the send is checked against the chain. the position is read before
the call, and if the call throws, the position is read again. if it
moved on, the move landed and the answer was merely lost. only when
the position did NOT move is the call retried.

the log says which happened: `landed_without_answer` is true when the
move went through and the answer did not.

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

**by default the daemon proposes, and lets an agent choose.**

```sh
bun bin/chess_daemon.ts --account kcameau.near --agent-timeout 300000
```

the split is deliberate:

- choosing a **legal** move is mechanical. `chess.js` already knows
  about check, pins, stalemate and the rest.
- choosing a **good** move is judgement. which move to play against an
  opponent that is shuffling its king is not a search question.

so this is the DEFAULT, and the daemon does not choose on its own. it
writes the position and the legal moves to a file, and waits:

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

#### DECIDING BY ITSELF

**`--decides-itself` turns the asking off, for when there is no agent
to ask.**

```sh
bun bin/chess_daemon.ts --account kcameau.near --decides-itself
```

the daemon then plays the program's own choice: the same search the
skill has always used, with the endgame knowledge and the repetition
avoidance added to it.

the old `--agent-decides` flag is still accepted. it was the way to
turn this ON, and it is now the default, so it does nothing on its
own — it is kept so that an old command line does not break.

---

#### THE PAUSE

**the contract can be paused.** every call fails with
`"Contract is paused"` while it is. the daemon logs the failure and
keeps watching — it does not spin on a call that cannot succeed.

=====================
<br/>
copyright 2026 by sleet.near
