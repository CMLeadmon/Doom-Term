//! Hosted value types that retained code accepts only as optional inputs.
//!
//! Some local functions take an `Option<T>` where `T` exists only with hosted services,
//! for example an agent conversation to restore into a new tab. Doom Term aliases each
//! such `T` to [`Infallible`]. The only value a caller can pass is then `None`, and the
//! compiler proves that the hosted branch cannot run. Any code that would construct one
//! of these values fails to compile and is compiled out instead.

use std::convert::Infallible;

/// An agent conversation to restore into a new pane.
pub type ConversationRestorationInNewPaneType = Infallible;

/// A Warp Drive object reference.
pub type CloudObjectTypeAndId = Infallible;

/// A hosted ambient-agent task.
pub type AmbientAgentTaskId = Infallible;

/// An AI input mode (shell or agent, locked or not) to restore into a new terminal.
pub type InputConfig = Infallible;

/// The shell, directory and platform context that a hosted AI request carries.
pub type WarpAiExecutionContext = Infallible;

/// The progress state of an agent conversation or CLI agent session.
pub type ConversationStatus = Infallible;

/// A Warp Drive notebook.
pub type NotebookId = Infallible;

/// An agent-proposed change to a file (create, update or delete).
pub type DiffType = Infallible;

/// An agent conversation.
pub type AIConversationId = Infallible;

/// How a code diff view is laid out: in its own pane, embedded in an agent block, or as an
/// inline banner. Every mode belongs to an agent diff surface.
pub type DisplayMode = Infallible;

/// An agent action that opened a code pane. Code panes record where they came from and are
/// saved with the session, so this stand-in keeps the serde derives of those types; it has no
/// values, so nothing can construct or restore one.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AIAgentActionId {}
