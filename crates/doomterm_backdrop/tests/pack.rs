//! Each pack's contract: the keys Doom Term's theme loader needs, the values the design fixes,
//! and the files the YAML points at.

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Deserialize)]
struct Pack {
    name: String,
    background: String,
    foreground: String,
    accent: String,
    cursor: String,
    details: String,
    terminal_colors: TerminalColors,
    background_image: BackgroundImage,
    plate_stone: Option<String>,
}

#[derive(Deserialize)]
struct TerminalColors {
    normal: Ansi,
    bright: Ansi,
}

#[derive(Deserialize)]
struct Ansi {
    black: String,
    red: String,
    green: String,
    yellow: String,
    blue: String,
    magenta: String,
    cyan: String,
    white: String,
}

impl Ansi {
    fn all(&self) -> [&str; 8] {
        [
            &self.black,
            &self.red,
            &self.green,
            &self.yellow,
            &self.blue,
            &self.magenta,
            &self.cyan,
            &self.white,
        ]
    }
}

#[derive(Deserialize)]
struct BackgroundImage {
    path: String,
    opacity: u8,
}

/// A shipped pack and the values its design fixes.
struct Shipped {
    id: &'static str,
    name: &'static str,
    opacity: u8,
    plate_stone: Option<&'static str>,
}

const PACKS: [Shipped; 5] = [
    Shipped {
        id: "redsky",
        name: "Redsky",
        opacity: 10,
        plate_stone: Some("#49121f"),
    },
    Shipped {
        id: "bluehighway",
        name: "Blue Highway",
        opacity: 10,
        plate_stone: Some("#1a304d"),
    },
    Shipped {
        id: "canopy",
        name: "Canopy",
        opacity: 10,
        plate_stone: Some("#1b3c2c"),
    },
    Shipped {
        id: "replay",
        name: "Replay",
        opacity: 30,
        plate_stone: None,
    },
    Shipped {
        id: "bfr",
        name: "Big Fucking Replay",
        opacity: 30,
        plate_stone: None,
    },
];

fn themes_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../themes")
}

fn load(id: &str) -> Pack {
    let file = format!("{id}/{id}.yaml");
    let text = fs::read_to_string(themes_dir().join(&file)).expect("the pack's YAML");
    serde_yaml::from_str(&text).unwrap_or_else(|error| panic!("{file} parses: {error}"))
}

fn is_hex(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..]
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn luminance(color: &str) -> f64 {
    let channel = |range: std::ops::Range<usize>| {
        let value = f64::from(u8::from_str_radix(&color[range], 16).unwrap()) / 255.0;
        if value <= 0.03928 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(1..3) + 0.7152 * channel(3..5) + 0.0722 * channel(5..7)
}

#[test]
fn each_pack_is_named_and_ships_at_the_agreed_opacity() {
    for shipped in &PACKS {
        let pack = load(shipped.id);
        assert_eq!(pack.name, shipped.name);
        assert_eq!(pack.details, "darker", "{}", shipped.id);
        assert_eq!(
            pack.background_image.opacity, shipped.opacity,
            "{}",
            shipped.id
        );
    }
}

#[test]
fn every_colour_is_a_lowercase_hex_triplet() {
    for shipped in &PACKS {
        let pack = load(shipped.id);
        let mut colours = vec![
            pack.background.as_str(),
            pack.foreground.as_str(),
            pack.accent.as_str(),
            pack.cursor.as_str(),
        ];
        colours.extend(pack.plate_stone.as_deref());
        colours.extend(pack.terminal_colors.normal.all());
        colours.extend(pack.terminal_colors.bright.all());
        for colour in colours {
            assert!(
                is_hex(colour),
                "{}: not a lowercase #rrggbb colour: {colour}",
                shipped.id
            );
        }
    }
}

#[test]
fn the_foreground_reads_on_the_background() {
    for shipped in &PACKS {
        let pack = load(shipped.id);
        let (a, b) = (luminance(&pack.foreground), luminance(&pack.background));
        assert!((a + 0.05) / (b + 0.05) >= 7.0, "{}", shipped.id);
    }
}

#[test]
fn the_image_path_resolves_under_the_themes_folder() {
    for shipped in &PACKS {
        let pack = load(shipped.id);
        assert_eq!(
            pack.background_image.path,
            format!("{0}/{0}.gif", shipped.id)
        );
        assert!(themes_dir().join(&pack.background_image.path).is_file());
    }
}

#[test]
fn the_plate_stone_key_is_the_agreed_value() {
    for shipped in &PACKS {
        assert_eq!(load(shipped.id).plate_stone.as_deref(), shipped.plate_stone);
    }
}

#[test]
fn each_pack_folder_holds_only_the_shipped_files() {
    for shipped in &PACKS {
        let id = shipped.id;
        let mut names: Vec<String> = fs::read_dir(themes_dir().join(id))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "README.txt".to_string(),
                format!("{id}.gif"),
                format!("{id}.yaml")
            ]
        );
    }
}

#[test]
fn the_pack_text_uses_no_game_vocabulary() {
    for shipped in &PACKS {
        let id = shipped.id;
        let text = [format!("{id}/{id}.yaml"), format!("{id}/README.txt")]
            .iter()
            .map(|file| {
                fs::read_to_string(themes_dir().join(file))
                    .unwrap()
                    .to_lowercase()
            })
            .collect::<String>();
        for word in ["ammo", "armor", "e1m1", "god mode", "phobos", "doomguy"] {
            assert!(!text.contains(word), "{id}: pack text contains {word:?}");
        }
    }
}

#[test]
fn the_neutral_names_carry_no_third_party_branding() {
    for shipped in &PACKS {
        let id = shipped.id;
        let text = [format!("{id}/{id}.yaml"), format!("{id}/README.txt")]
            .iter()
            .map(|file| {
                fs::read_to_string(themes_dir().join(file))
                    .unwrap()
                    .to_lowercase()
            })
            .collect::<String>();
        for word in ["blue ink", "blueink"] {
            assert!(!text.contains(word), "{id}: pack text contains {word:?}");
        }
    }
}

#[test]
fn replay_names_its_source_and_disclaims_affiliation() {
    let readme = fs::read_to_string(themes_dir().join("replay/README.txt")).unwrap();
    let flat = readme.split_whitespace().collect::<Vec<_>>().join(" ");
    for needed in [
        "DOOM1.WAD",
        "freely distributable shareware data file",
        "not affiliated with, endorsed by or sponsored by id Software or ZeniMax Media",
    ] {
        assert!(flat.contains(needed), "the Replay README lacks {needed:?}");
    }
}

#[test]
fn big_fucking_replay_names_its_source_and_disclaims_affiliation() {
    let readme = fs::read_to_string(themes_dir().join("bfr/README.txt")).unwrap();
    let flat = readme.split_whitespace().collect::<Vec<_>>().join(" ");
    for needed in [
        "DOOM.WAD",
        "not part of this download",
        "not affiliated with, endorsed by or sponsored by id Software or ZeniMax Media",
    ] {
        assert!(
            flat.contains(needed),
            "the Big Fucking Replay README lacks {needed:?}"
        );
    }
}
