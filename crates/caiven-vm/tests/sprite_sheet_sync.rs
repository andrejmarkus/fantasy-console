//! Drift guard: the sprite sheet's slot count and column width are
//! single-sourced in `caiven_core::memory`, but Studio's group-canvas math
//! (`editorMath.ts`'s `composeGroup`/`decomposeGroup`) needs `SPRITE_SHEET_COLS`
//! to know how a flat slot index maps to a sheet row/column, and hand-copies it
//! into `ipc.ts` — the same class of frontend-constant drift already caught
//! twice in `ipc.ts` (see `palette_sync.rs`).

use caiven_core::memory::{SPRITE_COUNT, SPRITE_SHEET_COLS};

const IPC_TS: &str = include_str!("../../caiven-studio-ui/src/lib/ipc.ts");

fn ipc_ts_const(name: &str) -> usize {
    let needle = format!("export const {name} = ");
    let start = IPC_TS
        .find(&needle)
        .unwrap_or_else(|| panic!("ipc.ts: `{needle}` not found"));
    let body = &IPC_TS[start + needle.len()..];
    let end = body
        .find(';')
        .unwrap_or_else(|| panic!("ipc.ts: {name} is not terminated with `;`"));
    body[..end]
        .trim()
        .parse()
        .unwrap_or_else(|e| panic!("ipc.ts: {name} is not a plain integer literal: {e}"))
}

#[test]
fn ipc_ts_sprite_sheet_constants_match_core() {
    assert_eq!(
        ipc_ts_const("SPRITE_COUNT"),
        SPRITE_COUNT,
        "ipc.ts SPRITE_COUNT is out of sync with caiven_core::memory::SPRITE_COUNT"
    );
    assert_eq!(
        ipc_ts_const("SPRITE_SHEET_COLS"),
        SPRITE_SHEET_COLS,
        "ipc.ts SPRITE_SHEET_COLS is out of sync with caiven_core::memory::SPRITE_SHEET_COLS"
    );
}
