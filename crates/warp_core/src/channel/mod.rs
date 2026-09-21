mod config;
mod state;

use std::fmt;

pub use config::*;
pub use state::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    /// The official/first-party stable release.
    Stable,
    /// The official/first-party feature preview release.
    Preview,

    /// The internal-only nightly build.
    Dev,
    /// The internal-only HEAD build.
    Local,

    /// The open-source build of Warp.
    Oss,

    /// The integration test build.
    Integration,

    /// Doom Term: a local-only fork with no hosted services.
    ///
    /// This channel exists to carry product identity and policy. It is not a
    /// Warp release channel and never talks to Warp's servers: its
    /// [`ChannelConfig`] carries no hosted services configuration at all, and
    /// the hosted implementations themselves are excluded from its build by
    /// Cargo feature rather than disabled at runtime.
    DoomTerm,
}

impl Channel {
    /// Whether or not this channel is for internal use only
    pub fn is_dogfood(&self) -> bool {
        match self {
            Channel::Dev | Channel::Local => true,
            Channel::Stable
            | Channel::Preview
            | Channel::Integration
            | Channel::Oss
            | Channel::DoomTerm => false,
        }
    }

    /// Whether this channel honors the `--server-root-url` / `--ws-server-url` /
    /// `--session-sharing-server-url` flags (and their `WARP_*` env-var equivalents).
    ///
    /// Release channels (`Stable`, `Preview`, `Oss`) ignore these overrides so shipped
    /// builds can't be redirected away from their baked-in server URLs. Internal-only channels
    /// (`Dev`, `Local`, `Integration`) continue to honor them for local development and testing.
    pub fn allows_server_url_overrides(&self) -> bool {
        match self {
            Channel::Dev | Channel::Local | Channel::Integration => true,
            Channel::Stable | Channel::Preview | Channel::Oss => false,
            // Doom Term has no servers to be redirected to or away from. This
            // stays false so that a `--server-root-url` flag or a `WARP_*`
            // environment variable in a user's shell profile cannot introduce
            // one, independently of the compile boundary that removes the
            // client implementations.
            Channel::DoomTerm => false,
        }
    }

    /// Returns the CLI command name corresponding to this channel.
    pub fn cli_command_name(&self) -> &'static str {
        match self {
            Channel::Stable => "oz",
            Channel::Dev => "oz-dev",
            Channel::Preview => "oz-preview",
            Channel::Local => "oz-local",
            Channel::Integration => "oz-integration",
            Channel::Oss => "warp-oss",
            Channel::DoomTerm => "doomterm",
        }
    }

    /// Returns the Warp Control CLI command name corresponding to this channel.
    pub fn warpctrl_command_name(&self) -> &'static str {
        match self {
            Channel::Stable => "warpctrl",
            Channel::Dev => "warpctrl-dev",
            Channel::Preview => "warpctrl-preview",
            Channel::Local => "warpctrl-local",
            Channel::Integration => "warpctrl-integration",
            Channel::Oss => "warpctrl-oss",
            // Reserved so the match stays exhaustive. Doom Term does not ship a
            // control CLI in v1, so nothing invokes this name.
            Channel::DoomTerm => "doomtermctl",
        }
    }
}

impl fmt::Display for Channel {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(match self {
            Channel::Stable => "stable",
            Channel::Preview => "preview",
            Channel::Dev => "dev",
            Channel::Integration => "integration",
            Channel::Local => "local",
            Channel::Oss => "warp-oss",
            Channel::DoomTerm => "doomterm",
        })
    }
}
