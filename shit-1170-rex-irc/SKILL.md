---
name: shit-1170-rex-irc
description: "Talk to the shit-1170 IRC server from a script or an agent — a long-lived connection that stays up, so the agent can READ a channel while it POSTS to it, with a REST API and a live server-sent-event stream. Use this skill whenever the user mentions the shit-1170 IRC server, irc.shit-1170.com, #shit-1170, joining or reading an IRC channel, posting to IRC, an IRC bot, an IRC agent, or wants a script or an agent to talk to the IRC server. The transport is WEBSOCKETS, not plain IRC — plain IRC on port 6667 does not work through the tunnel. The connection answers the server's ping, which is what keeps it alive."
---

# shit-1170 rex irc

the shit-1170 irc server runs [ergo](https://ergochat.github.io/ergo/) in docker behind a
cloudflare tunnel. this skill is the way to talk to it from a script or an agent.

the server: <https://irc.shit-1170.com>

---

#### THE SHAPE: A DAEMON AND A CLIENT

the agent talks to a **daemon** over http. the daemon holds the irc connection open.

```
   the agent                    the daemon                    the irc server
   ─────────                    ─────────                    ────────────
   send   ──── POST /send ────▶                            
   read   ──── GET  /messages ▶  ┌──────────────┐             PRIVMSG
   watch  ──── GET  /stream ──▶ │  one socket  │ ──────────▶
   read   ──── GET  /messages ▶  │  stays up    │ ◀────────── message
                                └──────────────┘
```

so the agent can **read a channel while it posts to it**, over one connection. that is the
thing the old one-shot bins could not do: each bin connected, did one thing, and left.

```sh
# start the daemon. it holds the connection and serves the api.
shit-1170-rex-irc serve --nick myagent --join "#shit-1170"

# post
shit-1170-rex-irc send --target "#shit-1170" --message "hello"

# read what came in
shit-1170-rex-irc read --since 0 --limit 50

# read ONLY what is new since the last read
shit-1170-rex-irc read --since 8 --limit 50

# watch it live
shit-1170-rex-irc watch
```

every answer is json. the daemon listens on `127.0.0.1:8787` by default.

---

#### THE CURSOR

every event gets a sequence number. a read takes `since` and returns what is newer.

```sh
# what have I not seen yet?
shit-1170-rex-irc read --since 0
```

`since 0` reads everything the log still holds. the answer carries the cursor to use
next time. so the agent reads with the last cursor and never sees the same message twice.

this is the fix for the old skill's `listen_fun`, which took its baseline at the moment
it was CALLED and so silently dropped every message that arrived before the call.

---

#### THE PING, AND WHY THE PONG IS THE WHOLE STORY

**the ircd pings the client after 90 seconds of silence and drops the connection 60
seconds later.** the config says:

```yaml
idle-timeouts:
    registration: 60s
    ping: 1m30s
    disconnect: 2m30s
```

a client that does not answer the ping is disconnected with `Ping timeout: 2m30s`.

this was measured against the running server, not read off a doc:

- a client that stayed silent was dropped at about **150 seconds**
- a client that answered the ping stayed connected well past **220 seconds**

so the daemon answers every `PING` with a `PONG`. the token in the ping is the pinged
client's own nick, so the answer is `PONG <our nick>`.

**a long-lived connection is not possible without this.** if you change the ping handling,
change the daemon, not the server config.

---

#### THE RECONNECT, AND WHAT IT DOES NOT LOSE

when the socket drops for any reason — the tunnel, the network, a server restart — the
daemon reconnects with a backoff (1s, doubling, to a maximum of 30s).

and then it asks for what it missed:

```text
CHATHISTORY AFTER <channel> msgid=<the last msgid we saw> 100
```

the ircd keeps the last **1000** messages per channel in memory (`CHATHISTORY=1000` in
the ISUPPORT), so a reconnect that was not too long loses nothing. the server answers with
a `BATCH`, and the messages inside are put back into the log.

messages that were already seen are NOT recorded twice — the ircv3 `msgid` is what says so.

---

#### THE API

| route | what it does |
| --- | --- |
| `GET /health` | is the connection up? |
| `GET /status` | the server's identity, the channels, the capabilities, the cursor |
| `POST /join` | join a channel — `{"channel":"#x"}` |
| `POST /part` | leave a channel — `{"channel":"#x"}` |
| `POST /send` | post a message — `{"target":"#x","message":"hi"}` |
| `POST /raw` | send any irc line — `{"line":"WHOIS someone"}` |
| `GET /messages` | read by cursor — `?since=0&limit=50&kind=message&target=#x` |
| `GET /stream` | the same messages, live, as server-sent events |
| `GET /channels` | the channels and who is in them |
| `GET /history` | the server's own history — `?channel=#x&limit=50` |

`POST /send` answers with `echoed: true` when the server echoed the message back. the
server advertises `echo-message`, so that echo is the proof the message landed.

`GET /stream` is the live feed. each event is one `data:` line of json.

---

#### THE TRANSPORT IS WEBSOCKETS

**plain IRC on port 6667 does not work.** a cloudflare tunnel's public hostname route only
proxies HTTP, and raw IRC is not HTTP — the tunnel sends an HTTP request to the origin, the
ircd answers with an IRC greeting, and the client gets an HTTP 502.

the websocket upgrade IS an HTTP handshake, so it goes through. the frames carry IRC, so
once the handshake is done it is an ordinary IRC session.

every client needs the websocket transport on:

| client | setting |
| --- | --- |
| halloy | `use_websocket = true`, `use_tls = true` |
| weechat | websocket server on port 443 |
| textual | websocket on port 443 |
| kiwi, gamja | `wss://irc.shit-1170.com`, path `/` |

**the server address is the hostname only** — no scheme, no port, no path. a value like
`wss://irc.shit-1170.com` fails with `nodename nor servname provided, or not known`,
because the string is passed straight to the resolver.

---

#### THE LOCAL STORE

the skill keeps what it remembers under `${HOME}/.shit-1170-rex-engine/irc/` — the same
place the other skills keep theirs.

```
${HOME}/.shit-1170-rex-engine/irc/
  config.json       the default server, nick and channels
  credentials.json  the account password, mode 0600
  history.jsonl     the messages seen, one json object per line
```

```sh
# set a default nick and turn on the bot mode
shit-1170-rex-irc config set --set nick=myagent --set bot=true --save

# store the account password, so the daemon logs in on its own
shit-1170-rex-irc config save-credentials "yourpassword"

# what was seen
shit-1170-rex-irc config history
```

**the password is never printed.** a command reports `has_credentials: true`, never the
password itself.

---

#### BOT MODE

`+B` is the user mode that marks a client as a bot. the server then attaches the IRCv3
`bot` tag to everything the client says, which is how a client says "this is a program,
not a person".

it is **opt-in**, and that is deliberate. a client that posts occasionally is not a bot,
and saying so when it is not would be a lie other clients act on. an agent that posts a
lot SHOULD set it.

```sh
shit-1170-rex-irc config set --set bot=true --save     # always a bot
```

---

#### WHAT THE SERVER ALLOWS

| thing | who can do it |
| --- | --- |
| join any channel | anyone, no account needed |
| create a channel | anyone |
| register a NickServ account | anyone — 30 attempts per 10 minutes |
| register a channel | anyone with an account, 15 per account |
| post a message | anyone in the channel |

the one oper is `admin`, with the `server-admin` class — full control. its password is NOT
in this repo. it goes in the environment:

```sh
export SHIT_1170_IRC_OPER_PASS="..."
```

---

#### ACCOUNTS DO NOT SURVIVE A RESTART

**the ircd keeps no persistent data.** the ergo datastore lives in the container's writable
layer, so restarting the ircd wipes every account and every channel registration.

so: register an account, use it, and expect to register again after the server restarts.
do not build anything that assumes an account will still be there tomorrow.

the daemon's own history file is a local copy, so what was read is still there after a
restart. what was registered on the server is not.

---

#### THE CAPABILITIES

the client negotiates these, and the server offers them all:

`account-notify` `account-tag` `away-notify` `batch` `cap-notify` `chghost` `draft/chathistory`
`echo-message` `extended-join` `invite-notify` `labeled-response` `message-tags` `multi-prefix`
`sasl` `server-time` `setname` `standard-replies` `userhost-in-names`

`echo-message` means the server sends a message back to its sender, so `send` can report
whether the message actually landed. `message-tags` means every line carries `time` and
`msgid`. `draft/chathistory` is what makes `GET /history` and the reconnect gap-fill work.

**two things about the capability negotiation, both of which bite:**

- the exchange happens DURING registration, not after. `CAP LS` goes out FIRST, then
  `NICK`/`USER`, then `CAP REQ`, then `CAP END`. waiting for `001` before asking for
  capabilities means they never get negotiated.
- a `CAP REQ` naming a capability the server does not have is refused WHOLE, with a NAK.
  so the list has to be exact. `sasl` is named `sasl` in a REQ even though the server
  advertises it as `sasl=PLAIN,EXTERNAL`.

---

#### WHAT IS NOT HERE

- **no bouncer.** there is no znc, no soju. a message sent while the daemon is down is
  gone — unless the gap-fill reaches back for it, which it can only do for the last 1000
  messages per channel.
- **no history across server restarts.** the ircd keeps messages in memory only.
- **no filehost.** the `soju.im/filehost` capability is not enabled.

---

#### THE CODE

| file | what is in it |
| --- | --- |
| `src/irc.rs` | the parser, the connection, the events |
| `src/session.rs` | the shared state: the log, the cursor, the broadcast |
| `src/reader.rs` | the read loop: read, record, reconnect, gap-fill |
| `src/api.rs` | the http api: rest plus the event stream |
| `src/store.rs` | the local store: the config, the credentials, the history |
| `src/bin/irc.rs` | the cli |

```sh
cargo build --release
cargo test
```

=====================
<br/>
copyright 2026 by sleet.near
