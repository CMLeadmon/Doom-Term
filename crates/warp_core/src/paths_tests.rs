use dirs::home_dir;

use super::*;

#[test]
fn test_data_dir_path() {
    let home_dir = home_dir().expect("Should be able to compute home directory");
    // ChannelState, by default, is configured for Channel::Oss.
    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(data_dir(), home_dir.join(".warp-oss"));
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(data_dir(), home_dir.join(".local/share/warp-oss"));
        } else if #[cfg(windows)] {
            assert_eq!(data_dir(), home_dir.join("AppData\\Roaming\\warp\\WarpOss\\data"));
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

#[test]
fn test_config_local_dir_path() {
    let home_dir = home_dir().expect("Should be able to compute home directory");
    // ChannelState, by default, is configured for Channel::Oss.
    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(config_local_dir(), home_dir.join(".warp-oss"));
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(config_local_dir(), home_dir.join(".config/warp-oss"));
        } else if #[cfg(windows)] {
            assert_eq!(config_local_dir(), home_dir.join("AppData\\Local\\warp\\WarpOss\\config"));
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

#[cfg(target_os = "macos")]
#[test]
fn test_macos_config_dir_name_scopes_to_data_profile() {
    assert_eq!(macos_config_dir_name_for(Channel::Stable, None), ".warp");
    assert_eq!(
        macos_config_dir_name_for(Channel::Local, None),
        ".warp-local"
    );

    // Each development profile must get its own directory so shared config
    // (notably settings.toml) cannot leak between profiles.
    assert_eq!(
        macos_config_dir_name_for(Channel::Local, Some("myprofile")),
        ".warp-local-myprofile"
    );
    assert_eq!(
        macos_config_dir_name_for(Channel::Stable, Some("myprofile")),
        ".warp-myprofile"
    );
}

#[test]
fn test_gui_app_id_maps_oss_tui_to_oss_gui() {
    let gui_app_id = gui_app_id_for_channel(Channel::Oss, AppId::new("dev", "warp", "WarpTui"));

    assert_eq!(gui_app_id.to_string(), "dev.warp.WarpOss");
}

#[test]
fn test_gui_config_and_mcp_paths_resolve_explicit_sources() {
    let home_dir = home_dir().expect("Should be able to compute home directory");
    let gui_config_dir = gui_config_local_dir().expect("GUI config path should resolve");

    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(gui_config_dir, home_dir.join(".warp-oss"));
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(gui_config_dir, home_dir.join(".config/warp-oss"));
        } else if #[cfg(windows)] {
            assert_eq!(
                gui_config_dir,
                home_dir.join("AppData\\Local\\warp\\WarpOss\\config")
            );
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }

    assert_eq!(gui_mcp_config_file_path(), warp_home_mcp_config_file_path());
}
#[test]
fn test_warp_home_config_dir_path() {
    let home_dir = home_dir().expect("Should be able to compute home directory");
    let expected_dir_name = match ChannelState::data_profile() {
        Some(data_profile) => format!(".warp-oss-{data_profile}"),
        None => ".warp-oss".to_string(),
    };

    assert_eq!(
        warp_home_config_dir(),
        Some(home_dir.join(expected_dir_name))
    );
}

#[test]
fn test_warp_home_skills_and_mcp_paths() {
    let Some(config_dir) = warp_home_config_dir() else {
        panic!("Should be able to compute Warp home config directory");
    };

    assert_eq!(warp_home_skills_dir(), Some(config_dir.join("skills")));
    assert_eq!(
        warp_home_mcp_config_file_path(),
        Some(config_dir.join(".mcp.json"))
    );
}

#[test]
fn test_tui_mcp_config_path_is_separate_from_gui() {
    let tui_mcp_path = tui_mcp_config_file_path();

    assert_eq!(tui_mcp_path, tui_config_local_dir().join(".mcp.json"));
    assert_ne!(
        Some(tui_mcp_path),
        warp_home_mcp_config_file_path(),
        "GUI and TUI MCP configuration must remain isolated"
    );
}
#[test]
fn test_cache_dir_path() {
    let home_dir = home_dir().expect("Should be able to compute home directory");
    // ChannelState, by default, is configured for Channel::Oss.
    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(cache_dir(), home_dir.join("Library/Application Support/dev.warp.WarpOss"));
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(cache_dir(), home_dir.join(".cache/warp-oss"));
        } else if #[cfg(windows)] {
            assert_eq!(cache_dir(), home_dir.join("AppData\\Local\\warp\\WarpOss\\cache"));
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

#[test]
fn test_state_dir_path() {
    let home_dir = home_dir().expect("Should be able to compute home directory");
    cfg_if::cfg_if! {
        // ChannelState, by default, is configured for Channel::Oss.
        if #[cfg(target_os = "macos")] {
            assert_eq!(state_dir(), home_dir.join("Library/Application Support/dev.warp.WarpOss"));
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(state_dir(), home_dir.join(".local/state/warp-oss"));
        } else if #[cfg(windows)] {
            assert_eq!(state_dir(), home_dir.join("AppData\\Local\\warp\\WarpOss\\data"));
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

#[test]
fn test_tui_state_dir_is_tui_subdir_of_gui_state_base() {
    let tui_dir = tui_state_dir();
    assert_eq!(tui_dir.file_name(), Some(std::ffi::OsStr::new("tui")));

    // The TUI state dir must be a direct `tui` child of the same base
    // directory that holds the GUI's SQLite database (the secure state dir
    // when available, otherwise the plain state dir), so the two front-ends
    // keep sibling — never shared — databases.
    let gui_state_base = secure_state_dir().unwrap_or_else(state_dir);
    assert_eq!(tui_dir.parent(), Some(gui_state_base.as_path()));
}

#[test]
fn test_project_path_for_warp_app_id() {
    let project_dirs = project_dirs_for_app_id(AppId::new("dev", "warp", "Warp"), None)
        .expect("should be able to compute project dirs");
    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(project_dirs.project_path(), "dev.warp.Warp");
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(project_dirs.project_path(), "warp-terminal");
        } else if #[cfg(windows)] {
            assert_eq!(project_dirs.project_path(), "warp\\Warp");
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

#[test]
fn test_project_path_for_warp_dev_app_id() {
    let project_dirs = project_dirs_for_app_id(AppId::new("dev", "warp", "WarpDev"), None)
        .expect("should be able to compute project dirs");
    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(project_dirs.project_path(), "dev.warp.WarpDev");
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(project_dirs.project_path(), "warp-terminal-dev");
        } else if #[cfg(windows)] {
            assert_eq!(project_dirs.project_path(), "warp\\WarpDev");
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

#[test]
fn test_project_path_for_oss_app_id() {
    let project_dirs = project_dirs_for_app_id(AppId::new("dev", "warp", "WarpOss"), None)
        .expect("should be able to compute project dirs");
    cfg_if::cfg_if! {
        if #[cfg(target_os = "macos")] {
            assert_eq!(project_dirs.project_path(), "dev.warp.WarpOss");
        } else if #[cfg(any(target_os = "linux", target_os = "freebsd"))] {
            assert_eq!(project_dirs.project_path(), "warp-oss");
        } else if #[cfg(windows)] {
            assert_eq!(project_dirs.project_path(), "warp\\WarpOss");
        } else {
            unimplemented!("Need to update tests for current platform!");
        }
    }
}

// --- Doom Term path isolation ------------------------------------------------
//
// Doom Term is expected to be installed alongside Warp. These assert that the
// two products cannot end up reading or writing each other's data, which is
// what a shared configuration directory would mean in practice: one product
// rewriting the other's settings, themes and workflows on launch.
//
// Asserted through the pure `*_for` seams so no test mutates the process-global
// channel state. `channel::state_tests` covers the global in a subprocess.

const EVERY_WARP_CHANNEL: &[Channel] = &[
    Channel::Stable,
    Channel::Preview,
    Channel::Dev,
    Channel::Local,
    Channel::Integration,
    Channel::Oss,
];

#[test]
fn doomterm_home_config_dir_is_not_a_warp_directory() {
    let name = base_warp_config_dir_name_for(Channel::DoomTerm);
    assert_eq!(name, ".doomterm");
    assert!(
        !name.starts_with(".warp"),
        "Doom Term must not live under a `.warp*` directory: {name}"
    );
}

#[test]
fn doomterm_home_config_dir_collides_with_no_warp_channel() {
    let doomterm = base_warp_config_dir_name_for(Channel::DoomTerm);
    for channel in EVERY_WARP_CHANNEL {
        assert_ne!(
            base_warp_config_dir_name_for(*channel),
            doomterm,
            "{channel} shares a home config directory with Doom Term"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn doomterm_macos_config_dir_collides_with_no_warp_channel() {
    let doomterm = macos_config_dir_name_for(Channel::DoomTerm, None);
    assert_eq!(doomterm, ".doomterm");
    for channel in EVERY_WARP_CHANNEL {
        assert_ne!(
            macos_config_dir_name_for(*channel, None),
            doomterm,
            "{channel} shares a macOS config directory with Doom Term"
        );
    }
}

#[test]
fn doomterm_gui_app_id_is_preserved_rather_than_remapped() {
    // Doom Term ships no separate TUI binary, so unlike the OSS channel there
    // is no second application ID to map onto. The configured ID is the only
    // one, and remapping it would point the GUI at another product's data.
    let app_id = AppId::new("io", "cmleadmon", "DoomTerm");
    let mapped = gui_app_id_for_channel(Channel::DoomTerm, app_id.clone());
    assert_eq!(mapped.to_string(), app_id.to_string());
    assert_eq!(mapped.to_string(), "io.cmleadmon.DoomTerm");
}
