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

### 2.4 Audio 8 voices → 6 typed voices

- `crates/caiven-vm/src/vm/audio.rs:15-28` — `VOICE_COUNT` 8 → 6; replace
  `MUSIC_VOICE_CH0`/`CH1`, `LEGACY_SFX_VOICE`, `SFX_POOL_START`/`LEN` with 4
  typed music voices (2 pulse, 1 triangle, 1 noise) and 2 reserved sfx voices.
- **Delete** `LEGACY_SFX_VOICE` and its call path — do not keep it working.
- `crates/caiven-vm/src/vm/sfx.rs` and `play_sfx` / `play_music` semantics.
- **Format change:** 2 → 4 music channels means 4 bytes per row, 64 bytes per
  pattern, so `memory.rs:58` `MUSIC_BANK_LEN` 256 → 512 and the music region
  widens. Cart music sections change shape.
- Studio tracker UI wires only 2 channels today; 4 typed columns is a real UI
  change and may be split into its own diff under 3.3.

Test: an sfx played while music runs never silences a music channel.

### 2.5 Named banks

Numeric ids removed, not aliased.

- `crates/caiven-vm/src/vm/lua_exec.rs:1266-1336` — the five `load_*_bank`
  builtins take a string name.
- `crates/caiven-vm/src/vm/mod.rs:42-91` — bank maps keyed by name instead of
  `u8`; the Map → Collision companion rule follows the name.
- `crates/caiven-cart/src/section.rs:112-126` — payload is currently
  `[bank_id u8][data…]`; becomes a length-prefixed name plus data. Validate the
  name (length cap, allowed characters) at decode time — this is a cart-format
  boundary and untrusted input.
- `crates/caiven-cart/src/project.rs:139-152` — project filenames
  `sprites_1.png` → `sprites_forest.png`; sanitise names against path traversal
  when mapping name to filename.
- `crates/caiven-vm/src/vm/api_registry.rs` — signatures and doc strings.
- Studio bank picker in `Workspace.svelte`.

The default bank stays auto-loading, so a cart that never calls `load_*_bank`
is unaffected.

### 2.6 Drop `dset` / `dget`

- `crates/caiven-vm/src/vm/lua_exec.rs:87-88` and `:1446-1470` — remove both
  builtins.
- `crates/caiven-vm/src/vm/api_registry.rs` — remove entries.
- `crates/caiven-vm/src/vm/save_data.rs` — remove the numeric slot store if
  nothing else uses it; keep the blob path.
- `docs/api-reference.md:69-70` — remove the rows.
- Studio Lua autocomplete list.

`save_data`/`load_data` is the one obvious way.

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
