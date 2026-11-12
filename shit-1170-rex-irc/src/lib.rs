// =================================================
// shit-1170 rex irc
//
// a long-lived irc client for the shit-1170 irc server.
//
// the shape:
//   irc.rs     the protocol: the parser, the connection, the events
//   session.rs the shared state: the log, the cursor, the broadcast
//   reader.rs  the read loop: read, record, reconnect, gap-fill
//   api.rs     the http api: rest plus a server-sent-event stream
//   store.rs   the local store: the config, the credentials, the history
//
// the client talks to the http api. the irc connection stays up in the
// background, so it can read a channel while it posts to it.
//
// the one thing that makes a long-lived connection possible: the ircd
// pings the client after 90 seconds of silence and drops it 60 seconds
// later. the connection answers every ping with a pong.
// =================================================

pub mod api;
pub mod irc;
pub mod reader;
pub mod session;
pub mod store;

#[cfg(test)]
mod irc_tests;
#[cfg(test)]
mod session_tests;
#[cfg(test)]
mod integration_tests;

// =================================================
// copyright 2026 by sleet.near
// =================================================
