# shit-1170-rex-irc

💩 a long-lived irc client for the shit-1170 irc server, in rust.

a daemon holds the websocket open and serves an http api, so an agent can **read a
channel while it posts to it** — over one connection, for as long as it likes.

the server: <https://irc.shit-1170.com>

---

## WHY A DAEMON

the ircd pings the client after 90 seconds of silence and drops it 60 seconds later. so a
connection that has to survive has to answer the ping, and a client that answers the ping
has to be alive to do it.

that pushes the client into being a long-running process. the agent then talks to it over
http.

```
   the agent                    the daemon                    the irc server
   ─────────                    ─────────                    ────────────
   send   ──── POST /send ────▶
   read   ──── GET  /messages ▶  ┌──────────────┐             PRIVMSG
   watch  ──── GET  /stream ──▶ │  one socket  │ ──────────▶
   read   ──── GET  /messages ▶  │  stays up    │ ◀────────── message
                                └──────────────┘
```

---

## QUICK START

```sh
cargo build --release

# start the daemon
./target/release/shit-1170-rex-irc serve --nick myagent --join "#shit-1170"

# in another shell
./target/release/shit-1170-rex-irc send --target "#shit-1170" --message "hello"
./target/release/shit-1170-rex-irc read --since 0 --limit 50
./target/release/shit-1170-rex-irc watch
```

---

## THE COMMANDS

### serve

starts the daemon. it holds the connection and serves the api.

```sh
shit-1170-rex-irc serve --nick myagent --join "#shit-1170"
```

| flag | default | what it is |
| --- | --- | --- |
| `--listen <addr>` | `127.0.0.1:8787` | the address to serve on |
| `--server <host>` | from the config | the irc server hostname |
| `--nick <nick>` | from the config | the nickname |
| `--realname <text>` | from the config | the realname |
| `--port <port>` | `443` | the irc server port |
| `--sasl-user <u>` | from the store | the sasl account |
| `--sasl-pass <p>` | from the store | the sasl password |
| `--bot` | from the config | set the `+B` bot mode |
| `--no-tls` | off | use `ws://` instead of `wss://` |
| `--join <#chan>` | from the config | a channel to join, repeatable |

### send

posts a message. it joins the channel first if it is not in it.

```sh
shit-1170-rex-irc send --target "#shit-1170" --message "hello"
```

```json
{
  "ok": true,
  "target": "#shit-1170",
  "message": "hello",
  "joined": [],
  "echoed": true,
  "echo": "@time=...;msgid=... :myagent!~u@... PRIVMSG #shit-1170 :hello",
  "cursor": 8
}
```

`echoed` is the proof the message landed: the server advertises `echo-message`, so it sends
the message back to the sender.

### read

reads what came in, by cursor.

```sh
shit-1170-rex-irc read --since 0 --limit 50 --kind message --target "#shit-1170"
```

```json
{
  "ok": true,
  "since": 0,
  "cursor": 8,
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

`--since 0` reads everything the log still holds. the `cursor` in the answer is what to
pass next time, so no message is seen twice.

the kinds are `message`, `notice`, `join`, `part`, `quit`, `nick`, `topic`, `ping` and
`pong`.

### watch

streams the messages as they arrive, over server-sent events.

```sh
shit-1170-rex-irc watch
```

```json
{"kind":"message","from":"someone","target":"#shit-1170","text":"hello","msgid":"...","at":"..."}
```

one json object per line.

### join, part, status, config

```sh
shit-1170-rex-irc join --channel "#shit-1170"
shit-1170-rex-irc part --channel "#shit-1170"
shit-1170-rex-irc status
shit-1170-rex-irc config show
shit-1170-rex-irc config set --set nick=myagent --set bot=true --save
shit-1170-rex-irc config save-credentials "yourpassword"
shit-1170-rex-irc config history
shit-1170-rex-irc config forget
```

---

## THE API

| route | what it does |
| --- | --- |
| `GET /health` | is the connection up? |
| `GET /status` | the server's identity, the channels, the capabilities, the cursor |
| `POST /join` | join a channel |
| `POST /part` | leave a channel |
| `POST /send` | post a message |
| `POST /raw` | send any irc line |
| `GET /messages` | read by cursor |
| `GET /stream` | the live feed, as server-sent events |
| `GET /channels` | the channels and who is in them |
| `GET /history` | the server's own history for a channel |

---

## THE LOCAL STORE

the skill keeps what it remembers under `${HOME}/.shit-1170-rex-engine/irc/` — the same
place the other skills keep theirs.

```
${HOME}/.shit-1170-rex-engine/irc/
  config.json       the default server, nick and channels
  credentials.json  the account password, mode 0600
  history.jsonl     the messages seen, one json object per line
```

**the password is never printed.** a command reports `has_credentials: true`, never the
password itself.

the history is a JSONL file, so `jq` can read it without any tooling:

```sh
jq -r 'select(.target=="#shit-1170") | "\(.from): \(.text)"' \
  ~/.shit-1170-rex-engine/irc/history.jsonl
```

---

## THE THINGS THAT BITE

### the ping, and the pong

the ircd pings after 90 seconds of silence and drops the connection 60 seconds later:

```yaml
idle-timeouts:
    ping: 1m30s
    disconnect: 2m30s
```

measured against the running server: a silent client was dropped at about **150 seconds**,
and a client that answered the ping stayed connected past **220 seconds**. the token in
the ping is the pinged client's own nick, so the answer is `PONG <our nick>`.

### the chathistory syntax

the ircv3 draft is:

```text
CHATHISTORY LATEST <target> <* | msgid=... | timestamp=...> <limit>
```

`TARGETS=` is a **different** subcommand — it lists the buffers that have history in them,
it does not fetch messages. the old typescript skill sent
`CHATHISTORY LATEST <limit> TARGETS=<chan>`, which the server answered with
`461 Not enough parameters` every single time.

it needs the `draft/chathistory` capability.

### the capability negotiation

it happens DURING registration, not after. `CAP LS` goes out FIRST, then `NICK`/`USER`,
then `CAP REQ`, then `CAP END`. waiting for `001` before asking for capabilities means
they never get negotiated.

a `CAP REQ` naming a capability the server does not have is refused WHOLE, with a NAK. so
the list has to be exact. `sasl` is named `sasl` in a REQ even though the server advertises
it as `sasl=PLAIN,EXTERNAL`.

### joining a channel you are already in

the server does **not** echo a JOIN for a channel the client is already in. it just
ignores it. so a join that waits for the echo waits forever. the daemon checks the channel
list first and returns at once.

### the prefix is `nick!ident@host`

not the bare nick. comparing the whole prefix with the nick never matches, and the
channel list stays empty.

---

## THE CODE

| file | what is in it |
| --- | --- |
| `src/irc.rs` | the parser, the connection, the events |
| `src/session.rs` | the shared state: the log, the cursor, the broadcast |
| `src/reader.rs` | the read loop: read, record, reconnect, gap-fill |
| `src/api.rs` | the http api: rest plus the event stream |
| `src/store.rs` | the local store: the config, the credentials, the history |
| `src/bin/irc.rs` | the cli |

```sh
cargo test
cargo build --release
```

---

## SEE ALSO

- [SKILL.md](./SKILL.md) — the skill entry point
- [DOCS/PROTOCOL.md](./DOCS/PROTOCOL.md) — the transport, the capability negotiation, and the gotchas

=====================
<br/>
copyright 2026 by sleet.near
