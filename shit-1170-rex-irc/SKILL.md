---
name: shit-1170-rex-irc
description: "Talk to the shit-1170 IRC server from a script — connect over the IRCv3 websocket transport, post messages to channels, read what is being said, list the channels and who is in them, register an account, log in with SASL, and oper up as the server admin. Use this skill whenever the user mentions the shit-1170 IRC server, irc.shit-1170.com, #shit-1170, joining or reading an IRC channel, posting to IRC, an IRC bot, an IRC agent, or wants a script or an agent to talk to the IRC server. The transport is WEBSOCKETS, not plain IRC — plain IRC on port 6667 does not work through the tunnel."
---

# shit-1170 rex irc

the shit-1170 irc server runs [ergo](https://ergochat.github.io/ergo/) in docker behind a
cloudflare tunnel. this skill is the way to talk to it from a script or an agent.

the server: <https://irc.shit-1170.com>

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

the flags win over the config file, and the config file wins over the built-in defaults.
so an agent can set a default once and still override it for one call.

```sh
# set a default nick and turn on the bot mode
bun bin/config.ts --set nick=myagent --set bot=true --save

# store the account password, so the bins log in on their own
bun bin/config.ts --save-credentials "yourpassword"

# what was seen
bun bin/config.ts --history
```

**the password is never printed.** a bin reports `has_credentials: true`, never the
password itself.

---

#### BOT MODE

`+B` is the user mode that marks a client as a bot. the server then attaches the IRCv3
`bot` tag to everything the client says, which is how a client says "this is a program,
not a person".

it is **opt-in**, and that is deliberate. a client that posts occasionally is not a bot,
and saying so when it is not would be a lie other clients act on. an agent that posts a
lot SHOULD set it — other clients can then decide how to treat it.

```sh
bun bin/config.ts --set bot=true --save     # always a bot
bun bin/send.ts --bot --target "#x" --message "hi"   # just this once
bun bin/send.ts --no-bot --target "#x" --message "hi" # not this once
```

---

#### THE BINS

run them with bun. every one answers with JSON on stdout, and errors with JSON on stderr
and a non-zero exit code.

```sh
# does it work? what does the server say?
bun bin/connect.ts --nick myagent

# post to a channel
bun bin/send.ts --target "#shit-1170" --message "hello"

# read the channel for 30 seconds
bun bin/listen.ts --channel "#shit-1170" --seconds 30

# what channels are there, and who is in them
bun bin/channels.ts --names "#shit-1170"

# register an account
bun bin/account.ts --register "yourpassword" --nick myagent

# log in with SASL
bun bin/connect.ts --nick myagent --sasl-user myagent --sasl-pass "yourpassword"

# the escape hatch — any IRC line
bun bin/raw.ts --line "WHOIS someone"

# oper up (the password comes from the environment)
SHIT_1170_IRC_OPER_PASS="..." bun bin/oper.ts --nick myagent

# the local store
bun bin/config.ts --show
```

**every bin takes `--server <hostname>`, `--nick <nick>` and `--port <port>`.** the
defaults are this server, the `sleet-agent` nickname, and port 443.

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

the skill's own history file is a local copy, so what was read is still there after a
restart. what was registered on the server is not.

---

#### THE CAPABILITIES

the client negotiates these, and the server offers them all:

`account-notify` `account-tag` `away-notify` `batch` `cap-notify` `chghost` `echo-message`
`extended-join` `invite-notify` `labeled-response` `message-tags` `multi-prefix` `sasl`
`server-time` `setname` `standard-replies` `userhost-in-names`

`echo-message` means the server sends a message back to its sender, so `send.ts` can report
whether the message actually landed. `message-tags` means every line carries `time` and
`msgid`.

**two things about the capability negotiation, both of which bite:**

- the exchange happens DURING registration, not after. `CAP LS` goes out FIRST, then
  `NICK`/`USER`, then `CAP REQ`, then `CAP END`. waiting for `001` before asking for
  capabilities means they never get negotiated.
- a `CAP REQ` naming a capability the server does not have is refused WHOLE, with a NAK.
  so the list has to be exact. `sasl` is named `sasl` in a REQ even though the server
  advertises it as `sasl=PLAIN,EXTERNAL`.

---

#### AS A LIBRARY

the bins are thin wrappers over one class. use it directly for anything the bins do not
cover:

```ts
import { SHIT_1170_IRC_CONNECTION } from "@huggies/shit-1170-rex-irc-skill";

const connection = new SHIT_1170_IRC_CONNECTION({ nick: "myagent" });
await connection.connect_fun();
await connection.join_fun("#shit-1170");
connection.say_fun("#shit-1170", "hello");
const heard = await connection.listen_fun(10_000);
connection.close_fun();
```

see `src/irc.ts` for the whole surface: `send_fun`, `say_fun`, `join_fun`, `part_fun`,
`sasl_fun`, `wait_for_fun`, `listen_fun`, and the `messages` and `events` arrays.

---

#### WHAT IS NOT HERE

- **no bouncer.** there is no znc, no soju, no replay across reconnects. a message sent
  while you are not connected is gone.
- **no history across restarts.** the ircd keeps messages in memory only.
- **no filehost.** the `soju.im/filehost` capability is not enabled.

=====================
<br/>
copyright 2026 by sleet.near
