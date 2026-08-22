export interface MapCell { offset: number; tile: number; }

export const MAP_ZOOM_LEVELS = [0.5, 1, 2, 4] as const;

export function nextMapZoom(current: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return current;
  const next = current * Math.exp(-deltaY * 0.0015);
  return Math.max(MAP_ZOOM_LEVELS[0], Math.min(MAP_ZOOM_LEVELS.at(-1)!, next));
}

export function dragPanScroll(startScroll: number, startPointer: number, currentPointer: number): number {
  return startScroll + startPointer - currentPointer;
}

/** A collision-type id (u8) — the domain is whatever the cart's collision-type table defines, not a fixed enum. */
export type CollisionBrush = number;
export interface CollisionEdit { offset: number; value: number; }

export function collisionCellEdits(
  collision: readonly number[], offsets: readonly number[], brush: CollisionBrush,
): CollisionEdit[] {
  const edits = new Map<number, number>();
  for (const offset of offsets) {
    const before = collision[offset] ?? 0;
    if (before !== brush) edits.set(offset, brush);
  }
  return [...edits].map(([offset, value]) => ({ offset, value }));
}

export function sourceOffset(source: string, line: number, column = 1): number {
  const lines = source.split('\n');
  const targetLine = Math.max(1, Math.min(lines.length, Math.trunc(line) || 1));
  let offset = 0;
  for (let index = 0; index < targetLine - 1; index += 1) offset += lines[index].length + 1;
  const lineText = lines[targetLine - 1] ?? '';
  const targetColumn = Math.max(1, Math.min(lineText.length + 1, Math.trunc(column) || 1));
  return offset + targetColumn - 1;
}

export function rasterLine(from: number, to: number, width: number): number[] {
  const cells: number[] = [];
  let x0 = from % width;
  let y0 = Math.floor(from / width);
  const x1 = to % width;
  const y1 = Math.floor(to / width);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    cells.push(y0 * width + x0);
    if (x0 === x1 && y0 === y1) break;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
  return cells;
}

export function filledRectangle(from: number, to: number, width: number): number[] {
  const x0 = from % width;
  const y0 = Math.floor(from / width);
  const x1 = to % width;
  const y1 = Math.floor(to / width);
  const cells: number[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) cells.push(y * width + x);
  }
  return cells;
}

export type StrokeTool = 'pencil' | 'line' | 'rect' | 'fill' | 'erase';

export function strokeCells(
  tool: StrokeTool,
  anchor: number,
  current: number,
  previous: number | null,
  values: readonly number[],
  replacement: number,
  width: number,
  height: number,
): number[] {
  switch (tool) {
    case 'pencil':
    case 'erase':
      return rasterLine(previous ?? current, current, width);
    case 'line':
      return rasterLine(anchor, current, width);
    case 'rect':
      return filledRectangle(anchor, current, width);
    case 'fill':
      return floodCells(values, current, replacement, width, height).map((cell) => cell.offset);
    default:
      return [];
  }
}

export interface PixelRegion { x0: number; y0: number; w: number; h: number; }

/** Marquee rectangle from two grid indices (any drag direction), for the
 *  select tool shared by the map and sprite editors. */
export function regionFromPoints(anchor: number, current: number, width: number): PixelRegion {
  const ax = anchor % width, ay = Math.floor(anchor / width);
  const cx = current % width, cy = Math.floor(current / width);
  const x0 = Math.min(ax, cx), x1 = Math.max(ax, cx);
  const y0 = Math.min(ay, cy), y1 = Math.max(ay, cy);
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Reads a region out of a flat width-major grid, row by row. */
export function regionValues(values: readonly number[], region: PixelRegion, width: number): number[] {
  const out: number[] = [];
  for (let dy = 0; dy < region.h; dy += 1) for (let dx = 0; dx < region.w; dx += 1) {
    out.push(values[(region.y0 + dy) * width + (region.x0 + dx)] ?? 0);
  }
  return out;
}

/** Places a patch (row-major, `patch.length === w*h`) at `x0,y0` in a
 *  width×height grid, clipping anything that would fall outside it. */
export function pasteRegion(
  x0: number, y0: number, w: number, h: number, patch: readonly number[], width: number, height: number,
): { index: number; value: number }[] {
  const edits: { index: number; value: number }[] = [];
  for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    edits.push({ index: y * width + x, value: patch[dy * w + dx] ?? 0 });
  }
  return edits;
}

export function flipHorizontal(values: readonly number[], width: number, height: number): number[] {
  const out = new Array(width * height).fill(0);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    out[y * width + (width - 1 - x)] = values[y * width + x] ?? 0;
  }
  return out;
}

export function flipVertical(values: readonly number[], width: number, height: number): number[] {
  const out = new Array(width * height).fill(0);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    out[(height - 1 - y) * width + x] = values[y * width + x] ?? 0;
  }
  return out;
}

/** Only meaningful for a square grid (width === height) — callers must not
 *  offer rotate on a non-square sprite group, since the result would need a
 *  different-shaped canvas. */
export function rotateClockwise(values: readonly number[], width: number, height: number): number[] {
  const out = new Array(width * height).fill(0);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    out[x * height + (height - 1 - y)] = values[y * width + x] ?? 0;
  }
  return out;
}

export function rotateCounterClockwise(values: readonly number[], width: number, height: number): number[] {
  const out = new Array(width * height).fill(0);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    out[(width - 1 - x) * height + y] = values[y * width + x] ?? 0;
  }
  return out;
}

/** Composes an N×M block of adjacent sprite-sheet slots into one flat pixel
 *  grid, `(slotsW*8) × (slotsH*8)`, so the group can be edited as one canvas. */
export function composeGroup(
  sheet: readonly number[], originSlot: number, slotsW: number, slotsH: number, sheetCols: number,
): number[] {
  const width = slotsW * 8;
  const out = new Array(width * slotsH * 8).fill(0);
  const originX = originSlot % sheetCols, originY = Math.floor(originSlot / sheetCols);
  for (let sy = 0; sy < slotsH; sy += 1) for (let sx = 0; sx < slotsW; sx += 1) {
    const slot = (originY + sy) * sheetCols + (originX + sx);
    for (let py = 0; py < 8; py += 1) for (let px = 0; px < 8; px += 1) {
      out[(sy * 8 + py) * width + (sx * 8 + px)] = sheet[slot * 64 + py * 8 + px] ?? 0;
    }
  }
  return out;
}

/** Inverse of {@link composeGroup} — splits an edited group canvas back into
 *  per-slot 64-pixel arrays, ready for one `onSprite` call per slot. */
export function decomposeGroup(
  pixels: readonly number[], originSlot: number, slotsW: number, slotsH: number, sheetCols: number,
): { slot: number; pixels: number[] }[] {
  const width = slotsW * 8;
  const originX = originSlot % sheetCols, originY = Math.floor(originSlot / sheetCols);
  const out: { slot: number; pixels: number[] }[] = [];
  for (let sy = 0; sy < slotsH; sy += 1) for (let sx = 0; sx < slotsW; sx += 1) {
    const slot = (originY + sy) * sheetCols + (originX + sx);
    const slotPixels = new Array(64).fill(0);
    for (let py = 0; py < 8; py += 1) for (let px = 0; px < 8; px += 1) {
      slotPixels[py * 8 + px] = pixels[(sy * 8 + py) * width + (sx * 8 + px)] ?? 0;
    }
    out.push({ slot, pixels: slotPixels });
  }
  return out;
}

export function floodCells(
  values: readonly number[], start: number, replacement: number, width: number, height: number,
): MapCell[] {
  const target = values[start] ?? 0;
  if (target === replacement) return [];
  const cells: MapCell[] = [];
  const queue = [start];
  const seen = new Set<number>();
  while (queue.length) {
    const cell = queue.pop()!;
    if (seen.has(cell) || (values[cell] ?? 0) !== target) continue;
    seen.add(cell);
    cells.push({ offset: cell, tile: replacement });
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (x > 0) queue.push(cell - 1);
    if (x + 1 < width) queue.push(cell + 1);
    if (y > 0) queue.push(cell - width);
    if (y + 1 < height) queue.push(cell + width);
  }
  return cells;
}
