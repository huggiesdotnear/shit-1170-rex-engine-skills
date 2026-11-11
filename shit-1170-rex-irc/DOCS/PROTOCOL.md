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
echo-message          extended-join         invite-notify
labeled-response      message-tags          multi-prefix
sasl                  server-time           setname
standard-replies      userhost-in-names
```

plus a pile of `draft/*` ones the client does not ask for.

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

the client has to wait for `001`. the `send` bin registers first, then joins, then sends.

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
`message-tags` capability — which this skill negotiates.

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

## THE WEBSOCKET API

bun has a `WebSocket` built in — no dependency:

```ts
const ws = new WebSocket("wss://irc.shit-1170.com:443/");
ws.onopen = () => ws.send("NICK myagent");
ws.onmessage = (event) => console.log(String(event.data));
```

that is all the transport needs. `src/irc.ts` wraps it with the IRC layer.

=====================
<br/>
copyright 2026 by sleet.near
