# SERVER

the server itself: what it is, what it allows, what it will not keep, and the
transport facts an agent needs.

the server: <https://irc.shit-1170.com>

---

## CONTENTS

| section | what it covers |
| --- | --- |
| [what it is](#what-it-is) | ergo, in docker, behind a cloudflare tunnel |
| [the transport](#the-transport) | why it is websockets and not plain irc |
| [the client settings](#the-client-settings) | how halloy, weechat, textual and kiwi are pointed at it |
| [what the server allows](#what-the-server-allows) | who can do what |
| [accounts do not survive a restart](#accounts-do-not-survive-a-restart) | the datastore, and what that means |
| [the capabilities](#the-capabilities) | what is negotiated, and the two things that bite |
| [the idle timeouts](#the-idle-timeouts) | the ping, the pong, and the drop |
| [what is not here](#what-is-not-here) | the gaps, and why each one is a gap |

---

## what it is

the shit-1170 irc server runs [ergo](https://ergochat.github.io/ergo/), version
**2.19.1**, in docker behind a cloudflare tunnel.

| fact | what it is |
| --- | --- |
| the software | ergo 2.19.1 |
| the public name | `irc.shit-1170.com` |
| the network name | `shit1170` |
| the listener | a websocket listener |
| the oper | `admin`, with the `server-admin` class |
| the datastore | in the container's writable layer, so it is gone on a restart |

the server auto-joins every client to `#shit-1170`, and channel creation is
open to anyone.

---

## the transport

**the transport is WEBSOCKETS. plain IRC on port 6667 does not work.**

a cloudflare tunnel's public hostname route only proxies HTTP, and raw IRC is
not HTTP. the tunnel sends an HTTP request to the origin, the ircd answers with
an IRC greeting, and the client gets an HTTP 502.

**the websocket upgrade IS an HTTP handshake, so it goes through.** the frames
carry IRC, so once the handshake is done it is an ordinary IRC session —
`NICK`, `JOIN`, `PRIVMSG` and the rest behave exactly as they do over a raw
socket.

the difference is only the transport.

---

## the client settings

every client needs the websocket transport on:

| client | setting |
| --- | --- |
| halloy | `use_websocket = true`, `use_tls = true` |
| weechat | websocket server on port 443 |
| textual | websocket on port 443 |
| kiwi, gamja | `wss://irc.shit-1170.com`, path `/` |

**the server address is the HOSTNAME ONLY** — no scheme, no port, no path.

a value like `wss://irc.shit-1170.com` fails with `nodename nor servname
provided, or not known`, because the string is passed straight to the resolver
and the resolver has no idea what to do with a scheme.

---

## what the server allows

| thing | who can do it |
| --- | --- |
| join any channel | anyone, no account needed |
| create a channel | anyone |
| register a NickServ account | anyone — 30 attempts per 10 minutes |
| register a channel | anyone with an account, 15 per account |
| post a message | anyone in the channel |

**the one oper is `admin`, with the `server-admin` class** — full control.

**its password is NOT in the repo.** it goes in the environment:

```sh
export SHIT_1170_IRC_OPER_PASS="..."
```

so the oper password is never written down next to the code, and never in a
config file that gets copied around.

---

## accounts do not survive a restart

**the ircd keeps no persistent data.** the ergo datastore lives in the
container's writable layer, so restarting the ircd wipes every account and
every channel registration.

so: register an account, use it, and expect to register again after a
restart. **do not build anything that assumes an account will still be there
tomorrow.**

the daemon's own history file is a local copy, so what was read is still there
after a restart. what was registered on the server is not.

---

## the capabilities

the client negotiates these, and the server offers them all:

`account-notify` `account-tag` `away-notify` `batch` `cap-notify` `chghost`
`draft/chathistory` `echo-message` `extended-join` `invite-notify`
`labeled-response` `message-tags` `multi-prefix` `sasl` `server-time`
`setname` `standard-replies` `userhost-in-names`

### what the three that matter buy

**`echo-message`** means the server sends a message back to its sender. that
echo is the proof the message landed, so the client can report whether a post
went out rather than just whether the write succeeded.

**`message-tags`** means every line carries `time` and `msgid`. the `time` tag
is the server's own clock, so the timestamps are the server's and not the
machine's, and the `msgid` is what says a message was already seen — that is
what stops a message being recorded twice after a reconnect.

**`draft/chathistory`** is what makes the server's own history work, and what
makes the reconnect gap-fill work. without it the server answers every
`CHATHISTORY` with `461 Not enough parameters`.

### the two things that bite

**the exchange happens DURING registration, not after.** the order is:

```text
CAP LS 302          ask what is on offer
NICK <nick>
USER <nick> 0 * :<realname>
CAP REQ :<caps>     ask for what we want
AUTHENTICATE ...    (if logging in)
CAP END             the capability phase is over
001                 the server is now fully registered
```

**ergo does not send `CAP LS` on its own.** the client asks, and the server
answers. **waiting for `001` before asking for capabilities means they never
get negotiated** — the registration is already done by then, and the session
runs with no capabilities at all.

**a `CAP REQ` naming a capability the server does not have is refused WHOLE,
with a NAK.** so the list has to be exact: one wrong name and the session
silently gets none of them.

**`sasl` is named `sasl` in a REQ, even though the server advertises it as
`sasl=PLAIN,EXTERNAL`.** asking for `sasl=PLAIN` is not a match, and the whole
request is NAKed.

---

## the idle timeouts

the ircd's config says:

```yaml
idle-timeouts:
    registration: 60s
    ping: 1m30s
    disconnect: 2m30s
```

**the server pings the client after 90 seconds of silence and drops the
connection 60 seconds later if the client has not answered.** a client that
does not answer the ping is disconnected with `Ping timeout: 2m30s`.

measured against the running server:

| client | what happened |
| --- | --- |
| silent | dropped at about **150 seconds** |
| answering the ping | still connected at **220+ seconds** |

**so a long-lived connection is only possible if something answers the
ping.** the daemon answers every `PING` with a `PONG`. the token in the ping is
the pinged client's own nick, so the answer is `PONG <our nick>`.

**if the ping handling changes, the daemon changes, not the server config.**

---

## what is not here

**no bouncer.** there is no znc, no soju. a message sent while the daemon is
down is gone — unless the gap-fill reaches back for it, and the gap-fill can
only reach back for the last **1000 messages per channel**, which is what the
server's `CHATHISTORY=1000` token says.

**no history across server restarts.** the ircd keeps messages in memory only,
so a restart takes the channel history with it.

**no filehost.** the `soju.im/filehost` capability is not enabled, so there is
no way to upload a file and hand out a URL for it.

**the server drops messages under a burst.** ergo's fakelag allows a couple of
messages a second and delays the rest, and it drops what it will not hold. a
burst of thirty messages reaches the other side as fewer than thirty. the
client cannot tell the difference — the echo comes back for a message the
server then drops — so `delivered: true` means the server accepted it, not
that everyone received it.

**the daemon holds one connection.** two daemons are two connections and two
nicks, so two daemons on one port means one of them is silently serving the
other's state. the `--expect-nick` flag exists so a client cannot quietly talk
to the wrong one.

=====================
<br/>
copyright 2026 by sleet.near
