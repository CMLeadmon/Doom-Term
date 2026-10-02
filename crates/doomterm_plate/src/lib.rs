//! Doom Term status plate: pure geometry, state, glyph rendering and rasterization ops.

pub mod frame;
pub mod glyph;
pub mod paint;
pub mod spec;
pub mod state;
pub mod stone;

pub use frame::*;
pub use glyph::*;
pub use paint::*;
pub use spec::*;
pub use state::*;
pub use stone::*;
