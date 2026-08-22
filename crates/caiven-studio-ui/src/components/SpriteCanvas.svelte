<script lang="ts">
  import { onDestroy } from 'svelte';
  import { regionFromPoints, strokeCells, type PixelRegion, type StrokeTool } from '../lib/editorMath';

  export type SpriteTool = StrokeTool | 'pick' | 'select';
  export type Pixel = { index: number; color: number };

  interface Props {
    sprite: number[];
    /** Group size in adjacent 8x8 slots — {1,1} is a plain single sprite,
     *  same as before the group canvas existed. `sprite` must be
     *  `(cols*8) * (rows*8)` pixels, row-major. */
    cols?: number;
    rows?: number;
    /** Display scale on top of the base fit-to-container size. */
    zoom?: number;
    palette: string[];
    selectedColor: number;
    tool: SpriteTool;
    onStroke: (pixels: Pixel[]) => void;
    onPick: (color: number) => void;
    /** The 'select' tool's marquee, in group-pixel coordinates; null once
     *  cleared or when a different tool is active. */
    onSelectionChange?: (region: PixelRegion | null) => void;
  }

  const { sprite, cols = 1, rows = 1, zoom = 1, palette, selectedColor, tool, onStroke, onPick, onSelectionChange }: Props = $props();

  const CELL = 32;
  const width = $derived(cols * 8);
  const height = $derived(rows * 8);

  let canvas: HTMLCanvasElement;
  let drawing = false;
  let anchor: number | null = null;
  let previousPixel: number | null = null;
  let draft = new Map<number, number>();
  let renderFrame: number | undefined;
  let selectAnchor = $state<number | null>(null);
  let selectCurrent = $state<number | null>(null);
  const selectRegion = $derived.by((): PixelRegion | null => {
    if (selectAnchor === null || selectCurrent === null) return null;
    return regionFromPoints(selectAnchor, selectCurrent, width);
  });

  $effect(() => {
    if (tool !== 'select') { selectAnchor = null; selectCurrent = null; }
  });

  $effect(() => {
    onSelectionChange?.(selectRegion);
  });

  function color(hex: string): [number, number, number, number] {
    const value = hex || '#000000';
    return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16), 255];
  }

  function render() {
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const colors = palette.map(color);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = draft.get(index) ?? sprite[index] ?? 0;
      const rgba = colors[value] ?? colors[0] ?? [0, 0, 0, 255];
      context.fillStyle = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`;
      context.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // Coalesces redraws triggered by prop changes (bank switch, external sprite edits) that
  // aren't already followed by a direct render() call. Not requestAnimationFrame: WKWebView's
  // native mouse-tracking run loop (active for the whole time a button is held) starves rAF's
  // display-link callback, so a deferred rAF redraw can silently stall for seconds — confirmed
  // by instrumentation. setTimeout keeps running in that mode.
  function scheduleRender() {
    if (!canvas || renderFrame !== undefined) return;
    renderFrame = window.setTimeout(() => {
      renderFrame = undefined;
      render();
    }, 16);
  }

  $effect(() => {
    sprite; palette; draft; canvas; width; height;
    scheduleRender();
  });

  onDestroy(() => {
    if (renderFrame !== undefined) clearTimeout(renderFrame);
  });

  function pointerPixel(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * height)));
    return y * width + x;
  }

  function activeColor() {
    return tool === 'erase' ? 0 : selectedColor;
  }

  function applyStroke(at: number) {
    const drawTool: StrokeTool = tool === 'pick' || tool === 'select' ? 'pencil' : tool;
    const offsets = strokeCells(drawTool, anchor ?? at, at, previousPixel, sprite, activeColor(), width, height);
    // line/rect recompute the whole shape from anchor each move (live preview), so the
    // draft is replaced rather than accumulated; pencil/erase/fill accumulate across a drag.
    const next = tool === 'line' || tool === 'rect' ? new Map<number, number>() : new Map(draft);
    for (const offset of offsets) next.set(offset, activeColor());
    draft = next;
  }

  function pick(at: number) {
    onPick(sprite[at] ?? 0);
  }

  function begin(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    const at = pointerPixel(event);
    if (event.button === 2 || event.ctrlKey || tool === 'pick') {
      pick(at);
      return;
    }
    if (tool === 'select') {
      selectAnchor = at;
      selectCurrent = at;
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    draft = new Map();
    anchor = at;
    previousPixel = at;
    drawing = true;
    if (tool === 'fill') {
      applyStroke(at);
      finish(event);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    applyStroke(at);
    render(); // paint inline — see move() for why this can't wait for scheduleRender()
  }

  function move(event: PointerEvent) {
    if (!drawing) return;
    const at = pointerPixel(event);
    if (tool === 'select') {
      selectCurrent = at;
      return;
    }
    // Paints happen synchronously, in the pointer handler itself, rather than deferring to
    // scheduleRender()'s timer: the timer callback still *runs* while the mouse button is
    // held, but WKWebView doesn't actually composite/flush the canvas to screen again until
    // the native tracking loop ends — confirmed by comparing a scheduled render (invisible
    // for the whole drag) against a synchronous one (paints every move) in the same build.
    if (tool === 'rect' || tool === 'line') {
      applyStroke(at);
      render();
    } else if ((tool === 'pencil' || tool === 'erase') && previousPixel !== at) {
      applyStroke(at);
      previousPixel = at;
      render();
    }
  }

  function finish(event?: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    if (tool !== 'select') {
      const pixels = [...draft].map(([index, value]) => ({ index, color: value }));
      if (pixels.length) onStroke(pixels);
      draft = new Map();
    }
    anchor = null;
    previousPixel = null;
    if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
</script>

<div
  class="sprite-canvas-scroll"
  data-sprite-canvas-scroll
  style={`--sprite-cols:${cols}; --sprite-rows:${rows}; --sprite-zoom:${zoom}`}
>
  <div class="sprite-canvas-wrap" data-sprite-canvas>
    <canvas
      bind:this={canvas}
      class="sprite-canvas"
      class:picking={tool === 'pick'}
      class:erasing={tool === 'erase'}
      width={width * CELL}
      height={height * CELL}
      aria-label={`${width} by ${height} sprite grid`}
      onpointerdown={begin}
      onpointermove={move}
      onpointerup={finish}
      onpointercancel={finish}
      onlostpointercapture={finish}
      oncontextmenu={(event) => event.preventDefault()}
    ></canvas>
    <div class="sprite-grid-overlay" aria-hidden="true"></div>
    {#if cols > 1 || rows > 1}
      <div class="sprite-slot-overlay" aria-hidden="true"></div>
    {/if}
    {#if selectRegion}
      <div
        class="sprite-selection"
        aria-hidden="true"
        style={`left:${(selectRegion.x0 / width) * 100}%; top:${(selectRegion.y0 / height) * 100}%; width:${(selectRegion.w / width) * 100}%; height:${(selectRegion.h / height) * 100}%`}
      ></div>
    {/if}
  </div>
</div>

<style>
  .sprite-canvas-scroll { width: min(512px, 100%, calc(100vh - 390px)); aspect-ratio: var(--sprite-cols) / var(--sprite-rows); overflow: auto; border-radius: 8px; }
  .sprite-canvas-wrap {
    position: relative;
    width: calc(100% * var(--sprite-zoom));
    aspect-ratio: var(--sprite-cols) / var(--sprite-rows);
    border: 1px solid var(--color-void-600); border-radius: 8px; box-shadow: var(--shadow-lg); background: #000;
  }
  .sprite-canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; cursor: crosshair; touch-action: none; }
  .sprite-canvas.picking { cursor: copy; }
  .sprite-canvas.erasing { cursor: not-allowed; }
  .sprite-grid-overlay {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(96,94,94,.35) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(96,94,94,.35) 1px, transparent 1px);
    background-size: calc(100% / var(--sprite-cols) / 8) 100%, 100% calc(100% / var(--sprite-rows) / 8);
  }
  /* Heavier lines at each slot boundary, so a multi-slot group canvas still reads as N sprites. */
  .sprite-slot-overlay {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(245,242,242,.35) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(245,242,242,.35) 1px, transparent 1px);
    background-size: calc(100% / var(--sprite-cols)) 100%, 100% calc(100% / var(--sprite-rows));
  }
  .sprite-selection { position: absolute; border: 1px dashed var(--color-ember); background: rgba(254,176,93,.12); pointer-events: none; }
</style>
