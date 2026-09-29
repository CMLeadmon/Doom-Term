//! Doom Term's pixel agent marks, shared by the status plate and both tab bars.

use doomterm_plate::{Rasterizer, colors, draw_agent_mark, get_agent_color, shock_ring};
use pathfinder_color::ColorU;
use pathfinder_geometry::rect::RectF;
use pathfinder_geometry::vector::{Vector2F, vec2f};
use warp_core::ui::theme::Fill;
use warpui::elements::Point;
use warpui::event::DispatchedEvent;
use warpui::{
    AfterLayoutContext, AppContext, Element, EventContext, LayoutContext, PaintContext,
    SizeConstraint,
};

use crate::terminal::CLIAgent;

/// Key selecting an agent's mark in `doomterm_plate`.
pub fn mark_key(agent: CLIAgent) -> &'static str {
    match agent {
        CLIAgent::Claude => "claude",
        CLIAgent::Gemini => "gemini",
        CLIAgent::Codex => "codex",
        CLIAgent::Antigravity => "antigravity",
        CLIAgent::OpenCode => "opencode",
        CLIAgent::Copilot => "copilot",
        CLIAgent::Grok => "grok",
        CLIAgent::Amp
        | CLIAgent::Droid
        | CLIAgent::Pi
        | CLIAgent::OhMyPi
        | CLIAgent::Auggie
        | CLIAgent::CursorCli
        | CLIAgent::Goose
        | CLIAgent::Hermes
        | CLIAgent::Vibe
        | CLIAgent::WarpTui
        | CLIAgent::Unknown => "unknown",
    }
}

/// Four-character tag used in the plate's waiting well.
pub fn short_tag(agent: CLIAgent) -> &'static str {
    match agent {
        CLIAgent::Claude => "CLAU",
        CLIAgent::Gemini => "GEM",
        CLIAgent::Codex => "CODX",
        CLIAgent::Antigravity => "AGY",
        CLIAgent::OpenCode => "OPEN",
        CLIAgent::Copilot => "COPI",
        CLIAgent::Grok => "GROK",
        CLIAgent::Amp => "AMP",
        CLIAgent::Droid => "DROI",
        CLIAgent::Pi | CLIAgent::OhMyPi => "PI",
        CLIAgent::Auggie => "AUGG",
        CLIAgent::CursorCli => "CURS",
        CLIAgent::Goose => "GOOS",
        CLIAgent::Hermes => "HERM",
        CLIAgent::Vibe => "VIBE",
        CLIAgent::WarpTui => "WARP",
        CLIAgent::Unknown => "AGNT",
    }
}

/// Length of one pulse of a working agent's mark.
const PULSE: std::time::Duration = std::time::Duration::from_millis(1_400);

/// Position in the working pulse, from one monotonic clock shared by every surface so the plate
/// and the tab bars pulse in step.
pub fn pulse_phase() -> f32 {
    static START: std::sync::OnceLock<instant::Instant> = std::sync::OnceLock::new();
    let pulse = PULSE.as_millis();
    let elapsed = START
        .get_or_init(instant::Instant::now)
        .elapsed()
        .as_millis();
    (elapsed % pulse) as f32 / pulse as f32
}

/// Side of the square the marks are drawn in, in mark pixels.
const MARK_BOX: u32 = 24;

/// A mark in a small recessed well, scaled to `size` logical pixels.
pub struct AgentMarkElement {
    key: &'static str,
    working: bool,
    phase: f32,
    size: f32,
    laid_out: Option<Vector2F>,
    origin: Option<Point>,
}

impl AgentMarkElement {
    pub fn new(key: &'static str, working: bool, phase: f32, size: f32) -> Self {
        Self {
            key,
            working,
            phase,
            size,
            laid_out: None,
            origin: None,
        }
    }
}

impl Element for AgentMarkElement {
    fn layout(
        &mut self,
        constraint: SizeConstraint,
        _ctx: &mut LayoutContext,
        _app: &AppContext,
    ) -> Vector2F {
        let side = self
            .size
            .min(constraint.max.x())
            .min(constraint.max.y())
            .max(0.);
        let size = vec2f(side, side);
        self.laid_out = Some(size);
        size
    }

    fn after_layout(&mut self, _ctx: &mut AfterLayoutContext, _app: &AppContext) {}

    fn paint(&mut self, origin: Vector2F, ctx: &mut PaintContext, _app: &AppContext) {
        self.origin = Some(Point::from_vec2f(origin, ctx.scene.z_index()));
        let Some(size) = self.laid_out else {
            return;
        };
        let mut r = Rasterizer::new();
        r.well(0, 0, MARK_BOX, MARK_BOX, colors::MARK_FLOOR);
        let center = MARK_BOX / 2;
        if self.working {
            shock_ring(
                &mut r,
                center,
                center,
                self.phase,
                get_agent_color(self.key),
                [1, MARK_BOX - 2, 1, MARK_BOX - 2],
            );
        }
        draw_agent_mark(&mut r, self.key, center, center, self.phase, self.working);

        let scale = size.x() / MARK_BOX as f32;
        for op in r.ops.iter().filter(|op| op.x < MARK_BOX && op.y < MARK_BOX) {
            let width = op.width.min(MARK_BOX - op.x);
            let height = op.height.min(MARK_BOX - op.y);
            ctx.scene
                .draw_rect_without_hit_recording(RectF::new(
                    origin + vec2f(op.x as f32, op.y as f32) * scale,
                    vec2f(width as f32, height as f32) * scale,
                ))
                .with_background(Fill::Solid(ColorU::new(op.r, op.g, op.b, op.a)));
        }
    }

    fn dispatch_event(
        &mut self,
        _event: &DispatchedEvent,
        _ctx: &mut EventContext,
        _app: &AppContext,
    ) -> bool {
        false
    }

    fn size(&self) -> Option<Vector2F> {
        self.laid_out
    }

    fn origin(&self) -> Option<Point> {
        self.origin
    }

    fn finish(self) -> Box<dyn Element>
    where
        Self: 'static + Sized,
    {
        Box::new(self)
    }
}
