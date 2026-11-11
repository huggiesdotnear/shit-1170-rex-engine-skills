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

    #[test]
    fn the_bot_mode_is_on_by_default() {
        // the client is a program, and the `+B` mode is how it says
        // so. a client that says it is a bot when it is not would be
        // lying to everyone else in the channel.
        //
        // this test is here so the default cannot be flipped by
        // accident without someone noticing and changing this too.
        let config = crate::store::IrcConfig::default();
        assert!(config.bot, "the bot mode should be the default");
    }

    #[test]
    fn the_two_bot_defaults_agree() {
        // the store holds the config default and the library holds
        // the options default. they were disagreeing: the store said
        // on, the library said off. so a caller that built its
        // options directly — rather than going through the store —
        // got a client that did not say it was a bot.
        //
        // the integration test `the_bot_mode_is_set_on_connect` caught
        // this. this test makes sure it stays caught.
        let options = IrcOptions::default();
        let config = crate::store::IrcConfig::default();
        assert_eq!(
            options.bot, config.bot,
            "the library default and the config default must agree"
        );
    }

    // --- THE CHANNEL LIST AFTER A DROP ---

    #[tokio::test]
    async fn forgetting_the_channels_clears_the_list() {
        // when the socket dies, the server forgets us too. the list
        // has to be cleared, or the reconnect thinks it is still in
        // the channels and skips the JOIN — and the client ends up
        // believing it is in a channel it is not in.
        let session = session();
        {
            let mut connection = session.connection.lock().await;
            connection.channels.push("#somewhere".to_string());
            assert_eq!(connection.channels.len(), 1);
            connection.forget_channels();
        }
        let connection = session.connection.lock().await;
        assert!(
            connection.channels.is_empty(),
            "the channel list should be empty after a drop"
        );
    }

    #[tokio::test]
    async fn the_cursor_covers_everything_that_was_recorded() {
        // the cursor is what a caller advances. it has to cover every
        // event, or a message is skipped for good.
        let session = session();
        for i in 0..50 {
            session
                .record(event_from("noisy-peer", &format!("noise {i}")))
                .await;
        }
        assert_eq!(session.head().await, 50);

        // every event is reachable from the start.
        let all = session.since(0, 1000).await;
        assert_eq!(all.len(), 50);
        assert_eq!(all[49].seq, 50);

        // and walking the cursor covers them all, with no gaps.
        let mut cursor = 0;
        let mut seen = 0;
        loop {
            let batch = session.since(cursor, 10).await;
            if batch.is_empty() {
                break;
            }
            seen += batch.len();
            cursor = batch[batch.len() - 1].seq;
        }
        assert_eq!(seen, 50, "walking the cursor missed some events");
    }
}
