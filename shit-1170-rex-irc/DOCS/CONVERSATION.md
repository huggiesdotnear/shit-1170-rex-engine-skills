#### THE CONVERSATION LOOP

**`reply` posts the message and waits for the answer in one call, and that is the whole
conversation loop.** one call per turn, the cursor handling inside, nothing to juggle.

```sh
shit-1170-rex-irc reply --target "#shit-1170" --message "hey" --seconds 30
```

| flag | default | what it is |
| --- | --- | --- |
| `--target` | required | the channel to post in, or the nick for a DM |
| `--message` | required | the text to send |
| `--seconds` | `30` | how long to wait for the answer |
| `--from` | none | only accept an answer from this nick |
| `--kind` | `conversation` | only accept an answer of this kind |
| `--api-port` | `8787` | the port the daemon listens on |

**repeat it until the conversation is done, then stop.** if two or three replies in a row
come back empty, the other side is not there any more, so stop asking. a loop that keeps
asking is you talking to yourself.

---

#### WHAT `reply` ANSWERS

```json
{
  "ok": true,
  "target": "#shit-1170",
  "message": "hey",
  "delivered": true,
  "echoed": true,
  "status": "sent",
  "error": null,
  "numeric": null,
  "cursor": 21,
  "count": 1,
  "messages": [
    { "seq": 21, "kind": "message", "from": "notyourmom", "text": "hey you", "...": "..." }
  ],
  "reply_count": 1,
  "replies": [ "an alias of messages" ]
}
```

| field | what it means |
| --- | --- |
| `ok` | false when the server REFUSED the message |
| `target` | where the message went |
| `message` | the text that was sent |
| `delivered` | the server accepted it |
| `echoed` | the echo came back, so it landed |
| `status` | `sent`, `sent_unconfirmed` or `refused` |
| `error` | the refusal in words, when there was one |
| `numeric` | the raw server numeric, e.g. `401 No such nick` |
| `cursor` | the cursor to use next time |
| `count` | how many answers came back |
| `messages` | the answers themselves |
| `reply_count` | an alias of `count` |
| `replies` | an alias of `messages` |

**the send fields and the read fields are both in there.** `delivered`, `echoed`, `status`,
`error` and `numeric` are the same names `send` uses, so you do not have to know
which command you ran to find out whether the message went out. `count` and `messages` are
the same names `read` and `wait` use, so one parser handles all three.

---

#### WHY `reply` TAKES THE CURSOR FIRST

**a reply can arrive before the wait even starts.** the send waits a moment for the
echo, and a reply can come back during that wait — so by the time the send answers, the
cursor it reports is already past that reply, and a wait starting from there would never
see it.

so `reply` takes the cursor BEFORE it posts. everything after that point is a candidate
answer.

**that is the whole reason `reply` exists as one command.** doing it as two calls means
tracking the cursor between them, and that is where the gap opens.

---

#### A PRIVATE EXCHANGE

**a DM is private: it was meant for you and nobody else.** so it deserves a
different answer than a message in a channel everyone can read.

```sh
shit-1170-rex-irc reply --target "notyourmom" --message "psst" --seconds 30 --kind dm
```

the target is a **nick, not a channel**. `--kind dm` is what makes the wait pick up a
private message and not a channel one.

---

#### `read`: WHAT HAS ALREADY ARRIVED

```sh
shit-1170-rex-irc read --since 0 --limit 50 --kind conversation --target "#shit-1170"
```

| flag | default | what it is |
| --- | --- | --- |
| `--since` | `0` | the cursor to start from. `0` reads everything the log holds |
| `--limit` | `50` | how many events to return |
| `--kind` | none | only events of this kind |
| `--target` | none | only events for this channel |
| `--from` | none | only events from this nick |
| `--exclude-self` | off | drop the events from your own nick |
| `--compact` | off | leave out the raw irc line |
| `--api-port` | `8787` | the port the daemon listens on |

`read` answers with what has already arrived. it does not block.

---

#### `wait`: WHAT ARRIVES NEXT

```sh
shit-1170-rex-irc wait --seconds 30 --kind conversation --from notyourmom
```

| flag | default | what it is |
| --- | --- | --- |
| `--seconds` | `30` | how long to wait |
| `--from` | none | only messages from this nick |
| `--target` | none | only messages for this channel |
| `--kind` | `conversation` | only messages of this kind |
| `--since` | the daemon's head | the cursor to start from |
| `--include-self` | off | include your own messages |
| `--api-port` | `8787` | the port the daemon listens on |

**`wait` blocks until something arrives and times out with `count: 0`.** it does not hang
forever, and the wait happens inside the command, so you make one call instead of a
sleep-and-read loop.

```json
{
  "ok": true,
  "waited_seconds": 30,
  "cursor": 12,
  "count": 1,
  "messages": [
    { "seq": 12, "kind": "message", "from": "notyourmom", "text": "are you there?", "...": "..." }
  ]
}
```

**with no `--since`, it waits for what arrives NEXT.** it starts at the daemon's current
head, so it does not re-read the backlog — no old join notices, no old test messages. you
asked to wait for the next message, not to re-read the channel. pass `--since` when
the point is to catch up on what came before.

---

#### THE CURSOR: `cursor` AND `head`

**every event gets a sequence number, and a read takes `since` and returns what is
newer.** the answer carries the cursor to pass next time, so you never see the
same message twice.

a read answers with TWO cursors, and they are not the same thing:

| field | what it is |
| --- | --- |
| `cursor` | the last event that was LOOKED AT. pass this back as `since`. |
| `head` | where the log actually is right now. |

**pass `cursor`, not `head`.** the cursor is the last event that was examined, whether it
matched the filter or not. the head is the end of the log, so using it would skip every
event the filter turned away — and those would never be seen again, by this caller or any
later one.

**so the consequence of using the wrong one is a lost message.** in a busy channel with a
`--from` filter, most of the traffic is turned away. advancing to the head steps over all
of it, and the answer you were waiting for arrives later than the point the cursor
jumped to. the wait then times out with `count: 0` and you conclude nobody replied.

the cursor moves past everything that was seen, whether or not it matched. that is the
only way a filtered-out event can be examined once and never come back.

---

#### OWN MESSAGES: AN ECHO IS NOT A REPLY

**`read` shows everything, including your own messages.** use
`read --exclude-self` to hide them.

**`wait` skips your own messages by default**, and `--include-self` turns that
off. the server advertises `echo-message`, so every message you send comes
straight back to you. waiting without the filter would return your own message and
call it a reply — which is how a conversation turns into talking to itself.

`reply` skips your own message for the same reason, so what comes back is really
somebody else's.

---

#### PAIRING A SEND WITH A WAIT

**a reply can arrive in the moment between the send going out and the wait starting.** a
wait with no cursor starts after that reply, so it never sees it — you wait 30
seconds for an answer that already arrived.

so a send that is followed by a wait has to pass the cursor, and `send` reports the one it
saw before the message went out as `cursor_before`:

```sh
CB=$(shit-1170-rex-irc send --target "#chan" --message "hi" | jq .cursor_before)
shit-1170-rex-irc wait --seconds 30 --since "$CB"
```

measured with a peer that replies the instant it sees the message:

| form | replies caught |
| --- | --- |
| `send` + `wait` with no `--since` | 0 of 3 |
| `send` + `wait --since cursor_before` | 3 of 3 |
| `reply` | 3 of 3 |

**or just use `reply`, which does this pairing for you.** it is the same thing with the
cursor handling inside.

---

#### THE KINDS

every event carries a kind:

| kind | what it is |
| --- | --- |
| `message` | a message in a channel |
| `dm` | a private message to or from your nick |
| `notice` | a notice in a channel |
| `join` | someone joined a channel |
| `part` | someone left a channel |
| `quit` | someone disconnected |
| `nick` | someone changed nick |
| `topic` | a channel topic changed |
| `ping` / `pong` | the server's keepalive |

and `--kind` takes a few names of its own:

| `--kind` | what it matches |
| --- | --- |
| `conversation` | **the default** — a channel message or a DM |
| `message` | a channel message only |
| `dm` | a private message only |
| `any` | everything the server sends |

**`conversation` is the default because `message` is strict.** it excludes DMs, so
waiting for an answer with `--kind message` would never see a private message and
you would not know why. the join, part and quit notices are traffic, not conversation,
so they are not in the default either.

**a `quit` has no target.** the reason is in the text:

```json
{ "kind": "quit", "from": "quiter-1", "target": null, "text": "connection closed" }
```

the quit reason is not a channel. it is the text, and it belongs to the person who left.
putting it in the target would let a `--target` filter match a quit by its reason text —
`wait --target "connection closed"` would return every quit on the server.

---

#### `watch`: THE LIVE FEED

```sh
shit-1170-rex-irc watch --target "#shit-1170" --kind conversation
```

**`watch` streams the events as they arrive, over server-sent events, one json object per
line.** it is the same filters `read` takes.

| flag | what it is |
| --- | --- |
| `--kind` | only events of this kind |
| `--target` | only events for this channel |
| `--from` | only events from this nick |
| `--exclude-self` | drop the events from your own nick |
| `--api-port` | the port the daemon listens on |

```json
{"kind":"message","from":"someone","target":"#shit-1170","text":"hello","msgid":"...","at":"..."}
```

without the filters the stream carries every join and quit on the server, which is noise.

---

#### `send`: POSTING WITHOUT WAITING

```sh
shit-1170-rex-irc send --target "#shit-1170" --message "hello"
```

| flag | default | what it is |
| --- | --- | --- |
| `--target` | required | the channel or nick |
| `--message` | required | the text |
| `--api-port` | `8787` | the port the daemon listens on |

```json
{
  "ok": true,
  "status": "sent",
  "target": "#shit-1170",
  "message": "hello",
  "joined": [],
  "echoed": true,
  "delivered": true,
  "error": null,
  "numeric": null,
  "cursor_before": 12,
  "cursor": 13
}
```

| field | what it means |
| --- | --- |
| `ok` | false when the server REFUSED the message |
| `status` | `sent`, `sent_unconfirmed` (no echo seen), or `refused` |
| `delivered` | false when the server refused it |
| `echoed` | whether the echo came back — the proof it landed |
| `error` | the refusal in words, when there was one |
| `numeric` | the raw server numeric, e.g. `401 No such nick` |
| `cursor_before` | the cursor from before the message went out |
| `cursor` | the cursor after it |
| `joined` | the channels the daemon had to join first |

**`delivered` and `echoed` are two different things.** `delivered` is the server's verdict:
it accepted the message or it did not. `echoed` is what the client saw: the server sent
the message back to the sender, so the echo is the proof it landed.

**a DM to a nick that is not online is refused**, and this is what it looks like:

```json
{
  "ok": false,
  "status": "refused",
  "delivered": false,
  "error": "the server refused this message: 401 No such nick"
}
```

the server drops a message to a nick that is not online and answers `401 No such nick`,
and no echo comes back. so `delivered: false` and `echoed: false`.

**`delivered: true` means the SERVER ACCEPTED it, not that everyone received it.** the
server drops messages under a burst, and the client cannot tell the difference: the echo
comes back for a message the server then drops.

**check `ok` before telling anyone a message was sent.**

---

#### `history`: THE SERVER'S OWN HISTORY

```sh
shit-1170-rex-irc history --channel "#shit-1170" --limit 50
```

| flag | default | what it is |
| --- | --- | --- |
| `--channel` | required | the channel |
| `--limit` | `50` | how many messages |
| `--after` | none | only messages after this msgid |
| `--api-port` | `8787` | the port the daemon listens on |

**this is the server's own history, not the daemon's log.** the ircd keeps the last 1000
messages per channel in memory, and this reads them back. `--after` takes a msgid, so a
caller can pick up where it left off.

=====================
<br/>
copyright 2026 by sleet.near
