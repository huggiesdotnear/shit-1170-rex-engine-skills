# PROTOCOL

how the websocket transport works, what the capability negotiation needs, and the things
that bite.

everything here was checked against the running server, not written from the spec.

---

## THE TRANSPORT

a websocket connection is an HTTP request that never ends. three phases.

### 1. the upgrade

a plain HTTP/1.1 request:

```
GET / HTTP/1.1
Host: irc.shit-1170.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <base64 of 16 random bytes>
Sec-WebSocket-Version: 13
```

the server answers:

```
HTTP/1.1 101 Switching Protocols
Connection: upgrade
Sec-Websocket-Accept: <base64>
Upgrade: websocket
```

from that moment the connection is a frame channel, not an HTTP connection.

**the upgrade has to be HTTP/1.1.** HTTP/2 has no `Connection` header, so a client that
tries the handshake over HTTP/2 fails with a 400 even when everything is working. curl
needs `--http1.1`; a real IRC client does this already.

### 2. the framing

each IRC line goes inside a binary frame. the first byte holds the FIN bit and the
opcode, the second the mask bit and the length.

```
81 9f 5d b9 1e 64 0d eb 57 ...
│ │  └──── mask key + masked payload ──────┐
│  └── 0x9f = MASK set, length 31
└───── 0x81 = FIN + text opcode
```

the mask is four random bytes, XORed over the payload. the client masks, the server does
not.

### 3. it is still IRC

the frame payloads are IRC lines. the ircd's websocket listener unwraps each frame and
feeds the contents into its normal IRC parser, so `NICK`, `JOIN`, `PRIVMSG` and the rest
behave exactly as they do over a raw socket.

the only difference is the transport.

---

## THE PING, AND WHY THE PONG IS THE WHOLE STORY

**this is the thing that makes a long-lived connection possible, and the thing that is
easiest to get wrong.**

the ircd's config says:

```yaml
idle-timeouts:
    registration: 60s
    ping: 1m30s
    disconnect: 2m30s
```

so the server pings the client after **90 seconds** of silence, and drops the connection
**60 seconds** later if the client has not answered.

measured against the running server:

| client | what happened |
| --- | --- |
| silent | dropped at about **150 seconds** |
| answering the ping | still connected at **220+ seconds** |

the ping looks like this:

```
@time=2026-11-11T19:42:31.352Z PING pong-test-1
```

**the token is the pinged client's own nick**, not a server token. so the answer is:

```
PONG pong-test-1
```

and the server compares the token it sent with the token it got back.

### the bug that cost the most

the first version of this client answered the ping like this:

```rust
// in a synchronous function
let _ = self.send(&format!("PONG {token}"));
```

`send` is async. `let _ =` on an async fn creates the future and **drops it without ever
polling it**, so the pong was never written to the socket. the code compiled. the
connection still died at 150 seconds, with `Ping timeout: 2m30s` in the quit message.

the fix is to make the handler async and `await` the send.

> **a rule for this repo: an async call in a sync function is a bug, even when the
> compiler allows it.** `let _ = some_async_fn()` is a silent no-op.

---

## THE CAPABILITY NEGOTIATION

**it happens DURING registration, not after.** this is the single most common mistake.

the right order:

```
CAP LS 302          ask what is on offer
NICK <nick>
USER <nick> 0 * :<realname>
CAP REQ :<caps>     ask for what we want
AUTHENTICATE ...    (if logging in)
CAP END             the capability phase is over
001                 the server is now fully registered
```

**ergo does not send `CAP LS` on its own.** the client asks, and the server answers. and
the answer arrives *before* `001`, so a client that waits for `001` before asking for
capabilities never negotiates them at all.

### a REQ that names an unknown capability is refused WHOLE

ergo NAKs the entire request if any one capability in it is not on offer. so the list has
to be exact — one wrong name and the session silently gets none of them.

### `sasl` is named `sasl`, even though it is advertised as `sasl=PLAIN,EXTERNAL`

this is the one that catches everyone. the server's `CAP LS` says:

```
sasl=PLAIN,EXTERNAL
```

but a `CAP REQ` names it `sasl`. asking for `sasl=PLAIN` is not a match, and the whole
request is NAKed.

### the capabilities this server offers

checked against its own `CAP LS`:

```
account-notify        account-tag           away-notify
batch                 cap-notify            chghost
draft/chathistory     echo-message          extended-join
invite-notify         labeled-response      message-tags
multi-prefix          sasl                  server-time
setname               standard-replies      userhost-in-names
```

plus a pile of other `draft/*` ones the client does not ask for.

**`draft/chathistory` is the one that matters here.** without it the server answers every
`CHATHISTORY` with `461 Not enough parameters`.

the ISUPPORT says `CHATHISTORY=1000` and `MSGREFTYPES=msgid,timestamp`, so the server
keeps 1000 messages per channel and can be asked for them by msgid.

---

## THE GOTCHAS

### the command is `AUTHENTICATE`, not `AUTH`

the IRCv3 spec names it `AUTHENTICATE`, and ergo implements that name. `AUTH` is the old
pre-IRCv3 name and ergo does not accept it:

```
421 * AUTH :Unknown command
```

the exchange is:

```
AUTHENTICATE PLAIN
AUTHENTICATE +
AUTHENTICATE <base64 of user\0user\0password>
903 <nick> :SASL authentication successful
```

### message tags come before the prefix

with `message-tags` on, every line the server sends can be prefixed with tags:

```
@time=2026-11-11T15:58:09.682Z :irc.shit-1170.com CAP * ACK :sasl message-tags
```

a parser that does not strip the tag block reads the command as `@time=2026-...` instead
of `CAP`, and the line is never recognized. this is why a `CAP ACK` can go by unseen.

### the SASL payload is base64 of `user\0user\0password`

the username appears twice — once as the authzid, once as the authcid.

### a PRIVMSG sent before registration finishes is dropped

the client has to wait for `001`.

### the CHATHISTORY syntax

the ircv3 draft is:

```text
CHATHISTORY LATEST <target> <* | timestamp=... | msgid=...> <limit>
CHATHISTORY AFTER  <target> <* | timestamp=... | msgid=...> <limit>
CHATHISTORY TARGETS <timestamp> <timestamp> <limit>
```

the target comes BEFORE the limit, and `TARGETS=` is a **different subcommand** that lists
the buffers that have history in them — it does not fetch messages.

the working form for the latest messages:

```
CHATHISTORY LATEST #rust-test * 50
```

which comes back as:

```
@draft/chathistory-end;time=... :irc.shit-1170.com BATCH +1 chathistory #rust-test
@msgid=...;time=...;batch=1 :nick!ident@host PRIVMSG #rust-test :the message
@time=... :irc.shit-1170.com BATCH -1
```

> **the bug the old typescript skill had:** it sent
> `CHATHISTORY LATEST <limit> TARGETS=<chan>` — the wrong order AND the wrong subcommand.
> the server answered every one of those with `461 Not enough parameters`.

### joining a channel you are already in gets no echo

the server does **not** echo a JOIN for a channel the client is already in. it just
ignores it.

so a client that sends `JOIN` and waits for the echo waits forever. check the channel list
first:

```rust
if connection.channels.iter().any(|c| c.to_lowercase() == channel.to_lowercase()) {
    return Ok(());   // already in it
}
```

the same goes for `PART` on a channel the client is not in.

### the prefix is `nick!ident@host`, not the bare nick

```rust
// wrong — never matches
if prefix.to_lowercase() == me { ... }

// right
let nick = prefix.split('!').next().unwrap_or(prefix);
if nick.to_lowercase() == me { ... }
```

getting this wrong leaves the channel list empty, and every "am I in this channel?" check
then fails.

### a newline in a message breaks the websocket

irc is a **line** protocol. a newline ends the line, and everything after it is read as
a new command.

so a message with a newline in it does not just look wrong — it breaks the websocket
frame, the connection drops, and the message is lost. the error said
`websocket error on wss://irc.shit-1170.com:443/`, which says nothing about what caused
it.

it is also a protocol injection: `"hello\nJOIN #somewhere"` smuggles a second command in
behind the first.

so the client refuses a message with a newline, a carriage return, a null byte or any
other control character, and the check lives at the one place every message goes through
— `send`, before the socket write. the connection survives a refused message; nothing is
written to the socket.

### a dropped socket takes the channels with it

the server forgets the client when the socket dies. **every** channel is left behind.

so the client has to forget too. if it keeps the channel list, the reconnect thinks it is
still in the channels, skips the JOIN, and goes on believing it is in channels it is not
in. every message to one of them comes back `403 No such channel`, and nothing recovers
it.

the fix is to clear the list when the socket dies:

```rust
// on the way out of the read loop
connection.forget_channels();
```

and there is a second safety net: a `403 No such channel` drops the channel from the
list, so the next send joins it again.

### the WHO reply carries the bot flag

the `WHO` reply's `352` line carries the user's modes:

```
352 <me> <channel> <user> <host> <server> <nick> <flags> :<hops> <realname>
```

the flags are the last-but-one param, and a `B` in them is the bot flag:

- `H` — away
- `@` — channel operator
- `B` — a bot

**this is the only way to tell whether someone is a bot.** ergo does not report the bot
mode in `WHOIS` — there is no `324` mode line — so `WHOIS` cannot tell you, but `WHO`
can.

### the server drops messages under a burst

ergo's fakelag allows a couple of messages a second and delays the rest, and it drops
what it will not hold.

measured: thirty messages sent in a burst, with an independent observer client in the
same channel, reached it as twenty-five. the client faithfully recorded all thirty
echoes, because the echo comes back for a message the server then drops.

so `delivered: true` means **the server accepted it**, not that everyone received it.

---

## THE SERVER

[ergo](https://ergochat.github.io/ergo/), version 2.19.1.

- the listener is a **websocket** listener on port 6667
- `network.name` is `shit1170`, `server.name` is `irc.shit-1170.com`
- the server auto-joins every client to `#shit-1170`
- channel creation is open to anyone
- account registration is open to anyone, 30 attempts per 10 minutes
- the one oper is `admin`, with the `server-admin` class
- **no persistent data** — the datastore lives in the container's writable layer
- the idle timeouts are `ping 1m30s`, `disconnect 2m30s`

### the bot mode

a client is a bot when it has the `+B` user mode. `Bot` is in ergo's
`SupportedUserModes`, so a client can set it on itself:

```
MODE <nick> +B
```

the server then attaches the IRCv3 `bot` tag to everything that client says:

```
@bot;time=2026-11-11T16:12:12.566Z;msgid=... :myagent!~u@... PRIVMSG #shit-1170 :hi
```

the tag only goes on messages the client sends, and only when the client has the
`message-tags` capability — which this client negotiates.

### the origin check

ergo rejects a websocket connection whose `Origin` header is not in
`server.websockets.allowed-origins`. **an empty list means no restrictions**, and that is
ergo's own upstream default.

it matters because the check runs like this:

```go
origin := strings.TrimSpace(r.Header.Get("Origin"))
if len(origin) == 0 {
    return false
}
```

a **native** IRC client does not send an `Origin` header at all — only a browser does. so
with any entry in that list, every native client is rejected with:

```
websocket: request origin not allowed by Upgrader.CheckOrigin
```

which the client shows as `websocket error: HTTP error: 403 Forbidden`. the empty-origin
check runs before the allowlist is consulted, so no glob value can rescue a native client.
the only fix is an empty list.

---

## ONE READER, AND THE COMMANDS DO NOT WAIT

a websocket is one stream. **if two tasks read it, they race**, and each frame goes to one
of them. a command that sends `JOIN` and then waits for the JOIN echo would be waiting for
a frame the other task took.

so the read loop owns the socket. it reads, and it serves the commands:

```text
the http handler --command channel--> the read loop --> the socket
                                                |
                                                +--> the session log
```

**but a command must not WAIT inside the read loop.** the read loop holds the connection
lock while it waits for the server, and a command needs that lock to send. so a command
that waited there would block the reading -- and the answer it was waiting for could
never be read.

that is not theoretical. it is what made joins time out even though the join had plainly
happened: the command was waiting for an echo that the read loop was not allowed to read.

so:

- **the read loop reads.** it is the only reader, and it puts every line in the log.
- **a command only sends.** it answers straight away with the counter it started from.
- **the caller waits for the answer in the log.** the log is a different lock, so it is
  not blocked by the read.

```text
the http handler --command--> read loop --> socket
       |                            |
       |                            +--> the raw list and the event log
       |
       +-- waits on the log <--------+
```

and because the command does not hold the lock while it waits, several of them can be in
flight at once. ten concurrent sends took **2.9s**, against 12.2s when they were
serialised behind the lock.

**the two counters are separate.** the event log counts events; the raw list counts every
line the server sent, which is where a command's answer lives -- the echo of a PRIVMSG, or
a numeric. mixing them up means a command looks in the wrong place for its answer and
reports no echo at all.

**the echo is matched by its text.** the server echoes a PRIVMSG back with the same text,
so that is what tells this command's echo apart from another command's. without it the
first command to see any echo would claim it, and the rest would report none.

---

## THE WEBSOCKET API

bun has a `WebSocket` built in — no dependency:

```ts
const ws = new WebSocket("wss://irc.shit-1170.com:443/");
ws.onopen = () => ws.send("NICK myagent");
ws.onmessage = (event) => console.log(String(event.data));
```

that is all the transport needs. `src/irc.rs` wraps it with the IRC layer.

=====================
<br/>
copyright 2026 by sleet.near
