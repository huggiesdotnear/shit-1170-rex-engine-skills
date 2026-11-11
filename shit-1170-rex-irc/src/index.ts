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
  shit_1170_irc_parse_fun,
  sleep_fun,
  type SHIT_1170_IRC_EVENT,
  type SHIT_1170_IRC_MESSAGE,
  type SHIT_1170_IRC_OPTIONS,
} from "./irc";

export {
  SHIT_1170_HOME_DIR_NAME,
  shit_1170_home_dir_fun,
  shit_1170_irc_config_default_fun,
  shit_1170_irc_config_path_fun,
  shit_1170_irc_config_read_fun,
  shit_1170_irc_config_write_fun,
  shit_1170_irc_credential_fun,
  shit_1170_irc_credentials_read_fun,
  shit_1170_irc_credentials_write_fun,
  shit_1170_irc_dir_fun,
  shit_1170_irc_history_append_fun,
  shit_1170_irc_history_clear_fun,
  shit_1170_irc_history_path_fun,
  shit_1170_irc_history_read_fun,
  type SHIT_1170_IRC_CONFIG,
  type SHIT_1170_IRC_CREDENTIALS,
  type SHIT_1170_IRC_HISTORY_ENTRY,
} from "./store";
// ========================================
// copyright 2026 by sleet.near
