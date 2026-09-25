//! Native WarpUI Element rendering the Doom Term status plate footer.
//!
//! Renders the pure-Rust `doomterm_plate` geometry directly into WarpUI's scene
//! using integer pixel operations, maintaining 1:1 mathematical parity with the
//! reference renderer while docking at the bottom of the workspace.

use pathfinder_color::ColorU;
use pathfinder_geometry::rect::RectF;
use pathfinder_geometry::vector::{vec2f, Vector2F};
use warp_core::ui::theme::Fill;
use warpui::elements::Point;
use warpui::event::DispatchedEvent;
use warpui::{
    AfterLayoutContext, AppContext, Element, EventContext, LayoutContext, PaintContext,
    SizeConstraint,
};

use doomterm_plate::{paint, PlateSpec, PlateState};

pub const PLATE_LOGICAL_HEIGHT: f32 = 32.0;

/// WarpUI Element hosting the Doom Term status plate.
pub struct DoomTermPlateElement {
    state: PlateState,
    size: Option<Vector2F>,
    origin: Option<Point>,
}

impl DoomTermPlateElement {
    pub fn new(state: PlateState) -> Self {
        Self {
            state,
            size: None,
            origin: None,
        }
    }
}

impl Element for DoomTermPlateElement {
    fn layout(
        &mut self,
        constraint: SizeConstraint,
        _ctx: &mut LayoutContext,
        _app: &AppContext,
    ) -> Vector2F {
        let width = constraint.max.x();
        let height = PLATE_LOGICAL_HEIGHT;
        let size = vec2f(width, height);
        self.size = Some(size);
        size
    }

    fn after_layout(&mut self, _ctx: &mut AfterLayoutContext, _app: &AppContext) {}

    fn paint(&mut self, origin: Vector2F, ctx: &mut PaintContext, _app: &AppContext) {
        self.origin = Some(Point::from_vec2f(origin, ctx.scene.z_index()));
        let size = self.size.unwrap_or_else(|| vec2f(480.0, PLATE_LOGICAL_HEIGHT));

        // 1. Draw plate backdrop and register hit bounds
        ctx.scene
            .draw_rect_with_hit_recording(RectF::new(origin, size))
            .with_background(Fill::Solid(ColorU::new(20, 18, 15, 255)));

        // 2. Generate pixel operations from doomterm_plate engine
        let logical_width = (size.x() as u32).max(480);
        let spec = PlateSpec::for_width(logical_width);
        let ops = paint(&spec, &self.state);

        // 3. Batch render pixel operations into scene quad buffer
        for op in &ops {
            let r_origin = origin + vec2f(op.x as f32, op.y as f32);
            let r_size = vec2f(op.width as f32, op.height as f32);
            ctx.scene
                .draw_rect_without_hit_recording(RectF::new(r_origin, r_size))
                .with_background(Fill::Solid(ColorU::new(op.r, op.g, op.b, op.a)));
        }

        // 4. Hairline top divider separating status plate from terminal scrollback
        let divider_size = vec2f(size.x(), 1.0);
        ctx.scene
            .draw_rect_without_hit_recording(RectF::new(origin, divider_size))
            .with_background(Fill::Solid(ColorU::new(0x23, 0x28, 0x28, 255)));
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
        self.size
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
