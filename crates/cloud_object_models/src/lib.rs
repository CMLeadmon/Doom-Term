//! This crate defines the concrete Warp cloud object models and typed cloud object aliases built
//! on top of `cloud_objects`.
//!
//! Each model module should own the model payload for one cloud object family, plus any model-specific
//! adapters that should move with that model during future verticalization.
//!
//! Native SQLite adapters may live under model-local `persistence` modules, while shared persistence
//! infrastructure should stay in `cloud_object_persistence`.

// Multiple modules contain `persistence` submodules; it is expected that
// code from the persistence modules is imported with fully-qualified paths.
#![allow(ambiguous_glob_reexports)]

#[cfg(feature = "hosted")]
pub mod ai_execution_profile;
#[cfg(feature = "hosted")]
pub mod ai_fact;
#[cfg(feature = "hosted")]
pub mod cloud_agent_config;
#[cfg(feature = "hosted")]
pub mod cloud_environment;
#[cfg(feature = "hosted")]
pub mod env_vars;
#[cfg(feature = "hosted")]
pub mod folder;
#[cfg(feature = "hosted")]
pub mod json_model;
#[cfg(feature = "hosted")]
pub mod mcp;
#[cfg(feature = "hosted")]
pub mod notebook;
#[cfg(feature = "hosted")]
pub mod preference;
#[cfg(feature = "hosted")]
pub mod scheduled_ambient_agent;
#[cfg(feature = "hosted")]
pub mod server_cloud_object;
#[cfg(feature = "hosted")]
pub mod user_profile;
pub mod workflow;
#[cfg(feature = "hosted")]
pub mod workflow_enum;

#[cfg(feature = "hosted")]
pub use ai_execution_profile::*;
#[cfg(feature = "hosted")]
pub use ai_fact::*;
#[cfg(feature = "hosted")]
pub use cloud_agent_config::*;
#[cfg(feature = "hosted")]
pub use cloud_environment::*;
#[cfg(feature = "hosted")]
pub use env_vars::*;
#[cfg(feature = "hosted")]
pub use folder::*;
#[cfg(feature = "hosted")]
pub use json_model::*;
#[cfg(feature = "hosted")]
pub use mcp::*;
#[cfg(feature = "hosted")]
pub use notebook::*;
#[cfg(feature = "hosted")]
pub use preference::*;
#[cfg(feature = "hosted")]
pub use scheduled_ambient_agent::*;
#[cfg(feature = "hosted")]
pub use server_cloud_object::*;
#[cfg(feature = "hosted")]
pub use user_profile::*;
pub use workflow::*;
#[cfg(feature = "hosted")]
pub use workflow_enum::*;
