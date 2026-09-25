#![cfg_attr(target_family = "wasm", allow(dead_code, unused_imports))]

pub(crate) mod comment_editor;
mod comments;
pub(super) mod diff;
mod element;
#[cfg(feature = "warp_services")]
pub mod embedded_comment;
pub mod find;
pub mod goto_line;
pub mod line;
mod line_iterator;
pub mod model;
mod nav_bar;
pub mod scroll;
pub mod view;

#[cfg(feature = "warp_services")]
pub use comment_editor::{CommentEditor, CommentEditorEvent};
#[cfg(feature = "warp_services")]
pub use comments::EditorReviewComment;
#[cfg(feature = "warp_services")]
pub use comments::EditorCommentsModel;
pub(crate) use diff::{add_color, remove_color};
#[cfg(feature = "warp_services")]
pub(crate) use diff::compute_unified_diff;
#[cfg(feature = "warp_services")]
pub use element::GutterHoverTarget;
#[cfg(feature = "warp_services")]
pub use nav_bar::NavBarBehavior;
