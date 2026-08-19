//! Drift guard: the console's default palette is single-sourced in
//! `vm::palette::DEFAULT_COLORS`, but Studio's browser fallback hand-copies it
//! into `ipc.ts` so the editor has swatches before a VM is attached. That copy
//! had already drifted to a different console's palette once; this test parses
//! it and asserts every slot still matches.
//!
//! On failure, the assertion names the slot, the hex found in `ipc.ts`, and the
//! hex `DEFAULT_COLORS` expects — that's the fix.

use caiven_vm::vm::palette::DEFAULT_COLORS;

const IPC_TS: &str = include_str!("../../caiven-studio-ui/src/lib/ipc.ts");

/// Pulls the `'#RRGGBB'` literals out of `export const defaultPalette = [ … ];`.
fn ipc_ts_default_palette() -> Vec<String> {
    let start = IPC_TS
        .find("export const defaultPalette = [")
        .expect("ipc.ts: `export const defaultPalette` not found");
    let body = &IPC_TS[start..];
    let end = body
        .find("];")
        .expect("ipc.ts: defaultPalette is not terminated");
    body[..end]
        .split('\'')
        .filter(|token| token.starts_with('#') && token.len() == 7)
        .map(|token| token.to_ascii_uppercase())
        .collect()
}

#[test]
fn ipc_ts_default_palette_matches_vm() {
    let found = ipc_ts_default_palette();
    assert_eq!(
        found.len(),
        DEFAULT_COLORS.len(),
        "ipc.ts defaultPalette has {} slots, expected {}",
        found.len(),
        DEFAULT_COLORS.len()
    );
    for (slot, (got, &(r, g, b))) in found.iter().zip(DEFAULT_COLORS.iter()).enumerate() {
        let want = format!("#{r:02X}{g:02X}{b:02X}");
        assert_eq!(
            got, &want,
            "ipc.ts defaultPalette slot {slot}: found {got}, expected {want} from DEFAULT_COLORS"
        );
    }
}
