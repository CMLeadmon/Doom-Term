//! Serialization tests for [`ChannelConfig`].
//!
//! [`ChannelConfig::hosted_services`] groups the server and Oz configuration
//! into one optional value so that a build with no hosted services can say so.
//! It is serialized flattened, which keeps the historical top-level
//! `server_config` and `oz_config` field names on the wire.
//!
//! That compatibility is the entire reason these tests exist. Channel
//! configuration is deserialized from files produced outside this repository,
//! so a change to the field layout is a change to a format this code does not
//! own. `#[serde(flatten)]` combined with `Option` also has behaviour worth
//! pinning rather than assuming: these tests establish what absent, present and
//! partially-present configurations actually do.

use crate::channel::{ChannelConfig, HostedServicesConfig};

/// A channel configuration in the shape upstream files already use.
///
/// Note that these tests deserialize from `&str`, not from
/// `serde_json::Value`. `AppId`'s `Deserialize` asks for a borrowed `&str`, so
/// it cannot be read out of an owned `Value` at all. Anything that loads a
/// channel configuration has to parse from the original bytes.
const UPSTREAM_SHAPED_CONFIG: &str = r#"{
    "app_id": "dev.warp.WarpOss",
    "logfile_name": "warp-oss.log",
    "server_config": {
        "server_root_url": "https://app.warp.dev",
        "rtc_server_url": "wss://rtc.app.warp.dev/graphql/v2",
        "session_sharing_server_url": "wss://sessions.app.warp.dev",
        "firebase_auth_api_key": "test-key"
    },
    "oz_config": {
        "oz_root_url": "https://oz.warp.dev",
        "workload_audience_url": null
    },
    "telemetry_config": null,
    "autoupdate_config": null,
    "crash_reporting_config": null,
    "mcp_static_config": null
}"#;

/// The same configuration with the hosted service fields removed.
const LOCAL_ONLY_CONFIG: &str = r#"{
    "app_id": "io.cmleadmon.DoomTerm",
    "logfile_name": "doomterm.log",
    "telemetry_config": null,
    "autoupdate_config": null,
    "crash_reporting_config": null,
    "mcp_static_config": null
}"#;

#[test]
fn existing_channel_config_files_still_parse() {
    let config: ChannelConfig = serde_json::from_str(UPSTREAM_SHAPED_CONFIG)
        .expect("a channel config in the historical shape must still deserialize");

    let hosted = config
        .hosted_services
        .expect("a config naming server_config and oz_config has hosted services");
    assert_eq!(hosted.server_config.server_root_url, "https://app.warp.dev");
    assert_eq!(hosted.oz_config.oz_root_url, "https://oz.warp.dev");
}

#[test]
fn config_without_server_fields_has_no_hosted_services() {
    let config: ChannelConfig = serde_json::from_str(LOCAL_ONLY_CONFIG)
        .expect("a config with no hosted fields must deserialize");

    assert!(
        config.hosted_services.is_none(),
        "absent server and Oz configuration must produce None, not a default-filled struct"
    );
}

#[test]
fn hosted_services_round_trip_keeps_top_level_field_names() {
    let config = ChannelConfig {
        app_id: crate::AppId::new("dev", "warp", "WarpOss"),
        logfile_name: "warp-oss.log".into(),
        hosted_services: Some(HostedServicesConfig::production()),
        telemetry_config: None,
        autoupdate_config: None,
        crash_reporting_config: None,
        mcp_static_config: None,
    };

    let value = serde_json::to_value(&config).expect("serializes");
    let map = value.as_object().expect("object");

    // The flattened group must not appear as a nested "hosted_services" key:
    // that would be a new file format, not a compatible one.
    assert!(
        !map.contains_key("hosted_services"),
        "hosted services must serialize flattened, not as a nested object: {value}"
    );
    assert!(map.contains_key("server_config"), "got {value}");
    assert!(map.contains_key("oz_config"), "got {value}");

    let text = serde_json::to_string(&config).expect("serializes");
    let reparsed: ChannelConfig = serde_json::from_str(&text).expect("round trips");
    assert!(reparsed.hosted_services.is_some());
}

#[test]
fn absent_hosted_services_serializes_without_server_fields() {
    let config = ChannelConfig {
        app_id: crate::AppId::new("io", "cmleadmon", "DoomTerm"),
        logfile_name: "doomterm.log".into(),
        hosted_services: None,
        telemetry_config: None,
        autoupdate_config: None,
        crash_reporting_config: None,
        mcp_static_config: None,
    };

    let value = serde_json::to_value(&config).expect("serializes");
    let map = value.as_object().expect("object");

    // A local-only configuration must not emit empty or defaulted server
    // fields. An empty `server_root_url` on disk would read as "a server whose
    // address happens to be blank" rather than "no servers", and would silently
    // acquire a real value if anything ever filled the default in.
    assert!(
        !map.contains_key("server_config"),
        "a config with no hosted services must not emit server_config: {value}"
    );
    assert!(
        !map.contains_key("oz_config"),
        "a config with no hosted services must not emit oz_config: {value}"
    );

    let text = serde_json::to_string(&config).expect("serializes");
    let reparsed: ChannelConfig = serde_json::from_str(&text).expect("round trips");
    assert!(reparsed.hosted_services.is_none());
}

#[test]
fn app_id_round_trips_through_three_components() {
    // Doom Term's app ID deliberately has exactly three components, because
    // `AppId::parse` splits on `.` and requires exactly three. A four-component
    // identifier would parse into something other than what was written.
    let config: ChannelConfig = serde_json::from_str(LOCAL_ONLY_CONFIG).expect("deserializes");
    assert_eq!(config.app_id.qualifier(), "io");
    assert_eq!(config.app_id.organization(), "cmleadmon");
    assert_eq!(config.app_id.application_name(), "DoomTerm");
    assert_eq!(config.app_id.to_string(), "io.cmleadmon.DoomTerm");
}
