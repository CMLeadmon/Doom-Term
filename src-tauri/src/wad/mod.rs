use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WadHeader {
    pub wad_type: String, // "IWAD" or "PWAD"
    pub num_lumps: u32,
    pub directory_offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WadLumpInfo {
    pub name: String,
    pub file_pos: u32,
    pub size: u32,
    pub index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmxSoundData {
    pub name: String,
    pub sample_rate: u16,
    pub sample_count: u32,
    pub samples: Vec<u8>,
}

pub struct WadReader {
    data: Vec<u8>,
    pub header: WadHeader,
    pub directory: Vec<WadLumpInfo>,
}

impl WadReader {
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(path).context("Failed to open WAD file")?;
        let mut data = Vec::new();
        file.read_to_end(&mut data).context("Failed to read WAD data")?;
        Self::from_bytes(data)
    }

    pub fn from_bytes(data: Vec<u8>) -> Result<Self> {
        if data.len() < 12 {
            bail!("WAD data too short for header (minimum 12 bytes)");
        }

        let magic = std::str::from_utf8(&data[0..4]).context("Invalid WAD magic")?;
        if magic != "IWAD" && magic != "PWAD" {
            bail!("Unknown WAD magic: {}", magic);
        }

        let num_lumps = u32::from_le_bytes(data[4..8].try_into().unwrap());
        let directory_offset = u32::from_le_bytes(data[8..12].try_into().unwrap());

        let header = WadHeader {
            wad_type: magic.to_string(),
            num_lumps,
            directory_offset,
        };

        let mut directory = Vec::with_capacity(num_lumps as usize);
        let dir_start = directory_offset as usize;

        for i in 0..num_lumps as usize {
            let entry_offset = dir_start + i * 16;
            if entry_offset + 16 > data.len() {
                break;
            }

            let file_pos = u32::from_le_bytes(data[entry_offset..entry_offset + 4].try_into().unwrap());
            let size = u32::from_le_bytes(data[entry_offset + 4..entry_offset + 8].try_into().unwrap());
            let name_raw = &data[entry_offset + 8..entry_offset + 16];
            let name_len = name_raw.iter().position(|&c| c == 0).unwrap_or(8);
            let name = String::from_utf8_lossy(&name_raw[..name_len]).to_string();

            directory.push(WadLumpInfo {
                name,
                file_pos,
                size,
                index: i,
            });
        }

        Ok(Self {
            data,
            header,
            directory,
        })
    }

    pub fn find_lump(&self, name: &str) -> Option<&WadLumpInfo> {
        let upper = name.to_uppercase();
        self.directory.iter().find(|l| l.name.eq_ignore_ascii_case(&upper))
    }

    pub fn get_lump_data(&self, lump: &WadLumpInfo) -> Result<&[u8]> {
        let start = lump.file_pos as usize;
        let end = start + lump.size as usize;
        if end > self.data.len() {
            bail!("Lump '{}' extends past end of WAD buffer", lump.name);
        }
        Ok(&self.data[start..end])
    }

    /// Extracts PLAYPAL lump: 14 palettes x 256 colors x 3 bytes RGB (10,752 bytes).
    /// Returns 14 x 256 x 4 RGBA bytes (14,336 bytes total).
    pub fn extract_playpal_rgba(&self) -> Result<Vec<u8>> {
        let lump = self
            .find_lump("PLAYPAL")
            .ok_or_else(|| anyhow::anyhow!("PLAYPAL lump not found in WAD"))?;
        let raw = self.get_lump_data(lump)?;

        if raw.len() < 10752 {
            bail!("PLAYPAL lump too short: {} bytes (expected 10752)", raw.len());
        }

        let mut rgba = Vec::with_capacity(14 * 256 * 4);
        for palette_idx in 0..14 {
            let offset = palette_idx * 256 * 3;
            for color_idx in 0..256 {
                let r = raw[offset + color_idx * 3];
                let g = raw[offset + color_idx * 3 + 1];
                let b = raw[offset + color_idx * 3 + 2];
                rgba.push(r);
                rgba.push(g);
                rgba.push(b);
                rgba.push(255); // Alpha
            }
        }

        Ok(rgba)
    }

    /// Safely decodes DMX sound lump (e.g. DSPISTOL, DSSHOTGN, DSOOF)
    /// Performs dynamic length checking to safely strip 16-sample padding when present.
    pub fn extract_dmx_sound(&self, sound_name: &str) -> Result<DmxSoundData> {
        let lump = self
            .find_lump(sound_name)
            .ok_or_else(|| anyhow::anyhow!("Sound lump '{}' not found", sound_name))?;
        let raw = self.get_lump_data(lump)?;

        if raw.len() < 8 {
            bail!("DMX sound lump '{}' is too short (< 8 bytes)", sound_name);
        }

        let _format = u16::from_le_bytes(raw[0..2].try_into().unwrap());
        let sample_rate = u16::from_le_bytes(raw[2..4].try_into().unwrap());
        let sample_count = u32::from_le_bytes(raw[4..8].try_into().unwrap());

        let actual_data_len = raw.len().saturating_sub(8);
        let samples = if actual_data_len >= (sample_count as usize) + 32 {
            // Commercial Doom padded format: strip 16 leading padding samples
            let start = 8 + 16;
            let end = (start + sample_count as usize).min(raw.len());
            raw[start..end].to_vec()
        } else {
            // Freedoom / unpadded format
            let start = 8;
            let end = (start + sample_count as usize).min(raw.len());
            raw[start..end].to_vec()
        };

        Ok(DmxSoundData {
            name: sound_name.to_string(),
            sample_rate,
            sample_count: samples.len() as u32,
            samples,
        })
    }
}
