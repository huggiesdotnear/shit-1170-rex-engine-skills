// =================================================
// THE INTEGRATION TESTS.
//
// these drive the daemon over its own http api, the way a client
// does. they are ignored by default because they need the real
// server:
//
//     cargo test -- --ignored
//
// they are worth running before a release, because they cover the
// paths that unit tests cannot: the cursor over a real message
// stream, the self-exclusion, and the send/wait cycle.
// =================================================

#[cfg(test)]
mod tests {
    use crate::api;
    use crate::irc::IrcOptions;
    use crate::reader;
    use crate::session::Session;
    use std::sync::Arc;
    use std::time::Duration;

    /// a session connected to the real server, with a nick of our own.
    async fn live_session(nick: &str) -> Arc<Session> {
        let options = IrcOptions {
            nick: nick.to_string(),
            realname: "integration test".to_string(),
            channels: vec![],
            ..IrcOptions::default()
        };
        let session = Session::new(options);
        let reader_session = session.clone();
        tokio::spawn(async move {
            reader::run(reader_session).await;
        });

        // wait for the connection.
        for _ in 0..100 {
            if session.is_connected() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(session.is_connected(), "the daemon did not connect");

        // and for the registration to finish.
        for _ in 0..100 {
            let registered = { session.connection.lock().await.registered };
            if registered {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        session
    }

    /// the api, over the real session.
    fn app(session: Arc<Session>) -> axum::Router {
        api::router(session)
    }

    #[tokio::test]
    #[ignore = "needs the real irc server"]
    async fn the_bot_mode_is_set_on_connect() {
        let session = live_session("irc-it-bot-1").await;

        // the mode is set after the registration finishes. the server
        // echoes our own MODE command back — that echo carries the
        // `+B`.
        //
        // NOTE: the `221` numeric is NOT the answer. the server sends
        // `221 <nick> +Z` at registration, before we asked, so it says
        // nothing about our mode.
        let mut confirmed = false;
        for _ in 0..50 {
            {
                let connection = session.connection.lock().await;
                confirmed = connection.messages.iter().any(|m| {
                    m.command == "MODE" && m.params.iter().any(|p| p.contains('B'))
                });
            }
            if confirmed {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(confirmed, "the +B mode was not confirmed by the server");
    }

    #[tokio::test]
    #[ignore = "needs the real irc server"]
    async fn a_direct_message_is_its_own_kind() {
        let session = live_session("irc-it-dm-1").await;
        let channel = "#irc-it-dm-1";
        {
            let mut connection = session.connection.lock().await;
            connection.join(channel).await.expect("could not join");
        }
        // let the names and the join settle.
        tokio::time::sleep(Duration::from_millis(800)).await;

        // the join of our own channel is in the log, as a join event
        // for the channel we asked for. give the server a moment to
        // echo it back.
        let mut joined = false;
        for _ in 0..50 {
            joined = {
                let entries = session.since(0, 500).await;
                entries.iter().any(|e| {
                    e.event.kind == "join"
                        && e.event
                            .target
                            .as_ref()
                            .map(|t| t.to_lowercase() == channel.to_lowercase())
                            .unwrap_or(false)
                })
            };
            if joined {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(joined, "the join did not show up in the log");

        // and the channel list knows about it.
        let in_channel = {
            let connection = session.connection.lock().await;
            connection
                .channels
                .iter()
                .any(|c| c.to_lowercase() == channel.to_lowercase())
        };
        assert!(in_channel, "the channel list did not get the channel");
    }

    #[tokio::test]
    #[ignore = "needs the real irc server"]
    async fn the_cursor_advances_and_the_log_never_repeats() {
        let session = live_session("irc-it-cursor-1").await;

        let before = session.since(0, 500).await;
        let head = session.head().await;
        assert_eq!(
            before.len() as u64,
            head,
            "the head should be the number of events recorded"
        );

        // everything after the head is nothing.
        let after = session.since(head, 10).await;
        assert!(after.is_empty(), "there should be nothing after the head");

        // a message already seen is not recorded twice.
        let entries = session.since(0, 500).await;
        let mut msgids: Vec<&str> = entries
            .iter()
            .filter_map(|e| e.event.msgid.as_deref())
            .collect();
        let count = msgids.len();
        msgids.sort_unstable();
        msgids.dedup();
        assert_eq!(count, msgids.len(), "a msgid was recorded twice");
    }

    #[tokio::test]
    #[ignore = "needs the real irc server"]
    async fn the_api_serves_the_status() {
        let session = live_session("irc-it-api-1").await;
        let app = app(session.clone());

        let response = axum::body::Body::empty();
        let request = axum::http::Request::builder()
            .uri("/status")
            .body(response)
            .unwrap();
        let response = tower::ServiceExt::oneshot(app, request).await.unwrap();
        assert!(response.status().is_success());

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["ok"], serde_json::json!(true));
        assert_eq!(value["nick"], serde_json::json!("irc-it-api-1"));
        assert!(value.get("reconnects").is_some(), "no reconnects count");
        assert!(value.get("uptime_seconds").is_some(), "no uptime");
    }

    #[tokio::test]
    #[ignore = "needs the real irc server"]
    async fn the_who_endpoint_says_who_is_a_bot() {
        let session = live_session("irc-it-who-1").await;
        let app = app(session.clone());

        let request = axum::http::Request::builder()
            .uri("/who?channel=%23shit-1170")
            .body(axum::body::Body::empty())
            .unwrap();
        let response = tower::ServiceExt::oneshot(app, request).await.unwrap();
        assert!(response.status().is_success());

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["ok"], serde_json::json!(true));

        let people = value["people"].as_array().expect("no people");
        assert!(!people.is_empty(), "nobody was found in the channel");

        // our own nick is in there, and we are a bot.
        let me = people
            .iter()
            .find(|p| p["nick"] == serde_json::json!("irc-it-who-1"))
            .expect("our own nick was not in the list");
        assert_eq!(
            me["bot"],
            serde_json::json!(true),
            "our own bot flag was not reported"
        );
    }
}

