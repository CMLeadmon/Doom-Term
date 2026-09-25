#[cfg(feature = "warp_services")]
use pathfinder_color::ColorU;
#[cfg(feature = "warp_services")]
use warp_core::ui::theme::color::internal_colors;
#[cfg(feature = "warp_services")]
use warpui::Element;
#[cfg(feature = "warp_services")]
use warpui::elements::MainAxisSize;
#[cfg(feature = "warp_services")]
use warpui::elements::{Border, ConstrainedBox, Container, CornerRadius, CrossAxisAlignment, Flex, Icon, ParentElement, Radius, Shrinkable};
#[cfg(feature = "warp_services")]
use warpui::ui_components::components::{UiComponent, UiComponentStyles};

#[cfg(feature = "warp_services")]
use crate::appearance::Appearance;
#[cfg(feature = "warp_services")]
use crate::themes::theme::Fill;

#[cfg(feature = "warp_services")]
const ALERT_CORNER_RADIUS: f32 = 4.;
#[cfg(feature = "warp_services")]
const ALERT_VERTICAL_PADDING: f32 = 8.;
#[cfg(feature = "warp_services")]
const ALERT_HORIZONTAL_PADDING: f32 = 12.;
#[cfg(feature = "warp_services")]
const ALERT_ICON_RIGHT_MARGIN: f32 = 8.;
#[cfg(feature = "warp_services")]
const ALERT_ICON_SIZE: f32 = 16.;

#[cfg(feature = "warp_services")]
const DEFAULT_MAIN_AXIS_SIZE: MainAxisSize = MainAxisSize::Min;

#[cfg(feature = "warp_services")]
const SUCCESS_ICON_PATH: &str = "bundled/svg/check-skinny.svg";
#[cfg(feature = "warp_services")]
const ERROR_ICON_PATH: &str = "bundled/svg/alert-circle.svg";

/// Represents the type of alert. Controls color and icon in order to communicate success, error, etc.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum AlertFlavor {
    #[default]
    Default,
    Success,
    #[cfg(feature = "warp_services")]
    Error,
    #[cfg(feature = "warp_services")]
    Warning,
}

impl AlertFlavor {
    #[cfg(feature = "warp_services")]
    pub fn icon_path(&self) -> Option<&'static str> {
        match self {
            Self::Default => None,
            Self::Success => Some(SUCCESS_ICON_PATH),
            Self::Error | Self::Warning => Some(ERROR_ICON_PATH),
        }
    }

    #[cfg(feature = "warp_services")]
    pub fn text_color(&self, appearance: &Appearance) -> ColorU {
        let theme = appearance.theme();
        match self {
            AlertFlavor::Default => theme.main_text_color(theme.background()).into(),
            AlertFlavor::Warning => theme.ansi_fg_yellow(),
            _ => theme.background().into(),
        }
    }

    #[cfg(feature = "warp_services")]
    pub fn bg_color(&self, appearance: &Appearance) -> Fill {
        let theme = appearance.theme();
        match self {
            Self::Default => internal_colors::neutral_4(theme).into(),
            Self::Success => theme.ansi_fg_green().into(),
            Self::Error => theme.ansi_fg_red().into(),
            Self::Warning => theme.yellow_overlay_1(),
        }
    }

    #[cfg(feature = "warp_services")]
    pub fn border_color(&self, appearance: &Appearance) -> Fill {
        let theme = appearance.theme();
        match self {
            AlertFlavor::Default => internal_colors::neutral_3(theme).into(),
            AlertFlavor::Success => theme.ansi_bg_green().into(),
            AlertFlavor::Error => theme.ansi_bg_red().into(),
            AlertFlavor::Warning => Fill::Solid(ColorU::transparent_black()),
        }
    }
}

/// Configuration passed from parent to control the alert's appearance and behavior
#[derive(Default)]
pub struct AlertConfig {
    #[cfg(feature = "warp_services")]
    pub flavor: AlertFlavor,
    #[cfg(feature = "warp_services")]
    pub message: String,
    #[cfg(feature = "warp_services")]
    pub main_axis_size: Option<MainAxisSize>,
}

/// The main Alert component
#[derive(Clone, Default)]
#[cfg(feature = "warp_services")]
pub struct Alert;

#[cfg(feature = "warp_services")]
impl Alert {
    #[cfg(feature = "warp_services")]
    pub fn new() -> Self {
        Self
    }

    /// Creates a basic alert without a link.
    /// Ergonomic constructor to avoid writing `Alert::<()>::new()`.
    #[cfg(feature = "warp_services")]
    pub fn basic() -> Self {
        Self::new()
    }

    #[cfg(feature = "warp_services")]
    pub fn render(&self, config: AlertConfig, appearance: &Appearance) -> Box<dyn Element> {
        let content = self.render_simple(&config, appearance);

        Container::new(content)
            .with_vertical_padding(ALERT_VERTICAL_PADDING)
            .with_horizontal_padding(ALERT_HORIZONTAL_PADDING)
            .with_background(config.flavor.bg_color(appearance))
            .with_corner_radius(CornerRadius::with_all(Radius::Pixels(ALERT_CORNER_RADIUS)))
            .with_border(Border::all(1.).with_border_fill(config.flavor.border_color(appearance)))
            .finish()
    }

    #[cfg(feature = "warp_services")]
    fn render_simple(&self, config: &AlertConfig, appearance: &Appearance) -> Box<dyn Element> {
        let ui_builder = appearance.ui_builder();
        let mut content_row = Flex::row()
            .with_cross_axis_alignment(CrossAxisAlignment::Start)
            .with_main_axis_size(config.main_axis_size.unwrap_or(DEFAULT_MAIN_AXIS_SIZE));

        if let Some(icon_path) = config.flavor.icon_path() {
            content_row.add_child(
                Container::new(
                    ConstrainedBox::new(
                        Icon::new(icon_path, config.flavor.text_color(appearance)).finish(),
                    )
                    .with_max_height(ALERT_ICON_SIZE)
                    .with_max_width(ALERT_ICON_SIZE)
                    .finish(),
                )
                .with_margin_right(ALERT_ICON_RIGHT_MARGIN)
                .finish(),
            );
        }

        content_row.add_child(
            Shrinkable::new(
                1.,
                ui_builder
                    .wrappable_text(config.message.clone(), true)
                    .with_style(UiComponentStyles {
                        font_size: Some(appearance.ui_font_size() * 1.2),
                        font_color: Some(config.flavor.text_color(appearance)),
                        ..Default::default()
                    })
                    .build()
                    .finish(),
            )
            .finish(),
        );

        content_row.finish()
    }
}

// Convenience methods for creating common alert configurations
impl AlertConfig {
    #[cfg_attr(not(feature = "warp_services"), allow(unused_variables))]
    pub fn new(message: String, flavor: AlertFlavor) -> Self {
        Self {
            #[cfg(feature = "warp_services")]
            flavor,
            #[cfg(feature = "warp_services")]
            message,
            #[cfg(feature = "warp_services")]
            main_axis_size: None,
        }
    }

    #[cfg(feature = "warp_services")]
    pub fn error(message: String) -> Self {
        Self::new(message, AlertFlavor::Error)
    }

    #[allow(dead_code)]
    pub fn success(message: String) -> Self {
        Self::new(message, AlertFlavor::Success)
    }

    #[cfg(feature = "warp_services")]
    pub fn warning(message: String) -> Self {
        Self::new(message, AlertFlavor::Warning)
    }

    #[cfg(feature = "warp_services")]
    pub fn with_main_axis_size(mut self, main_axis_size: MainAxisSize) -> Self {
        self.main_axis_size = Some(main_axis_size);
        self
    }
}
