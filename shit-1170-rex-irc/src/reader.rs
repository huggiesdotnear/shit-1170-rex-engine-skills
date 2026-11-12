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
// a long-lived connection dies for reasons that are not the caller's
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
    /// send a raw irc line.
    ///
    /// the command only SENDS. it does not wait for the answer — the
    /// read loop has to keep reading, or the answer would never
    /// arrive. the caller waits for the answer in the session's log.
    Send {
        line: String,
        /// how long to wait for the reply.
        wait_ms: u64,
        /// the raw counter from before the send, so the caller can
        /// find the answer.
        reply: oneshot::Sender<Result<u64, IrcError>>,
    },
    /// send a line and do not wait.
    Fire { line: String },
    /// join a channel.
    ///
    /// like `Send`, it only sends. the caller waits for the echo.
    Join {
        channel: String,
        /// the raw counter from before the join.
        reply: oneshot::Sender<Result<u64, IrcError>>,
    },
    /// leave a channel.
    Part {
        channel: String,
        reason: Option<String>,
        reply: oneshot::Sender<Result<u64, IrcError>>,
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
                Err(IrcError::NickInUse { nick }) => {
                    // --- WHY THIS IS NOT RETRIED ---
                    // the nickname is taken. that will not change by
                    // trying again, so a reconnect loop would spin
                    // forever on something only the operator can fix.
                    //
                    // so it stops, and says why.
                    session.mark_disconnected();
                    session.set_registration_error(format!(
                        "the nickname {nick} is already in use. pick another one, with --nick."
                    ))
                    .await;
                    tracing::error!(
                        nick = %nick,
                        "the nickname is already in use. not retrying — pick another with --nick."
                    );
                    return;
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

        // --- THE COMMAND LOOP ---
        // the read loop owns the socket, so it also serves the
        // commands. it does the reading and the writing in one place,
        // which is what keeps the two from racing.
        let (tx, mut rx) = mpsc::channel::<Command>(64);
        session.set_sender(tx).await;

        // join the channels the config asked for, now that the
        // connection is up.
        //
        // the JOIN is only SENT here. the echo is picked up by the
        // read loop, which starts next — so the wait for it happens
        // there, and not in a place where nothing is reading yet.
        {
            let mut connection = session.connection.lock().await;
            for channel in &session.options.channels {
                if connection
                    .channels
                    .iter()
                    .any(|c| c.to_lowercase() == channel.to_lowercase())
                {
                    continue;
                }
                if let Err(err) = connection.send(&format!("JOIN {channel}")).await {
                    tracing::warn!(%err, channel = %channel, "could not join");
                }
            }
        }

        // after a reconnect, ask for what was missed while the socket
        // was down.
        //
        // the requests are only SENT here too. the answers come back
        // and the read loop picks them up.
        //
        // this runs AFTER the re-join, because the gap fill asks
        // about channels we are in — and right after a drop we are in
        // none of them until we join.
        gap_fill_request(&session).await;

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
                            // every raw message goes in the raw list.
                            // a command needs to find its own answer
                            // there, and that answer may be an event
                            // (the echo of a PRIVMSG) or a numeric.
                            session.record_raw(message.clone()).await;

                            // and the ones that are events go in the
                            // log, which is what the client reads.
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

        // --- FORGET THE CHANNELS ---
        // the server forgot us too. the channel list is what says
        // which channels WE are in, and it is what the reconnect uses
        // to decide whether it needs to send a JOIN.
        //
        // without this, the reconnect sees the channels still in the
        // list, skips the JOIN, and the client believes it is in
        // channels it is not in. every message to them is refused with
        // `403 No such channel`, and nothing recovers it.
        {
            let mut connection = session.connection.lock().await;
            connection.forget_channels();
        }

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
            // --- THE COMMAND ONLY SENDS ---
            // the read loop has to keep reading, or the answer would
            // never arrive. so the command sends and answers straight
            // away, and the caller waits for the answer in the log.
            let before = session.raw_head();
            let mut connection = session.connection.lock().await;
            let result = connection.send(&line).await;
            drop(connection);
            let _ = reply.send(result.map(|_| before));
            let _ = wait_ms;
        }
        Command::Join { channel, reply } => {
            let before = session.raw_head();
            let mut connection = session.connection.lock().await;

            // already in it? the server would not echo the join, and
            // there is nothing to wait for.
            let already = connection
                .channels
                .iter()
                .any(|c| c.to_lowercase() == channel.to_lowercase());

            let result = if already {
                Ok(())
            } else {
                connection.send(&format!("JOIN {channel}")).await
            };
            drop(connection);
            let _ = reply.send(result.map(|_| before));
        }
        Command::Part {
            channel,
            reason,
            reply,
        } => {
            let before = session.raw_head();
            let mut connection = session.connection.lock().await;

            // not in it? the server would not echo the part either.
            let in_channel = connection
                .channels
                .iter()
                .any(|c| c.to_lowercase() == channel.to_lowercase());

            let result = if !in_channel {
                Ok(())
            } else {
                match reason {
                    Some(reason) => {
                        connection.send(&format!("PART {channel} :{reason}")).await
                    }
                    None => connection.send(&format!("PART {channel}")).await,
                }
            };
            drop(connection);
            let _ = reply.send(result.map(|_| before));
        }
    }
}

/// does this batch of replies look finished?
///
/// `nick` is our own nickname, so the echo of our own message can be
/// told apart from traffic that happened to arrive while we waited.
///
/// `sent_text` is the text of the command that was sent. the echo
/// comes back with the same text, so matching on it tells THIS
/// command's echo apart from another command's — which matters when
/// several commands are in flight at once. without it, the first
/// command to see any echo would claim it, and the others would
/// report no echo at all.
///
/// the server sends the answer to a command and then nothing else, so
/// a short quiet period after the first reply means the answer is
/// complete. the timeout in the caller is the real bound; this just
/// makes the common case return sooner.
pub fn reply_looks_done(messages: &[IrcMessage], nick: &str, sent_text: &str) -> bool {
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
    // the echo is from OUR OWN nick, and it carries the text we
    // sent. a PRIVMSG from somebody else is not the answer to our
    // command — it is just traffic that happened to arrive while we
    // waited — so it must not end the wait.
    //
    // and when several commands are in flight, the TEXT is what
    // tells them apart. without it the first command to see any echo
    // would claim it, and the rest would report no echo at all.
    messages.iter().any(|m| {
        m.command == "PRIVMSG"
            && m.prefix
                .as_ref()
                .map(|p| p.split('!').next().unwrap_or(p) == nick)
                .unwrap_or(false)
            && (sent_text.is_empty()
                || m.params.last().map(|t| t == sent_text).unwrap_or(false))
    })
}

/// how many channels to gap-fill at once.
///
/// a client that joined a lot of channels asks a lot of questions, and
/// the server answers each one. this keeps that bounded.
const GAP_FILL_CHANNEL_CAP: usize = 20;

/// ask the server for the messages that arrived while the socket was
/// down.
///
/// the ircd keeps the last 1000 messages per channel, so this covers
/// a reconnect that was not too long. it is a best effort: if the
/// request fails, the caller simply misses that window.
///
/// --- WHY ONLY THE CHANNELS WE ARE IN ---
/// asking about a channel we are not in gets `FAIL CHATHISTORY
/// INVALID_TARGET` from the server. and the server answers every
/// request, so asking about a hundred channels means a hundred
/// failures and a hundred replies to sort through.
///
/// --- WHY THE BATCH IS WAITED FOR, NOT SLEPT ON ---
/// a fixed sleep truncates the batch on a slow server. the server
/// says when the batch is finished with `BATCH -N`, so we wait for
/// that.
/// ask the server for the messages that arrived while the socket was
/// down.
///
/// the ircd keeps the last 1000 messages per channel, so this covers
/// a reconnect that was not too long. it is a best effort: if the
/// request fails, the caller simply misses that window.
///
/// --- WHY ONLY THE CHANNELS WE ARE IN ---
/// asking about a channel we are not in gets `FAIL CHATHISTORY
/// INVALID_TARGET` from the server. and the server answers every
/// request, so asking about a hundred channels means a hundred
/// failures and a hundred replies to sort through.
///
/// --- WHY IT ONLY SENDS ---
/// the answers come back and the read loop picks them up. waiting
/// for them here would stop the reading, and the answers would never
/// arrive.
async fn gap_fill_request(session: &Arc<Session>) {
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
    let channels: Vec<String> = channels
        .into_iter()
        .take(GAP_FILL_CHANNEL_CAP)
        .collect();

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

async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
