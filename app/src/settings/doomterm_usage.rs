use settings::macros::define_settings_group;
use settings::{SupportedPlatforms, SyncToCloud};

define_settings_group!(DoomTermUsageSettings, settings: [
    claude_usage_lookup_enabled: ClaudeUsageLookupEnabled {
        type: bool,
        default: false,
        supported_platforms: SupportedPlatforms::ALL,
        sync_to_cloud: SyncToCloud::Never,
        surface: settings::SettingSurfaces::GUI,
        private: false,
        toml_path: "doomterm.status_plate.claude_usage_lookup",
        description: "Whether the status plate asks api.anthropic.com, with your existing Claude \
            Code login, how much of Claude's rate limit you have used. Off by default. In SSH \
            sessions, the remote helper makes this request using the remote Claude Code login.",
    },
]);
