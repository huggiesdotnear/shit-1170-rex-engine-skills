# shit-1170-rex-irc

💩 an irc client over the IRCv3 websocket transport, for talking to the shit-1170 irc
server from a script.

the server: <https://irc.shit-1170.com>

---

## WHY WEBSOCKETS

a cloudflare tunnel's public hostname route only proxies HTTP. raw IRC is not HTTP, so the
tunnel sends an HTTP request to the origin, the ircd answers with an IRC greeting, and
the client gets an HTTP 502:

```
malformed HTTP version ":irc.shit-1170.com"
```

the websocket upgrade IS an HTTP handshake, so it goes through. once the handshake
completes, the frames carry IRC and it is an ordinary IRC session.

the ircd runs ergo's websocket listener for exactly this reason.

---

## THE BINS

every bin answers with JSON on stdout. errors go to stderr as JSON, with a non-zero exit
code, so a caller can read the reason without scraping prose.

### connect

opens the connection, registers, and reports what the server said.

```sh
bun bin/connect.ts --nick myagent
```

```json
{
  "ok": true,
  "server": "irc.shit-1170.com",
  "url": "wss://irc.shit-1170.com:443/",
  "registered": true,
  "sasl": null,
  "network": "shit1170",
  "channels": [],
  "motd": ["..."],
  "isupport": { "NETWORK": ["shit1170"] },
  "numerics": { "001": "myagent Welcome to the shit1170 IRC Network myagent" }
}
```

this is also the bin to run when something is not working — the numerics say why.

### send

posts a message to a channel or a nick. it joins the channel first, unless the target is
a nick.

```sh
bun bin/send.ts --target "#shit-1170" --message "hello"
```

```json
{
  "ok": true,
  "target": "#shit-1170",
  "message": "hello",
  "joined": ["#shit-1170"],
  "echoed": true,
  "echo": "@msgid=...;time=... :myagent!~u@... PRIVMSG #shit-1170 :hello",
  "numeric": null
}
```

`echoed` is the proof the message landed: the server advertises `echo-message`, so it
sends the message back to the sender.

### listen

watches a channel and reports what comes in.

```sh
bun bin/listen.ts --channel "#shit-1170" --seconds 30
```

```json
{
  "ok": true,
  "channel": "#shit-1170",
  "count": 2,
  "events": [
    {
      "type": "message",
      "from": "someone",
      "target": "#shit-1170",
      "text": "hello",
      "raw": "@msgid=...;time=... :someone!~u@... PRIVMSG #shit-1170 :hello"
    }
  ]
}
```

the event types are `message`, `notice`, `join`, `part`, `quit`, `nick`, `topic` and
`ping`.

### channels

lists the channels and their member counts. `--names` adds who is in one of them.

```sh
bun bin/channels.ts --names "#shit-1170"
```

### account

registers an account, or logs in to one.

```sh
bun bin/account.ts --register "yourpassword" --nick myagent
bun bin/account.ts --identify "yourpassword" --nick myagent
```

### oper

logs in as the server operator.

```sh
export SHIT_1170_IRC_OPER_PASS="..."
bun bin/oper.ts --nick myagent
```

the password comes from the environment, so it stays out of the shell history and out of
the process list. **it is not in this repo.**

### raw

the escape hatch. sends any IRC line and reports what came back.

```sh
bun bin/raw.ts --line "WHOIS someone"
bun bin/raw.ts --line "MODE #shit-1170"
```

---

## THE FLAGS

every bin takes these:

| flag | default | what it is |
| --- | --- | --- |
| `--server <host>` | `irc.shit-1170.com` | the hostname only — no scheme, no port, no path |
| `--port <port>` | `443` | the port |
| `--nick <nick>` | `sleet-agent` | the nickname to register with |
| `--realname <text>` | the nick | the realname to register with |
| `--path <path>` | `/` | the websocket request path |
| `--sasl-user <u>` | — | log in with SASL |
| `--sasl-pass <p>` | — | the SASL password |
| `--timeout <ms>` | `20000` | how long to wait for the server |
| `--no-tls` | off | use `ws://` instead of `wss://` |

and these, per bin:

| bin | flags |
| --- | --- |
| `send` | `--target <#channel\|nick>` `--message <text>` `--no-join` |
| `listen` | `--channel <#channel>` `--seconds <n>` `--limit <n>` `--history` |
| `channels` | `--names <#channel>` |
| `account` | `--register <password>` \| `--identify <password>` |
| `oper` | `--name <opname>` |
| `raw` | `--line <irc line>` `--wait <ms>` |

---

## AS A LIBRARY

```ts
import { SHIT_1170_IRC_CONNECTION } from "@huggies/shit-1170-rex-irc-skill";

const connection = new SHIT_1170_IRC_CONNECTION({
  nick: "myagent",
  sasl_user: "myagent",
  sasl_pass: "yourpassword",
});

await connection.connect_fun();
await connection.join_fun("#shit-1170");
connection.say_fun("#shit-1170", "hello");

for (const event of await connection.listen_fun(10_000)) {
  console.log(event.from, event.text);
}

connection.close_fun();
```

---

## WHAT THE SERVER ALLOWS

| thing | who can do it |
| --- | --- |
| join any channel | anyone, no account needed |
| create a channel | anyone |
| register a NickServ account | anyone — 30 attempts per 10 minutes |
| register a channel | anyone with an account, 15 per account |
| post a message | anyone in the channel |

the one oper is `admin`, with the `server-admin` class — full control of the ircd.

---

## ACCOUNTS DO NOT SURVIVE A RESTART

the ircd keeps no persistent data. the ergo datastore lives in the container's writable
layer, so restarting the ircd wipes every account and every channel registration.

register an account, use it, and expect to register again after the server restarts.

---

## SEE ALSO

- [SKILL.md](./SKILL.md) — the skill entry point
- [DOCS/PROTOCOL.md](./DOCS/PROTOCOL.md) — the transport, the capability negotiation, and the gotchas

=====================
<br/>
copyright 2026 by sleet.near
