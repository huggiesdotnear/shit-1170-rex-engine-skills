// =================================================
// THE CLI.
//
// the daemon holds the irc connection open and serves the http api.
// the client subcommands talk to that daemon.
//
// so the shape is:
//
//   shit-1170-rex-irc serve            start the daemon
//   shit-1170-rex-irc send ...         post a message
//   shit-1170-rex-irc read ...         read what came in
//   shit-1170-rex-irc watch            stream messages
//   shit-1170-rex-irc status           what is going on
//   shit-1170-rex-irc config ...       the local store
//
// --- WHY A DAEMON AND NOT A BUNCH OF ONE-SHOT BINS ---
// the ircd pings the client after 90 seconds of silence and drops it
// 60 seconds later. a one-shot bin that connects, does one thing, and
// disconnects is fine, but an agent that wants to READ a channel while
// it POSTS to it needs one connection that stays up.
//
// so the daemon is the connection, and the client subcommands are
// thin http calls against it.
// =================================================

use clap::{Parser, Subcommand};
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;

use shit_1170_rex_irc::api;
use shit_1170_rex_irc::irc::IrcOptions;
use shit_1170_rex_irc::reader;
use shit_1170_rex_irc::session::Session;
use shit_1170_rex_irc::store;

#[derive(Parser)]
#[command(name = "shit-1170-rex-irc", about = "a long-lived irc client for the shit-1170 server")]
struct Cli {
    /// check that the daemon answers with this nickname.
    ///
    /// two daemons can end up on the same port, and then the client
    /// commands talk to the wrong one — silently, with the wrong data.
    /// with this flag, a mismatch is an error.
    #[arg(long, global = true)]
    expect_nick: Option<String>,

    #[command(subcommand)]
    command: Command,
}

impl Cli {
    /// the port the client commands talk to.
    ///
    /// every client subcommand has its own `--api-port`, and the
    /// daemon itself has none — it IS the daemon.
    fn api_port(&self) -> u16 {
        match &self.command {
            Command::Serve { api_port, .. } => *api_port,
            Command::Send { api_port, .. }
            | Command::Read { api_port, .. }
            | Command::Reply { api_port, .. }
            | Command::Wait { api_port, .. }
            | Command::Join { api_port, .. }
            | Command::Part { api_port, .. }
            | Command::Who { api_port, .. }
            | Command::Raw { api_port, .. }
            | Command::History { api_port, .. }
            | Command::Watch { api_port, .. }
            | Command::Status { api_port, .. } => *api_port,
            Command::Config { .. } => 8787,
        }
    }
}

#[derive(Subcommand)]
enum Command {
    /// start the daemon: connect, and serve the http api.
    Serve {
        /// the address to listen on.
        #[arg(long, default_value = "127.0.0.1:8787")]
        listen: String,
        /// the hostname of the irc server.
        #[arg(long)]
        server: Option<String>,
        /// the nickname to register with.
        #[arg(long)]
        nick: Option<String>,
        /// the realname to register with.
        #[arg(long)]
        realname: Option<String>,
        /// the port of the irc server.
        #[arg(long)]
        port: Option<u16>,
        /// the sasl account name.
        #[arg(long)]
        sasl_user: Option<String>,
        /// the sasl account password.
        #[arg(long)]
        sasl_pass: Option<String>,
        /// set the +B bot mode. this is the default already.
        #[arg(long)]
        bot: bool,
        /// do NOT set the +B bot mode.
        ///
        /// the client is a program and the bot mode is how it says
        /// so. only turn it off if the client is standing in for a
        /// person, which it should not be.
        #[arg(long)]
        no_bot: bool,
        /// connect without tls.
        #[arg(long)]
        no_tls: bool,
        /// a channel to join on connect.
        #[arg(long)]
        join: Vec<String>,
        /// the port the client subcommands talk to.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// post a message.
    Send {
        /// the channel or nick.
        #[arg(long)]
        target: String,
        /// the text.
        #[arg(long)]
        message: String,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// send a message and wait for the reply, in one call.
    ///
    /// this is the whole conversation loop in a single command: it
    /// posts, then blocks until something comes back, and answers
    /// with both the send result and what was heard.
    ///
    /// the agent's own message is skipped, so the reply it gets is
    /// really somebody else's.
    Reply {
        /// the channel or nick.
        #[arg(long)]
        target: String,
        /// the text to send.
        #[arg(long)]
        message: String,
        /// how long to wait for the reply, in seconds.
        #[arg(long, default_value_t = 30)]
        seconds: u64,
        /// only accept a reply from this nick.
        #[arg(long)]
        from: Option<String>,
        /// only accept a reply of this kind.
        ///
        /// `conversation` is the default: a channel message or a DM.
        /// `message` is a channel message only, `dm` is a private
        /// message only, `any` is everything.
        #[arg(long, default_value = "conversation")]
        kind: String,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// read what came in.
    Read {
        /// the cursor. 0 reads everything the log holds.
        #[arg(long, default_value_t = 0)]
        since: u64,
        /// how many events.
        #[arg(long, default_value_t = 50)]
        limit: usize,
        /// only events of this kind.
        #[arg(long)]
        kind: Option<String>,
        /// only events for this channel.
        #[arg(long)]
        target: Option<String>,
        /// drop the events from our own nick.
        #[arg(long)]
        exclude_self: bool,
        /// leave out the raw irc line.
        ///
        /// the raw line is about three times the size of the useful
        /// fields and carries the same information. this keeps the
        /// answer small when the raw line is not needed.
        #[arg(long)]
        compact: bool,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// join a channel.
    Join {
        /// the channel.
        #[arg(long)]
        channel: String,
        /// do not create the channel if it does not exist.
        ///
        /// this server creates a channel the moment anyone joins it,
        /// so a typo quietly makes a new empty room — and the agent
        /// goes on talking to it as if it were the channel it meant.
        #[arg(long)]
        no_create: bool,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// leave a channel.
    Part {
        /// the channel.
        #[arg(long)]
        channel: String,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// who is in a channel, and which of them are bots.
    Who {
        /// the channel.
        #[arg(long)]
        channel: String,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// send any irc line. the escape hatch.
    Raw {
        /// the line to send.
        #[arg(long)]
        line: String,
        /// how long to wait for the server's answer.
        #[arg(long, default_value_t = 800)]
        wait_ms: u64,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// wait for a message to arrive.
    ///
    /// this blocks until something comes in, so the agent does not
    /// have to poll. it is the difference between a sleep-and-read
    /// loop and one call.
    ///
    /// --- WHY THE AGENT'S OWN MESSAGES ARE SKIPPED ---
    /// the server advertises `echo-message`, so every message the
    /// agent sends comes straight back to it. waiting for a reply
    /// would return the agent's own message and call it a reply —
    /// which is how a conversation turns into talking to itself.
    ///
    /// so by default `wait` skips the messages from our own nick.
    /// `--include-self` turns that off when you want to see them.
    ///
    /// --- WHY THE DEFAULT KIND IS "conversation" ---
    /// `--kind message` is strict: it means a message in a channel,
    /// and it excludes a DM. so an agent waiting for a reply with
    /// `--kind message` would never see a private message, and would
    /// not know why.
    ///
    /// the default is `conversation`, which is a channel message OR a
    /// DM — the things a person would read as being spoken to them.
    /// the join, part and quit notices are traffic, not conversation.
    Wait {
        /// how long to wait, in seconds.
        #[arg(long, default_value_t = 30)]
        seconds: u64,
        /// only messages from this nick.
        #[arg(long)]
        from: Option<String>,
        /// only messages for this channel.
        #[arg(long)]
        target: Option<String>,
        /// only messages of this kind.
        ///
        /// `conversation` is the default: a channel message or a DM.
        /// `message` is a channel message only, `dm` is a private
        /// message only, `any` is everything the server sends.
        #[arg(long, default_value = "conversation")]
        kind: String,
        /// the cursor to start from.
        ///
        /// the default is "from now" — the wait only sees messages
        /// that arrive while it is waiting. pass the cursor from the
        /// last read to catch up on what came before.
        ///
        /// --- WHY THE CURSOR MATTERS WHEN YOU PAIR WITH A SEND ---
        /// a reply can arrive in the moment between the send going
        /// out and the wait starting. a wait with no cursor starts
        /// AFTER that reply, so it never sees it — and the agent
        /// waits 30 seconds for an answer that already arrived.
        ///
        /// so a send that is followed by a wait must pass the
        /// cursor. `send` reports it as `cursor_before`:
        ///
        ///     CB=$(send --target "#chan" --message "hi" | jq .cursor_before)
        ///     wait --seconds 30 --since "$CB"
        ///
        /// or just use `reply`, which does this pairing for you.
        #[arg(long)]
        since: Option<u64>,
        /// include our own messages. off by default.
        #[arg(long)]
        include_self: bool,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// the server's own history for a channel.
    History {
        /// the channel.
        #[arg(long)]
        channel: String,
        /// how many messages.
        #[arg(long, default_value_t = 50)]
        limit: usize,
        /// only messages after this msgid.
        #[arg(long)]
        after: Option<String>,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// stream the messages as they arrive.
    ///
    /// the filters are the same ones `read` takes. without them the
    /// stream carries every join and quit on the server, which is
    /// noise.
    Watch {
        /// only events of this kind, e.g. `message` or `dm`.
        #[arg(long)]
        kind: Option<String>,
        /// only events for this channel.
        #[arg(long)]
        target: Option<String>,
        /// only events from this nick.
        #[arg(long)]
        from: Option<String>,
        /// drop the events from our own nick.
        #[arg(long)]
        exclude_self: bool,
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// what is going on.
    Status {
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// the local store.
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
}

#[derive(Subcommand)]
enum ConfigAction {
    /// show the config.
    Show,
    /// set a value: `key=value`.
    Set {
        #[arg(long)]
        set: Vec<String>,
        /// save the config.
        #[arg(long)]
        save: bool,
    },
    /// store the account password, so the daemon logs in on its own.
    SaveCredentials {
        /// the password.
        password: String,
        /// the nick it belongs to.
        #[arg(long)]
        nick: Option<String>,
    },
    /// show what was seen.
    History {
        /// how many entries.
        #[arg(long, default_value_t = 50)]
        limit: usize,
    },
    /// forget the history.
    Forget,
}

/// the base url of the daemon.
fn api_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    // --- THE IDENTITY CHECK ---
    // it runs before the command, for every command that talks to a
    // daemon. `serve` is the daemon itself, so it is skipped.
    if let Some(expected) = cli.expect_nick.as_deref() {
        let port = cli.api_port();
        if let Err(err) = check_daemon(&api_url(port), Some(expected)).await {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }

    match cli.command {
        Command::Serve {
            listen,
            server,
            nick,
            realname,
            port,
            sasl_user,
            sasl_pass,
            bot,
            no_bot,
            no_tls,
            join,
            api_port,
        } => {
            let config = store::read_config();

            let nick = nick.unwrap_or(config.nick.clone());
            let stored = store::credential_for(&nick);

            // the channels to join once connected.
            let channels: Vec<String> = if join.is_empty() {
                config.channels.clone()
            } else {
                join
            };

            let mut options = IrcOptions {
                server: server.unwrap_or(config.server.clone()),
                port: port.unwrap_or(config.port),
                tls: !no_tls && config.tls,
                path: "/".to_string(),
                nick: nick.clone(),
                realname: realname.unwrap_or(config.realname.clone()),
                sasl_user: sasl_user
                    .or_else(|| stored.as_ref().map(|c| c.account.clone().unwrap_or(nick.clone())))
                    .or_else(|| stored.as_ref().map(|_| nick.clone())),
                sasl_pass: sasl_pass.or_else(|| stored.map(|c| c.password)),
                timeout_ms: 20_000,
                bot: bot || (config.bot && !no_bot),
                channels: channels.clone(),
            };
            options.channels = channels;

            let session = Session::new(options);

            // start the read loop. it owns the connection, and it
            // joins the channels on its own once it is up.
            let reader_session = session.clone();
            tokio::spawn(async move {
                reader::run(reader_session).await;
            });

            let app = api::router(session);

            // the port the client subcommands talk to is the same one
            // the daemon listens on.
            let _ = api_port;

            let listener = tokio::net::TcpListener::bind(&listen).await?;
            tracing::info!(address = %listen, "the irc daemon is serving");

            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown_signal())
                .await?;
        }

        Command::Send {
            target,
            message,
            api_port,
        } => {
            let body = json!({ "target": target, "message": message });
            let answer = post(&api_url(api_port), "/send", &body).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Read {
            since,
            limit,
            kind,
            target,
            exclude_self,
            compact,
            api_port,
        } => {
            let mut query = format!("?since={since}&limit={limit}");
            if let Some(kind) = kind {
                query.push_str(&format!("&kind={}", urlencode(&kind)));
            }
            if let Some(target) = target {
                query.push_str(&format!("&target={}", urlencode(&target)));
            }
            if exclude_self {
                query.push_str("&exclude_self=true");
            }
            if compact {
                query.push_str("&compact=true");
            }
            let answer = get(&api_url(api_port), &format!("/messages{query}")).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Join {
            channel,
            no_create,
            api_port,
        } => {
            let body = json!({ "channel": channel, "no_create": no_create });
            let answer = post(&api_url(api_port), "/join", &body).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Part { channel, api_port } => {
            let body = json!({ "channel": channel });
            let answer = post(&api_url(api_port), "/part", &body).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Who { channel, api_port } => {
            let query = format!("?channel={}", urlencode(&channel));
            let answer = get(&api_url(api_port), &format!("/who{query}")).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Raw {
            line,
            wait_ms,
            api_port,
        } => {
            let body = json!({ "line": line, "wait_ms": wait_ms });
            let answer = post(&api_url(api_port), "/raw", &body).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Reply {
            target,
            message,
            seconds,
            from,
            kind,
            api_port,
        } => {
            // --- WHY THIS IS ONE CALL AND NOT TWO ---
            // the conversation loop is "post, then wait for the
            // answer". making the agent do that as two calls means
            // it has to track the cursor between them, and that is
            // where the self-echo bug came from.
            //
            // so this does both, and the cursor handling is internal.

            // --- WHY THE CURSOR IS TAKEN BEFORE THE SEND ---
            // the send waits a moment for the echo. a reply can
            // arrive DURING that wait, and by the time the send
            // answers, the cursor it returns is already past the
            // reply — so the reply would be missed.
            //
            // so the cursor is read BEFORE posting. everything after
            // that point is a candidate reply.
            //
            // the send also reports `cursor_before` — the cursor it
            // saw when the message went out. if it is EARLIER than
            // what we read here, the earlier one wins, because it
            // covers a wider window.
            let before_send = get(&api_url(api_port), "/status")
                .await?
                .get("cursor")
                .and_then(|c| c.as_u64())
                .unwrap_or(0);

            // 1. post.
            let body = json!({ "target": target, "message": message });
            let sent = post(&api_url(api_port), "/send", &body).await?;

            // the earlier of the two cursors wins — it covers more.
            let mut cursor = sent
                .get("cursor_before")
                .and_then(|c| c.as_u64())
                .unwrap_or(before_send)
                .min(before_send);

            // 2. wait for the answer. the agent's own message is
            //    skipped, so the reply it gets is really somebody
            //    else's.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(seconds);
            let mut replies: Vec<serde_json::Value> = Vec::new();

            while std::time::Instant::now() < deadline {
                let mut query = format!("?since={cursor}&limit=100&exclude_self=true");
                if !kind.is_empty() {
                    query.push_str(&format!("&kind={}", urlencode(&kind)));
                }
                if let Some(from) = &from {
                    query.push_str(&format!("&from={}", urlencode(from)));
                }

                let answer = get(&api_url(api_port), &format!("/messages{query}")).await?;
                let messages = answer
                    .get("messages")
                    .and_then(|m| m.as_array())
                    .cloned()
                    .unwrap_or_default();

                // the cursor moves first, so a filtered-out message
                // does not come back on the next poll.
                if let Some(head) = answer.get("cursor").and_then(|c| c.as_u64()) {
                    cursor = head;
                }

                if !messages.is_empty() {
                    replies = messages;
                    break;
                }

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }

            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "ok": sent.get("ok").cloned().unwrap_or(json!(true)),
                    "target": target,
                    "message": message,
                    "delivered": sent.get("delivered").cloned().unwrap_or(json!(false)),
                    "numeric": sent.get("numeric").cloned().unwrap_or(json!(null)),
                    "cursor": cursor,
                    // --- THE SAME SHAPE AS read AND wait ---
                    // an agent writing one "give me the messages"
                    // parser should not break on the reply command.
                    // so `count` and `messages` are the names here
                    // too, with the older names kept as aliases.
                    "count": replies.len(),
                    "messages": replies,
                    "reply_count": replies.len(),
                    "replies": replies,
                }))?
            );
        }

        Command::Wait {
            seconds,
            from,
            target,
            kind,
            since,
            include_self,
            api_port,
        } => {
            // --- WHY THIS POLLS INSTEAD OF STREAMING ---
            // the daemon has a live stream at /stream, but a stream
            // does not end: it holds the connection open forever. the
            // agent wants "the next message", which has a natural end.
            //
            // so this polls the daemon's cursor endpoint and returns
            // as soon as something matches. the wait happens HERE,
            // not in the agent, so the agent makes one call instead of
            // a sleep-and-read loop.
            // --- WHY THE CURSOR DEFAULTS TO "FROM NOW" ---
            // a wait with no cursor would start at 0 and read the
            // whole backlog — the join notices, the old test
            // messages, everything. the agent asked to wait for the
            // NEXT message, not to re-read the channel.
            //
            // so with no cursor the wait starts at the daemon's
            // current head, and only sees what arrives while it
            // waits. pass `--since` to catch up on what came before.
            let mut cursor = match since {
                Some(since) => since,
                None => {
                    let status = get(&api_url(api_port), "/status").await?;
                    status.get("cursor").and_then(|c| c.as_u64()).unwrap_or(0)
                }
            };

            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(seconds);
            let mut found: Vec<serde_json::Value> = Vec::new();

            while std::time::Instant::now() < deadline {
                let mut query = format!("?since={cursor}&limit=100");
                if !kind.is_empty() {
                    query.push_str(&format!("&kind={}", urlencode(&kind)));
                }
                if let Some(target) = &target {
                    query.push_str(&format!("&target={}", urlencode(target)));
                }
                if let Some(from) = &from {
                    query.push_str(&format!("&from={}", urlencode(from)));
                }
                // the agent's own messages are not replies. the server
                // echoes them back, so they have to be filtered out or
                // the agent ends up talking to itself.
                if !include_self {
                    query.push_str("&exclude_self=true");
                }

                let answer = get(&api_url(api_port), &format!("/messages{query}")).await?;
                let messages = answer
                    .get("messages")
                    .and_then(|m| m.as_array())
                    .cloned()
                    .unwrap_or_default();

                // --- THE CURSOR MOVES PAST EVERYTHING SEEN ---
                // this happens BEFORE the emptiness check, and it
                // happens whether or not anything matched. the
                // filtered-out messages still advanced the log, so
                // the next poll must start after them — otherwise
                // they are returned again on the next iteration and
                // the wait never sees the real reply.
                if let Some(head) = answer.get("cursor").and_then(|c| c.as_u64()) {
                    cursor = head;
                }

                if !messages.is_empty() {
                    found = messages;
                    break;
                }

                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }

            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "ok": true,
                    "waited_seconds": seconds,
                    "cursor": cursor,
                    "count": found.len(),
                    "messages": found,
                }))?
            );
        }

        Command::History {
            channel,
            limit,
            after,
            api_port,
        } => {
            let mut query = format!("?channel={}&limit={limit}", urlencode(&channel));
            if let Some(after) = after {
                query.push_str(&format!("&after={}", urlencode(&after)));
            }
            let answer = get(&api_url(api_port), &format!("/history{query}")).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Watch {
            kind,
            target,
            from,
            exclude_self,
            api_port,
        } => {
            // the stream is server-sent events.
            let mut query = String::new();
            if let Some(kind) = &kind {
                query.push_str(&format!("?kind={}", urlencode(kind)));
            }
            if let Some(target) = &target {
                let sep = if query.is_empty() { "?" } else { "&" };
                query.push_str(&format!("{sep}target={}", urlencode(target)));
            }
            if let Some(from) = &from {
                let sep = if query.is_empty() { "?" } else { "&" };
                query.push_str(&format!("{sep}from={}", urlencode(from)));
            }
            if exclude_self {
                let sep = if query.is_empty() { "?" } else { "&" };
                query.push_str(&format!("{sep}exclude_self=true"));
            }

            let url = format!("{}/stream{}", api_url(api_port), query);
            let response = reqwest::get(&url).await?;
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            use futures_util::StreamExt;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(pos) = buffer.find("\n\n") {
                    let block: String = buffer.drain(..pos + 2).collect();
                    for line in block.lines() {
                        if let Some(data) = line.strip_prefix("data:") {
                            let data = data.trim();
                            if data.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<serde_json::Value>(data) {
                                Ok(value) => {
                                    let out = serde_json::to_string(&value)?;
                                    println!("{out}");
                                    let _ = std::io::stdout().flush();
                                }
                                Err(err) => tracing::warn!(%err, "could not read the event"),
                            }
                        }
                    }
                }
            }
        }

        Command::Status { api_port } => {
            let answer = get(&api_url(api_port), "/status").await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Config { action } => match action {
            ConfigAction::Show => {
                let config = store::read_config();
                let credentials = store::read_credentials();
                let has_credentials = credentials.by_nick.contains_key(&config.nick);
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "config": config,
                        // the password is never printed. only whether
                        // there is one.
                        "has_credentials": has_credentials,
                        "history_entries": store::read_history(None).len(),
                    }))?
                );
            }
            ConfigAction::Set { set, save } => {
                let mut config = store::read_config();
                for pair in &set {
                    let Some((key, value)) = pair.split_once('=') else {
                        eprintln!("that is not a key=value pair: {pair}");
                        std::process::exit(1);
                    };
                    match key {
                        "server" => config.server = value.to_string(),
                        "port" => {
                            config.port = value.parse().map_err(|_| "the port is not a number")?
                        }
                        "nick" => config.nick = value.to_string(),
                        "realname" => config.realname = value.to_string(),
                        "bot" => config.bot = value == "true",
                        "tls" => config.tls = value == "true",
                        "channels" => {
                            config.channels = value
                                .split(',')
                                .map(|c| c.trim().to_string())
                                .filter(|c| !c.is_empty())
                                .collect()
                        }
                        other => {
                            eprintln!("there is no setting called {other}");
                            std::process::exit(1);
                        }
                    }
                }
                if save {
                    store::write_config(&config)?;
                }
                println!("{}", serde_json::to_string_pretty(&config)?);
            }
            ConfigAction::SaveCredentials { password, nick } => {
                let config = store::read_config();
                let nick = nick.unwrap_or(config.nick.clone());
                let mut credentials = store::read_credentials();
                credentials.by_nick.insert(
                    nick.clone(),
                    store::Credential {
                        account: None,
                        password,
                    },
                );
                store::write_credentials(&credentials)?;
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "ok": true,
                        "nick": nick,
                        "has_credentials": true,
                    }))?
                );
            }
            ConfigAction::History { limit } => {
                let entries = store::read_history(Some(limit));
                println!("{}", serde_json::to_string_pretty(&entries)?);
            }
            ConfigAction::Forget => {
                store::clear_history();
                println!("{}", serde_json::to_string_pretty(&json!({ "ok": true }))?);
            }
        },
    }

    Ok(())
}

/// shut down on ctrl-c.
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}

/// a GET against the daemon.
async fn get(base: &str, path: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let url = format!("{base}{path}");
    let response = reqwest::get(&url).await?;
    let value: serde_json::Value = response.json().await?;
    Ok(value)
}

/// a POST against the daemon.
async fn post(
    base: &str,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let url = format!("{base}{path}");
    let response = reqwest::Client::new().post(&url).json(body).send().await?;
    let value: serde_json::Value = response.json().await?;
    Ok(value)
}

/// check that the daemon on this port is the one we meant.
///
/// --- WHY THIS MATTERS ---
/// two daemons can end up fighting over the same port. the second one
/// fails to bind and prints the error to its stderr, but the client
/// commands then talk to the FIRST one — silently — and get its nick,
/// its messages and its state. it looks like it worked.
///
/// so a caller that knows the nick it expects can say so, and a
/// mismatch is an error rather than wrong data.
async fn check_daemon(
    base: &str,
    expect_nick: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(expected) = expect_nick else {
        return Ok(());
    };

    let status = get(base, "/status").await?;
    let actual = status
        .get("nick")
        .and_then(|n| n.as_str())
        .unwrap_or("<unknown>");

    if actual != expected {
        return Err(format!(
            "the daemon on {base} is {actual}, not {expected}. it is a different daemon — \
             another one is already on that port. use --api-port to pick the right one."
        )
        .into());
    }
    Ok(())
}

/// a tiny url encoder, for the query strings.
fn urlencode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// where the pid file goes.
#[allow(dead_code)]
fn pid_path() -> PathBuf {
    store::irc_dir().join("daemon.pid")
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
