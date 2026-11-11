// =================================================
// THE IRC PROTOCOL LAYER.
//
// the parser, the message and event types, and the connection that
// holds the websocket open.
//
// --- WHY THE WEBSOCKET AND NOT PLAIN IRC ---
// the server sits behind a cloudflare tunnel, and a tunnel's public
// hostname route only proxies HTTP. a raw irc socket cannot get
// through it — cloudflared sends an HTTP request to the origin, the
// ircd answers with an irc greeting, and the client gets a 502.
//
// the websocket upgrade IS an HTTP handshake, so it goes through. the
// frames carry irc, so once the handshake is done it is an ordinary
// irc session.
//
// --- WHY THERE IS A PONG IN HERE ---
// the ircd's config sets `idle-timeouts: ping 1m30s, disconnect 2m30s`.
// it pings the client after 90 seconds of silence and drops the
// connection 60 seconds later if the client has not answered.
//
// a client that does not answer the ping is disconnected. that is not
// a guess — it was measured against the running server: a client that
// stayed silent was dropped at about 150 seconds, and a client that
// answered the ping stayed connected well past 200 seconds.
//
// so the connection answers every PING with a PONG. that is the
// single thing that makes a long-lived connection possible.
// =================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// the default server. a hostname only — no scheme, no port, no path.
pub const DEFAULT_SERVER: &str = "irc.shit-1170.com";
/// the default port. a websocket over TLS is 443.
pub const DEFAULT_PORT: u16 = 443;
/// the default websocket path.
pub const DEFAULT_PATH: &str = "/";
/// the default nickname.
pub const DEFAULT_NICK: &str = "sleet-agent";
/// how long to wait for the server by default.
pub const DEFAULT_TIMEOUT_MS: u64 = 20_000;

/// how often to send a PING of our own, in seconds.
///
/// the ircd pings us at 90 seconds. a client that only ever answers
/// is enough to stay connected, but sending our own ping keeps the
/// path alive through a tunnel that would otherwise drop an idle
/// TCP flow, and it proves the connection is still good.
pub const KEEPALIVE_SECONDS: u64 = 45;

/// the capabilities this client asks for.
///
/// ergo NAKs the WHOLE request if any one capability in it is not on
/// offer, so the list has to name only caps the server actually has,
/// and the bare name.
///
/// `sasl` is the one that bites: the server advertises it as
/// `sasl=PLAIN,EXTERNAL`, but a CAP REQ names it `sasl`. asking for
/// `sasl=PLAIN` fails, and the whole request is refused with a NAK,
/// so the session silently gets none of them.
///
/// `draft/chathistory` is what makes `CHATHISTORY` work, and the
/// `chathistory` ISUPPORT token says the server keeps 1000 messages
/// per channel. without it the server answers every CHATHISTORY with
/// `461 Not enough parameters`.
pub const REQUESTED_CAPS: &str = "sasl message-tags server-time echo-message extended-join account-notify away-notify chghost cap-notify userhost-in-names setname standard-replies invite-notify labeled-response account-tag batch multi-prefix draft/chathistory";

// =================================================
// THE PARSER
// =================================================

/// one thing the server said.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrcMessage {
    /// the source of the message, e.g. `irc.shit-1170.com` or a nick.
    pub prefix: Option<String>,
    /// the middle word: `001`, `PRIVMSG`, `353`, ...
    pub command: String,
    /// everything after the command.
    pub params: Vec<String>,
    /// the ircv3 message tags, e.g. `time` and `msgid`.
    pub tags: HashMap<String, String>,
    /// the whole raw line, as it came off the wire.
    pub raw: String,
}

/// a message the agent cares about, flattened for json output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrcEvent {
    /// `message`, `join`, `part`, `quit`, `nick`, `topic`, `notice`, ...
    pub kind: String,
    /// the nick it came from, if any.
    pub from: Option<String>,
    /// the channel it is about, if any.
    pub target: Option<String>,
    /// the text of the message.
    pub text: Option<String>,
    /// the ircv3 msgid, when the server sent one.
    pub msgid: Option<String>,
    /// the server-time tag, when the server sent one.
    pub at: Option<String>,
    /// the raw line.
    pub raw: String,
}

/// pull the trailing param off an irc line.
///
/// a trailing param is one that starts with `:` and runs to the end of
/// the line. everything before it is split on spaces.
fn split_line(raw: &str) -> (Option<String>, String, Vec<String>, HashMap<String, String>) {
    let mut rest = raw.to_string();
    let mut prefix: Option<String> = None;
    let mut tags: HashMap<String, String> = HashMap::new();

    // --- IRCv3 MESSAGE TAGS ---
    // with the `message-tags` capability on, every line the server
    // sends can be prefixed with `@key=value;key2=value2`. without
    // handling this, the prefix looks like part of the command and the
    // line is parsed wrong — a `CAP ACK` arrives as the command
    // `@time=2026-...` and is never recognized.
    if rest.starts_with('@') {
        if let Some(space) = rest.find(' ') {
            for pair in rest[1..space].split(';') {
                if pair.is_empty() {
                    continue;
                }
                match pair.find('=') {
                    Some(eq) => {
                        let value = pair[eq + 1..]
                            .replace("\\:", ":")
                            .replace("\\;", ";")
                            .replace("\\\\", "\\")
                            .replace("\\s", " ");
                        tags.insert(pair[..eq].to_string(), value);
                    }
                    None => {
                        tags.insert(pair.to_string(), String::new());
                    }
                }
            }
            rest = rest[space + 1..].to_string();
        } else {
            return (None, rest[1..].to_string(), Vec::new(), tags);
        }
    }

    // a prefix is a `:thing` at the very start.
    if rest.starts_with(':') {
        if let Some(space) = rest.find(' ') {
            prefix = Some(rest[1..space].to_string());
            rest = rest[space + 1..].to_string();
        } else {
            return (Some(rest[1..].to_string()), String::new(), Vec::new(), tags);
        }
    }

    // a trailing param is a `:thing` after the command.
    let mut trailing: Option<String> = None;
    if let Some(colon) = rest.find(" :") {
        trailing = Some(rest[colon + 2..].to_string());
        rest = rest[..colon].to_string();
    }

    let mut parts: Vec<String> = rest
        .split(' ')
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect();
    let command = if parts.is_empty() {
        String::new()
    } else {
        parts.remove(0)
    };
    if let Some(trailing) = trailing {
        parts.push(trailing);
    }

    (prefix, command.to_uppercase(), parts, tags)
}

/// turn a raw irc line into a typed message.
pub fn parse_line(raw: &str) -> IrcMessage {
    let raw = raw.trim();
    let (prefix, command, params, tags) = split_line(raw);
    IrcMessage {
        prefix,
        command,
        params,
        tags,
        raw: raw.to_string(),
    }
}

/// flatten a message into an event.
pub fn to_event(message: &IrcMessage) -> Option<IrcEvent> {
    let nick = message
        .prefix
        .as_ref()
        .map(|prefix| prefix.split('!').next().unwrap_or(prefix).to_string());

    let text = message.params.last().cloned();
    let msgid = message.tags.get("msgid").cloned();
    let at = message.tags.get("time").cloned();

    let kind = match message.command.as_str() {
        "PRIVMSG" => "message",
        "NOTICE" => "notice",
        "JOIN" => "join",
        "PART" => "part",
        "QUIT" => "quit",
        "NICK" => "nick",
        "TOPIC" => "topic",
        "PING" => "ping",
        "PONG" => "pong",
        _ => return None,
    };

    // for JOIN and PART the channel is the first param, and there is
    // no text. for NICK the new nick is the first param.
    let target = match kind {
        "join" | "part" => message.params.first().cloned(),
        "nick" => message.params.first().cloned(),
        _ => message.params.first().cloned(),
    };

    // --- IS IT A DIRECT MESSAGE? ---
    // a channel starts with the channel type character, which is `#`
    // on this server (see the CHANTYPES isupport token). anything
    // else — a nick — is a direct message.
    //
    // this matters because an agent has to be able to tell the two
    // apart. a DM is private and deserves a different answer than a
    // message in a channel that everyone can read.
    let is_dm = matches!(kind, "message" | "notice")
        && target
            .as_ref()
            .map(|t| !t.starts_with('#'))
            .unwrap_or(false);

    let text = match kind {
        "join" | "nick" | "ping" | "pong" => None,
        _ => text,
    };

    Some(IrcEvent {
        kind: if is_dm { "dm".to_string() } else { kind.to_string() },
        from: nick,
        target,
        text,
        msgid,
        at,
        raw: message.raw.clone(),
    })
}

// =================================================
// THE ERRORS
// =================================================

/// what can go wrong.
#[derive(Debug, thiserror::Error)]
pub enum IrcError {
    #[error("could not open a websocket to {url}: {source}")]
    Connect {
        url: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("websocket error on {url}")]
    Socket {
        url: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("timed out connecting to {url} after {timeout_ms}ms. is the server up, and does the host resolve?")]
    Timeout { url: String, timeout_ms: u64 },

    #[error("timed out after {timeout_ms}ms waiting for {what}")]
    WaitTimeout { what: String, timeout_ms: u64 },

    #[error("the connection is not open")]
    NotOpen,

    #[error("the message has a newline in it, which would break the irc line. send it as one message, or send two")]
    NewlineInMessage,

    #[error("the message has a character that cannot be sent: {character:?}")]
    BadCharacter { character: char },

    #[error("the server never sent 001 (registration)")]
    NoRegistration,

    #[error("the nickname {nick} is already in use")]
    NickInUse { nick: String },

    #[error("the server answered the capability request with a NAK: {caps}")]
    CapNak { caps: String },

    #[error("the server never answered the capability request")]
    NoCapAnswer,

    #[error("the server never answered CAP LS")]
    NoCapLs,

    #[error("the server never finished the welcome (376)")]
    NoWelcome,

    #[error("sasl login failed")]
    SaslFailed,

    #[error("the server never answered the sasl login")]
    NoSaslAnswer,

    #[error("the server never asked for the sasl payload")]
    NoSaslChallenge,

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// the result type.
pub type IrcResult<T> = Result<T, IrcError>;

/// check that a line can be sent over irc without breaking it.
///
/// irc is a line protocol: a line ends at the first newline, and
/// everything after it is read as a new command. so a newline in the
/// text is not a cosmetic problem — it ends the websocket frame, the
/// connection dies, and the message is lost.
///
/// the other control characters are refused for the same reason. a
/// null byte truncates the line at the server, and a carriage return
/// does the same thing a newline does.
///
/// the check is here, at the one place every message goes through, so
/// no caller can forget it.
pub fn check_irc_line(line: &str) -> IrcResult<()> {
    for character in line.chars() {
        match character {
            '\n' | '\r' => return Err(IrcError::NewlineInMessage),
            '\0' => return Err(IrcError::BadCharacter { character }),
            // the other control characters are legal in a message but
            // not useful, and they confuse some clients.
            c if (c.is_control()) => {
                return Err(IrcError::BadCharacter { character: c });
            }
            _ => {}
        }
    }
    Ok(())
}

// =================================================
// THE CONNECTION
// =================================================

/// the options a connection takes.
#[derive(Debug, Clone)]
pub struct IrcOptions {
    /// the hostname, no scheme and no port.
    pub server: String,
    /// the port. 443 for a websocket over TLS.
    pub port: u16,
    /// use TLS. true for wss://.
    pub tls: bool,
    /// the websocket request path.
    pub path: String,
    /// the nickname to register with.
    pub nick: String,
    /// the realname to register with.
    pub realname: String,
    /// the SASL username.
    pub sasl_user: Option<String>,
    /// the SASL password.
    pub sasl_pass: Option<String>,
    /// how long to wait for the server, in ms.
    pub timeout_ms: u64,
    /// set the `+B` bot mode on connect.
    pub bot: bool,
    /// the channels to join once the connection is up.
    pub channels: Vec<String>,
}

impl Default for IrcOptions {
    fn default() -> Self {
        IrcOptions {
            server: DEFAULT_SERVER.to_string(),
            port: DEFAULT_PORT,
            tls: true,
            path: DEFAULT_PATH.to_string(),
            nick: DEFAULT_NICK.to_string(),
            realname: DEFAULT_NICK.to_string(),
            sasl_user: None,
            sasl_pass: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            // the bot mode is on by default. the client is a program,
            // and this is how it says so. it matches the config
            // default in the store — the two must not disagree.
            bot: true,
            channels: Vec::new(),
        }
    }
}

/// an irc session over a websocket.
///
/// it wraps one websocket and keeps a list of the messages that came
/// in. every `send` is one text frame.
#[derive(Debug)]
pub struct IrcConnection {
    /// the options this connection was built with.
    pub options: IrcOptions,
    /// every message the server has sent, in order.
    pub messages: Vec<IrcMessage>,
    /// the numerics and events, flattened for output.
    pub events: Vec<IrcEvent>,
    /// the server's `005` ISUPPORT values.
    pub isupport: HashMap<String, Vec<String>>,
    /// the channels this client is in.
    pub channels: Vec<String>,
    /// the server's MOTD, if it sent one.
    pub motd: Vec<String>,
    /// true once the server has sent 001.
    pub registered: bool,
    /// the SASL result, if SASL was attempted.
    pub sasl_ok: Option<bool>,
    /// the oper result, if OPER was attempted.
    pub oper_ok: Option<bool>,

    socket: Option<tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >>,
    timeout_ms: u64,
    closed: bool,
}

impl IrcConnection {
    /// build a connection.
    pub fn new(options: IrcOptions) -> Self {
        let timeout_ms = options.timeout_ms;
        IrcConnection {
            options,
            messages: Vec::new(),
            events: Vec::new(),
            isupport: HashMap::new(),
            channels: Vec::new(),
            motd: Vec::new(),
            registered: false,
            sasl_ok: None,
            oper_ok: None,
            socket: None,
            timeout_ms,
            closed: false,
        }
    }

    /// the websocket url this connection opens.
    pub fn url(&self) -> String {
        let scheme = if self.options.tls { "wss" } else { "ws" };
        format!(
            "{}://{}:{}{}",
            scheme, self.options.server, self.options.port, self.options.path
        )
    }

    /// open the websocket and register with the server.
    ///
    /// resolves once the server has sent 001, or rejects with the reason.
    pub async fn connect(&mut self) -> IrcResult<()> {
        self.open().await?;
        self.register().await
    }

    /// open the websocket and wait for the 101.
    async fn open(&mut self) -> IrcResult<()> {
        let url = self.url();
        let timeout = Duration::from_millis(self.timeout_ms);

        // build the request. the `Origin` header is deliberately NOT
        // set: ergo rejects a websocket whose origin is not in
        // `server.websockets.allowed-origins`, and the empty-origin
        // check runs before the allowlist is consulted. a native
        // client does not send an origin at all.
        let request = url
            .parse::<tokio_tungstenite::tungstenite::http::Uri>()
            .map_err(|err| IrcError::Connect {
                url: url.clone(),
                source: Box::new(err),
            })?;

        let connect = tokio_tungstenite::connect_async(request);
        let (socket, _response) = tokio::time::timeout(timeout, connect)
            .await
            .map_err(|_| IrcError::Timeout {
                url: url.clone(),
                timeout_ms: self.timeout_ms,
            })?
            .map_err(|err| IrcError::Socket {
                url: url.clone(),
                source: Box::new(err),
            })?;

        self.socket = Some(socket);
        self.closed = false;
        Ok(())
    }

    /// register with the server: capabilities, nick, user, sasl, 001.
    async fn register(&mut self) -> IrcResult<()> {
        // --- THE ORDER MATTERS ---
        // capability negotiation happens DURING registration, not
        // after. ergo does not send `CAP LS` on its own — the client
        // asks, and the server answers. if the client waits for 001
        // first, the registration is already done and the capability
        // exchange comes too late.
        //
        // so the order is:
        //   CAP LS          ask what is on offer
        //   NICK + USER     begin registration
        //   CAP REQ         ask for what we want
        //   CAP END         finish the capability phase
        //   001             the server is now fully registered
        self.send("CAP LS 302").await?;

        self.send(&format!("NICK {}", self.options.nick)).await?;
        self.send(&format!(
            "USER {} 0 * :{}",
            self.options.nick, self.options.realname
        ))
        .await?;

        self.wait_for(|m| m.command == "CAP" && m.params.get(1) == Some(&"LS".to_string()))
            .await
            .map_err(|_| IrcError::NoCapLs)?;

        self.send(&format!("CAP REQ :{REQUESTED_CAPS}")).await?;
        let cap_answer = self
            .wait_for(|m| {
                m.command == "CAP"
                    && (m.params.get(1) == Some(&"ACK".to_string())
                        || m.params.get(1) == Some(&"NAK".to_string()))
            })
            .await
            .map_err(|_| IrcError::NoCapAnswer)?;

        if cap_answer.params.get(1) == Some(&"NAK".to_string()) {
            return Err(IrcError::CapNak {
                caps: cap_answer.params.get(2).cloned().unwrap_or_default(),
            });
        }

        // SASL has to happen before CAP END — the `sasl` capability is
        // what makes the server accept the AUTHENTICATE command, and
        // the capability phase ends with CAP END.
        if let Some(user) = self.options.sasl_user.clone() {
            let pass = self.options.sasl_pass.clone().unwrap_or_default();
            self.sasl(&user, &pass).await?;
        }

        self.send("CAP END").await?;

        // wait for 001.
        //
        // --- WHY THE 433 IS CHECKED ---
        // `433 ERR_NICKNAMEINUSE` means the nickname is taken. that
        // is PERMANENT until the nick changes — retrying forever will
        // never succeed, and the old code sat in a reconnect loop
        // with a misleading "the server never sent 001" message.
        //
        // so the 433 is caught and reported as what it is.
        let registration = self
            .wait_for(|m| m.command == "001" || m.command == "433")
            .await
            .map_err(|_| IrcError::NoRegistration)?;

        if registration.command == "433" {
            return Err(IrcError::NickInUse {
                nick: self.options.nick.clone(),
            });
        }

        // wait for the welcome burst to finish, so a caller that takes
        // a snapshot of the messages right after connecting does not
        // get the tail of the MOTD mixed into its own answer.
        //
        // 376 (end of MOTD) ends the burst. a server with no MOTD does
        // not send it, so this cannot block forever — the wait is
        // capped and the session is still usable without it.
        let _ = self
            .wait_for_with_timeout(|m| m.command == "376", 4000)
            .await;

        // --- THE BOT MODE ---
        // `+B` is the user mode that marks a client as a bot. the
        // server then attaches the ircv3 `bot` tag to everything the
        // client says, which is how a well-behaved client says "this
        // is a program, not a person".
        //
        // it is opt-in in the sense that there is a flag to turn it
        // off, but the default is on — see the note on `bot` in
        // `IrcOptions`.
        //
        // --- WHY THE CONFIRMATION IS NOT THE 221 ---
        // the server sends `221 <nick> +Z` at registration, with the
        // mode list as it was BEFORE we asked. so waiting for a 221
        // finds that stale one at once and never checks whether our
        // mode was applied.
        //
        // the answer we want is the `MODE` line the server echoes
        // back for our own command — that one carries the `+B`.
        if self.options.bot {
            self.send(&format!("MODE {} +B", self.options.nick)).await?;
            // the echo is `MODE <nick> +B`, so the mode is the SECOND
            // param. the first one is the nick the mode applies to.
            let _ = self
                .wait_for_with_timeout(
                    |m| {
                        m.command == "MODE"
                            && m.params.iter().any(|p| p.contains('B'))
                    },
                    3000,
                )
                .await;
        }

        Ok(())
    }

    /// log in with SASL PLAIN.
    ///
    /// the AUTHENTICATE command carries a base64 blob of
    /// `user\0user\0password`.
    ///
    /// --- WHY "AUTHENTICATE" AND NOT "AUTH" ---
    /// the ircv3 spec names the command `AUTHENTICATE`, and ergo
    /// implements that name. sending `AUTH` gets
    /// `421 AUTH :Unknown command`, because `AUTH` is the old
    /// pre-ircv3 name and ergo does not accept it.
    ///
    /// NOTE: this has to run BEFORE `CAP END`, because the sasl
    /// capability is what makes the server accept the command.
    pub async fn sasl(&mut self, username: &str, password: &str) -> IrcResult<bool> {
        self.send("AUTHENTICATE PLAIN").await?;
        self.wait_for(|m| {
            m.command == "AUTHENTICATE" && m.params.first() == Some(&"+".to_string())
        })
        .await
        .map_err(|_| IrcError::NoSaslChallenge)?;

        use base64::Engine;
        let payload = base64::engine::general_purpose::STANDARD
            .encode(format!("{username}\0{username}\0{password}"));
        self.send(&format!("AUTHENTICATE {payload}")).await?;

        self.wait_for(|m| {
            matches!(
                m.command.as_str(),
                "903" | "904" | "905" | "906" | "907"
            )
        })
        .await
        .map_err(|_| IrcError::NoSaslAnswer)?;

        let ok = self.messages.iter().any(|m| m.command == "903");
        self.sasl_ok = Some(ok);
        if !ok {
            return Err(IrcError::SaslFailed);
        }
        Ok(true)
    }

    /// send a raw irc line.
    ///
    /// --- WHY THE LINE IS CHECKED ---
    /// irc is a LINE protocol. a newline in the text ends the line,
    /// and everything after it is read as a new command. so a
    /// message with a newline in it does not just look wrong — it
    /// breaks the websocket frame, the connection dies, and the
    /// message is lost.
    ///
    /// it is also a protocol injection: a crafted message could
    /// smuggle a second irc command in behind the first.
    ///
    /// so the line is checked here, at the one place every message
    /// goes through, before it reaches the socket.
    pub async fn send(&mut self, line: &str) -> IrcResult<()> {
        check_irc_line(line)?;
        use futures_util::SinkExt;
        let socket = self.socket.as_mut().ok_or(IrcError::NotOpen)?;
        if self.closed {
            return Err(IrcError::NotOpen);
        }
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                line.to_string().into(),
            ))
            .await
            .map_err(|err| IrcError::Socket {
                url: self.url(),
                source: Box::new(err),
            })?;
        Ok(())
    }

    /// send a message to a channel or a nick.
    pub async fn say(&mut self, target: &str, text: &str) -> IrcResult<()> {
        self.send(&format!("PRIVMSG {target} :{text}")).await
    }

    /// join a channel.
    ///
    /// this only sends the JOIN. it does NOT wait for the echo.
    ///
    /// --- WHY IT DOES NOT WAIT ---
    /// waiting for the reply means reading the socket, and the read
    /// loop owns the socket. a second reader on the same websocket
    /// would race it and steal the frames the read loop needs.
    ///
    /// so the wait happens somewhere else: the caller subscribes to
    /// the session's event log and waits for the JOIN to show up
    /// there. the read loop is the only reader, and the wait is on a
    /// copy of what it produced.
    pub async fn join(&mut self, channel: &str) -> IrcResult<()> {
        self.send(&format!("JOIN {channel}")).await
    }

    /// leave a channel.
    pub async fn part(&mut self, channel: &str, reason: Option<&str>) -> IrcResult<()> {
        match reason {
            Some(reason) => self.send(&format!("PART {channel} :{reason}")).await?,
            None => self.send(&format!("PART {channel}")).await?,
        }
        Ok(())
    }

    /// wait for a message matching a predicate.
    ///
    /// it looks at what has already arrived first, so a message that
    /// came in before the wait started is not missed.
    pub async fn wait_for(
        &mut self,
        predicate: impl Fn(&IrcMessage) -> bool,
    ) -> IrcResult<IrcMessage> {
        self.wait_for_with_timeout(predicate, self.timeout_ms).await
    }

    /// wait for a message matching a predicate, with an explicit timeout.
    pub async fn wait_for_with_timeout(
        &mut self,
        predicate: impl Fn(&IrcMessage) -> bool,
        timeout_ms: u64,
    ) -> IrcResult<IrcMessage> {
        if let Some(existing) = self.messages.iter().find(|m| predicate(m)) {
            return Ok(existing.clone());
        }

        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(IrcError::WaitTimeout {
                    what: "the expected message".to_string(),
                    timeout_ms,
                });
            }
            let message = tokio::time::timeout(remaining, self.read_message())
                .await
                .map_err(|_| IrcError::WaitTimeout {
                    what: "the expected message".to_string(),
                    timeout_ms,
                })??;
            if predicate(&message) {
                return Ok(message);
            }
        }
    }

    /// read the next message off the wire.
    pub async fn read_message(&mut self) -> IrcResult<IrcMessage> {
        use futures_util::StreamExt;
        let socket = self.socket.as_mut().ok_or(IrcError::NotOpen)?;

        loop {
            let next = socket.next().await;
            let Some(next) = next else {
                self.closed = true;
                return Err(IrcError::NotOpen);
            };

            match next {
                Ok(message) => {
                    let text = match message {
                        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
                        tokio_tungstenite::tungstenite::Message::Binary(bytes) => {
                            match String::from_utf8(bytes.to_vec()) {
                                Ok(text) => text,
                                Err(_) => continue,
                            }
                        }
                        tokio_tungstenite::tungstenite::Message::Close(_) => {
                            self.closed = true;
                            return Err(IrcError::NotOpen);
                        }
                        _ => continue,
                    };

                    for line in text.split('\n') {
                        let line = line.trim_end_matches('\r');
                        if line.is_empty() {
                            continue;
                        }
                        let parsed = parse_line(line);
                        self.on_data(&parsed).await;
                        return Ok(parsed);
                    }
                }
                Err(err) => {
                    self.closed = true;
                    return Err(IrcError::Socket {
                        url: self.url(),
                        source: Box::new(err),
                    });
                }
            }
        }
    }

    /// handle one raw line from the server.
    ///
    /// this is async because it may have to ANSWER the server — a PING
    /// has to be answered with a PONG, and sending is async.
    async fn on_data(&mut self, message: &IrcMessage) {
        self.messages.push(message.clone());

        // ISUPPORT (005) carries the server's capabilities.
        if message.command == "005" {
            for param in message.params.iter().skip(1) {
                let (key, rest) = match param.split_once('=') {
                    Some((key, rest)) => (key, vec![rest.to_string()]),
                    None => (param.as_str(), vec![String::new()]),
                };
                if key.is_empty() {
                    continue;
                }
                self.isupport
                    .insert(key.to_uppercase(), rest);
            }
        }

        // the MOTD comes as 372 lines with a 376 at the end.
        if message.command == "372"
            && let Some(line) = message.params.last() {
                self.motd.push(line.clone());
            }

        // 001 means registered.
        if message.command == "001" {
            self.registered = true;
        }

        // the SASL answers.
        if message.command == "903" {
            self.sasl_ok = Some(true);
        }
        if matches!(message.command.as_str(), "904" | "905" | "906" | "907") {
            self.sasl_ok = Some(false);
        }

        // the OPER answers.
        if message.command == "381" {
            self.oper_ok = Some(true);
        }
        if matches!(message.command.as_str(), "464" | "465") {
            self.oper_ok = Some(false);
        }

        // --- THE PONG ---
        // this is the thing that keeps a long-lived connection alive.
        // the ircd pings after 90 seconds of silence and drops the
        // connection 60 seconds later if the client has not answered.
        // a client that does not answer is disconnected.
        //
        // the pong carries the same token the ping carried, which is
        // what the server compares.
        if message.command == "PING" {
            let token = message.params.first().cloned().unwrap_or_default();
            // the pong carries the same token the ping carried, which
            // is what the server compares. the server sends the
            // PINGING client's nick as the token, so the answer is
            // `PONG <our nick>`.
            //
            // this AWAITS the send. an earlier version dropped the
            // future without polling it, which meant the pong was
            // never written to the socket and the server dropped the
            // connection with "Ping timeout: 2m30s" every time.
            if let Err(err) = self.send(&format!("PONG {token}")).await {
                tracing::warn!(%err, "could not answer the ping");
            }
        }

        // track the channels we are in.
        //
        // --- WHY THE NICK IS SPLIT OFF THE PREFIX ---
        // the prefix of a message from a client is
        // `nick!ident@host`, not the bare nick. comparing the whole
        // prefix with the nick never matches, so the channel list
        // stayed empty and every "am i in this channel?" check failed.
        let me = self.options.nick.to_lowercase();
        let prefix_nick = message
            .prefix
            .as_ref()
            .map(|prefix| prefix.split('!').next().unwrap_or(prefix).to_lowercase());

        if message.command == "JOIN"
            && prefix_nick.as_deref() == Some(me.as_str())
                && let Some(channel) = message.params.first() {
                    let lower = channel.to_lowercase();
                    if !self.channels.iter().any(|c| c.to_lowercase() == lower) {
                        self.channels.push(channel.clone());
                    }
                }
        if message.command == "PART"
            && prefix_nick.as_deref() == Some(me.as_str())
                && let Some(channel) = message.params.first() {
                    let lower = channel.to_lowercase();
                    self.channels.retain(|c| c.to_lowercase() != lower);
                }

        if let Some(event) = to_event(message) {
            self.events.push(event);
        }
    }

    /// forget that we are in any channel.
    ///
    /// --- WHY THIS EXISTS ---
    /// the channel list says which channels WE are in. when the socket
    /// dies, the server forgets us too — every channel is left behind.
    ///
    /// so the list has to be cleared on the way out, or the reconnect
    /// will think it is still in the channels and skip the JOIN. the
    /// client then believes it is in a channel it is not in, and every
    /// message to it is refused with `403 No such channel`.
    ///
    /// that is a permanent wedge: the agent reconnects, believes it is
    /// fine, and sends into a channel where nobody is listening.
    pub fn forget_channels(&mut self) {
        self.channels.clear();
    }

    /// close the connection.
    pub async fn close(&mut self) {
        self.closed = true;
        if let Some(socket) = self.socket.as_mut() {
            let _ = socket.close(None).await;
        }
        self.socket = None;
    }


    /// true when the socket is gone.
    pub fn is_closed(&self) -> bool {
        self.closed
    }
}

// =================================================
// THE HELPERS
// =================================================

/// the numerics a caller might want, keyed by their code.
pub fn numerics(connection: &IrcConnection) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for message in &connection.messages {
        if message.command.len() == 3
            && message.command.chars().all(|c| c.is_ascii_digit())
        {
            out.insert(
                message.command.clone(),
                message.params.join(" "),
            );
        }
    }
    out
}

/// one entry in a channel's names list.
#[derive(Debug, Clone, serde::Serialize)]
pub struct NameEntry {
    /// the nick, without the ident and the host.
    pub nick: String,
    /// the nick as it appeared, `nick!ident@host`.
    pub raw: String,
    /// the channel operator prefix, `@` or `&`, when there is one.
    pub operator: Option<String>,
    /// the `+` or `%` prefix, when there is one.
    pub voice: Option<String>,
}

/// the names in a channel, split into their parts.
///
/// the `353` names reply gives `nick!ident@host`, and sometimes a
/// prefix before it. an agent wants the nick on its own, so the parts
/// are pulled apart here.
pub fn name_entries(connection: &IrcConnection) -> HashMap<String, Vec<NameEntry>> {
    let mut out: HashMap<String, Vec<NameEntry>> = HashMap::new();
    for message in &connection.messages {
        if message.command != "353" {
            continue;
        }
        let channel = message.params.get(2).cloned().unwrap_or_default();
        let entry = out.entry(channel).or_default();

        for name in message
            .params
            .get(3)
            .cloned()
            .unwrap_or_default()
            .split(' ')
            .filter(|n| !n.is_empty())
        {
            // the prefix comes before the nick: `@nick`, `+nick`, `%nick`.
            let (prefix, rest) = match name.chars().next() {
                Some(c) if "@&+%".contains(c) => (Some(c.to_string()), &name[1..]),
                _ => (None, name),
            };

            let nick = rest.split('!').next().unwrap_or(rest).to_string();
            if entry.iter().any(|e| e.nick == nick) {
                continue;
            }
            entry.push(NameEntry {
                nick,
                raw: name.to_string(),
                operator: prefix
                    .as_ref()
                    .filter(|p| matches!(p.as_str(), "@" | "&"))
                    .cloned(),
                voice: prefix
                    .as_ref()
                    .filter(|p| matches!(p.as_str(), "+" | "%"))
                    .cloned(),
            });
        }
    }
    out
}

/// the channels on the server, from a `353` names reply.
pub fn names(connection: &IrcConnection) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for message in &connection.messages {
        if message.command == "353" {
            let channel = message.params.get(2).cloned().unwrap_or_default();
            let names = message
                .params
                .get(3)
                .cloned()
                .unwrap_or_default()
                .split(' ')
                .filter(|n| !n.is_empty())
                .map(|n| n.to_string())
                .collect::<Vec<_>>();
            let entry = out.entry(channel).or_default();
            for name in names {
                if !entry.contains(&name) {
                    entry.push(name);
                }
            }
        }
    }
    out
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
