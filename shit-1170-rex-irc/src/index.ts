// ========================================
// the public surface of the irc skill.
//
// an irc client over the IRCv3 websocket transport, for agents that
// need to talk to the shit-1170 irc server from a script.
//
// see DOCS/PROTOCOL.md for what the server supports.
// ========================================

export {
  SHIT_1170_IRC_CONNECTION,
  SHIT_1170_IRC_DEFAULT_NICK,
  SHIT_1170_IRC_DEFAULT_PATH,
  SHIT_1170_IRC_DEFAULT_PORT,
  SHIT_1170_IRC_DEFAULT_SERVER,
  SHIT_1170_IRC_DEFAULT_TIMEOUT_MS,
  shit_1170_irc_names_fun,
  shit_1170_irc_numerics_fun,
  sleep_fun,
  type SHIT_1170_IRC_EVENT,
  type SHIT_1170_IRC_MESSAGE,
  type SHIT_1170_IRC_OPTIONS,
} from "./irc";
// ========================================
// copyright 2026 by sleet.near
