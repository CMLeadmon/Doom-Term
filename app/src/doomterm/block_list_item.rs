//! The serialized form of a terminal block list entry, used by session restoration.
//!
//! Upstream defines this wrapper in the agent block list's persistence module, which is
//! compiled out of Doom Term. Only command blocks are persisted, so the type is a plain
//! wrapper around [`SerializedBlock`] and Doom Term defines it here with the same shape.

use chrono::{DateTime, Local};

use crate::terminal::model::block::SerializedBlock;

/// The types of "blocks" stored in SQLite for session restoration.
#[derive(Debug, Clone, PartialEq)]
pub enum SerializedBlockListItem {
    Command { block: Box<SerializedBlock> },
}

impl SerializedBlockListItem {
    pub(crate) fn start_ts(&self) -> Option<DateTime<Local>> {
        match self {
            Self::Command { block } => block.start_ts,
        }
    }
}

impl From<crate::persistence::model::Block> for SerializedBlockListItem {
    fn from(value: crate::persistence::model::Block) -> Self {
        Self::Command {
            block: Box::new(SerializedBlock::from(value)),
        }
    }
}

impl From<SerializedBlock> for SerializedBlockListItem {
    fn from(value: SerializedBlock) -> Self {
        Self::Command {
            block: Box::new(value),
        }
    }
}
