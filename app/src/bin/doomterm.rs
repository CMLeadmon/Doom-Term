// On Windows, we don't want to display a console window when the application is running in release
// builds. See https://doc.rust-lang.org/reference/runtime.html#the-windows_subsystem-attribute.
#![cfg_attr(feature = "release_bundle", windows_subsystem = "windows")]

use anyhow::Result;
use warp_core::AppId;
use warp_core::channel::{Channel, ChannelConfig, ChannelState};

/// Entry point for Doom Term, the local-only fork.
///
/// The shape mirrors the other channel wrappers, with one difference that is
/// the whole point of the channel: there is no hosted services configuration to
/// pass. `hosted_services: None` is not a disabled server, a placeholder URL or
/// an unreachable endpoint. It is the absence of any server to address.
///
/// Note what this wrapper also does not do. It does not add
/// `features::DEBUG_FLAGS` in debug builds the way the upstream wrappers do:
/// the enabled feature set for this channel is the closed allowlist in
/// `features::DOOMTERM_FEATURES`, and a debug build must not quietly enable
/// capabilities that a release build of the same channel does not have. If the
/// two diverged, every local test would be testing a different product from the
/// one that ships.
fn main() -> Result<()> {
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

    warp::run()
}

// If we're not using an external plist, embed the following as the Info.plist.
#[cfg(all(not(feature = "extern_plist"), target_os = "macos"))]
embed_plist::embed_info_plist_bytes!(r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>English</string>
    <key>CFBundleDisplayName</key>
    <string>Doom Term</string>
    <key>CFBundleExecutable</key>
    <string>doomterm</string>
    <key>CFBundleIdentifier</key>
    <string>io.cmleadmon.DoomTerm</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>DoomTerm</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>UIDesignRequiresCompatibility</key>
    <true/>
    <key>CFBundleURLTypes</key>
    <array><dict><key>CFBundleURLName</key><string>Doom Term</string><key>CFBundleURLSchemes</key><array><string>doomterm</string></array></dict></array>
    <key>NSHumanReadableCopyright</key>
    <string>Doom Term is a fork of Warp, © Denver Technologies, Inc, distributed under the AGPL-3.0. Fork changes © the Doom Term contributors.</string>
    </dict>
    </plist>
"#.as_bytes());
