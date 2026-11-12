# DAEMON

the daemon as a long-lived process: the ping it answers, the reconnect it makes,
the gap it fills, and the concurrency it survives.

**the daemon is the connection.** every client subcommand is a short http call, so
nothing would be listening while you were away — and an irc session that
has been dropped is gone. the daemon holds the socket open so you can read
a channel while you post to it, over one connection.

---

#### WHY A DAEMON

**the ircd pings the client after 90 seconds of silence and drops it 60 seconds
later.** the config says:

```yaml
idle-timeouts:
    registration: 60s
    ping: 1m30s
    disconnect: 2m30s
```

measured against the running server:

| client | what happened |
| --- | --- |
| silent | dropped at about **150 seconds** |
| answering the ping | still connected at **220+ seconds** |

**a client that does not answer the ping is disconnected with
`Ping timeout: 2m30s`.** so a long-lived connection is only possible if something
answers.

**the daemon answers every `PING` with a `PONG`.** the token in the ping is the
pinged client's own nick, so the answer is `PONG <our nick>`.

**if the ping handling changes, the daemon changes, not the server config.** the
server's timeouts are not something a client can negotiate, and the whole design
rests on the connection surviving a quiet channel.

---

#### THE RECONNECT, AND WHAT IT DOES NOT LOSE

**a long-lived connection dies for reasons that are not your fault:** the
tunnel drops it, the network blinks, the ircd restarts. the daemon reconnects with
a backoff — 1 second, doubling, to a maximum of 30 seconds — and the backoff
resets when a connection succeeds.

then it asks for what it missed:

```text
CHATHISTORY AFTER <channel> msgid=<the last msgid we saw> 100
```

**the ircd keeps the last 1000 messages per channel in memory** — that is what the
`CHATHISTORY=1000` token in the ISUPPORT says — so a reconnect that was not too
long loses nothing.

the server answers with a `BATCH`, and the messages inside it are put back into the
log. **messages already seen are NOT recorded twice.** the ircv3 `msgid` is what
says so: it is the identity of a message, so a message whose msgid is already in
the log is not news.

**the gap fill only asks about the channels the client is in**, and only for the
first 20 of them. asking about a channel it is not in gets `FAIL CHATHISTORY
INVALID_TARGET` from the server, and the server answers every request — so asking
about a hundred channels means a hundred failures to sort through.

**the gap fill runs after the re-join**, because it asks about channels the client
is in, and right after a drop it is in none of them until it joins.

---

#### THE DAEMON REJOINS THE CHANNELS IT WAS IN

**the server forgets the client when the socket dies, so the client has to forget
too: the channel list is cleared when the socket dies.**

keeping it would be wrong. the reconnect would look at the list, see the channels
still in it, skip the `JOIN`, and go on believing it was in channels it was not in.
every message to them would come back `403 No such channel`, and nothing would
recover it — a client that hit one network blip could never talk to anyone again.

**there is a second safety net: a `403 No such channel` drops the channel from the
list.** so the next send joins it again. the belief is dropped the moment the
server contradicts it.

---

#### THE RECONNECT IS VISIBLE

`status` reports the connection health:

```json
{ "connected": true, "reconnects": 1, "uptime_seconds": 842 }
```

**the counter goes up on every successful connection, including the first**, so a
fresh daemon reports `reconnects: 1`.

**a rising `reconnects` is the first thing to look at when messages stop
arriving.** each drop is a window where messages were not being read, and the
counter is the only place that window shows up.

---

#### MANY SENDS AT ONCE

**the daemon handles concurrent sends.** ten of them at the same time take about
three seconds, all ten are delivered, and all ten see their own echo.

**the reason is the shape of the read loop.** the read loop is the only thing that
reads the socket. a command sends and answers straight away, and the caller waits
for the answer in the log. so several commands can be in flight without any of
them blocking the reading — and the reading is the only way an answer can arrive
at all.

**the server's fakelag is the limit, not the client.** ergo allows a couple of
messages a second and delays the rest, so a burst of ten sends gets its echoes
back over a second or two. **the wait window extends while things are still
arriving** — every new message pushes the deadline out, up to a cap — so a delayed
echo is still reported as delivered.

| | before | after |
| --- | --- | --- |
| ten concurrent sends | 12.2s, one at a time | **2.9s** |
| of those, echoed | 1 | **10** |

---

#### ONE READER, AND THE COMMANDS DO NOT WAIT

**a websocket is one stream.** if two tasks read it, they race, and each frame goes
to one of them. a command that sends `JOIN` and then waits for the `JOIN` echo
would be waiting for a frame the other task took.

so the read loop owns the socket: it reads, and it serves the commands.

**but a command must not WAIT inside the read loop.** the read loop holds the
connection lock while it waits for the server, and a command needs that lock to
send. so a command that waited there would block the reading — and the answer it
was waiting for could never be read. that is what made joins time out even though
the join had plainly happened: the command was waiting for an echo that the read
loop was not allowed to read.

so the split is:

| what | where it happens |
| --- | --- |
| reading the socket | the read loop, and only the read loop |
| putting every line in the log | the read loop |
| sending a line | a command, which answers straight away |
| waiting for the answer | the caller, in the log — a different lock |

---

#### THE TWO COUNTERS ARE SEPARATE

**the event log counts events. the raw list counts every line the server sent.**

a command's answer lives in the raw list: the echo of a `PRIVMSG`, or a numeric.
the event log holds the events with their own sequence numbers, and it is a
different space.

**mixing them up means a command looks in the wrong place for its answer and
reports no echo at all.** a command notes the raw counter before it sends, and
looks for the answer after it. a cursor from the event log would point into the
raw list at an unrelated line, and the answer would never be found.

the two lists are bounded, so a daemon that runs for days does not grow without
limit: the raw list keeps 5000 lines and the event log keeps 20000 events.

---

#### THE ECHO IS MATCHED BY ITS TEXT

**the server echoes a `PRIVMSG` back with the same text**, because it advertises
`echo-message`. that text is what tells this command's echo apart from another
command's.

**without it the first command to see any echo would claim it, and the rest would
report none.** a `PRIVMSG` from somebody else is not the answer to a command — it
is traffic that happened to arrive while the command waited — so it must not end
the wait either.

so the echo is matched on all three: it is a `PRIVMSG`, it is from our own nick,
and its text is the text that was sent.

---

#### JOINING A CHANNEL YOU ARE ALREADY IN

**the server does not echo a `JOIN` for a channel the client is already in.** it
just ignores it.

**so a join that waits for the echo waits forever.** the daemon checks the channel
list first and returns at once.

**the same goes for `PART` on a channel the client is not in.** the server would
not echo that either, so there would be nothing to wait for.

---

#### THE PREFIX IS `nick!ident@host`

**not the bare nick.** the prefix of a message from a client is
`nick!ident@host`, and comparing the whole prefix with the nick never matches.

**the consequence is that the channel list stays empty**, so every "am I in this
channel?" check fails — and that check is what the join, the part and the send
all depend on.

the nick is the part before the `!`:

```rust
let prefix_nick = message
    .prefix
    .as_ref()
    .map(|prefix| prefix.split('!').next().unwrap_or(prefix).to_lowercase());
```

and it is compared with our own nick, lowercased on both sides, because IRC nicks
are case-insensitive.

=====================
<br/>
copyright 2026 by sleet.near
