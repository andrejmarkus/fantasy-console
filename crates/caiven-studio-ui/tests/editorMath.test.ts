import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collisionCellEdits, composeGroup, decomposeGroup, dragPanScroll, filledRectangle, flipHorizontal, flipVertical,
  floodCells, nextMapZoom, pasteRegion, rasterLine, regionFromPoints, regionValues, rotateClockwise,
  rotateCounterClockwise, sourceOffset, strokeCells,
} from '../src/lib/editorMath.ts';

test('rasterLine bridges skipped pointer cells', () => {
  assert.deepEqual(rasterLine(0, 3, 8), [0, 1, 2, 3]);
  assert.deepEqual(rasterLine(0, 27, 8), [0, 9, 18, 27]);
});

test('filledRectangle works in either drag direction', () => {
  assert.deepEqual(filledRectangle(9, 0, 8), [0, 1, 8, 9]);
});

test('floodCells stops at tile boundaries and map edges', () => {
  const map = [0, 0, 2, 0, 2, 2, 0, 0, 2];
  assert.deepEqual(
    floodCells(map, 0, 7, 3, 3).map((cell) => cell.offset).sort((a, b) => a - b),
    [0, 1, 3, 6, 7],
  );
  assert.deepEqual(floodCells(map, 2, 2, 3, 3), []);
});

test('mouse wheel zoom changes continuously and clamps at limits', () => {
  const zoomedIn = nextMapZoom(1, -120);
  const zoomedOut = nextMapZoom(1, 120);
  assert.ok(zoomedIn > 1 && zoomedIn < 1.5);
  assert.ok(zoomedOut < 1 && zoomedOut > 0.5);
  assert.equal(nextMapZoom(4, -1_000), 4);
  assert.equal(nextMapZoom(0.5, 1_000), 0.5);
  assert.equal(nextMapZoom(2, 0), 2);
});

test('right-button drag pans map opposite pointer movement', () => {
  assert.equal(dragPanScroll(200, 100, 140), 160);
  assert.equal(dragPanScroll(200, 100, 60), 240);
});

test('source navigation resolves exact one-based line and column', () => {
  const source = 'local x = 1\n  sprite(7, x, 8)\nreturn x';
  assert.equal(sourceOffset(source, 2, 3), 14);
  assert.equal(sourceOffset(source, 99, 99), source.length);
  assert.equal(sourceOffset(source, 0, 0), 0);
});

test('collision cell edits only report cells whose brush value actually changes', () => {
  const collision = [0, 0, 1, 2];
  assert.deepEqual(collisionCellEdits(collision, [0, 1, 2, 3], 1), [
    { offset: 0, value: 1 },
    { offset: 1, value: 1 },
    { offset: 3, value: 1 },
  ]);
  assert.deepEqual(collisionCellEdits(collision, [2], 1), []);
});

test('strokeCells: pencil/erase bridges from previous point, or is a dot with no previous', () => {
  assert.deepEqual(strokeCells('pencil', 0, 3, 0, [], 1, 8, 8), [0, 1, 2, 3]);
  assert.deepEqual(strokeCells('erase', 0, 5, null, [], 0, 8, 8), [5]);
});

test('strokeCells: line recomputes from anchor each call for live preview', () => {
  assert.deepEqual(strokeCells('line', 0, 3, 1, [], 1, 8, 8), [0, 1, 2, 3]);
  assert.deepEqual(strokeCells('line', 0, 27, 99, [], 1, 8, 8), [0, 9, 18, 27]);
});

test('strokeCells: rect is filled between anchor and current', () => {
  assert.deepEqual(strokeCells('rect', 9, 0, null, [], 1, 8, 8), [0, 1, 8, 9]);
});

test('strokeCells: fill floods from current using values/replacement, ignoring anchor/previous', () => {
  const map = [0, 0, 2, 0, 2, 2, 0, 0, 2];
  assert.deepEqual(
    strokeCells('fill', 99, 0, null, map, 7, 3, 3).sort((a, b) => a - b),
    [0, 1, 3, 6, 7],
  );
});

test('regionFromPoints normalizes either drag direction into x0/y0/w/h', () => {
  assert.deepEqual(regionFromPoints(0, 0, 8), { x0: 0, y0: 0, w: 1, h: 1 });
  assert.deepEqual(regionFromPoints(9, 0, 8), { x0: 0, y0: 0, w: 2, h: 2 });
  assert.deepEqual(regionFromPoints(0, 9, 8), { x0: 0, y0: 0, w: 2, h: 2 });
});

test('regionValues reads a sub-rectangle row by row', () => {
  const grid = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // 3x3
  assert.deepEqual(regionValues(grid, { x0: 1, y0: 0, w: 2, h: 2 }, 3), [2, 3, 5, 6]);
});

test('pasteRegion clips a patch against the target grid bounds', () => {
  const edits = pasteRegion(2, 2, 2, 2, [1, 2, 3, 4], 3, 3);
  assert.deepEqual(edits, [{ index: 8, value: 1 }]); // only (2,2) is in-bounds
});

test('flipHorizontal and flipVertical mirror a rectangular grid', () => {
  const grid = [1, 2, 3, 4, 5, 6]; // 3x2
  assert.deepEqual(flipHorizontal(grid, 3, 2), [3, 2, 1, 6, 5, 4]);
  assert.deepEqual(flipVertical(grid, 3, 2), [4, 5, 6, 1, 2, 3]);
});

test('rotateClockwise and rotateCounterClockwise are inverses on a square grid', () => {
  const grid = [1, 2, 3, 4]; // 2x2
  const cw = rotateClockwise(grid, 2, 2);
  assert.deepEqual(cw, [3, 1, 4, 2]);
  assert.deepEqual(rotateCounterClockwise(cw, 2, 2), grid);
});

test('composeGroup/decomposeGroup round-trip a multi-slot sprite-sheet block', () => {
  const sheetCols = 4;
  const sheet = new Array(16 * 64).fill(0);
  // Slot 0 (top-left) gets pixel (0,0)=9; slot 1 (top-right of the 2x1 group) gets pixel (0,0)=3.
  sheet[0] = 9;
  sheet[1 * 64] = 3;
  const group = composeGroup(sheet, 0, 2, 1, sheetCols);
  assert.equal(group.length, 16 * 8);
  assert.equal(group[0], 9); // slot 0's (0,0)
  assert.equal(group[8], 3); // slot 1 starts at group x=8

  const parts = decomposeGroup(group, 0, 2, 1, sheetCols);
  assert.deepEqual(parts.map((p) => p.slot), [0, 1]);
  assert.equal(parts[0].pixels[0], 9);
  assert.equal(parts[1].pixels[0], 3);
});
