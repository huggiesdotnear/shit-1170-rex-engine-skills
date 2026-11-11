// =================================================
// THE READ LOOP.
//
// the task that owns the irc connection. it is the ONLY thing that
// touches the socket: it reads messages, records them in the session,
// answers the server's pings, and reconnects when the socket drops.
//
// --- WHY THE READ LOOP OWNS THE SOCKET ---
// a websocket is one stream. if two tasks read it, they race, and
// each frame goes to one of them. a command that sends `JOIN` and
// then waits for the JOIN echo would be waiting for a frame that the
// other task took.
//
// so: the read loop reads, and the commands go to it through a
// channel. a command is a line to send, plus an optional wait.
//
// the wait is answered by the read loop too, because the read loop
// is the one that sees the reply.
//
// --- WHY IT RECONNECTS ---
// a long-lived connection dies for reasons that are not the agent's
// fault: the tunnel drops it, the wifi blinks, the ircd restarts.
//
// and when it dies, messages that arrived in between are gone. the
// ircd has no bouncer behind it, so there is nothing to replay them.
//
// but the ircd does keep the last 1000 messages per channel in memory
// and answers `CHATHISTORY`. so after a reconnect the client asks for
// what it missed, using the msgid of the last message it saw.
//
// --- THE CHATHISTORY SYNTAX ---
// the ircv3 draft is:
//
//     CHATHISTORY LATEST <target> <* | timestamp=... | msgid=...> <limit>
//
// so the target and the limit are in that order, and `TARGETS=` is a
// DIFFERENT subcommand that lists the buffers with history in them —
// it does not fetch messages.
//
// the old typescript skill sent `CHATHISTORY LATEST <limit> TARGETS=<chan>`,
// which is the wrong order and the wrong subcommand. the server
// answered every one of those with `461 Not enough parameters`.
//
// the working form is:
//
//     CHATHISTORY LATEST #chan * 50
//
// which comes back as a `BATCH +N chathistory #chan` ... `BATCH -N`
// with the messages inside.
// =================================================

use crate::irc::{to_event, IrcError, IrcMessage};
use crate::session::Session;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

/// the backoff between reconnect attempts.
const BACKOFF_MIN: Duration = Duration::from_secs(1);
/// the longest the backoff ever gets.
const BACKOFF_MAX: Duration = Duration::from_secs(30);

/// a command for the read loop.
#[derive(Debug)]
pub enum Command {
    /// send a raw irc line and wait for the answer.
    Send {
        line: String,
        /// how long to wait for the reply.
        wait_ms: u64,
        /// where to send the reply.
        reply: oneshot::Sender<Result<Vec<IrcMessage>, IrcError>>,
    },
    /// send a line and do not wait.
    Fire { line: String },
    /// join a channel and wait for the JOIN echo.
    Join {
        channel: String,
        reply: oneshot::Sender<Result<(), IrcError>>,
    },
    /// leave a channel.
    Part {
        channel: String,
        reason: Option<String>,
        reply: oneshot::Sender<Result<(), IrcError>>,
    },
}

/// run the read loop until the task is dropped.
pub async fn run(session: Arc<Session>) {
    let mut backoff = BACKOFF_MIN;

    loop {
        // --- CONNECT ---
        let connected = {
            let mut connection = session.connection.lock().await;
            match connection.connect().await {
                Ok(()) => {
                    session.mark_connected().await;
                    backoff = BACKOFF_MIN;
                    tracing::info!(
                        server = %connection.options.server,
                        nick = %connection.options.nick,
                        "connected"
                    );
                    true
                }
                Err(err) => {
                    session.mark_disconnected();
                    tracing::warn!(%err, "connect failed, retrying");
                    false
                }
            }
        };

        if !connected {
            sleep(backoff).await;
            backoff = (backoff * 2).min(BACKOFF_MAX);
            continue;
        }

        // count the reconnects, so a stalling conversation can be
        // traced to a dropping socket.
        session.reconnects.fetch_add(1, Ordering::Relaxed);

        // after a reconnect, ask for what was missed while the socket
        // was down.
        gap_fill(&session).await;

        // --- THE COMMAND LOOP ---
        // the read loop owns the socket, so it also serves the
        // commands. it does the reading and the writing in one place,
        // which is what keeps the two from racing.
        let (tx, mut rx) = mpsc::channel::<Command>(64);
        session.set_sender(tx).await;

        // join the channels the config asked for, now that the
        // connection is up.
        let channels = session.options.channels.clone();
        for channel in channels {
            if let Err(err) = do_join(&session, &channel).await {
                tracing::warn!(%err, channel = %channel, "could not join");
            }
        }

        loop {
            // wait for either a command or an incoming message.
            tokio::select! {
                command = rx.recv() => {
                    let Some(command) = command else {
                        // every sender is gone. the session is done.
                        break;
                    };
                    handle_command(&session, command).await;
                }
                read = read_one(&session) => {
                    match read {
                        Ok(Some(message)) => {
                            // record the event, if it is one the agent
                            // cares about.
                            if let Some(event) = to_event(&message) {
                                session.record(event).await;
                            }
                        }
                        Ok(None) => {
                            // nothing right now.
                        }
                        Err(err) => {
                            // the socket is gone. the reconnect picks
                            // it up.
                            tracing::warn!(%err, "connection lost, reconnecting");
                            break;
                        }
                    }
                }
            }
        }

        session.mark_disconnected();
        session.clear_sender().await;
        tracing::info!("connection lost, reconnecting");
        sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

/// read one message, or None if there is nothing right now.
async fn read_one(session: &Arc<Session>) -> Result<Option<IrcMessage>, IrcError> {
    let mut connection = session.connection.lock().await;
    // a short timeout, so the select loop can also serve commands.
    match tokio::time::timeout(Duration::from_millis(250), connection.read_message()).await {
        Ok(Ok(message)) => Ok(Some(message)),
        Ok(Err(err)) => Err(err),
        // nothing came in. the select loop goes round again.
        Err(_) => Ok(None),
    }
}

/// handle one command.
async fn handle_command(session: &Arc<Session>, command: Command) {
    match command {
        Command::Fire { line } => {
            let mut connection = session.connection.lock().await;
            if let Err(err) = connection.send(&line).await {
                tracing::warn!(%err, "could not send");
            }
        }
        Command::Send {
            line,
            wait_ms,
            reply,
        } => {
            let result = send_and_wait(session, &line, wait_ms).await;
            let _ = reply.send(result);
        }        Command::Join { channel, reply } => {
            let result = do_join(session, &channel).await;
            let _ = reply.send(result);
        }
        Command::Part {
            channel,
            reason,
            reply,
        } => {
            let result = do_part(session, &channel, reason.as_deref()).await;
            let _ = reply.send(result);
        }
    }
}

/// send a line and collect the reply.
///
/// the reply is whatever the server sends until the timeout. this
/// waits for the socket, so it must run in the read loop — not in an
/// http handler, which would race the reader.
async fn send_and_wait(
    session: &Arc<Session>,
    line: &str,
    wait_ms: u64,
) -> Result<Vec<IrcMessage>, IrcError> {
    let mut connection = session.connection.lock().await;
    let before = connection.messages.len();
    connection.send(line).await?;

    let deadline = tokio::time::Instant::now() + Duration::from_millis(wait_ms);
    loop {
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        // wait for one more message, but no longer than the deadline.
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(remaining, connection.read_message()).await {
            Ok(Ok(_)) => {
                // keep going until the deadline, or until the reply
                // looks complete.
                if connection.messages.len() > before
                    && reply_looks_done(&connection.messages[before..], &connection.options.nick)
                {
                    break;
                }
            }
            Ok(Err(err)) => return Err(err),
            Err(_) => break,
        }
    }

    let replies = connection.messages[before..].to_vec();
    drop(connection);

    // --- THE MESSAGES THAT CAME BACK GO IN THE LOG ---
    // this command read them off the socket, so the read loop will
    // not see them. if they are not recorded here, they are lost from
    // the log — and the echo of the agent's own message is exactly
    // what an agent wants to see in its next read.
    for message in &replies {
        if let Some(event) = to_event(message) {
            session.record(event).await;
        }
    }

    Ok(replies)
}

/// does this batch of replies look finished?
///
/// `nick` is our own nickname, so the echo of our own message can be
/// told apart from traffic that happened to arrive while we waited.
///
/// the server sends the answer to a command and then nothing else, so
/// a short quiet period after the first reply means the answer is
/// complete. the timeout in `send_and_wait` is the real bound; this
/// just makes the common case return sooner.
fn reply_looks_done(messages: &[IrcMessage], nick: &str) -> bool {
    // a closed batch means the whole batch arrived.
    if messages
        .iter()
        .any(|m| m.command == "BATCH" && m.params.get(1) == Some(&"-".to_string()))
    {
        return true;
    }

    // an error numeric means the server said no, and there is nothing
    // more to come.
    if messages.iter().any(|m| {
        matches!(
            m.command.as_str(),
            "401" | "403" | "404" | "421" | "461" | "462" | "464" | "465" | "366"
        )
    }) {
        return true;
    }

    // --- THE ECHO OF OUR OWN MESSAGE ---
    // the server advertises `echo-message`, so a PRIVMSG we sent
    // comes straight back. that echo IS the answer, and waiting for
    // more after it just burns the timeout.
    //
    // the echo is from OUR OWN nick. a PRIVMSG from somebody else is
    // not the answer to our command — it is just traffic that
    // happened to arrive while we waited — so it must not end the
    // wait.
    messages.iter().any(|m| {
        m.command == "PRIVMSG"
            && m.prefix
                .as_ref()
                .map(|p| p.split('!').next().unwrap_or(p) == nick)
                .unwrap_or(false)
    })
}

/// join a channel and wait for the JOIN echo.
///
/// --- WHY IT CHECKS THE CHANNEL LIST FIRST ---
/// the server does NOT echo a JOIN for a channel the client is already
/// in. it just ignores it. so a join of a channel we are already in
/// would wait for an echo that never comes and time out.
///
/// so: if we are already in it, return at once. there is nothing to
/// wait for, and nothing to do.
async fn do_join(session: &Arc<Session>, channel: &str) -> Result<(), IrcError> {
    let mut connection = session.connection.lock().await;

    // already in it? nothing to wait for.
    if connection
        .channels
        .iter()
        .any(|c| c.to_lowercase() == channel.to_lowercase())
    {
        return Ok(());
    }

    let before = connection.messages.len();
    connection.send(&format!("JOIN {channel}")).await?;

    let deadline =
        tokio::time::Instant::now() + Duration::from_millis(session.options.timeout_ms);
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(IrcError::WaitTimeout {
                what: format!("the JOIN of {channel}"),
                timeout_ms: session.options.timeout_ms,
            });
        }
        // the echo may already have arrived.
        let joined = connection.messages[before..].iter().any(|m| {
            m.command == "JOIN"
                && m.params
                    .first()
                    .map(|p| p.to_lowercase() == channel.to_lowercase())
                    .unwrap_or(false)
        });
        if joined {
            // record the channel too. the message handler normally
            // does this, but a JOIN that arrived while the reader was
            // busy would be missed, and the channel list is what
            // every "am i in it?" check reads.
            let lower = channel.to_lowercase();
            if !connection.channels.iter().any(|c| c.to_lowercase() == lower) {
                connection.channels.push(channel.to_string());
            }
            // the messages this command read belong in the log too.
            let seen = connection.messages[before..].to_vec();
            drop(connection);
            for message in &seen {
                if let Some(event) = to_event(message) {
                    session.record(event).await;
                }
            }
            return Ok(());
        }

        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(remaining, connection.read_message()).await {
            Ok(Ok(_)) => continue,
            Ok(Err(err)) => return Err(err),
            Err(_) => {
                return Err(IrcError::WaitTimeout {
                    what: format!("the JOIN of {channel}"),
                    timeout_ms: session.options.timeout_ms,
                });
            }
        }
    }
}

/// leave a channel and wait for the PART echo.
async fn do_part(
    session: &Arc<Session>,
    channel: &str,
    reason: Option<&str>,
) -> Result<(), IrcError> {
    let mut connection = session.connection.lock().await;

    // not in it? the server will not echo a PART either.
    if !connection
        .channels
        .iter()
        .any(|c| c.to_lowercase() == channel.to_lowercase())
    {
        return Ok(());
    }

    let before = connection.messages.len();
    match reason {
        Some(reason) => connection.send(&format!("PART {channel} :{reason}")).await?,
        None => connection.send(&format!("PART {channel}")).await?,
    }

    let deadline =
        tokio::time::Instant::now() + Duration::from_millis(session.options.timeout_ms);
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(IrcError::WaitTimeout {
                what: format!("the PART of {channel}"),
                timeout_ms: session.options.timeout_ms,
            });
        }
        let parted = connection.messages[before..].iter().any(|m| {
            m.command == "PART"
                && m.params
                    .first()
                    .map(|p| p.to_lowercase() == channel.to_lowercase())
                    .unwrap_or(false)
        });
        if parted {
            let lower = channel.to_lowercase();
            connection.channels.retain(|c| c.to_lowercase() != lower);
            let seen = connection.messages[before..].to_vec();
            drop(connection);
            for message in &seen {
                if let Some(event) = to_event(message) {
                    session.record(event).await;
                }
            }
            return Ok(());
        }

        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(remaining, connection.read_message()).await {
            Ok(Ok(_)) => continue,
            Ok(Err(err)) => return Err(err),
            Err(_) => {
                return Err(IrcError::WaitTimeout {
                    what: format!("the PART of {channel}"),
                    timeout_ms: session.options.timeout_ms,
                });
            }
        }
    }
}

/// ask the server for the messages that arrived while the socket was
/// down.
///
/// the ircd keeps the last 1000 messages per channel, so this covers
/// a reconnect that was not too long. it is a best effort: if the
/// request fails, the agent simply misses that window.
async fn gap_fill(session: &Arc<Session>) {
    let msgid = session.last_msgid.lock().await.clone();
    let Some(msgid) = msgid else {
        // nothing was seen before, so there is nothing to fill.
        return;
    };

    let channels = {
        let connection = session.connection.lock().await;
        connection.channels.clone()
    };
    if channels.is_empty() {
        return;
    }

    {
        let mut connection = session.connection.lock().await;
        for channel in &channels {
            // `AFTER` gets the messages that came after the one we saw.
            let line = format!("CHATHISTORY AFTER {channel} msgid={msgid} 100");
            if let Err(err) = connection.send(&line).await {
                tracing::warn!(%err, channel = %channel, "could not ask for the missed messages");
                return;
            }
        }
    }

    // the server answers with a batch. give it a moment, then take
    // whatever came back.
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let batch: Vec<IrcMessage> = {
        let connection = session.connection.lock().await;
        connection
            .messages
            .iter()
            .filter(|m| m.command == "PRIVMSG" && m.tags.contains_key("batch"))
            .cloned()
            .collect()
    };

    for message in batch {
        if let Some(event) = to_event(&message) {
            tracing::info!(?event.from, ?event.text, "recovered a missed message");
            session.record(event).await;
        }
    }
}

/// sleep, without caring whether it was interrupted.
async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
