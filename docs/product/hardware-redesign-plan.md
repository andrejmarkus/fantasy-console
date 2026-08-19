# Hardware redesign — Phase 2 and Phase 3 change list

Steering document: `docs/product/design-charter.md`. The charter's §4 table is
the target; this file is how the code gets there.

Each item below is a **separate focused diff with its own tests**. Nothing is in
production and no user has seen the console, so there are **no migration paths,
no deprecation periods, and no compatibility shims** — old behaviour is deleted,
not aliased. Existing documentation is updated in the same diff as the change it
describes.

Order matters where noted; otherwise items are independent.

## Phase 2 — hardware

### 2.1 Screen 128 × 128 → 192 × 128 — **done**

Landed; kept as the record of what the item covered. Two things the original
list did not anticipate: `--scale fit --aspect square` filled the window height
unconditionally, which pushed a 3:2 console off the sides of a 4:3 handheld
panel (now clamped to the width budget), and every cover-art container in
Studio and Port was `aspect-square`.

- `crates/caiven-core/src/memory.rs:28-30` — `SCREEN_WIDTH` 128 → 192. Derived
  bases follow automatically through `MemRegion::span`/`base`.
- Renderer and framebuffer sizing in `caiven-vm` (anything assuming a square
  screen or reusing `SCREEN_HEIGHT` for width).
- `caiven-studio-ui` `ConsolePane` canvas dimensions and integer-scale logic.
- `caiven-web` player canvas.
- `caiven-machine` window sizing and handheld scaling
  (`docs/development/handheld-builds.md:171` states 128×128 explicitly).
- Showcase carts: anything that centres by hard-coded 64.

Test: a cart drawing `draw_text` at x=0 fits 24 columns; a pixel at x=191 is
in-bounds and x=192 errors.

### 2.2 Map 64 × 64 → 128 × 128 — **done**

Landed; kept as the record of what the item covered. The thing the original
list did not anticipate: **32 KiB of map + collision does not fit the 64 KiB
flat address space.** The old layout filled 64 KiB exactly, and the two regions
needed +24 KiB against a 22.5 KiB heap. Resolved by an explicit decision from
the project owner — the addressable space grew to 96 KiB, with Work still
16 KiB and Heap now ~30.5 KiB, so "64 KiB RAM" now names the general-purpose
memory (Work + Heap) and the asset windows are mapped alongside it rather than
carved out of it. The charter's §4 RAM row and its "does not eat guest RAM"
justification were updated to say so.

- `crates/caiven-core/src/memory.rs` — `MAP_W`/`MAP_H` 64 → 128, both region
  spans 0x1000 → 0x4000, `RAM_SIZE` 64 → 96 KiB. Every base downstream shifted
  automatically; only the golden-base test needed new numbers.
- `crates/caiven-cart/src/project.rs`, `asset_png.rs`, `section.rs` — map PNG
  dimensions and doc comments follow the constants; no code change was needed
  beyond the prose.
- `crates/caiven-studio-ui/src/lib/ipc.ts` — new `MAP_W`/`MAP_H`/`MAP_LEN`/
  `TILE_SIZE`/`MAP_PX_*`/`SCREEN_TILES_*` exports, guarded by a new drift test
  in `crates/caiven-core/tests/memory_map_sync.rs`.
- `MapCanvas.svelte` and `Workspace.svelte` — every hard-coded `64` and `512`
  now derives from those exports, including the minimap and the scroll-viewport
  fractions.
- `MapCanvas.svelte` repaint cost: 4× the tiles made the full redraw ~23 ms in
  a dev build, and it ran on every pointer move of a paint drag. The canvas
  image is now kept between renders and a stroke repaints only the cells it
  touched (measured back down to ~10 ms per move on the tile layer). Editor
  responsiveness is Clock A, so this was fixed in the same diff rather than
  filed.
- `projects/showcase/platformer/main.lua` — rooms re-authored from 16 × 16 to
  24 × 16 tiles (`ROOM_TILES_W`/`ROOM_TILES_H`), which is what 2.1 deferred.

Note for later items: the map is **not** a whole number of screens wide
(128 / 24 = 5.33), so the map editor's screen grid has a partial right-hand
column. That is deliberate — it follows from the charter's own numbers — and
the editor draws it honestly rather than hiding it.

Guest RAM is untouched: map and collision live in their own regions.

Test: a tile written at (127, 127) lands, one at (128, 0) is dropped rather
than wrapping onto row 1, and the collision region starts past the map's end.

### 2.3 Palette redesign — **done**

Landed; kept as the record of what the item covered. Count stayed 16, so no
format changed — only the RGB values and the slot meanings moved.

- `crates/caiven-vm/src/vm/palette.rs` — `DEFAULT_COLORS` rebuilt to the
  charter's structure. Slot layout: 0 black, 1-12 four ramps (ember, moss, sky,
  stone) in dark → mid → light order, 13-14 the gold and magenta accents, 15
  white. The ordering is the teaching aid: the shadow of any color is the slot
  before it and the highlight is the slot after it, in every ramp. Three unit
  tests hold that property (ramps climb in brightness, black and white bound the
  range, shade tiers stay separated across ramps).
- `docs/brand-colors.md` was checked and is **brand-only** — logo, Port and
  Studio chrome. It does not document the console palette, so it did not change.
- `crates/caiven-studio-ui/src/lib/ipc.ts` — the browser-fallback swatches had
  **already drifted to PICO-8's exact palette**, so Studio-in-a-browser showed
  colors the VM never rendered. Corrected, and a new drift test
  (`crates/caiven-vm/tests/palette_sync.rs`) now parses the copy and fails on
  any future divergence. The same file still had `map: Array(4096)` left over
  from 2.2; it now uses `MAP_LEN`.
- `crates/caiven-vm/tests/lua_script.rs` — four tests about input and bounds
  asserted hard-coded palette RGB as sentinels and broke on the recolor. They
  now derive the expected pixel from `DEFAULT_COLORS` through a `slot_rgba`
  helper, so a future palette change cannot break assertions that were never
  about color.
- Carts re-indexed: `stdlib_demo` (showcase and dev, Lua plus `sprites.png`
  pixel indices and PLTE), `scenes_demo` (showcase and dev), and the dev carts
  `demo_string`, `demo_table`, `platformer_demo`, `sprite_flip_rotate`.

Not re-indexed, deliberately: `catch`, `movement`, `tiles`, `sprite`, `smoke`,
`audio_test`, `stdlib_all_modules`, `stdlib_core_only` and the showcase
`platformer` all overwrite their slots with `set_palette_color` in `_init`, so
their indices name their own colors and have no default slot to move to.

**Open question for the owner:** the showcase `platformer` replaces all 16 slots
with hand-picked colors. That predates a palette worth using, and re-authoring
it onto the default ramps would make the flagship cart actually show the new
palette — but it is an art decision on a showcase cart, not a mechanical
re-index, so it was left alone rather than decided mid-task.

Test: each ramp is monotone in brightness; the `ipc.ts` copy matches
`DEFAULT_COLORS` slot for slot.

### 2.4 Audio 8 voices → 6 typed voices — **done**

Landed; kept as the record of what the item covered.

- `crates/caiven-vm/src/vm/audio.rs` — `VOICE_COUNT` is now
  `MUSIC_VOICE_COUNT + SFX_VOICE_COUNT` = 4 + 2. `MUSIC_VOICE_CH0`/`CH1`,
  `LEGACY_SFX_VOICE` and `SFX_POOL_START`/`LEN` are gone, replaced by
  `MUSIC_VOICE_START`/`SFX_VOICE_START` and a `MUSIC_VOICE_KINDS` table fixing
  each music channel's timbre by column: pulse, pulse, triangle, noise.
- `VoiceKind::Triangle` is new, so the synth gained a third waveform. A unit
  test asserts it ramps between its extremes instead of stepping — a triangle
  that jumps is just a square with extra code.
- **`LEGACY_SFX_VOICE` deleted.** Studio's SFX-editor preview used to own a
  third voice class of its own; it now borrows an ordinary sfx voice through
  `play_sfx_voice`, tracked by a `preview_sfx` handle. With only two sfx
  voices, reserving a third for an editor would have spent a third of the
  console's polyphony on Studio. `Vm::sfx_player()` consequently returns a
  `SfxPlayer` snapshot rather than a `&SfxPlayer` — it reports the preview's
  voice, or an idle player once that voice finished or was stolen.
- `crates/caiven-vm/src/vm/sfx.rs` — `MusicPlayer`'s `ch0`/`ch1` became a
  `channels: [SfxPlayer; MUSIC_VOICE_COUNT]` array, and `pattern_row_base`
  strides by channel count instead of a hard-coded 2.
- **Format change:** a music row is now one byte per typed channel, so
  `MUSIC_BANK_LEN` went 256 → 512 (`8 patterns × 16 rows × 4 channels`) and
  `MemRegion::Music`'s span 0x100 → 0x200. Unlike 2.2 there was no squeeze:
  `Heap` absorbs the shift, since the address space grew to 96 KiB in 2.2.
  Every region above Music moved up by 0x100 (RTC to 0xC700, collision to
  0xC703, heap to 0x10703).
- The pattern shape is now single-sourced in `caiven_core::memory` as
  `MUSIC_PATTERN_COUNT`/`MUSIC_PATTERN_ROWS`/`MUSIC_CHANNEL_COUNT`, with
  `MUSIC_BANK_LEN` derived from them and `audio::MUSIC_VOICE_COUNT` taking the
  channel count from there — one number, not four.
- Existing music data was converted rather than dropped: each old row `[a, b]`
  became `[a, 0, 0, b]`. Old channel 0 was forced Square and old channel 1
  forced Noise, so this puts each one in the new column with the same timbre.
  Affects `projects/dev/catch`, `projects/showcase/catch` and
  `projects/showcase/platformer`; their `.cav` binaries were rebuilt.
- Studio's tracker went to four typed columns in this diff rather than waiting
  for 3.3. Leaving it at two would not have been "unchanged" — the row stride
  moved, so a two-column tracker would have written into the wrong rows. The
  deeper tracker work (step/pattern copy-paste, song order, chaining) is still
  3.3's.
- `crates/caiven-studio-ui/src/lib/ipc.ts` — the audio bank shape is now
  exported as constants and guarded by a new drift test in
  `memory_map_sync.rs`, the same prevention pattern 2.2 and 2.3 established.
  Two more stale copies in that file were found and fixed while there:
  `sfx: Array(1024)` and `ram: Array(65536)` (the latter wrong since the
  address space grew in 2.2).

Test: `play_sfx_does_not_disturb_concurrent_music_playback` now fills every
music channel, then makes more concurrent `play_sfx` calls than there are sfx
voices, and asserts no music channel went silent — the reserved-voice promise
stated as an executable claim.

**Noted, not fixed:** `projects/showcase/platformer`'s music references SFX ids
47 and 7, but a bank only has 16 slots. That data was already out of range
before this change — the conversion preserved it exactly — so the cart's music
was reading past the SFX bank both before and after. Fixing it means
re-authoring the platformer's music, which is an art decision on a showcase
cart, not part of this item.

### 2.5 Named banks — **done**

Numeric ids removed, not aliased.

- `crates/caiven-vm/src/vm/lua_exec.rs` — the five `load_*_bank` builtins
  take a string name.
- `crates/caiven-vm/src/vm/mod.rs` — `AssetBanks`'s bank maps are keyed by
  `String` instead of `u8`; the Map → Collision companion rule follows the
  name. The reserved name `"default"` (`caiven_cart::DEFAULT_BANK_NAME`) is
  the bank that auto-loads at boot — it can be switched back to like any
  other name but never created or removed (`create_asset_bank`/
  `remove_asset_bank` reject it, mirroring the old id-`0` special case).
- `crates/caiven-cart/src/section.rs` — payload changed from `[bank_id
  u8][data…]` to `[name_len u8][name][data…]`. `is_valid_bank_name` (also
  exported) gates both the encoder and decoder: 1-31 ASCII letters, digits,
  `_`, or `-`. `decode_asset_bank` is the untrusted-input boundary — a
  truncated section, non-UTF-8 name bytes, or a name failing the charset
  all return `None` rather than panicking, and the charset excludes `.`,
  `/`, `\`, so a validated name can never escape a directory when later
  joined into a project-file path.
- **Format version bumped 3 → 4** (`crates/caiven-cart/src/format.rs`),
  `MIN_SUPPORTED_CART_VERSION` raised to 4. A pre-2.5 cart's numeric bank id
  would misparse as a name length under the new decoder, so old carts are
  rejected outright with `CartError::UnsupportedCartVersion` rather than
  silently misread — no migration exists because nothing is in production.
  All showcase/dev `.cav` files rebuilt via `scripts/demo-carts/build.sh`.
- `crates/caiven-cart/src/project.rs` — project filenames
  `sprites_1.png` → `sprites_forest.png`. The read side no longer scans
  `1..=u8::MAX` for candidate ids; it lists the project directory once per
  bank kind and keeps filenames matching `{stem}_{name}.{png,hex}` where
  `name` passes `is_valid_bank_name` (`bank_file_name`) — the same gate, so
  a hand-placed file with a path-traversal or oversized name is silently
  skipped rather than loaded.
- `crates/caiven-vm/src/vm/api_registry.rs` — signatures and doc strings.
- Studio: `tauri_app.rs`'s `AssetBankPayload`/`BootstrapPayload`/
  `TickPayload` fields and the `studio_asset_bank` Tauri command switched
  from `Vec<u8>`/`u8` to `Vec<String>`/`String`; `"create"` now requires the
  caller to supply a name (no more auto-picking the lowest free id) and
  validates it with `is_valid_bank_name` before touching the VM. Frontend
  (`Workspace.svelte`) prompts for a name on bank creation, validated
  client-side against the same charset before the round-trip; the bank
  `<select>` and delete button work off names, and delete is disabled on
  `"default"`.

The default bank stays auto-loading, so a cart that never calls `load_*_bank`
is unaffected.

### 2.6 Drop `dset` / `dget` — DONE, committed on `master`.

`save_data`/`load_data` is the one obvious way; the numeric-slot pair is
gone. Removed the `dset`/`dget` builtins from `lua_exec.rs`'s
`BUILTIN_NAMES` and `register_builtins`, and their entries from
`api_registry.rs`. `save_data.rs`'s `SaveData` dropped the 64-slot
`[f64; 64]` array and `get_slot`/`set_slot` entirely — nothing outside the
removed builtins used the numeric store, so there was no reason to keep it
alongside the blob. `SaveDataError::SlotOutOfRange` went with it, leaving
only `BlobTooLarge`.

The on-disk `SaveData::encode`/`decode` format lost its slot section
(`[magic][version][64×f64 slots][blob_len][blob]` →
`[magic][version][blob_len][blob]`), so `FORMAT_VERSION` bumped 1→2 —
otherwise an old file's leftover slot bytes would misparse as the blob
length. `decode` rejects any other version outright rather than
attempting a partial read; nothing is in production, so there's no
migration path, matching the same policy already applied to the cart
format in 2.5. `caiven-machine`'s and `caiven-studio`'s disk-persistence
tests (which had been round-tripping a value through `set_slot`/`get_slot`
as their marker) were rewritten to round-trip through the blob instead.

`docs/api-reference.md`'s Persistent Data table dropped the `dset`/`dget`
rows; the System Specifications pending-note now lists item 2.6 as landed.
No Studio Lua autocomplete list needed touching — Studio doesn't hardcode
a builtin-name list; it has no separate copy to drift.

### 2.7 Per-frame execution budget

- `crates/caiven-vm/src/vm/execution.rs` and `fault.rs` — an instruction-count
  hook that trips after a per-frame budget.
- Hook installation near the frame-call site in `lua_exec.rs`.
- Error surfaces with a line number and a plain-language message ("your game did
  not finish drawing this frame — is there a loop that never ends?"), not a Lua
  traceback.

Must not `unwrap`/`panic` on the fault path.

### 2.8 Optional `w` / `h` on `sprite()`

- `crates/caiven-vm/src/vm/lua_exec.rs:869` — two optional trailing args in
  sprite units (not pixels), defaulting to 1 × 1.
- `crates/caiven-vm/src/vm/api_registry.rs:50` and the renderer's blit loop.
- Docs mention it only in the section where a cart outgrows one sprite.

This is the tooling half of the 8×8 decision: a 16×16 hero draws in one call
while the hardware stays 8×8.

### 2.9 T2 module split — `collision`

Charter Appendix A: `collision.lua` is 147 lines, the only breach of the
readable-lesson cap, caused by `move_and_collide` and its slope solver
(lines 80-147).

- Keep the 6 predicates in `collision.lua` (~30 lines).
- Move the swept-movement solver to its own opt-in module.
- Update `caiven.toml` module lists, the api-reference stdlib tables, and any
  showcase cart that calls `move_and_collide`.

Split, do not cut, and do not raise the cap.

## Phase 3 — editors (Clock A)

Unlimited budget applies here. The map editor is already near TIC-80 parity
(zoom, pan, minimap, stamps, select/copy/paste, 64-deep undo, collision type
manager) — it needs finishing, not building. The **sprite editor is the weak
surface** and is the priority, because it is where the 8×8 hardware decision
gets paid for.

### 3.1 Sprite editor catch-up (priority)

`SpriteCanvas.svelte`, `Workspace.svelte:1171-1215`. Missing today: marquee
select, copy/paste between slots, an N × N group canvas spanning adjacent 8×8
slots, zoom, vertical flip, counter-clockwise rotate.

### 3.2 Map autotile and selection ops

Terrain/autotile brushes, reusable named stamps, in-place paste, move/rotate/
flip a selection, rectangle outline.

### 3.3 Music / SFX gaps

Step and pattern copy/paste, song order list, pattern chaining, plus the tracker
rework the 4 typed music channels from 2.4 require.

### 3.4 Keyboard-first editing

Arrow-key cursor and keyboard painting across all editors — everything is
mouse-only today. This is the single largest friction item for a returning user.

## Verification per phase

- `scripts/claude/check-rust.sh` after each Phase 2 item.
- `scripts/claude/check-cart-compat.sh` after 2.2, 2.4, and 2.5 (format changes).
- `scripts/claude/check-lua-api.sh` after 2.5, 2.6, 2.8, and 2.9.
- `scripts/claude/check-studio-ui.sh` after any Phase 3 item.
- `scripts/claude/pre-commit-gate.sh` as the final pass only.
- Every item: the showcase carts still run, and the numbers quoted in
  `README.md`, `docs/api-reference.md`, and `docs/product/design-charter.md`
  match the constants in `memory.rs` / `audio.rs`.
