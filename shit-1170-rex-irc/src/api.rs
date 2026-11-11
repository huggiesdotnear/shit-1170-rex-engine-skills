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

use crate::irc::{names, numerics, to_event, IrcMessage};
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
        "registered": connection.registered,
        "sasl": connection.sasl_ok,
        "channels": connection.channels,
        "motd": connection.motd,
        "isupport": connection.isupport,
        "numerics": numerics(&connection),
        "cursor": session.seq.load(std::sync::atomic::Ordering::SeqCst),
    }))
}

/// join a channel.
#[derive(Debug, Deserialize)]
struct JoinRequest {
    channel: String,
}

async fn join(
    State(session): State_,
    Json(request): Json<JoinRequest>,
) -> axum::response::Response {
    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Join {
        channel: request.channel.clone(),
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }

    match wait.await {
        Ok(Ok(())) => {
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
        Ok(Ok(())) => {
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
            match wait.await {
                Ok(Ok(())) => joined.push(request.target.clone()),
                Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
                Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
            }
        }
    }

    // send the message. the read loop does the sending, because it
    // owns the socket.
    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: format!("PRIVMSG {} :{}", request.target, request.message),
        wait_ms: 1200,
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }

    let replies = match wait.await {
        Ok(Ok(replies)) => replies,
        Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    };

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

    let delivered = echo.is_some() && error_numeric.is_none();

    Json(serde_json::json!({
        "ok": true,
        "target": request.target,
        "message": request.message,
        "joined": joined,
        // the echo is the proof. its absence is not a failure — the
        // message may still have been delivered — so it is reported
        // rather than treated as an error.
        "echoed": echo.is_some(),
        "echo": echo.map(|m| m.raw.clone()),
        // true when the server accepted it. false when the server
        // said no, e.g. the nick is not online.
        "delivered": delivered,
        // the error numeric, when the server sent one.
        "numeric": error_numeric.map(|m| m.raw.clone()),
        "cursor": session.seq.load(std::sync::atomic::Ordering::SeqCst),
    }))
    .into_response()
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
    let (reply, wait) = tokio::sync::oneshot::channel();
    let command = crate::reader::Command::Send {
        line: request.line.clone(),
        wait_ms: request.wait_ms.unwrap_or(800),
        reply,
    };
    if let Err(err) = session.command(command).await {
        return fail(StatusCode::SERVICE_UNAVAILABLE, err);
    }

    let replies = match wait.await {
        Ok(Ok(replies)) => replies,
        Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    };

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
}

async fn messages(
    State(session): State_,
    Query(query): Query<MessagesQuery>,
) -> axum::response::Response {
    let since = query.since.unwrap_or(0);
    let limit = query.limit.unwrap_or(200).min(2000);
    let me = session.options.nick.to_lowercase();

    let entries = session.since(since, limit * 4).await;

    let filtered: Vec<serde_json::Value> = entries
        .into_iter()
        .filter(|entry| {
            if let Some(kind) = &query.kind
                && &entry.event.kind != kind {
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
        })
        .take(limit)
        .map(|entry| {
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
        })
        .collect();

    let head = session.head().await;
    Json(serde_json::json!({
        "ok": true,
        "since": since,
        "cursor": head,
        "count": filtered.len(),
        "messages": filtered,
    }))
    .into_response()
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
                        && &event.kind != kind {
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
        "names": names(&connection),
    }))
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

    let replies = match wait.await {
        Ok(Ok(replies)) => replies,
        Ok(Err(err)) => return fail(StatusCode::BAD_GATEWAY, err),
        Err(_) => return fail(StatusCode::BAD_GATEWAY, "the read loop went away"),
    };

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
