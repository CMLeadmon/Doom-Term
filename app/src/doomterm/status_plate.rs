//! Native WarpUI Element rendering the Doom Term status plate footer.
//!
//! Renders the pure-Rust `doomterm_plate` geometry directly into WarpUI's scene
//! using integer pixel operations, maintaining 1:1 mathematical parity with the
//! reference renderer while docking at the bottom of the workspace.

use doomterm_agents::trace;
use doomterm_plate::colors::BEVEL_LO_SIDE;
use doomterm_plate::{HEIGHT, PlateLayout, PlateState, paint, plate_layout};
use pathfinder_color::ColorU;
use serde_json::json;
use pathfinder_geometry::rect::RectF;
use pathfinder_geometry::vector::{Vector2F, vec2f};
use warp_core::ui::theme::Fill;
use warpui::elements::Point;
use warpui::event::{DispatchedEvent, Event};
use warpui::{
    AfterLayoutContext, AppContext, Element, EventContext, LayoutContext, PaintContext,
    SizeConstraint,
};

use crate::workspace::{PaneViewLocator, WorkspaceAction};

/// WarpUI Element hosting the Doom Term status plate.
pub struct DoomTermPlateElement {
    state: PlateState,
    /// The pane each queue row focuses, in row order.
    waiting_panes: Vec<PaneViewLocator>,
    layout: Option<PlateLayout>,
    size: Option<Vector2F>,
    origin: Option<Point>,
}

impl DoomTermPlateElement {
    pub fn new(state: PlateState, waiting_panes: Vec<PaneViewLocator>) -> Self {
        Self {
            state,
            waiting_panes,
            layout: None,
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
        let layout = plate_layout(width);
        let size = vec2f(width, (HEIGHT * layout.scale) as f32);
        self.layout = Some(layout);
        self.size = Some(size);
        size
    }

    fn after_layout(&mut self, _ctx: &mut AfterLayoutContext, _app: &AppContext) {}

    fn paint(&mut self, origin: Vector2F, ctx: &mut PaintContext, _app: &AppContext) {
        self.origin = Some(Point::from_vec2f(origin, ctx.scene.z_index()));
        let (Some(size), Some(layout)) = (self.size, self.layout) else {
            return;
        };
        let scale = layout.scale as f32;
        trace::emit("paint", || json!({ "working": self.state.working }));

        ctx.scene
            .draw_rect_with_hit_recording(RectF::new(origin, size))
            .with_background(Fill::Solid(ColorU::new(20, 18, 15, 255)));

        for op in &paint(&layout.spec, &self.state) {
            let r_origin = origin + vec2f(op.x as f32 * scale, op.y as f32 * scale);
            let r_size = vec2f(op.width as f32 * scale, op.height as f32 * scale);
            ctx.scene
                .draw_rect_without_hit_recording(RectF::new(r_origin, r_size))
                .with_background(Fill::Solid(ColorU::new(op.r, op.g, op.b, op.a)));
        }

        // A width that is not a multiple of the scale leaves a sliver past the last logical
        // pixel; drawing it as border keeps the border on the window's edge.
        if layout.edge_px > 0.0 {
            let (r, g, b) = BEVEL_LO_SIDE;
            ctx.scene
                .draw_rect_without_hit_recording(RectF::new(
                    origin + vec2f(layout.spec.width as f32 * scale, 0.0),
                    vec2f(layout.edge_px, size.y()),
                ))
                .with_background(Fill::Solid(ColorU::new(r, g, b, 255)));
        }

        let divider_size = vec2f(size.x(), scale.min(2.0));
        ctx.scene
            .draw_rect_without_hit_recording(RectF::new(origin, divider_size))
            .with_background(Fill::Solid(ColorU::new(0x23, 0x28, 0x28, 255)));
    }

    fn dispatch_event(
        &mut self,
        event: &DispatchedEvent,
        ctx: &mut EventContext,
        _app: &AppContext,
    ) -> bool {
        let (Some(origin), Some(size), Some(layout)) = (self.origin, self.size, self.layout) else {
            return false;
        };
        let Some(Event::LeftMouseDown { position, .. }) = event.at_z_index(origin.z_index(), ctx)
        else {
            return false;
        };
        let local = *position - origin.xy();
        if local.x() < 0.0 || local.y() < 0.0 || local.x() >= size.x() || local.y() >= size.y() {
            return false;
        }
        let scale = layout.scale as f32;
        let x = (local.x() / scale).floor() as u32;
        let y = (local.y() / scale).floor() as u32;
        let Some(locator) = layout.spec.waiting_target_at(x, y, &self.waiting_panes) else {
            return false;
        };
        ctx.dispatch_typed_action(WorkspaceAction::FocusPane(locator));
        true
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
