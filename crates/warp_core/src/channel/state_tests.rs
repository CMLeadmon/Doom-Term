use super::derive_http_origin_from_ws_url;

#[test]
fn wss_becomes_https_and_strips_path() {
    let got = derive_http_origin_from_ws_url("wss://rtc.app.warp.dev/graphql/v2");
    assert_eq!(got.as_deref(), Some("https://rtc.app.warp.dev"));
}

#[test]
fn ws_becomes_http_and_preserves_port() {
    let got = derive_http_origin_from_ws_url("ws://localhost:8080/graphql/v2");
    assert_eq!(got.as_deref(), Some("http://localhost:8080"));
}

#[test]
fn unparseable_input_returns_none() {
    assert!(derive_http_origin_from_ws_url("not a url").is_none());
    assert!(derive_http_origin_from_ws_url("https://app.warp.dev").is_none());
}

// --- Doom Term channel policy ------------------------------------------------
//
// These assert per-channel behaviour through the pure `*_for` seams rather than
// by mutating the process-global `ChannelState`. The global is a singleton, so
// a test that set it would leak into whichever test ran next, and the failure
// would depend on thread scheduling. The subprocess test below covers the one
// thing the seams cannot: what the global actually holds in a real Doom Term
// binary.

use crate::channel::{Channel, url_scheme_for};

#[test]
fn doomterm_is_not_a_dogfood_channel() {
    assert!(
        !Channel::DoomTerm.is_dogfood(),
        "Doom Term is a public build; dogfood channels enable internal-only behaviour"
    );
}

#[test]
fn doomterm_rejects_server_url_overrides() {
    // This matters independently of the compile boundary. A user with
    // WARP_SERVER_ROOT_URL exported in their shell profile, or a stale
    // --server-root-url in a launch configuration, must not be able to point a
    // local-only build at anything.
    assert!(
        !Channel::DoomTerm.allows_server_url_overrides(),
        "a build with no hosted services must not honour server URL overrides"
    );
}

#[test]
fn doomterm_url_scheme_is_distinct_from_every_warp_channel() {
    assert_eq!(url_scheme_for(Channel::DoomTerm), "doomterm");

    for channel in [
        Channel::Stable,
        Channel::Preview,
        Channel::Dev,
        Channel::Local,
        Channel::Integration,
        Channel::Oss,
    ] {
        assert_ne!(
            url_scheme_for(channel),
            url_scheme_for(Channel::DoomTerm),
            "{channel} shares a URL scheme with Doom Term; installing both would make \
             which application handles a link depend on installation order"
        );
    }
}

#[test]
fn doomterm_cli_and_display_names_are_distinct() {
    assert_eq!(Channel::DoomTerm.cli_command_name(), "doomterm");
    assert_eq!(Channel::DoomTerm.to_string(), "doomterm");

    for channel in [
        Channel::Stable,
        Channel::Preview,
        Channel::Dev,
        Channel::Local,
        Channel::Integration,
        Channel::Oss,
    ] {
        assert_ne!(
            channel.cli_command_name(),
            Channel::DoomTerm.cli_command_name()
        );
        assert_ne!(
            channel.warpctrl_command_name(),
            Channel::DoomTerm.warpctrl_command_name()
        );
    }
}

// --- The global singleton ----------------------------------------------------

/// Name of the environment variable that marks the child half of the subprocess
/// test below.
const CHILD_MARKER: &str = "WARP_CORE_DOOMTERM_CHANNEL_STATE_CHILD";

/// Asserts what a real Doom Term binary's global channel state holds.
///
/// `ChannelState` is a process-global singleton with a `set` that any test
/// could call. Asserting against it in-process would mean this test either
/// leaks its state into whichever test runs next, or reads state some other
/// test installed first — and which of those happened would depend on thread
/// scheduling. Running the assertions in a fresh process removes the ordering
/// question entirely, and has the side benefit of exercising `set` exactly the
/// way `bin/doomterm.rs` does, from a process that has not yet touched it.
#[test]
fn doomterm_channel_state_in_a_fresh_process() {
    use std::process::Command;

    if std::env::var(CHILD_MARKER).is_ok() {
        assert_doomterm_channel_state();
        return;
    }

    let exe = std::env::current_exe().expect("test binary path");
    let output = Command::new(exe)
        .args([
            "--exact",
            "channel::state::tests::doomterm_channel_state_in_a_fresh_process",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_MARKER, "1")
        .output()
        .expect("spawn the child half of this test");

    assert!(
        output.status.success(),
        "child process assertions failed.\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
}

fn assert_doomterm_channel_state() {
    use crate::AppId;
    use crate::channel::{ChannelConfig, ChannelState};

    // Exactly what app/src/bin/doomterm.rs installs.
    ChannelState::set(ChannelState::new(
        Channel::DoomTerm,
        ChannelConfig {
            app_id: AppId::new("io", "cmleadmon", "DoomTerm"),
            logfile_name: "doomterm.log".into(),
            hosted_services: None,
            telemetry_config: None,
            crash_reporting_config: None,
            autoupdate_config: None,
            mcp_static_config: None,
        },
    ));

    assert_eq!(ChannelState::channel(), Channel::DoomTerm);
    assert_eq!(ChannelState::app_id().to_string(), "io.cmleadmon.DoomTerm");
    assert_eq!(ChannelState::logfile_name(), "doomterm.log");
    assert_eq!(ChannelState::url_scheme(), "doomterm");

    assert!(
        !ChannelState::has_hosted_services(),
        "the Doom Term channel must carry no hosted services configuration"
    );

    // No server is addressable. An empty root is not the mechanism that removes
    // hosted services — the Cargo feature boundary in T4 is — but while the
    // hosted code is still compiled, it must not have anywhere to go.
    assert!(
        ChannelState::server_root_url().is_empty(),
        "no server root URL may be reachable from the Doom Term channel"
    );
    assert!(ChannelState::oz_root_url().is_empty());
    assert!(ChannelState::firebase_api_key().is_empty());
    assert!(ChannelState::session_sharing_server_url().is_none());
    assert!(ChannelState::iap_config().is_none());
    assert!(
        ChannelState::server_root_domain().is_none(),
        "an absent server must yield no origin rather than a parsed placeholder"
    );
    assert!(!ChannelState::uses_staging_server());

    // Optional subsystems are absent, so their UI has nothing to toggle.
    assert!(!ChannelState::is_telemetry_available());
    assert!(!ChannelState::is_crash_reporting_available());
    assert!(!ChannelState::show_autoupdate_menu_items());
    assert!(ChannelState::telemetry_file_name().is_empty());
    assert!(ChannelState::releases_base_url().is_empty());
    assert!(ChannelState::sentry_url().is_empty());

    // A server URL override must not be able to introduce a server. The channel
    // refuses overrides, and even applied directly there is nothing to write to.
    assert!(!Channel::DoomTerm.allows_server_url_overrides());
    ChannelState::override_server_root_url("https://example.invalid")
        .expect("a syntactically valid URL is still validated");
    assert!(
        ChannelState::server_root_url().is_empty(),
        "an override must not create a hosted services configuration that did not exist"
    );
    assert!(!ChannelState::has_hosted_services());

    // Data lives beside no other product's.
    let config_dir_name = crate::paths::warp_home_config_dir_name();
    assert_eq!(config_dir_name, ".doomterm");
    assert!(
        !config_dir_name.starts_with(".warp"),
        "Doom Term must not read or write a Warp installation's configuration"
    );
}
