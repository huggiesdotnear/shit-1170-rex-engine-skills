// =================================================
// THE SESSION.
//
// the thing the http api talks to. it owns the irc connection, the
// log of everything that came in, and the cursor the api uses to say
// "give me what i have not seen yet".
//
// --- WHY THE CURSOR EXISTS ---
// an agent reads a channel, acts on it, and reads again. if every
// read returned everything since the beginning, the agent would have
// to filter the same messages out of every answer, and the answers
// would grow without bound.
//
// so the session keeps a monotonically increasing sequence number on
// every event, and a read takes `since` and returns what is newer. the
// cursor moves only when the caller says it has seen the messages.
//
// this is also the fix for the bug in the old typescript skill, where
// `listen_fun` took its baseline at the moment it was CALLED and so
// silently dropped every message that arrived before the call.
// =================================================

use crate::irc::{IrcConnection, IrcError, IrcEvent, IrcOptions};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

/// the most events the log keeps.
///
/// the log is a ring: the newest events push the oldest out. this is
/// what lets a long-lived connection hold a bounded amount of memory
/// while still covering a reconnect gap.
pub const LOG_CAPACITY: usize = 20_000;

/// one event, with the sequence number the cursor uses.
#[derive(Debug, Clone)]
pub struct LoggedEvent {
    /// the sequence number. starts at 1 and never repeats.
    pub seq: u64,
    /// the event itself.
    pub event: IrcEvent,
}

/// the shared state.
pub struct Session {
    /// the options the connection was built with.
    pub options: IrcOptions,
    /// the connection. behind a lock because the read loop holds it
    /// for long stretches and the http handlers need it too.
    pub connection: Mutex<IrcConnection>,
    /// the log of everything that came in.
    pub log: RwLock<Vec<LoggedEvent>>,
    /// the sequence counter.
    pub seq: AtomicU64,
    /// a broadcast of new events, for the sse stream.
    pub tx: broadcast::Sender<IrcEvent>,
    /// the last msgid seen, for a chathistory gap fill after a
    /// reconnect.
    pub last_msgid: Mutex<Option<String>>,
    /// whether the connection is up.
    pub connected: Arc<AtomicU64>,
    /// how many times the connection has been re-established.
    ///
    /// this is the number an agent looks at when a conversation keeps
    /// stalling — a rising count means the socket is dropping.
    pub reconnects: AtomicU64,
    /// when the connection came up, as a unix timestamp in seconds.
    pub connected_at: Mutex<Option<u64>>,
    /// the channel the read loop takes commands from.
    ///
    /// the read loop owns the socket, so it is the only thing that may
    /// read from it. a command from an http handler goes through here.
    pub commands: Mutex<Option<mpsc::Sender<crate::reader::Command>>>,
}

impl Session {
    /// build a session.
    pub fn new(options: IrcOptions) -> Arc<Self> {
        let (tx, _rx) = broadcast::channel(4096);
        let connection = IrcConnection::new(options.clone());
        Arc::new(Session {
            options,
            connection: Mutex::new(connection),
            log: RwLock::new(Vec::new()),
            seq: AtomicU64::new(0),
            tx,
            last_msgid: Mutex::new(None),
            connected: Arc::new(AtomicU64::new(0)),
            reconnects: AtomicU64::new(0),
            connected_at: Mutex::new(None),
            commands: Mutex::new(None),
        })
    }

    /// record that the connection came up.
    pub async fn mark_connected(&self) {
        self.connected.store(1, Ordering::Relaxed);
        let mut guard = self.connected_at.lock().await;
        *guard = Some(now_seconds());
    }

    /// record that the connection went down.
    pub fn mark_disconnected(&self) {
        self.connected.store(0, Ordering::Relaxed);
    }

    /// how long the connection has been up, in seconds.
    pub async fn uptime_seconds(&self) -> Option<u64> {
        let guard = self.connected_at.lock().await;
        guard.map(|at| now_seconds().saturating_sub(at))
    }

    /// give the read loop's command channel to the session.
    pub async fn set_sender(&self, sender: mpsc::Sender<crate::reader::Command>) {
        let mut guard = self.commands.lock().await;
        *guard = Some(sender);
    }

    /// take the command channel away, for when the read loop stops.
    pub async fn clear_sender(&self) {
        let mut guard = self.commands.lock().await;
        *guard = None;
    }

    /// the command channel, if the read loop is running.
    pub async fn sender(&self) -> Option<mpsc::Sender<crate::reader::Command>> {
        let guard = self.commands.lock().await;
        guard.clone()
    }

    /// send a command to the read loop.
    pub async fn command(
        &self,
        command: crate::reader::Command,
    ) -> Result<(), IrcError> {
        let sender = self.sender().await.ok_or(IrcError::NotOpen)?;
        sender
            .send(command)
            .await
            .map_err(|_| IrcError::NotOpen)
    }

    /// true when the connection is up.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed) == 1
    }

    /// record an event: give it a number, keep it in the log, and
    /// broadcast it.
    ///
    /// a message that was already seen is NOT recorded twice. the
    /// reconnect's chathistory gap fill can hand back messages the
    /// client already had, and the ircv3 msgid is what says so.
    pub async fn record(&self, event: IrcEvent) {
        // the msgid is the identity of a message. if we have seen it,
        // it is not news.
        if let Some(msgid) = &event.msgid {
            let already = {
                let log = self.log.read().await;
                log.iter().any(|entry| entry.event.msgid.as_deref() == Some(msgid.as_str()))
            };
            if already {
                tracing::debug!(msgid = %msgid, "already seen, not recording it again");
                return;
            }
        }

        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;

        // remember the last msgid, for the reconnect gap fill.
        if let Some(msgid) = &event.msgid
            && event.kind == "message" {
                let mut guard = self.last_msgid.lock().await;
                *guard = Some(msgid.clone());
            }

        {
            let mut log = self.log.write().await;
            log.push(LoggedEvent { seq, event: event.clone() });
            if log.len() > LOG_CAPACITY {
                let overflow = log.len() - LOG_CAPACITY;
                log.drain(0..overflow);
            }
        }

        // a send with no receivers is not an error — it just means
        // nobody is streaming right now.
        let _ = self.tx.send(event);
    }

    /// the events after `since`, up to `limit`.
    ///
    /// `since` of 0 means "everything the log still holds".
    pub async fn since(&self, since: u64, limit: usize) -> Vec<LoggedEvent> {
        let log = self.log.read().await;
        log.iter()
            .filter(|entry| entry.seq > since)
            .take(limit)
            .cloned()
            .collect()
    }

    /// the newest sequence number.
    pub async fn head(&self) -> u64 {
        self.seq.load(Ordering::SeqCst)
    }
}

/// the seconds since the unix epoch.
pub fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// a websocket read error that is really just a closed socket.
pub fn is_disconnect(err: &IrcError) -> bool {
    matches!(err, IrcError::NotOpen)
}

// =================================================
// copyright 2026 by sleet.near
// =================================================
