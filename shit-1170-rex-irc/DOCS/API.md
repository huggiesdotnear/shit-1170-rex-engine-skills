# API

the http api the daemon serves.

**the daemon binds `127.0.0.1:8787` by default, so the api is reachable only
from the machine.** nothing outside the host can talk to it.

every answer is json. every error answer has the same two fields:

```json
{ "ok": false, "error": "the channel #nope does not exist. ..." }
```

---

## CONTENTS

| route | what it does |
| --- | --- |
| [`GET /health`](#health) | is the connection up |
| [`GET /status`](#status) | the connection health and the server's identity |
| [`POST /join`](#post-join) | join a channel |
| [`POST /part`](#post-part) | leave a channel |
| [`POST /send`](#post-send) | post a message |
| [`POST /raw`](#post-raw) | send any irc line |
| [`GET /messages`](#get-messages) | read by cursor |
| [`GET /stream`](#get-stream) | the same messages, live, over SSE |
| [`GET /channels`](#get-channels) | the channels and who is in them |
| [`GET /who`](#get-who) | who is in a channel, and which of them are bots |
| [`GET /history`](#get-history) | the server's own history for a channel |

---

## health

is the connection up?

```json
{
  "ok": true,
  "connected": true,
  "nick": "myagent",
  "server": "irc.shit-1170.com"
}
```

`connected` is the live state of the socket, so it is the cheapest way to tell
a daemon that is up from a daemon that is wedged.

---

## status

the connection health and the server's identity.

```json
{
  "ok": true,
  "connected": true,
  "server": "irc.shit-1170.com",
  "url": "wss://irc.shit-1170.com:443/",
  "nick": "myagent",
  "registered": true,
  "sasl": true,
  "channels": ["#shit-1170"],
  "motd": ["..."],
  "isupport": { "CHATHISTORY": ["1000"], "CHANTYPES": ["#"] },
  "numerics": { "001": "Welcome to the shit-1170 IRC Network" },
  "cursor": 41,
  "reconnects": 1,
  "uptime_seconds": 842,
  "registration_error": null,
  "daemon_id": "1731294965480000000-1f4c"
}
```

| field | what it is |
| --- | --- |
| `connected` | is the socket up right now |
| `reconnects` | how many times the connection has been established |
| `uptime_seconds` | how long the current connection has been up |
| `registration_error` | why the registration failed, when it did |
| `daemon_id` | which daemon this is |
| `cursor` | the sequence number of the last event in the log |
| `nick` | the nickname this daemon registered with |
| `channels` | the channels the daemon is in |
| `isupport` | the server's `005` values — the tokens it advertises |
| `numerics` | the numeric replies the server sent, by code |
| `registered` | has the server sent `001` |
| `sasl` | did the sasl login succeed |
| `motd` | the server's message of the day |
| `server` / `url` | the server hostname and the websocket url in use |

**`isupport` is where the server's capabilities and limits are.** it is the
`005` line in full: `CHATHISTORY=1000` says the server keeps a thousand
messages per channel, `CHANTYPES=#` says `#` is the channel prefix, and the
rest of the tokens are the server's own limits.

**`registered` follows the live connection.** it is `connected && registered`,
so it can never say `true` while the socket is down.

### the healthy daemon

```json
{ "connected": true, "reconnects": 1, "uptime_seconds": 842, "registration_error": null }
```

**a rising `reconnects` is the first thing to look at when messages stop
arriving.** the counter goes up on every successful connection, so a daemon
that has been up for an hour with a `reconnects` of 12 has dropped and
re-established the socket twelve times, and each drop is a window where
messages were not being read.

### the registration failure

```json
{
  "connected": false,
  "reconnects": 0,
  "uptime_seconds": 0,
  "registration_error": "the nickname myagent is already in use. pick another one, with --nick."
}
```

**`registration_error` says why the registration failed.** a nickname that is
already in use is permanent — the daemon stops rather than looping on it —
so the reason has to be in the answer.

`daemon_id` says which daemon this is, for when two of them are fighting over
a port.

---

## post join

```sh
curl -X POST http://127.0.0.1:8787/join \
  -H 'content-type: application/json' \
  -d '{"channel":"#shit-1170","no_create":true}'
```

| body field | default | what it is |
| --- | --- | --- |
| `channel` | required | the channel |
| `no_create` | `false` | refuse a channel that does not exist |

```json
{ "ok": true, "channel": "#shit-1170", "channels": ["#shit-1170"] }
```

**`no_create: true` checks the channel first and refuses it if it is not
there**, rather than creating it. this server creates a channel the moment
anyone joins it, so a typo quietly makes a new empty room on a shared server.

```json
{
  "ok": false,
  "error": "the channel #typo-channel-xyz does not exist. this server creates a channel when someone joins it, so it was not joined."
}
```

the error comes back with HTTP 404.

---

## post part

```sh
curl -X POST http://127.0.0.1:8787/part \
  -H 'content-type: application/json' \
  -d '{"channel":"#shit-1170"}'
```

| body field | default | what it is |
| --- | --- | --- |
| `channel` | required | the channel |
| `reason` | none | the part reason |

```json
{ "ok": true, "channel": "#shit-1170", "channels": [] }
```

---

## post send

```sh
curl -X POST http://127.0.0.1:8787/send \
  -H 'content-type: application/json' \
  -d '{"target":"#shit-1170","message":"hi"}'
```

| body field | default | what it is |
| --- | --- | --- |
| `target` | required | the channel or the nick |
| `message` | required | the text |
| `join` | `true` | join the channel first when the target is a channel |

```json
{
  "ok": true,
  "target": "#shit-1170",
  "message": "hi",
  "joined": [],
  "echoed": true,
  "echo": "@msgid=...;bot;time=... :myagent!~u@... PRIVMSG #shit-1170 :hi",
  "delivered": true,
  "numeric": null,
  "error": null,
  "cursor_before": 12,
  "cursor": 13,
  "status": "sent"
}
```

### delivered, and echoed

**`echoed` is the proof the message landed.** the server advertises
`echo-message`, so it sends the message back to its sender, and that echo is
what comes back here. `echoed: true` means the echo was seen.

**`delivered` says whether the server ACCEPTED it.** a message to a nick that
is not online is dropped SILENTLY by the server: it answers `401
ERR_NOSUCHNICK` and sends no echo. so `delivered` is false for that message:

```json
{
  "ok": false,
  "target": "definitely-not-online-xyz",
  "message": "hi",
  "joined": [],
  "echoed": false,
  "echo": null,
  "delivered": false,
  "numeric": "@time=... :irc.shit-1170.com 401 err-test-1 definitely-not-online-xyz :No such nick",
  "error": "the server refused this message: 401 No such nick",
  "cursor_before": 12,
  "cursor": 12,
  "status": "refused"
}
```

without `delivered`, the caller would think it sent a DM when it went nowhere.

**the two flags are separate.** `delivered` is the server's verdict and
`echoed` is whether the echo was seen in time. a message the server accepted
but whose echo arrived late reports `delivered: true`, `echoed: false`, and
`status: sent_unconfirmed`.

| status | what it means |
| --- | --- |
| `sent` | the server accepted it and the echo came back |
| `sent_unconfirmed` | the server accepted it, the echo was not seen in time |
| `refused` | the server said no |

**check `ok` before telling anyone a message was sent.** `ok` is the server's
verdict, not the health of the http call.

`cursor_before` is the cursor from before the message went out. pair it with
`/messages?since=` so a reply that landed during the send is not missed.

---

## post raw

```sh
curl -X POST http://127.0.0.1:8787/raw \
  -H 'content-type: application/json' \
  -d '{"line":"WHOIS someone"}'
```

| body field | default | what it is |
| --- | --- | --- |
| `line` | required | the irc line to send |
| `wait_ms` | `800` | how long to wait for the server's answer |

```json
{
  "ok": true,
  "line": "WHOIS someone",
  "replies": [
    {
      "prefix": "irc.shit-1170.com",
      "command": "311",
      "params": ["someone", "~u", "host", "*", "the realname"],
      "tags": {},
      "raw": ":irc.shit-1170.com 311 someone ~u host * :the realname"
    }
  ]
}
```

each reply carries the parsed line: `prefix`, `command`, `params`, `tags` and
the whole `raw` line.

---

## get messages

read what came in, by cursor.

```sh
curl 'http://127.0.0.1:8787/messages?since=0&limit=50&kind=conversation&target=%23shit-1170&from=nick&exclude_self=true&compact=true'
```

| param | default | what it is |
| --- | --- | --- |
| `since` | `0` | the cursor. `0` reads everything the log holds |
| `limit` | `200` | how many events to return, capped at 2000 |
| `kind` | none | only events of this kind |
| `target` | none | only events for this channel |
| `from` | none | only events from this nick |
| `exclude_self` | `false` | drop the events from our own nick |
| `compact` | `false` | leave out the raw irc line |

```json
{
  "ok": true,
  "since": 0,
  "cursor": 8,
  "head": 41,
  "count": 2,
  "messages": [
    {
      "seq": 3,
      "kind": "message",
      "from": "someone",
      "target": "#shit-1170",
      "text": "hello",
      "msgid": "xneeb9ys8er6xiaqt27qnbnvhe",
      "at": "2026-11-11T19:31:25.623Z",
      "raw": "@time=...;msgid=... :someone!~u@... PRIVMSG #shit-1170 :hello"
    }
  ]
}
```

**the answer carries TWO cursors, and they are not the same thing:**

| field | what it is |
| --- | --- |
| `cursor` | the last event that was LOOKED AT. pass this back as `since`. |
| `head` | where the log actually is right now. |

**pass `cursor`, not `head`.** the cursor is the last event that was examined,
whether it matched the filter or not. the head is the end of the log, so using
it would skip every event the filter turned away, and those would never be
seen again by this caller or any later one.

**`compact=true` leaves out the `raw` line.** the raw line is about three
times the size of the useful fields and carries the same information, so it is
there when it is wanted and out of the way when it is not.

the `kind` filter takes `conversation` (a channel message or a DM), `message`
(a channel message only), `dm` (a private message only) and `any` (everything).

---

## get stream

the same messages, live, over server-sent events.

```sh
curl -N 'http://127.0.0.1:8787/stream?kind=message&target=%23shit-1170&exclude_self=true'
```

| param | default | what it is |
| --- | --- | --- |
| `kind` | none | only events of this kind |
| `target` | none | only events for this channel |
| `from` | none | only events from this nick |
| `exclude_self` | `false` | drop the events from our own nick |

**the filters are the same ones `/messages` takes**, so a consumer only sees
what it cares about. without them the stream carries every join and quit on
the server, which is noise.

each event is one `data:` line of json:

```text
data: {"kind":"message","from":"someone","target":"#shit-1170","text":"hello","msgid":"...","at":"..."}
```

the stream carries a keep-alive comment every 15 seconds, so an idle
connection does not look dead.

**the stream does not carry a cursor.** it only reports what arrives from now
on, so a consumer that wants the backlog reads `/messages` first and then
opens the stream.

---

## get channels

the channels the daemon is in, and who is in them.

```json
{
  "ok": true,
  "channels": ["#shit-1170"],
  "names": { "#shit-1170": ["@notyourmom!~u@host", "sleet-agent!~u@host"] },
  "people": {
    "#shit-1170": [
      { "nick": "notyourmom", "operator": "@", "voice": null, "raw": "@notyourmom!~u@host" },
      { "nick": "sleet-agent", "operator": null, "voice": null, "raw": "sleet-agent!~u@host" }
    ]
  }
}
```

**the names list comes two ways.** `names` is the raw form, as the server
sends it: `nick!ident@host`, with a prefix before it when the nick has one.
`people` is the same list, split into the parts a caller wants.

| field | what it is |
| --- | --- |
| `nick` | the nick on its own |
| `raw` | the nick as the server sent it |
| `operator` | `@` or `&`, when the nick has that prefix |
| `voice` | `+` or `%`, when the nick has that prefix |

both are keyed by channel name.

---

## get who

who is in a channel, and which of them are bots.

```sh
curl 'http://127.0.0.1:8787/who?channel=%23shit-1170'
```

| param | what it is |
| --- | --- |
| `channel` | the channel, required |

```json
{
  "ok": true,
  "channel": "#shit-1170",
  "count": 2,
  "people": [
    { "nick": "notyourmom", "modes": "H@", "operator": true,  "bot": false, "away": false, "realname": "..." },
    { "nick": "sleet-agent", "modes": "HB", "operator": false, "bot": true,  "away": false, "realname": "..." }
  ]
}
```

| field | what it is |
| --- | --- |
| `nick` | the nick |
| `modes` | the modes the `WHO` reply carried |
| `operator` | the modes carry `@` or `&` |
| `bot` | the modes carry `B` |
| `away` | the modes carry `G` |
| `realname` | the realname from the `WHO` reply |

**this is the way to tell whether someone is a bot.** ergo does not report the
bot mode in `WHOIS` — there is no `324` mode line — so `WHOIS` cannot tell you,
but `WHO` can.

---

## get history

the server's own history for a channel.

```sh
curl 'http://127.0.0.1:8787/history?channel=%23shit-1170&limit=50'
```

| param | default | what it is |
| --- | --- | --- |
| `channel` | required | the channel |
| `limit` | `50` | how many messages, capped at 1000 |
| `after` | none | only messages after this msgid |

```json
{
  "ok": true,
  "channel": "#shit-1170",
  "count": 3,
  "messages": [
    {
      "kind": "message",
      "from": "someone",
      "target": "#shit-1170",
      "text": "hello",
      "msgid": "xneeb9ys8er6xiaqt27qnbnvhe",
      "at": "2026-11-11T19:31:25.623Z",
      "raw": "@msgid=...;time=... :someone!~u@... PRIVMSG #shit-1170 :hello"
    }
  ]
}
```

**the target comes BEFORE the limit, and `TARGETS=` is a different
subcommand.** `TARGETS=` lists the buffers that have history in them, it does
not fetch messages. the working form is `CHATHISTORY LATEST #chan * 50`.

with `after`, the request is `CHATHISTORY AFTER <channel> msgid=<msgid>
<limit>` — the messages that came after the one with that msgid. this is the
same request the daemon makes after a reconnect, to fill the gap.

=====================
<br/>
copyright 2026 by sleet.near
