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

use crate::irc::{IrcConnection, IrcError, IrcEvent, IrcMessage, IrcOptions};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

/// the most events the log keeps.
///
/// the log is a ring: the newest events push the oldest out. this is
/// what lets a long-lived connection hold a bounded amount of memory
/// while still covering a reconnect gap.
pub const LOG_CAPACITY: usize = 20_000;

/// the most raw messages the raw list keeps.
///
/// this is for the answers to a command — the numerics and the
/// replies that are not events.
pub const RAW_MESSAGE_CAPACITY: usize = 5_000;

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
    /// the raw messages, for the ones that are not events.
    ///
    /// a numeric is not an event. the read loop puts those here, so a
    /// command can find its answer without needing the connection
    /// lock — which the read loop holds while it waits for the
    /// server.
    pub raw_messages: RwLock<Vec<IrcMessage>>,
    /// the raw counter, so a command can find what came after its own
    /// send.
    ///
    /// this is SEPARATE from the event log's counter. the event log
    /// counts events; this counts every line the server sent. mixing
    /// them up means a command looks in the wrong place for its
    /// answer.
    pub raw_seq: AtomicU64,
    /// whether the connection is up.
    pub connected: Arc<AtomicU64>,
    /// how many times the connection has been re-established.
    ///
    /// this is the number an agent looks at when a conversation keeps
    /// stalling — a rising count means the socket is dropping.
    pub reconnects: AtomicU64,
    /// when the connection came up, as a unix timestamp in seconds.
    pub connected_at: Mutex<Option<u64>>,
    /// why the registration failed, when it did.
    ///
    /// a nick that is already in use is permanent — retrying will not
    /// help — so the reason is kept and reported rather than looping.
    pub registration_error: Mutex<Option<String>>,
    /// an id for this daemon, unique per run.
    ///
    /// two daemons can end up on the same port — the second one fails
    /// to bind and the client commands then talk to the FIRST one,
    /// silently, and get its data. so the daemon says who it is, and
    /// a client can check.
    pub daemon_id: String,
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
            raw_messages: RwLock::new(Vec::new()),
            raw_seq: AtomicU64::new(0),
            seq: AtomicU64::new(0),
            tx,
            last_msgid: Mutex::new(None),
            connected: Arc::new(AtomicU64::new(0)),
            reconnects: AtomicU64::new(0),
            connected_at: Mutex::new(None),
            registration_error: Mutex::new(None),
            daemon_id: crate::store::random_id(),
            commands: Mutex::new(None),
        })
    }

    /// record a raw message.
    ///
    /// the read loop records EVERY line here, and the ones that are
    /// events in the event log as well.
    ///
    /// a command needs to find its own answer in this list, and that
    /// answer may be an event (the echo of a PRIVMSG) or a numeric.
    /// the raw counter is separate from the event log's, so a command
    /// can say "what came after my send" without the two spaces
    /// getting mixed up.
    pub async fn record_raw(&self, mut message: IrcMessage) {
        let seq = self.raw_seq.fetch_add(1, Ordering::SeqCst) + 1;
        message.seq = seq;
        let mut raw = self.raw_messages.write().await;
        raw.push(message);
        if raw.len() > RAW_MESSAGE_CAPACITY {
            let overflow = raw.len() - RAW_MESSAGE_CAPACITY;
            raw.drain(0..overflow);
        }
    }

    /// the raw messages after a sequence number.
    pub async fn raw_since(&self, seq: u64) -> Vec<IrcMessage> {
        let raw = self.raw_messages.read().await;
        raw.iter().filter(|m| m.seq > seq).cloned().collect()
    }

    /// the raw counter, as a sequence number.
    pub fn raw_head(&self) -> u64 {
        self.raw_seq.load(Ordering::SeqCst)
    }

    /// wait for an EVENT to show up in the log that matches.
    ///
    /// --- WHY THE LOG AND NOT THE SOCKET ---
    /// the read loop is the only reader, and it holds the connection
    /// lock while it waits for the server. so a command that wanted to
    /// check the socket would be stuck behind that wait.
    ///
    /// the log is a separate lock. the read loop puts every event
    /// there, so a command can watch it without touching the socket
    /// at all. that is what lets several commands be in flight at
    /// once without any of them starving.
    /// wait for the answer to a command.
    ///
    /// the read loop reads, and puts every line in the raw list. this
    /// watches that list for the answer.
    ///
    /// it is here, rather than in the read loop, so the read loop is
    /// never blocked waiting for an answer — it has to keep reading,
    /// or the answer would never arrive.
    ///
    /// `sent_text` is what was sent. the echo of a PRIVMSG comes back
    /// with the same text, so matching on it tells this command's
    /// answer apart from another command's when several are in flight.
    pub async fn wait_for_reply(
        &self,
        timeout_ms: u64,
        since_seq: u64,
        sent_text: &str,
        nick: &str,
    ) -> Vec<IrcMessage> {
        let start = tokio::time::Instant::now();
        let mut deadline = start + std::time::Duration::from_millis(timeout_ms);
        // --- THE WINDOW EXTENDS WHILE THINGS ARE ARRIVING ---
        // the server has a fakelag: it allows a couple of messages a
        // second and delays the rest. so a burst of ten sends gets
        // its echoes back over a second or two, and a fixed window
        // would report most of them as unconfirmed — even though
        // they all arrived.
        //
        // so the window extends while the answer is still on its way:
        // every new message pushes the deadline out. it is CAPPED, so
        // a stream of traffic cannot keep it alive forever.
        let hard_stop = start + std::time::Duration::from_millis(timeout_ms * 3);
        let mut last_seen = 0usize;
        loop {
            let found = self.raw_since(since_seq).await;
            if !found.is_empty() && crate::reader::reply_looks_done(&found, nick, sent_text) {
                return found;
            }
            // something new arrived — give it a moment more.
            if found.len() != last_seen {
                last_seen = found.len();
                deadline = (deadline + std::time::Duration::from_millis(timeout_ms)).min(hard_stop);
            }
            let now = tokio::time::Instant::now();
            if now >= deadline || now >= hard_stop {
                return found;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    pub async fn wait_for_event(
        &self,
        timeout_ms: u64,
        since_seq: u64,
        matches: impl Fn(&IrcEvent) -> bool,
    ) -> Option<IrcEvent> {
        let deadline =
            tokio::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            {
                let log = self.log.read().await;
                if let Some(found) = log
                    .iter()
                    .find(|entry| entry.seq > since_seq && matches(&entry.event))
                {
                    return Some(found.event.clone());
                }
            }
            if tokio::time::Instant::now() >= deadline {
                return None;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    /// the current log head, as a sequence number.
    pub fn log_head(&self) -> u64 {
        self.seq.load(Ordering::SeqCst)
    }

    /// record why the registration failed.
    pub async fn set_registration_error(&self, message: String) {
        let mut guard = self.registration_error.lock().await;
        *guard = Some(message);
    }

    /// why the registration failed, if it did.
    pub async fn registration_error(&self) -> Option<String> {
        let guard = self.registration_error.lock().await;
        guard.clone()
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
