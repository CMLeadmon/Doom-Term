//! Doom Term's application-side product boundary.
//!
//! Doom Term is built with `--no-default-features --features doomterm,gui`, which leaves
//! `warp_services` off. That feature owns every hosted implementation: the server and
//! authentication clients, hosted AI, Drive and team workspaces. Code that exists only to
//! reach those services is compiled out with `#[cfg(feature = "warp_services")]` at the
//! narrowest item, field, arm or statement that contains it.
//!
//! `#[cfg]` cannot select between two expressions on stable Rust, so [`hosted_or!`] covers
//! that one position.

/// Chooses between an expression that needs hosted services and Doom Term's local value.
///
/// In builds with `warp_services`, this expands to the first expression. In Doom Term it
/// expands to the second. The unselected expression is parsed but never name-resolved or
/// type-checked, so it may name modules that are compiled out.
///
/// ```ignore
/// let agent_input = hosted_or!(self.ai_input_model.as_ref(ctx).is_ai_input_enabled(), false);
/// ```
///
/// The local value must be the honest answer for a build without hosted services, such as
/// `false` for "is an agent conversation active". It must never stand in for a result the
/// hosted service would have produced.
#[cfg(feature = "warp_services")]
macro_rules! hosted_or {
    ($hosted:expr, $local:expr $(,)?) => {
        $hosted
    };
}

#[cfg(not(feature = "warp_services"))]
macro_rules! hosted_or {
    ($hosted:expr, $local:expr $(,)?) => {
        $local
    };
}

/// History autosuggestions and their validation. Both builds compile this module: the hosted
/// next-command model calls it too, so there is one copy of the code.
pub(crate) mod history_autosuggestions;

#[cfg(not(feature = "warp_services"))]
pub(crate) mod keystroke;

/// Inline status icons (check, cross, warning, cancelled) used by retained terminal blocks.
/// Upstream keeps the file under the agent block list; it has no hosted dependencies, so
/// Doom Term compiles the same file here instead of copying it.
#[cfg(not(feature = "warp_services"))]
#[path = "../ai/blocklist/inline_action/inline_action_icons.rs"]
pub(crate) mod inline_action_icons;

#[cfg(not(feature = "warp_services"))]
pub(crate) mod block_list_item;

/// Workflow argument parsing (`{{name}}` placeholders) for commands run from notebooks.
/// Upstream keeps it with the Drive workflow editor; it depends only on the workflow value
/// types, so Doom Term compiles the same file here.
#[cfg(not(feature = "warp_services"))]
#[path = "../drive/workflows/arguments.rs"]
pub(crate) mod workflow_arguments;

#[cfg(not(feature = "warp_services"))]
pub(crate) mod absent;

#[cfg(not(feature = "warp_services"))]
pub(crate) mod status_plate;
