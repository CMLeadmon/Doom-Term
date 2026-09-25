use string_offset::StringRange;
pub use warp_terminal::model::secrets::*;
use warpui::EntityId;

#[cfg(feature = "warp_services")]
use crate::ai::blocklist::block::TextLocation;
#[derive(Clone, Debug)]
pub struct RichContentSecretTooltipInfo {
    pub secret: String,
    pub secret_range: StringRange,
    #[cfg(feature = "warp_services")]
    pub location: TextLocation,
    pub is_obfuscated: bool,
    pub position_id: String,
    pub view_id: EntityId,
    pub secret_level: SecretLevel,
}
