// =================================================
// THE HTTP API.
//
// the agent talks to this over http. the irc connection stays up in
// the background, so the agent can send a message, read the channel,
// send another, and read again — all over one connection.
//
// the routes:
//
//   GET  /health          is the connection up?
//   GET  /status          the server's identity, the channels, the caps
//   POST /join             join a channel
//   POST /part             leave a channel
//   POST /send             post a message
//   POST /raw              send any irc line
//   GET  /messages         read what came in, by cursor
//   GET  /stream           the same messages, live, over SSE
//   GET  /channels         the channels and who is in them
//   GET  /history          the server's own history for a channel
//
// every answer is json.
// =================================================

use crate::irc::{names, numerics, to_event, IrcError, IrcMessage};
use crate::session::Session;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

// =================================================
// THE ROUTER
// =================================================

/// build the router.
pub fn router(session: Arc<Session>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/status", get(status))
        .route("/join", post(join))
        .route("/part", post(part))
        .route("/send", post(send))
        .route("/raw", post(raw))
        .route("/messages", get(messages))
        .route("/stream", get(stream))
        .route("/channels", get(channels))
        .route("/who", get(who))
        .route("/history", get(history))
        .with_state(session)
}

/// the state every handler gets.
type State_ = State<Arc<Session>>;

// =================================================
// THE ANSWER SHAPE
// =================================================

/// the shape every error answer has.
#[derive(Debug, Serialize)]
struct ErrorAnswer {
    ok: bool,
    error: String,
}

fn fail(status: StatusCode, message: impl std::fmt::Display) -> axum::response::Response {
    (
        status,
        Json(ErrorAnswer {
            ok: false,
            error: message.to_string(),
        }),
    )
        .into_response()
}

// =================================================
// THE HANDLERS
// =================================================

/// is the connection up?
async fn health(State(session): State_) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "connected": session.is_connected(),
        "nick": session.options.nick,
        "server": session.options.server,
    }))
}

/// the server's identity and the state of the connection.
async fn status(State(session): State_) -> impl IntoResponse {
    let connection = session.connection.lock().await;
    Json(serde_json::json!({
        "ok": true,
        "connected": session.is_connected(),
        "server": session.options.server,
        "url": connection.url(),
        "nick": session.options.nick,
        // `registered` follows the live connection. the old version
        // reported the last known state, so it could say
        // `registered: true` while `connected: false` — two answers
        // that contradict each other.
        "registered": session.is_connected() && connection.registered,
        "sasl": connection.sasl_ok,
        "channels": connection.channels,
        "motd": connection.motd,
        "isupport": connection.isupport,
        "numerics": numerics(&connection),
        "cursor": session.seq.load(std::sync::atomic::Ordering::SeqCst),
        // --- THE CONNECTION HEALTH ---
        // a rising reconnect count means the socket is dropping, which
        // is the first thing to look at when a conversation keeps
        // stalling.
        "reconnects": session.reconnects.load(std::sync::atomic::Ordering::Relaxed),
        "uptime_seconds": session.uptime_seconds().await.unwrap_or(0),
        // why the registration failed, when it did. a nick that is
        // already in use is permanent — the daemon stops rather than
        // looping on it — so the reason has to be here.
        "registration_error": session.registration_error().await,
        // who this daemon is. two daemons can end up on the same
        // port, and a client that talks to the wrong one gets the
        // wrong data without noticing.
        "daemon_id": session.daemon_id,
    }))
}

/// join a channel.
#[derive(Debug, Deserialize)]
struct JoinRequest {
    channel: String,
    /// do not create the channel if it does not exist.
    ///
    /// this server creates a channel the moment anyone joins it, so a
    /// typo in a channel name quietly makes a new empty room — and
    /// the agent goes on talking to it as if it were the channel it
    /// meant.
    #[serde(default)]
    no_create: bool,
}

async fn join(
    State(session): State_,
    Json(request): Json<JoinRequest>,
) -> axum::response::Response {
    // --- THE CHANNEL HAS TO EXIST ---
    // `LIST <channel>` answers with a `322` for a channel that exists
    // and with nothing for one that does not. asking first means a
    // typo does not create a channel on a shared server.
    if request.no_create {
        match channel_exists(&session, &request.channel).await {
            Ok(true) => {}
            Ok(false) => {
                return fail(
                    StatusCode::NOT_FOUND,
                    format!(
                        "the channel {} does not exist. this server creates a channel when \
                         someone joins it, so it was not joined.",
                        request.channel
                    ),
                );
            }
            Err(err) => return fail(StatusCode::BAD_GATEWAY, err),
        }
    }

    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Join {
        channel: request.channel.clone(),
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }

    let before = match wait.await {
        Ok(Ok(before)) => before,
        Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    };

    // wait for the JOIN echo, in the log. the read loop keeps
    // reading while this waits — that is the whole point.
    let lower = request.channel.to_lowercase();
    let joined = session
        .wait_for_event(session.options.timeout_ms, before, |event| {
            event.kind == "join"
                && event
                    .target
                    .as_ref()
                    .map(|t| t.to_lowercase() == lower)
                    .unwrap_or(false)
        })
        .await;

    if joined.is_none() {
        return fail(
            StatusCode::GATEWAY_TIMEOUT,
            format!("the JOIN of {} did not come back", request.channel),
        );
    }

    // record the channel too. the message handler normally does
    // this, but a JOIN that arrived while the reader was busy would
    // be missed, and the channel list is what every "am i in it?"
    // check reads.
    {
        let mut connection = session.connection.lock().await;
        if !connection
            .channels
            .iter()
            .any(|c| c.to_lowercase() == lower)
        {
            connection.channels.push(request.channel.clone());
        }
    }

    let channels = {
        let connection = session.connection.lock().await;
        connection.channels.clone()
    };
    Json(serde_json::json!({
        "ok": true,
        "channel": request.channel,
        "channels": channels,
    }))
    .into_response()
}

/// does this channel exist on the server?
///
/// `LIST <channel>` answers with a `322` for a channel that exists
/// and with nothing for one that does not.
async fn channel_exists(session: &Arc<Session>, channel: &str) -> Result<bool, IrcError> {
    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: format!("LIST {channel}"),
        wait_ms: 1500,
        reply,
    };
    session.command(command).await?;

    let before = match wait.await {
        Ok(Ok(before)) => before,
        Ok(Err(err)) => return Err(err),
        Err(_) => {
            return Err(IrcError::NotOpen);
        }
    };

    // wait for the answer, in the log.
    let replies = session
        .wait_for_reply(1500, before, "", &session.options.nick)
        .await;

    Ok(replies.iter().any(|m| m.command == "322"))
}

/// leave a channel.
#[derive(Debug, Deserialize)]
struct PartRequest {
    channel: String,
    #[serde(default)]
    reason: Option<String>,
}

async fn part(
    State(session): State_,
    Json(request): Json<PartRequest>,
) -> axum::response::Response {
    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Part {
        channel: request.channel.clone(),
        reason: request.reason.clone(),
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }

    match wait.await {
        Ok(Ok(_)) => {
            let channels = {
                let connection = session.connection.lock().await;
                connection.channels.clone()
            };
            Json(serde_json::json!({
                "ok": true,
                "channel": request.channel,
                "channels": channels,
            }))
            .into_response()
        }
        Ok(Err(err)) => fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    }
}

/// post a message.
#[derive(Debug, Deserialize)]
struct SendRequest {
    target: String,
    message: String,
    /// join the channel first when the target is a channel.
    #[serde(default = "default_true")]
    join: bool,
}

fn default_true() -> bool {
    true
}

async fn send(
    State(session): State_,
    Json(request): Json<SendRequest>,
) -> axum::response::Response {
    let mut joined = Vec::new();

    // join the channel first when the target is a channel and we are
    // not in it already.
    if request.join && request.target.starts_with('#') {
        let in_channel = {
            let connection = session.connection.lock().await;
            connection
                .channels
                .iter()
                .any(|c| c.to_lowercase() == request.target.to_lowercase())
        };
        if !in_channel {
            let (reply, wait) = tokio::sync::oneshot::channel();
            let command = crate::reader::Command::Join {
                channel: request.target.clone(),
                reply,
            };
            if let Err(err) = session.command(command).await {
                return fail(StatusCode::SERVICE_UNAVAILABLE, err);
            }
            let before = match wait.await {
                Ok(Ok(before)) => before,
                Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
                Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
            };

            // wait for the JOIN echo, in the log.
            let lower = request.target.to_lowercase();
            let echoed = session
                .wait_for_event(session.options.timeout_ms, before, |event| {
                    event.kind == "join"
                        && event
                            .target
                            .as_ref()
                            .map(|t| t.to_lowercase() == lower)
                            .unwrap_or(false)
                })
                .await;

            if echoed.is_some() {
                joined.push(request.target.clone());
            }
        }
    }

    // --- THE CURSOR BEFORE THE SEND ---
    // a reply can arrive DURING the send's wait for the echo. by the
    // time the send answers, the cursor it returns is already past
    // that reply, so a `wait --since <cursor>` would never see it.
    //
    // so the send reports the cursor it started from as well. a
    // caller that wants to catch the reply does:
    //
    //     send  ->  cursor_before
    //     wait --since <cursor_before>
    let cursor_before = session.seq.load(std::sync::atomic::Ordering::SeqCst);

    // send the message. the read loop does the sending, because it
    // owns the socket.
    //
    // the command only SENDS. it does not wait for the answer — the
    // read loop has to keep reading, or the answer would never
    // arrive. so the wait happens here, on the session's log.
    let before = session.raw_head();
    let sent_text = request.message.clone();

    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: format!("PRIVMSG {} :{}", request.target, request.message),
        wait_ms: 1200,
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }
    if let Ok(Err(err)) = wait.await {
        return fail(StatusCode::BAD_GATEWAY, err);
    }

    // wait for the answer, in the log.
    let replies = session
        .wait_for_reply(1200, before, &sent_text, &session.options.nick)
        .await;

    // the echo is the proof the message landed. the server advertises
    // `echo-message`, so it sends the message back to the sender.
    let echo = replies.iter().find(|m| {
        m.command == "PRIVMSG"
            && m.params.first().map(|p| p == &request.target).unwrap_or(false)
            && m.params.last().map(|p| p == &request.message).unwrap_or(false)
    });

    // --- THE ERROR NUMERICS ---
    // the server answers a message it cannot deliver with an error
    // numeric. `401 ERR_NOSUCHNICK` is the one that matters most: a
    // DM to a nick that is not online is dropped SILENTLY, and the
    // agent would never know.
    //
    // so the numeric is reported. `delivered` says plainly whether
    // the message went out.
    let error_numeric = replies.iter().find(|m| {
        matches!(
            m.command.as_str(),
            // no such nick, no such channel, cannot send to channel
            "401" | "403" | "404" | "405" | "407" | "411" | "412" | "413"
                // the message was too long, or the nick is banned
                | "417" | "437"
        )
    });

    // --- THE DELIVERED FLAG ---
    // the server refuses a message it cannot deliver, and says so with
    // an error numeric. `401 ERR_NOSUCHNICK` is the one that matters
    // most: a DM to a nick that is not online is dropped SILENTLY,
    // and the agent would never know.
    //
    // so a message is DELIVERED unless the server said no.
    //
    // a missing echo on its own does not mean failure — it means we
    // did not see the proof in time. that is a different thing, and
    // the two are reported separately: `delivered` for the server's
    // verdict, `echoed` for whether we saw the echo.
    let refused = error_numeric.is_some();
    let delivered = !refused;

    // --- THE 403 SELF-HEAL ---
    // `403 ERR_NOSUCHCHANNEL` means the server does not have that
    // channel, or we are not in it. either way, the client believes it
    // is in a channel it is not in — so the belief is dropped, and
    // the next send joins it properly.
    //
    // this is what recovers a client whose channel list went stale.
    if let Some(numeric) = &error_numeric
        && numeric.command == "403"
            && let Some(channel) = numeric.params.get(1)
        {
            let mut connection = session.connection.lock().await;
            let lower = channel.to_lowercase();
            connection
                .channels
                .retain(|c| c.to_lowercase() != lower);
            tracing::warn!(
                channel = %channel,
                "the server said there is no such channel, so the client is no longer \
                 pretending to be in it. the next send will join it again."
            );
        }

    // --- THE `ok` FLAG ---
    // `ok` used to mean "the api call worked", which is true even
    // when the server threw the message away. an agent checking `ok`
    // would believe a DM to a nick that was not online had been sent.
    //
    // so `ok` means "the server did not refuse this".
    let error = error_numeric.map(|m| {
        let numeric = m.command.clone();
        let text = m.params.last().cloned().unwrap_or_default();
        format!("the server refused this message: {numeric} {text}")
    });

    let ok = delivered;

    let mut answer = serde_json::json!({
        "ok": ok,
        "target": request.target,
        "message": request.message,
        "joined": joined,
        // whether we saw the echo. this is the proof the message
        // landed, but it is not the same as "the server refused it".
        "echoed": echo.is_some(),
        "echo": echo.map(|m| m.raw.clone()),
        // true when the server accepted it. false when the server
        // said no, e.g. the nick is not online.
        "delivered": delivered,
        // the error numeric, when the server sent one.
        "numeric": error_numeric.map(|m| m.raw.clone()),
        // the same thing in words, for when the numeric is opaque.
        "error": error,
        // the cursor before the message went out. pair a `wait` with
        // this to catch a reply that landed while the send was waiting
        // for the echo.
        "cursor_before": cursor_before,
        "cursor": session.seq.load(std::sync::atomic::Ordering::SeqCst),
    });

    // keep the shape honest: the status says it in words too.
    if !ok {
        answer["status"] = serde_json::json!("refused");
    } else if echo.is_some() {
        answer["status"] = serde_json::json!("sent");
    } else {
        // the server did not refuse it, but we did not see the echo.
        // that is worth saying out loud.
        answer["status"] = serde_json::json!("sent_unconfirmed");
    }

    Json(answer).into_response()
}

/// send any irc line.
#[derive(Debug, Deserialize)]
struct RawRequest {
    line: String,
    /// how long to wait for the server's answer.
    #[serde(default)]
    wait_ms: Option<u64>,
}

async fn raw(
    State(session): State_,
    Json(request): Json<RawRequest>,
) -> axum::response::Response {
    let before = session.raw_head();
    let wait_ms = request.wait_ms.unwrap_or(800);

    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: request.line.clone(),
        wait_ms,
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }
    if let Ok(Err(err)) = wait.await {
        return fail(StatusCode::BAD_GATEWAY, err);
    }

    // wait for the answer, in the log.
    let replies = session
        .wait_for_reply(wait_ms, before, "", &session.options.nick)
        .await;

    let replies: Vec<serde_json::Value> = replies
        .iter()
        .map(|m| {
            serde_json::json!({
                "prefix": m.prefix,
                "command": m.command,
                "params": m.params,
                "tags": m.tags,
                "raw": m.raw,
            })
        })
        .collect();

    Json(serde_json::json!({
        "ok": true,
        "line": request.line,
        "replies": replies,
    }))
    .into_response()
}

/// read what came in.
#[derive(Debug, Deserialize)]
struct MessagesQuery {
    /// the cursor. 0 means everything the log still holds.
    #[serde(default)]
    since: Option<u64>,
    /// how many events to return.
    #[serde(default)]
    limit: Option<usize>,
    /// only events of this kind, e.g. `message`.
    #[serde(default)]
    kind: Option<String>,
    /// only events for this channel.
    #[serde(default)]
    target: Option<String>,
    /// only events from this nick.
    #[serde(default)]
    from: Option<String>,
    /// drop the events that came from our own nick.
    ///
    /// the server advertises `echo-message`, so every message the
    /// agent sends comes back to it. a caller waiting for a REPLY
    /// does not want its own message — that is not a reply.
    #[serde(default)]
    exclude_self: Option<bool>,
    /// leave out the raw irc line.
    ///
    /// the raw line is about three times the size of the useful
    /// fields, and it carries the same information they do. it is
    /// here when it is needed and out of the way when it is not.
    #[serde(default)]
    compact: Option<bool>,
}

async fn messages(
    State(session): State_,
    Query(query): Query<MessagesQuery>,
) -> axum::response::Response {
    let since = query.since.unwrap_or(0);
    let limit = query.limit.unwrap_or(200).min(2000);
    let me = session.options.nick.to_lowercase();
    let compact = query.compact.unwrap_or(false);

    // --- THE WHOLE LOG IS SCANNED ---
    // this used to fetch only `limit * 4` events and then filter
    // them. so if more than three quarters of the window was
    // non-matching traffic — which is what a busy channel with a
    // `--from` filter looks like — the matching event was never
    // returned at all.
    //
    // and it was SILENT: the answer said `count: 0` and carried the
    // log head as its cursor, so a caller that advanced past it never
    // saw the message again. an agent waiting for a reply in a busy
    // channel would wait out its timeout and conclude nobody replied.
    //
    // so the whole log is scanned, and `limit` applies to the RESULT.
    let entries = session.since(since, usize::MAX).await;

    // --- THE CURSOR IS THE LAST EVENT EXAMINED ---
    // it is NOT the log head. the head is where the log is now, and
    // using it as the cursor would skip every event that did not
    // match the filter — so a message that arrived during a noisy
    // moment would never be seen, by this caller or any later one.
    //
    // the cursor moves to the last event that was LOOKED AT, whether
    // or not it matched. the next call starts from there and looks
    // again.
    let mut examined = since;
    let mut matched: Vec<crate::session::LoggedEvent> = Vec::new();

    for entry in entries {
        examined = entry.seq;
        if matched.len() >= limit {
            // there are enough. stop here — but the cursor still
            // points at the last event examined, so nothing is lost.
            break;
        }
        if !matches_query(&entry, &query, &me) {
            continue;
        }
        matched.push(entry);
    }

    let filtered: Vec<serde_json::Value> = matched
        .iter()
        .map(|entry| {
            if compact {
                // without the raw line. the other fields carry the
                // same information.
                serde_json::json!({
                    "seq": entry.seq,
                    "kind": entry.event.kind,
                    "from": entry.event.from,
                    "target": entry.event.target,
                    "text": entry.event.text,
                    "msgid": entry.event.msgid,
                    "at": entry.event.at,
                })
            } else {
                serde_json::json!({
                    "seq": entry.seq,
                    "kind": entry.event.kind,
                    "from": entry.event.from,
                    "target": entry.event.target,
                    "text": entry.event.text,
                    "msgid": entry.event.msgid,
                    "at": entry.event.at,
                    "raw": entry.event.raw,
                })
            }
        })
        .collect();

    let head = session.head().await;
    Json(serde_json::json!({
        "ok": true,
        "since": since,
        // the cursor to use next time. it is the last event that was
        // LOOKED AT — not the log head. using the head would skip
        // every event the filter turned away, and those would never
        // be seen again.
        "cursor": examined,
        // where the log actually is. useful when the caller wants to
        // know whether it is behind.
        "head": head,
        "count": filtered.len(),
        "messages": filtered,
    }))
    .into_response()
}

/// does an event match what the caller asked for?
fn matches_query(
    entry: &crate::session::LoggedEvent,
    query: &MessagesQuery,
    me: &str,
) -> bool {
    if let Some(kind) = &query.kind
        && !kind_matches(kind, &entry.event.kind)
    {
        return false;
    }
    if query.exclude_self == Some(true)
        && entry
            .event
            .from
            .as_ref()
            .map(|f| f.to_lowercase() == me)
            .unwrap_or(false)
    {
        return false;
    }
    if let Some(target) = &query.target {
        let want = target.to_lowercase();
        let have = entry
            .event
            .target
            .as_ref()
            .map(|t| t.to_lowercase() == want)
            .unwrap_or(false);
        if !have {
            return false;
        }
    }
    if let Some(from) = &query.from {
        let want = from.to_lowercase();
        let have = entry
            .event
            .from
            .as_ref()
            .map(|f| f.to_lowercase() == want)
            .unwrap_or(false);
        if !have {
            return false;
        }
    }
    true
}

/// does an event of this kind match what the caller asked for?
///
/// `conversation` is the default, and it means the things a person
/// would read as being spoken to them: a channel message or a DM.
///
/// `message` is a channel message only, and `dm` is a private message
/// only. `any` is everything.
///
/// the strictness matters: `--kind message` used to be the only
/// sensible filter, and it excluded DMs, so an agent waiting for a
/// reply would never see a private one and would not know why.
fn kind_matches(wanted: &str, actual: &str) -> bool {
    match wanted {
        "conversation" => actual == "message" || actual == "dm",
        "any" => true,
        other => other == actual,
    }
}

/// the live stream of messages.
///
/// the filters are the same ones `/messages` takes, so a consumer
/// only sees what it cares about. without them the stream carries
/// every join and quit on the server, which is noise.
#[derive(Debug, Deserialize)]
struct StreamQuery {
    /// only events of this kind, e.g. `message` or `dm`.
    #[serde(default)]
    kind: Option<String>,
    /// only events for this channel.
    #[serde(default)]
    target: Option<String>,
    /// only events from this nick.
    #[serde(default)]
    from: Option<String>,
    /// drop the events from our own nick.
    #[serde(default)]
    exclude_self: Option<bool>,
}

/// the live stream of messages.
async fn stream(
    State(session): State_,
    Query(query): Query<StreamQuery>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let mut rx = session.tx.subscribe();
    let me = session.options.nick.to_lowercase();

    // the filters are worked out once, here, so the stream loop does
    // not have to parse them for every event.
    let kind = query.kind.clone();
    let target = query.target.clone().map(|t| t.to_lowercase());
    let from = query.from.clone().map(|f| f.to_lowercase());
    let exclude_self = query.exclude_self.unwrap_or(false);

    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // --- THE FILTERS ---
                    if let Some(kind) = &kind
                        && !kind_matches(kind, &event.kind) {
                        continue;
                    }
                    if let Some(target) = &target {
                        let have = event
                            .target
                            .as_ref()
                            .map(|t| t.to_lowercase() == *target)
                            .unwrap_or(false);
                        if !have {
                            continue;
                        }
                    }
                    if let Some(from) = &from {
                        let have = event
                            .from
                            .as_ref()
                            .map(|f| f.to_lowercase() == *from)
                            .unwrap_or(false);
                        if !have {
                            continue;
                        }
                    }
                    if exclude_self
                        && event
                            .from
                            .as_ref()
                            .map(|f| f.to_lowercase() == me)
                            .unwrap_or(false)
                    {
                        continue;
                    }

                    let payload = serde_json::json!({
                        "kind": event.kind,
                        "from": event.from,
                        "target": event.target,
                        "text": event.text,
                        "msgid": event.msgid,
                        "at": event.at,
                    });
                    let sse = Event::default()
                        .event("message")
                        .data(serde_json::to_string(&payload).unwrap_or_default());
                    yield Ok(sse);
                }
                Err(RecvError::Lagged(_)) => {
                    // the consumer fell behind. say so, and let it catch
                    // up over the cursor in /messages.
                    let sse = Event::default()
                        .event("lagged")
                        .data("{\"kind\":\"lagged\"}");
                    yield Ok(sse);
                }
                Err(RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    )
}

/// the channels and who is in them.
async fn channels(State(session): State_) -> impl IntoResponse {
    let connection = session.connection.lock().await;
    Json(serde_json::json!({
        "ok": true,
        "channels": connection.channels,
        // the raw names list, as `nick!ident@host`.
        "names": names(&connection),
        // the same list, split into the parts an agent wants.
        "people": crate::irc::name_entries(&connection),
    }))
}

/// who is in a channel, and which of them are bots.
///
/// the `WHO` reply is the good one. its `352` line carries the user's
/// modes, and a `B` in there is the bot flag — so this can say who is
/// a bot even though WHOIS does not report it.
///
/// the modes look like `H@B`:
///   H — here (every user has it)
///   G — away
///   @ — channel operator
///   B — a bot
async fn who(
    State(session): State_,
    Query(query): Query<WhoQuery>,
) -> axum::response::Response {
    let channel = query.channel.clone();

    // ask the server.
    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: format!("WHO {channel}"),
        wait_ms: 1500,
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }
    let before = match wait.await {
        Ok(Ok(before)) => before,
        Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    };

    // wait for the answer, in the log.
    let replies = session
        .wait_for_reply(1500, before, "", &session.options.nick)
        .await;

    // the 352 line is:
    //   352 <me> <channel> <user> <host> <server> <nick> <flags> :<hops> <realname>
    let people: Vec<serde_json::Value> = replies
        .iter()
        .filter(|m| m.command == "352")
        .filter_map(|m| {
            let flags = m.params.get(6)?;
            let nick = m.params.get(5)?;
            let realname = m.params.last().cloned().unwrap_or_default();
            Some(serde_json::json!({
                "nick": nick,
                // the modes, without the leading H that every user has.
                "modes": flags,
                "operator": flags.contains('@') || flags.contains('&'),
                // this is the one that matters: a `B` in the modes.
                "bot": flags.contains('B'),
                "away": flags.contains('G'),
                "realname": realname,
            }))
        })
        .collect();

    Json(serde_json::json!({
        "ok": true,
        "channel": channel,
        "count": people.len(),
        "people": people,
    }))
    .into_response()
}

/// the query for `who`.
#[derive(Debug, Deserialize)]
struct WhoQuery {
    /// the channel to ask about.
    channel: String,
}

/// the server's own history for a channel.
///
/// this is the `CHATHISTORY` command, which needs the `draft/chathistory`
/// capability. the syntax is:
///
/// ```text
/// CHATHISTORY LATEST <target> <* | msgid=... | timestamp=...> <limit>
/// ```
///
/// and the server answers with a `BATCH +N chathistory <target>` ...
/// `BATCH -N` with the messages inside.
#[derive(Debug, Deserialize)]
struct HistoryQuery {
    channel: String,
    /// how many messages.
    #[serde(default)]
    limit: Option<usize>,
    /// only messages after this msgid.
    #[serde(default)]
    after: Option<String>,
}

async fn history(
    State(session): State_,
    Query(query): Query<HistoryQuery>,
) -> axum::response::Response {
    let limit = query.limit.unwrap_or(50).min(1000);

    let line = match &query.after {
        Some(msgid) => format!(
            "CHATHISTORY AFTER {} msgid={} {}",
            query.channel, msgid, limit
        ),
        None => format!("CHATHISTORY LATEST {} * {}", query.channel, limit),
    };

    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: line.clone(),
        wait_ms: 2500,
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }
    let before = match wait.await {
        Ok(Ok(before)) => before,
        Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    };

    // wait for the batch, in the log.
    let replies = session
        .wait_for_reply(2500, before, "", &session.options.nick)
        .await;

    // only the messages inside the batch count. the server answers
    // with `BATCH +N chathistory <target>` ... `BATCH -N`, and the
    // messages inside carry a `batch=N` tag.
    let batch_id = replies
        .iter()
        .find(|m| m.command == "BATCH" && m.params.get(1) == Some(&"+".to_string()))
        .and_then(|m| m.params.get(1).cloned());

    let messages: Vec<serde_json::Value> = replies
        .iter()
        .filter(|m| {
            m.command == "PRIVMSG"
                && match (&batch_id, m.tags.get("batch")) {
                    (Some(batch), Some(tag)) => tag == batch,
                    _ => true,
                }
        })
        .map(|m| {
            serde_json::json!({
                "kind": "message",
                "from": m.prefix.as_ref().map(|p| p.split('!').next().unwrap_or(p)),
                "target": m.params.first(),
                "text": m.params.last(),
                "msgid": m.tags.get("msgid"),
                "at": m.tags.get("time"),
                "raw": m.raw,
            })
        })
        .collect();

    Json(serde_json::json!({
        "ok": true,
        "channel": query.channel,
        "count": messages.len(),
        "messages": messages,
    }))
    .into_response()
}

/// the numerics and the events, for a caller that wants the raw state.
pub async fn debug_dump(session: &Session) -> HashMap<String, serde_json::Value> {
    let mut out = HashMap::new();
    out.insert("cursor".to_string(), session.head().await.into());
    out
}

/// turn a message into an event, for the callers that want it.
pub fn event_of(message: &IrcMessage) -> Option<crate::irc::IrcEvent> {
    to_event(message)
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
