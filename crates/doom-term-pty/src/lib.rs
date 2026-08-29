//! The Doom Term PTY layer: one implementation, two shells.
//!
//! The standalone WebSocket daemon (`backend/`) and the Tauri desktop app
//! (`src-tauri/`) both consume this crate. They differ only in transport, so
//! `PtySession::spawn` takes callbacks rather than knowing about either one.
//! Nothing here may be forked back into a consumer.

pub mod demuxer;
pub mod foreground;
pub mod session;
pub mod shell_integration;

pub use demuxer::{DemuxEvent, StreamDemuxer};
pub use foreground::{classify_agent, detect_isolation, foreground_command, AgentIdentity};
pub use session::{expand_path, PtySession, SessionInfo};
