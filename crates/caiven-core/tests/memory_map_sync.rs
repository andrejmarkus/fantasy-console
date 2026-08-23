//! Drift guard: the RAM memory map is single-sourced in `src/memory.rs`
//! (`MemRegion`), but it is also hand-copied into two frontend files and
//! `docs/api-reference.md` for humans to read. Nothing stops those copies
//! from going stale when a region in `MemRegion` is resized, so this test
//! parses each copy and asserts every address it finds still matches
//! `MemRegion`.
//!
//! On failure, the assertion message names the file, the region, the value
//! found in that file, and the value `MemRegion` actually expects — that's
//! the fix.

use caiven_core::memory::{
    MAP_H, MAP_W, MUSIC_CHANNEL_COUNT, MUSIC_ORDER_STEPS, MUSIC_PATTERN_COUNT, MUSIC_PATTERN_ROWS,
    MUSIC_SONG_LEN, MemRegion, RAM_SIZE, SCREEN_HEIGHT, SCREEN_WIDTH, SFX_BANK_LEN,
};
use regex::Regex;

const IPC_TS: &str = include_str!("../../caiven-studio-ui/src/lib/ipc.ts");
const DRAWER_MATH_TS: &str = include_str!("../../caiven-studio-ui/src/lib/drawerMath.ts");
const API_REFERENCE_MD: &str = include_str!("../../../docs/api-reference.md");

fn parse_hex(s: &str) -> usize {
    usize::from_str_radix(s, 16).expect("regex only captures hex digits")
}

#[test]
fn ipc_ts_memory_object_matches_layout() {
    let re = Regex::new(r"(\w+):\s*0x([0-9A-Fa-f]+)").expect("valid regex");
    let cases: [(&str, MemRegion); 6] = [
        ("sprites", MemRegion::SpriteSheet),
        ("map", MemRegion::Map),
        ("palette", MemRegion::Palette),
        ("sfx", MemRegion::Sfx),
        ("music", MemRegion::Music),
        ("collision", MemRegion::Collision),
    ];

    // Scope to the `MEMORY` object literal so we don't match unrelated `key: 0x…` pairs.
    let start = IPC_TS
        .find("export const MEMORY")
        .expect("ipc.ts: MEMORY object not found");
    let end = IPC_TS[start..]
        .find("as const")
        .expect("ipc.ts: MEMORY object not closed")
        + start;
    let block = &IPC_TS[start..end];

    for (key, region) in cases {
        let found = re
            .captures_iter(block)
            .find(|c| &c[1] == key)
            .unwrap_or_else(|| panic!("ipc.ts: MEMORY.{key} not found"));
        let got = parse_hex(&found[2]);
        let want = region.base();
        assert_eq!(
            got, want,
            "ipc.ts MEMORY.{key}: found 0x{got:04X}, expected 0x{want:04X} from MemRegion::{region:?}"
        );
    }
}

#[test]
fn drawer_math_ts_regions_match_layout() {
    let re = Regex::new(r"label:\s*'(\w+)',\s*address:\s*0x([0-9A-Fa-f]+)").expect("valid regex");
    let cases: [(&str, MemRegion); 6] = [
        ("WORK", MemRegion::Work),
        ("SPRITES", MemRegion::SpriteSheet),
        ("MAP", MemRegion::Map),
        ("PALETTE", MemRegion::Palette),
        ("SFX", MemRegion::Sfx),
        ("MUSIC", MemRegion::Music),
    ];

    for (label, region) in cases {
        let found = re
            .captures_iter(DRAWER_MATH_TS)
            .find(|c| &c[1] == label)
            .unwrap_or_else(|| panic!("drawerMath.ts: MEMORY_REGIONS entry '{label}' not found"));
        let got = parse_hex(&found[2]);
        let want = region.base();
        assert_eq!(
            got, want,
            "drawerMath.ts MEMORY_REGIONS '{label}': found 0x{got:04X}, expected 0x{want:04X} from MemRegion::{region:?}"
        );
    }
}

#[test]
fn api_reference_memory_map_table_matches_layout() {
    let re =
        Regex::new(r"`0x([0-9A-Fa-f]+).0x([0-9A-Fa-f]+)`\s*\|\s*([^|]+)\|").expect("valid regex");
    // (keyword to find in the row's description, region it names)
    let cases: [(&str, MemRegion); 8] = [
        ("Sprite sheet", MemRegion::SpriteSheet),
        ("Tilemap", MemRegion::Map),
        ("Palette", MemRegion::Palette),
        ("SFX bank", MemRegion::Sfx),
        ("Music bank", MemRegion::Music),
        ("RTC", MemRegion::Rtc),
        ("Collision", MemRegion::Collision),
        ("Reserved", MemRegion::Heap),
    ];

    for (keyword, region) in cases {
        let row = re
            .captures_iter(API_REFERENCE_MD)
            .find(|c| c[3].contains(keyword))
            .unwrap_or_else(|| {
                panic!("docs/api-reference.md: memory-map row for '{keyword}' not found")
            });
        let got_base = parse_hex(&row[1]);
        let got_end = parse_hex(&row[2]);
        let want_base = region.base();
        let want_end = region.base() + region.span() - 1;
        assert_eq!(
            got_base, want_base,
            "docs/api-reference.md '{keyword}' row: base found 0x{got_base:04X}, expected 0x{want_base:04X} from MemRegion::{region:?}"
        );
        assert_eq!(
            got_end, want_end,
            "docs/api-reference.md '{keyword}' row: end found 0x{got_end:04X}, expected 0x{want_end:04X} from MemRegion::{region:?}"
        );
    }
}

/// The Studio frontend hand-copies the framebuffer size to build its canvases;
/// widening the screen without updating it silently renders a torn image.
#[test]
fn ipc_ts_screen_size_matches_memory() {
    let re =
        Regex::new(r"export const (SCREEN_WIDTH|SCREEN_HEIGHT) = (\d+);").expect("valid regex");
    for (name, want) in [
        ("SCREEN_WIDTH", SCREEN_WIDTH),
        ("SCREEN_HEIGHT", SCREEN_HEIGHT),
    ] {
        let found = re
            .captures_iter(IPC_TS)
            .find(|c| &c[1] == name)
            .unwrap_or_else(|| panic!("ipc.ts: `export const {name}` not found"));
        let got: u32 = found[2].parse().expect("regex only captures digits");
        assert_eq!(
            got, want,
            "ipc.ts {name}: found {got}, expected {want} from caiven_core::memory"
        );
    }
}

/// The map editor hand-copies the map's tile dimensions to size its canvas,
/// its pointer math and its screen grid; a stale copy silently paints the
/// wrong cell.
#[test]
fn ipc_ts_map_size_matches_memory() {
    let re = Regex::new(r"export const (MAP_W|MAP_H) = (\d+);").expect("valid regex");
    for (name, want) in [("MAP_W", MAP_W), ("MAP_H", MAP_H)] {
        let found = re
            .captures_iter(IPC_TS)
            .find(|c| &c[1] == name)
            .unwrap_or_else(|| panic!("ipc.ts: `export const {name}` not found"));
        let got: usize = found[2].parse().expect("regex only captures digits");
        assert_eq!(
            got, want,
            "ipc.ts {name}: found {got}, expected {want} from caiven_core::memory"
        );
    }
}

/// The drawer labels its memory tab with the total address space, and its
/// hex-dump paging is sized from the same number.
#[test]
fn ipc_ts_ram_size_matches_memory() {
    let re = Regex::new(r"export const RAM_SIZE = (\d+);").expect("valid regex");
    let found = re
        .captures(IPC_TS)
        .expect("ipc.ts: `export const RAM_SIZE` not found");
    let got: usize = found[1].parse().expect("regex only captures digits");
    assert_eq!(
        got, RAM_SIZE,
        "ipc.ts RAM_SIZE: found {got}, expected {RAM_SIZE} from caiven_core::memory"
    );
}

/// The song-order editor hand-copies the order table's size to lay out its
/// step slots and to find the loop-point byte; a stale copy silently edits
/// past the end of the table or misses the loop byte entirely.
#[test]
fn ipc_ts_song_order_shape_matches_memory() {
    let steps_re = Regex::new(r"export const MUSIC_ORDER_STEPS = (\d+);").expect("valid regex");
    let found = steps_re
        .captures(IPC_TS)
        .expect("ipc.ts: `export const MUSIC_ORDER_STEPS` not found");
    let got: usize = found[1].parse().expect("regex only captures digits");
    assert_eq!(
        got, MUSIC_ORDER_STEPS,
        "ipc.ts MUSIC_ORDER_STEPS: found {got}, expected {MUSIC_ORDER_STEPS} from caiven_core::memory"
    );

    // Written as `MUSIC_ORDER_STEPS + 1` for readability, so capture the addend
    // and re-derive rather than expecting a bare literal.
    let song_re = Regex::new(r"export const MUSIC_SONG_LEN = MUSIC_ORDER_STEPS \+ (\d+);")
        .expect("valid regex");
    let found = song_re
        .captures(IPC_TS)
        .expect("ipc.ts: `export const MUSIC_SONG_LEN = MUSIC_ORDER_STEPS + …` not found");
    let addend: usize = found[1].parse().expect("regex only captures digits");
    let got = got + addend;
    assert_eq!(
        got, MUSIC_SONG_LEN,
        "ipc.ts MUSIC_SONG_LEN: found {got}, expected {MUSIC_SONG_LEN} from caiven_core::memory"
    );
}

/// The Music and SFX editors hand-copy the audio bank shape to index their
/// grids; a stale copy silently edits the wrong row or channel.
#[test]
fn ipc_ts_audio_bank_shape_matches_memory() {
    let re = Regex::new(
        r"export const (SFX_BANK_LEN|MUSIC_PATTERN_COUNT|MUSIC_PATTERN_ROWS|MUSIC_CHANNEL_COUNT) = ([0-9 *]+);",
    )
    .expect("valid regex");
    for (name, want) in [
        ("SFX_BANK_LEN", SFX_BANK_LEN),
        ("MUSIC_PATTERN_COUNT", MUSIC_PATTERN_COUNT),
        ("MUSIC_PATTERN_ROWS", MUSIC_PATTERN_ROWS),
        ("MUSIC_CHANNEL_COUNT", MUSIC_CHANNEL_COUNT),
    ] {
        let found = re
            .captures_iter(IPC_TS)
            .find(|c| &c[1] == name)
            .unwrap_or_else(|| panic!("ipc.ts: `export const {name}` not found"));
        // The literals are written as products (`16 * 64`), so evaluate rather
        // than parse — keeping the file readable shouldn't defeat the guard.
        let got: usize = found[2]
            .split('*')
            .map(|part| part.trim().parse::<usize>().expect("numeric factor"))
            .product();
        assert_eq!(
            got, want,
            "ipc.ts {name}: found {got}, expected {want} from caiven_core::memory"
        );
    }
}
