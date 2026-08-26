use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WadHeader {
    pub wad_type: String,
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

#[allow(dead_code)]
pub struct WadReader {
    data: Vec<u8>,
    pub header: WadHeader,
    pub directory: Vec<WadLumpInfo>,
}

#[allow(dead_code)]
impl WadReader {
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(path).context("Failed to open WAD file")?;
        let mut data = Vec::new();
        file.read_to_end(&mut data).context("Failed to read WAD data")?;
        Self::from_bytes(data)
    }

    pub fn from_bytes(data: Vec<u8>) -> Result<Self> {
        if data.len() < 12 {
            bail!("WAD data too short for header");
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wad_header_parsing() {
        let mut mock_wad = Vec::new();
        // Magic
        mock_wad.extend_from_slice(b"IWAD");
        // num_lumps: 1
        mock_wad.extend_from_slice(&1u32.to_le_bytes());
        // directory_offset: 12
        mock_wad.extend_from_slice(&12u32.to_le_bytes());
        // directory entry: file_pos = 0, size = 0, name = "PLAYPAL\0"
        mock_wad.extend_from_slice(&0u32.to_le_bytes());
        mock_wad.extend_from_slice(&0u32.to_le_bytes());
        mock_wad.extend_from_slice(b"PLAYPAL\0");

        let reader = WadReader::from_bytes(mock_wad).expect("Failed to parse mock WAD");
        assert_eq!(reader.header.wad_type, "IWAD");
        assert_eq!(reader.header.num_lumps, 1);
        assert_eq!(reader.directory.len(), 1);
        assert_eq!(reader.directory[0].name, "PLAYPAL");
    }
}

