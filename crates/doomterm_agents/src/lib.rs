//! How Doom Term observes the agents running in its terminal panes.
//!
//! Everything here is independent of the UI: it reads the operating system's process table and
//! the records agents write about themselves, and reports only what those sources state.

pub mod agent_sessions;
pub mod claude_usage;
pub mod foreground;
pub mod git_diff;
pub mod output_activity;
pub mod remote_status;
pub mod trace;
