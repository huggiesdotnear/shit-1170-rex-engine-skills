// ========================================
// IRC OVER WEBSOCKETS — the client.
//
// this is the whole thing: an irc client that speaks the IRCv3
// WEBSOCKET transport. the frames carry irc, so once the handshake is
// done it is an ordinary irc session.
//
// --- WHY WEBSOCKETS AND NOT PLAIN IRC ---
// the server sits behind a cloudflare tunnel, and a tunnel's public
// hostname route only proxies HTTP. a raw irc socket cannot get
// through it — cloudflared sends an HTTP request to the origin, the
// ircd answers with an irc greeting, and the client gets a 502.
//
// the websocket upgrade IS an HTTP handshake, so it goes through. this
// is the same transport halloy, weechat and textual use.
//
// --- WHAT IS IN HERE ---
//   the connection      — the websocket, the irc registration, CAP
//   the parser          — a raw irc line into a typed thing
//   the waiters         — "wait until the server says 001", "wait
//                         until this channel has names in it"
//   the sasl            — plain SASL, for logging in
//
// the server here is ergo. see DOCS/PROTOCOL.md for what it supports.
// ========================================

// ------------------------------------------------------------
// THE IRCCONNECTION CLASS
// ------------------------------------------------------------

/**
 * one thing the server said.
 *
 * the `command` is the middle word of a normal server message
 * (`001`, `PRIVMSG`, `353`, ...) and the `params` are the rest.
 */
export interface SHIT_1170_IRC_MESSAGE {
  /** the source of the message, e.g. `irc.shit-1170.com` or a nick */
  prefix: string | null;
  /** the middle word: `001`, `PRIVMSG`, `353`, `JOIN`, ... */
  command: string;
  /** everything after the command */
  params: string[];
  /** the IRCv3 message tags, e.g. `time` and `msgid` */
  tags: Record<string, string>;
  /** the whole raw line, as it came off the wire */
  raw: string;
}

/**
 * a message the agent cares about, flattened for JSON output.
 */
export interface SHIT_1170_IRC_EVENT {
  /** `message`, `join`, `part`, `quit`, `nick`, `topic`, `notice`, ... */
  type: string;
  /** the nick it came from, if any */
  from: string | null;
  /** the channel it is about, if any */
  target: string | null;
  /** the text of the message */
  text: string | null;
  /** the raw line */
  raw: string;
}

/**
 * the options a connection takes.
 */
export interface SHIT_1170_IRC_OPTIONS {
  /** the hostname, no scheme and no port */
  server?: string;
  /** the port. 443 for a websocket over TLS. */
  port?: number;
  /** use TLS. true for wss:// */
  tls?: boolean;
  /** the websocket request path */
  path?: string;
  /** the nickname to register with */
  nick?: string;
  /** the realname to register with */
  realname?: string;
  /** the SASL username */
  sasl_user?: string;
  /** the SASL password */
  sasl_pass?: string;
  /** how long to wait for the server, in ms */
  timeout_ms?: number;
}

/** the server this skill talks to by default. */
export const SHIT_1170_IRC_DEFAULT_SERVER = "irc.shit-1170.com";
/** the default port. a websocket over TLS is 443. */
export const SHIT_1170_IRC_DEFAULT_PORT = 443;
/** the default websocket path. */
export const SHIT_1170_IRC_DEFAULT_PATH = "/";
/** the default nickname. */
export const SHIT_1170_IRC_DEFAULT_NICK = "sleet-agent";
/** how long to wait for the server by default. */
export const SHIT_1170_IRC_DEFAULT_TIMEOUT_MS = 20_000;

// ------------------------------------------------------------
// THE PARSER
// ------------------------------------------------------------

/**
 * pull the trailing param off an irc line.
 *
 * a trailing param is one that starts with `:` and runs to the end of
 * the line. everything before it is split on spaces.
 */
function shit_1170_irc_split_fun(raw: string): {
  prefix: string | null;
  command: string;
  params: string[];
  tags: Record<string, string>;
} {
  let rest = raw;
  let prefix: string | null = null;
  const tags: Record<string, string> = {};

  // --- IRCv3 MESSAGE TAGS ---
  // with the `message-tags` capability on, every line the server sends
  // can be prefixed with `@key=value;key2=value2`. without handling
  // this, the prefix looks like part of the command and the line is
  // parsed wrong — a `CAP ACK` arrives as the command
  // `@time=2026-...` and is never recognized.
  //
  // the tags are separated from the rest by a single space, and the
  // tag block ends at the first space that is not inside a `;`.
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    if (space === -1) {
      return { prefix: null, command: rest.slice(1), params: [], tags };
    }
    for (const pair of rest.slice(1, space).split(";")) {
      if (pair.length === 0) continue;
      const equals = pair.indexOf("=");
      if (equals === -1) {
        tags[pair] = "";
      } else {
        // a tag value may be escaped; unescape the `\:`, `\;`, `\\`
        // and `\s` sequences.
        tags[pair.slice(0, equals)] = pair
          .slice(equals + 1)
          .replace(/\\:/g, ":")
          .replace(/\\;/g, ";")
          .replace(/\\\\/g, "\\")
          .replace(/\\s/g, " ");
      }
    }
    rest = rest.slice(space + 1);
  }

  // a prefix is a `:thing` at the very start.
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    if (space === -1) {
      return { prefix: rest.slice(1), command: "", params: [], tags };
    }
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }

  // a trailing param is a `:thing` after the command.
  let trailing: string | null = null;
  const colon = rest.indexOf(" :");
  if (colon !== -1) {
    trailing = rest.slice(colon + 2);
    rest = rest.slice(0, colon);
  }

  const parts = rest.split(" ").filter((part) => part.length > 0);
  const command = parts.shift() ?? "";
  const params = parts;
  if (trailing !== null) params.push(trailing);

  return { prefix, command, params, tags };
}

/**
 * turn a raw irc line into a typed message.
 */
export function shit_1170_irc_parse_fun(raw: string): SHIT_1170_IRC_MESSAGE {
  const { prefix, command, params, tags } = shit_1170_irc_split_fun(raw.trim());
  return { prefix, command: command.toUpperCase(), params, tags, raw: raw.trim() };
}

// ------------------------------------------------------------
// THE CONNECTION
// ------------------------------------------------------------

/**
 * an irc session over a websocket.
 *
 * it wraps one `WebSocket` and keeps a list of the messages that came
 * in. every `send` is one text frame.
 */
export class SHIT_1170_IRC_CONNECTION {
  readonly server: string;
  readonly port: number;
  readonly tls: boolean;
  readonly path: string;
  readonly nick: string;
  readonly realname: string;

  /** every message the server has sent, in order */
  readonly messages: SHIT_1170_IRC_MESSAGE[] = [];
  /** the numerics and events, flattened for output */
  readonly events: SHIT_1170_IRC_EVENT[] = [];

  /** the server's `005` ISUPPORT values */
  isupport: Record<string, string[]> = {};
  /** the channels this client is in */
  channels: Set<string> = new Set();
  /** the server's MOTD, if it sent one */
  motd: string[] = [];
  /** true once the server has sent 001 */
  registered = false;
  /** the SASL result, if SASL was attempted */
  sasl_ok: boolean | null = null;
  /** the oper result, if OPER was attempted */
  oper_ok: boolean | null = null;

  private ws: WebSocket | null = null;
  private readonly timeout_ms: number;
  private readonly sasl_user?: string;
  private readonly sasl_pass?: string;
  private closed = false;

  constructor(options: SHIT_1170_IRC_OPTIONS = {}) {
    this.server = options.server ?? SHIT_1170_IRC_DEFAULT_SERVER;
    this.port = options.port ?? SHIT_1170_IRC_DEFAULT_PORT;
    this.tls = options.tls ?? true;
    this.path = options.path ?? SHIT_1170_IRC_DEFAULT_PATH;
    this.nick = options.nick ?? SHIT_1170_IRC_DEFAULT_NICK;
    this.realname = options.realname ?? options.nick ?? SHIT_1170_IRC_DEFAULT_NICK;
    this.timeout_ms = options.timeout_ms ?? SHIT_1170_IRC_DEFAULT_TIMEOUT_MS;
    this.sasl_user = options.sasl_user;
    this.sasl_pass = options.sasl_pass;
  }

  /** the websocket url this connection opens. */
  get url(): string {
    const scheme = this.tls ? "wss" : "ws";
    return `${scheme}://${this.server}:${this.port}${this.path}`;
  }

  /**
   * open the websocket and register with the server.
   *
   * resolves once the server has sent 001, or rejects with the reason.
   */
  async connect_fun(): Promise<void> {
    await this.open_fun();

    // --- THE ORDER MATTERS ---
    // capability negotiation happens DURING registration, not after.
    // ergo does not send `CAP LS` on its own — the client asks, and
    // the server answers. if the client waits for 001 first, the
    // registration is already done and the capability exchange comes
    // too late.
    //
    // so the order is:
    //   CAP LS          ask what is on offer
    //   NICK + USER     begin registration
    //   CAP REQ         ask for what we want
    //   CAP END         finish the capability phase
    //   001             the server is now fully registered
    this.send_fun("CAP LS 302");

    this.send_fun(`NICK ${this.nick}`);
    this.send_fun(`USER ${this.nick} 0 * :${this.realname}`);

    await this.wait_for_fun(
      (message) => message.command === "CAP" && message.params[1] === "LS",
      "the server never answered CAP LS",
    );

    // ask for the capabilities that make a session useful.
    //
    // --- WHY THIS LIST IS EXACT ---
    // ergo NAKs the WHOLE request if any one capability in it is not
    // on offer. so the list has to name only caps the server actually
    // has, and the bare name.
    //
    // `sasl` is the one that bites: the server advertises it as
    // `sasl=PLAIN,EXTERNAL`, but a CAP REQ names it `sasl`. asking for
    // `sasl=PLAIN` fails, and the whole request is refused with a
    // NAK, so the session silently gets none of them.
    //
    // the caps offered by this server, checked against its own CAP LS:
    //   account-notify account-tag away-notify batch cap-notify
    //   chghost echo-message extended-join invite-notify
    //   labeled-response message-tags multi-prefix sasl server-time
    //   setname standard-replies userhost-in-names
    this.send_fun(
      "CAP REQ :sasl message-tags server-time echo-message extended-join account-notify away-notify chghost cap-notify userhost-in-names setname standard-replies invite-notify labeled-response account-tag batch multi-prefix",
    );
    await this.wait_for_fun(
      (message) =>
        message.command === "CAP" &&
        (message.params[1] === "ACK" || message.params[1] === "NAK"),
      "the server never answered CAP REQ",
    );

    // SASL has to happen before CAP END — the `sasl` capability is
    // what makes the server accept the AUTH command, and the
    // capability phase ends with CAP END.
    if (this.sasl_user) {
      await this.sasl_fun(this.sasl_user, this.sasl_pass ?? "");
    }

    this.send_fun("CAP END");

    // wait for 001.
    await this.wait_for_fun(
      (message) => message.command === "001",
      "the server never sent 001 (registration)",
    );

    // wait for the welcome burst to finish, so a caller that takes a
    // snapshot of the messages right after connecting does not get the
    // tail of the MOTD mixed into its own answer.
    //
    // 376 (end of MOTD) ends the burst. a server with no MOTD does not
    // send it, so this cannot block forever — the wait is capped.
    await this.wait_for_fun(
      (message) => message.command === "376",
      "the server never finished the welcome (376)",
      Math.min(this.timeout_ms, 4000),
    ).catch(() => {
      // no MOTD, or it took too long. the session is still usable.
    });
  }

  /** open the websocket and wait for the 101. */
  private async open_fun(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(
          new Error(
            `could not open a websocket to ${this.url}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
        return;
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // already closed
        }
        reject(
          new Error(
            `timed out connecting to ${this.url} after ${this.timeout_ms}ms. is the server up, and does the host resolve?`,
          ),
        );
      }, this.timeout_ms);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            `websocket error connecting to ${this.url}. a 403 means the ircd rejected the origin; a DNS error means the name does not resolve.`,
          ),
        );
      };

      ws.onmessage = (event) => {
        this.on_data_fun(String(event.data));
      };

      ws.onclose = () => {
        this.closed = true;
      };
    });
  }

  /**
   * log in with SASL PLAIN.
   *
   * the AUTHENTICATE command carries a base64 blob of
   * `user\0user\0password`.
   *
   * --- WHY "AUTHENTICATE" AND NOT "AUTH" ---
   * the ircv3 spec names the command `AUTHENTICATE`, and ergo
   * implements that name. sending `AUTH` gets
   * `421 AUTH :Unknown command`, because `AUTH` is the old
   * pre-ircv3 name and ergo does not accept it.
   *
   * NOTE: this has to run BEFORE `CAP END`, because the sasl
   * capability is what makes the server accept the command.
   */
  async sasl_fun(username: string, password: string): Promise<boolean> {
    this.send_fun("AUTHENTICATE PLAIN");
    await this.wait_for_fun(
      (message) =>
        message.command === "AUTHENTICATE" && message.params[0] === "+",
      "the server did not ask for the SASL payload",
    );

    const payload = btoa(`${username}\0${username}\0${password}`);
    this.send_fun(`AUTHENTICATE ${payload}`);

    await this.wait_for_fun(
      (message) =>
        message.command === "903" ||
        message.command === "904" ||
        message.command === "905" ||
        message.command === "906" ||
        message.command === "907",
      "the server never answered the SASL login",
    );

    const ok = this.messages.some((message) => message.command === "903");
    this.sasl_ok = ok;
    return ok;
  }

  /**
   * send a raw irc line.
   */
  send_fun(line: string): void {
    if (!this.ws || this.closed) {
      throw new Error("the connection is not open");
    }
    this.ws.send(line);
  }

  /**
   * send a message to a channel or a nick.
   */
  say_fun(target: string, text: string): void {
    this.send_fun(`PRIVMSG ${target} :${text}`);
  }

  /**
   * join a channel and wait until the client is really in it.
   *
   * waiting for the `JOIN` echo is not enough — the server sends the
   * names list after it, and a message sent before that is fine, but
   * a caller that wants to know the channel is ready wants the names.
   */
  async join_fun(channel: string, key?: string): Promise<void> {
    this.send_fun(key ? `JOIN ${channel} ${key}` : `JOIN ${channel}`);
    await this.wait_for_fun(
      (message) =>
        message.command === "JOIN" &&
        (message.params[0] ?? "").toLowerCase() === channel.toLowerCase(),
      `never joined ${channel}`,
    );
    this.channels.add(channel.toLowerCase());
  }

  /**
   * leave a channel.
   */
  async part_fun(channel: string, reason?: string): Promise<void> {
    this.send_fun(reason ? `PART ${channel} :${reason}` : `PART ${channel}`);
    await this.wait_for_fun(
      (message) =>
        message.command === "PART" &&
        (message.params[0] ?? "").toLowerCase() === channel.toLowerCase(),
      `never left ${channel}`,
    );
    this.channels.delete(channel.toLowerCase());
  }

  /**
   * wait for a message matching a predicate.
   *
   * it looks at what has already arrived first, so a message that
   * came in before the wait started is not missed.
   */
  async wait_for_fun(
    predicate: (message: SHIT_1170_IRC_MESSAGE) => boolean,
    what = "the expected message",
    timeout_ms = this.timeout_ms,
  ): Promise<SHIT_1170_IRC_MESSAGE> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;

    return await new Promise<SHIT_1170_IRC_MESSAGE>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(checker);
        reject(new Error(`timed out after ${timeout_ms}ms waiting for ${what}`));
      }, timeout_ms);

      const checker = (message: SHIT_1170_IRC_MESSAGE): boolean => {
        if (!predicate(message)) return false;
        clearTimeout(timer);
        this.waiters.delete(checker);
        resolve(message);
        return true;
      };
      this.waiters.add(checker);
    });
  }

  /** the waiters that are looking for a message right now */
  private waiters: Set<(message: SHIT_1170_IRC_MESSAGE) => boolean> = new Set();

  /**
   * read messages for a while and return the ones that came in.
   *
   * this is how a caller watches a channel: `listen` keeps the
   * connection open for a while and returns everything it heard.
   */
  async listen_fun(
    duration_ms: number,
    filter?: (event: SHIT_1170_IRC_EVENT) => boolean,
  ): Promise<SHIT_1170_IRC_EVENT[]> {
    const from = this.events.length;
    const deadline = Date.now() + duration_ms;

    while (Date.now() < deadline) {
      await sleep_fun(Math.min(250, Math.max(0, deadline - Date.now())));
    }

    const fresh = this.events.slice(from);
    return filter ? fresh.filter(filter) : fresh;
  }

  /**
   * close the connection.
   */
  close_fun(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
  }

  // ------------------------------------------------------------
  // THE INCOMING PATH
  // ------------------------------------------------------------

  /**
   * handle one raw line from the server.
   */
  private on_data_fun(raw: string): void {
    const line = raw.replace(/\r\n$/, "").replace(/\n$/, "");
    if (line.length === 0) return;

    const { prefix, command, params, tags } = shit_1170_irc_split_fun(line);
    const upper = command.toUpperCase();
    const message: SHIT_1170_IRC_MESSAGE = {
      prefix,
      command: upper,
      params,
      tags,
      raw: line,
    };
    this.messages.push(message);

    // ISUPPORT (005) carries the server's capabilities.
    if (upper === "005") {
      for (const param of params.slice(1)) {
        const [key, ...rest] = param.split("=");
        if (!key) continue;
        this.isupport[key.toUpperCase()] = rest.length > 0 ? rest : [""];
      }
    }

    // the MOTD comes as 372 lines with a 376 at the end.
    if (upper === "372") this.motd.push(params[params.length - 1] ?? "");

    // 001 means registered.
    if (upper === "001") this.registered = true;

    // the SASL answers.
    if (upper === "903") this.sasl_ok = true;
    if (upper === "904" || upper === "905" || upper === "906" || upper === "907") {
      this.sasl_ok = false;
    }

    // the OPER answers.
    if (upper === "381") this.oper_ok = true;
    if (upper === "464" || upper === "465") this.oper_ok = false;

    // track the channels we are in.
    if (upper === "JOIN" && prefix) {
      const me = this.nick.toLowerCase();
      if (prefix.toLowerCase() === me) {
        this.channels.add((params[0] ?? "").toLowerCase());
      }
    }
    if (upper === "PART" && prefix) {
      const me = this.nick.toLowerCase();
      if (prefix.toLowerCase() === me) {
        this.channels.delete((params[0] ?? "").toLowerCase());
      }
    }

    const event = this.to_event_fun(message);
    if (event) this.events.push(event);

    // let anyone waiting know.
    for (const checker of [...this.waiters]) {
      checker(message);
    }
  }

  /**
   * flatten a message into an event.
   */
  private to_event_fun(message: SHIT_1170_IRC_MESSAGE): SHIT_1170_IRC_EVENT | null {
    const { command, params, prefix } = message;
    const nick = prefix ? prefix.split("!")[0] : null;

    switch (command) {
      case "PRIVMSG":
        return {
          type: "message",
          from: nick,
          target: params[0] ?? null,
          text: params[params.length - 1] ?? null,
          raw: message.raw,
        };
      case "NOTICE":
        return {
          type: "notice",
          from: nick,
          target: params[0] ?? null,
          text: params[params.length - 1] ?? null,
          raw: message.raw,
        };
      case "JOIN":
        return {
          type: "join",
          from: nick,
          target: params[0] ?? null,
          text: null,
          raw: message.raw,
        };
      case "PART":
        return {
          type: "part",
          from: nick,
          target: params[0] ?? null,
          text: params[params.length - 1] ?? null,
          raw: message.raw,
        };
      case "QUIT":
        return {
          type: "quit",
          from: nick,
          target: null,
          text: params[params.length - 1] ?? null,
          raw: message.raw,
        };
      case "NICK":
        return {
          type: "nick",
          from: nick,
          target: params[0] ?? null,
          text: null,
          raw: message.raw,
        };
      case "TOPIC":
        return {
          type: "topic",
          from: nick,
          target: params[0] ?? null,
          text: params[params.length - 1] ?? null,
          raw: message.raw,
        };
      case "PING":
        return {
          type: "ping",
          from: null,
          target: params[0] ?? null,
          text: null,
          raw: message.raw,
        };
      default:
        // the numerics and everything else are kept in `messages` but
        // are not events — an agent reads them through the numerics.
        return null;
    }
  }
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/**
 * sleep for a bit.
 */
export function sleep_fun(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * the numerics a caller might want, keyed by their code.
 */
export function shit_1170_irc_numerics_fun(
  connection: SHIT_1170_IRC_CONNECTION,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const message of connection.messages) {
    if (/^\d{3}$/.test(message.command)) {
      out[message.command] = message.params.join(" ");
    }
  }
  return out;
}

/**
 * the channels on the server, from a `353` names reply.
 */
export function shit_1170_irc_names_fun(
  connection: SHIT_1170_IRC_CONNECTION,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const message of connection.messages) {
    if (message.command === "353") {
      const channel = message.params[2] ?? "";
      const names = (message.params[3] ?? "").split(" ").filter(Boolean);
      const existing = out[channel] ?? [];
      for (const name of names) {
        if (!existing.includes(name)) existing.push(name);
      }
      out[channel] = existing;
    }
  }
  return out;
}
// ========================================
// copyright 2026 by sleet.near
