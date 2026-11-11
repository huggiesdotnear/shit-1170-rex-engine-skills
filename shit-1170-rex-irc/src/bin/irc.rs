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
    #[command(subcommand)]
    command: Command,
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
        /// set the +B bot mode.
        #[arg(long)]
        bot: bool,
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
        /// the port the daemon listens on.
        #[arg(long, default_value = "8787")]
        api_port: u16,
    },
    /// join a channel.
    Join {
        /// the channel.
        #[arg(long)]
        channel: String,
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
    /// stream the messages as they arrive.
    Watch {
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
                bot: bot || config.bot,
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
            api_port,
        } => {
            let mut query = format!("?since={since}&limit={limit}");
            if let Some(kind) = kind {
                query.push_str(&format!("&kind={}", urlencode(&kind)));
            }
            if let Some(target) = target {
                query.push_str(&format!("&target={}", urlencode(&target)));
            }
            let answer = get(&api_url(api_port), &format!("/messages{query}")).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Join { channel, api_port } => {
            let body = json!({ "channel": channel });
            let answer = post(&api_url(api_port), "/join", &body).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Part { channel, api_port } => {
            let body = json!({ "channel": channel });
            let answer = post(&api_url(api_port), "/part", &body).await?;
            println!("{}", serde_json::to_string_pretty(&answer)?);
        }

        Command::Watch { api_port } => {
            // the stream is server-sent events.
            let url = format!("{}/stream", api_url(api_port));
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
