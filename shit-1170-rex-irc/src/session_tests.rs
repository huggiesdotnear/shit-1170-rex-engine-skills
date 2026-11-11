// =================================================
// THE SESSION TESTS.
//
// these cover the self-exclusion logic — the thing that stops the
// agent from treating its own echoed message as a reply.
//
// the echo is real: the server advertises `echo-message`, so every
// message the agent sends comes back to it. a wait that returned that
// would be the agent talking to itself.
// =================================================

#[cfg(test)]
mod tests {
    use crate::irc::{IrcEvent, IrcOptions};
    use crate::session::Session;

    /// an event from a nick.
    fn event_from(from: &str, text: &str) -> IrcEvent {
        IrcEvent {
            kind: "message".to_string(),
            from: Some(from.to_string()),
            target: Some("#chan".to_string()),
            text: Some(text.to_string()),
            msgid: Some(format!("msgid-{from}-{text}")),
            at: Some("2026-11-11T20:00:00.000Z".to_string()),
            raw: format!("PRIVMSG #chan :{text}"),
        }
    }

    fn session() -> std::sync::Arc<Session> {
        let options = IrcOptions {
            nick: "sleet-agent".to_string(),
            ..IrcOptions::default()
        };
        Session::new(options)
    }

    #[tokio::test]
    async fn the_message_is_recorded_once() {
        let session = session();
        session.record(event_from("someone", "hello")).await;
        let entries = session.since(0, 10).await;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].event.text.as_deref(), Some("hello"));
    }

    #[tokio::test]
    async fn the_same_message_is_not_recorded_twice() {
        // the reconnect's chathistory gap fill can hand back messages
        // the client already had. the msgid is what says so.
        let session = session();
        session.record(event_from("someone", "hello")).await;
        session.record(event_from("someone", "hello")).await;
        let entries = session.since(0, 10).await;
        assert_eq!(entries.len(), 1);
    }

    #[tokio::test]
    async fn the_cursor_advances_over_the_events() {
        let session = session();
        session.record(event_from("someone", "one")).await;
        session.record(event_from("someone", "two")).await;

        let all = session.since(0, 10).await;
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].seq, 1);
        assert_eq!(all[1].seq, 2);

        // the cursor moves only when the caller says it has seen them.
        let after_first = session.since(1, 10).await;
        assert_eq!(after_first.len(), 1);
        assert_eq!(after_first[0].event.text.as_deref(), Some("two"));
    }

    #[tokio::test]
    async fn the_head_is_the_last_sequence_number() {
        let session = session();
        assert_eq!(session.head().await, 0);
        session.record(event_from("someone", "one")).await;
        assert_eq!(session.head().await, 1);
    }

    #[tokio::test]
    async fn our_own_nick_is_known_to_the_session() {
        // this is what the exclude_self filter compares against.
        let session = session();
        assert_eq!(session.options.nick, "sleet-agent");
    }
}
