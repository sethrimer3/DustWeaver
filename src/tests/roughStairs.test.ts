/**
 * Rough Stair block shape tests.
 *
 * A rough stair is a single 1x1 block with one quadrant removed (75% solid).
 * It reuses the stairs step-rectangle collision resolver and the ordinary
 * single-block step-up mechanism — see `levels/stairsGeometry.ts`'s module
 * doc comment for the orientation convention this file exercises.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

import {
  getRoughStairSolidRects,
  isRoughStairSolidAtLocalPx,
  roughStairMaskPatternRows,
  encodeRoughStairOrientationIndex,
  decodeRoughStairOrientationIndex,
  isRoughStairOrientationIndex,
  isStairsOrientationIndex,
  isRampOrientationIndex,
  isPlainRectOrientationIndex,
  wallShapeOrientationIndex,
  SHAPE_ORIENTATION_NONE,
} from '../levels/stairsGeometry';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { resolveStairsSurfaces } from '../sim/clusters/movementStairsCollision';
import { applyClusterMovement } from '../sim/clusters/movement';
import { aabbOverlapsWallSolid, forEachWallSolidRect, isStairsWall } from '../sim/stairsWorldGeometry';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';

// ── Template PNG decoding (mirrors stairs.test.ts) ────────────────────────────

const TEMPLATE_DIR = path.resolve('ASSETS/SPRITES/BLOCKS/block_templates');

function decodePngAlphaRows(filePath: string): { width: number; height: number; rows: string[] } {
  const buf = fs.readFileSync(filePath);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  let bitDepth = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    }
    offset += 12 + length;
  }

  assert.equal(bitDepth, 8, `${filePath}: expected 8-bit depth`);
  assert.equal(colourType, 6, `${filePath}: expected RGBA colour type`);

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) line += out[y * stride + x * 4 + 3] > 0 ? '#' : '.';
    rows.push(line);
  }
  return { width, height, rows };
}

// ── Template matches the geometry module ──────────────────────────────────────

test('rough stair template exists and decodes at 8x8', () => {
  const file = path.join(TEMPLATE_DIR, '1x1 rough stair', '1x1 rough stair_template.png');
  assert.ok(fs.existsSync(file), `missing template: ${file}`);
  const decoded = decodePngAlphaRows(file);
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 8);
});

test('generated rough stair mask matches the authored template PNG pixel-for-pixel', () => {
  const file = path.join(TEMPLATE_DIR, '1x1 rough stair', '1x1 rough stair_template.png');
  const decoded = decodePngAlphaRows(file);
  const generated = roughStairMaskPatternRows(0, 8, 8);
  assert.deepEqual(generated, decoded.rows);
});

// ── Geometry: four orientations occupy the correct quadrants ──────────────────

test('orientation 0 (top-left absent) leaves exactly the top-left quadrant empty', () => {
  assert.deepEqual(roughStairMaskPatternRows(0, 8, 8), [
    '....####',
    '....####',
    '....####',
    '....####',
    '########',
    '########',
    '########',
    '########',
  ]);
});

test('orientation 1 (top-right absent) is the X-mirror of orientation 0', () => {
  const base = roughStairMaskPatternRows(0, 8, 8);
  const flipX = roughStairMaskPatternRows(1, 8, 8);
  assert.deepEqual(flipX, base.map(r => [...r].reverse().join('')));
  assert.deepEqual(flipX, [
    '####....',
    '####....',
    '####....',
    '####....',
    '########',
    '########',
    '########',
    '########',
  ]);
});

test('orientation 2 (bottom-left absent) is the Y-mirror of orientation 0 — flat top, stepped underside', () => {
  const base = roughStairMaskPatternRows(0, 8, 8);
  const flipY = roughStairMaskPatternRows(2, 8, 8);
  assert.deepEqual(flipY, [...base].reverse());
  assert.deepEqual(flipY, [
    '########',
    '########',
    '########',
    '########',
    '....####',
    '....####',
    '....####',
    '....####',
  ]);
  // Top row is fully solid on both sides — no foot-level riser to climb.
  assert.equal(flipY[0], '########');
});

test('orientation 3 (bottom-right absent) mirrors both axes of orientation 0', () => {
  const base = roughStairMaskPatternRows(0, 8, 8);
  const flipBoth = roughStairMaskPatternRows(3, 8, 8);
  assert.deepEqual(flipBoth, [...base].reverse().map(r => [...r].reverse().join('')));
  assert.equal(flipBoth[0], '########');
});

test('the absent quadrant is genuinely non-solid, not approximated as a rectangle or slope', () => {
  // Orientation 0: top-left quadrant (x<4, y<4) must be empty; every other
  // pixel in the block solid — no diagonal falloff, no partial values.
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const expected = !(x < 4 && y < 4);
      assert.equal(isRoughStairSolidAtLocalPx(0, 8, 8, x, y), expected, `(${x},${y})`);
    }
  }
});

// ── Solid rectangle decomposition ──────────────────────────────────────────────

test('rough stair rects cover exactly the solid mask cells and nothing else, for all orientations', () => {
  for (const ori of [0, 1, 2, 3] as const) {
    const rects = getRoughStairSolidRects(ori, 8, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const inRect = rects.some(r => x >= r.xPx && x < r.xPx + r.wPx && y >= r.yPx && y < r.yPx + r.hPx);
        const inMask = isRoughStairSolidAtLocalPx(ori, 8, 8, x, y);
        assert.equal(inRect, inMask, `ori=${ori} at (${x},${y})`);
      }
    }
  }
});

test('rough stair decomposes into exactly 2 rectangles (an L-shape), not one per pixel', () => {
  for (const ori of [0, 1, 2, 3] as const) {
    assert.equal(getRoughStairSolidRects(ori, 8, 8).length, 2);
  }
});

// ── Orientation index encoding ─────────────────────────────────────────────────

test('rough stair orientation slot partitions cleanly from ramps, stairs, and plain rects', () => {
  for (const ori of [0, 1, 2, 3] as const) {
    const encoded = encodeRoughStairOrientationIndex(ori);
    assert.equal(isRoughStairOrientationIndex(encoded), true);
    assert.equal(isStairsOrientationIndex(encoded), false);
    assert.equal(isRampOrientationIndex(encoded), false);
    assert.equal(isPlainRectOrientationIndex(encoded), false);
    assert.equal(decodeRoughStairOrientationIndex(encoded), ori);
  }
  assert.equal(isRoughStairOrientationIndex(SHAPE_ORIENTATION_NONE), false);
  assert.equal(isPlainRectOrientationIndex(SHAPE_ORIENTATION_NONE), true);
});

test('wallShapeOrientationIndex packs roughStairOrientation', () => {
  assert.equal(wallShapeOrientationIndex({ roughStairOrientation: 2 }), encodeRoughStairOrientationIndex(2));
  // stairsOrientation still wins if a hand-edited room sets both.
  assert.equal(wallShapeOrientationIndex({ stairsOrientation: 1, roughStairOrientation: 2 }),
    wallShapeOrientationIndex({ stairsOrientation: 1 }));
});

// ── World-space collision dispatch ─────────────────────────────────────────────

function addRoughStairWall(world: ReturnType<typeof createWorldState>, x: number, y: number, ori: 0 | 1 | 2 | 3 = 0): number {
  const wi = world.wallCount++;
  world.wallXWorld[wi] = x;
  world.wallYWorld[wi] = y;
  world.wallWWorld[wi] = BLOCK_SIZE_SMALL;
  world.wallHWorld[wi] = BLOCK_SIZE_SMALL;
  world.wallIsPlatformFlag[wi] = 0;
  world.wallRampOrientationIndex[wi] = encodeRoughStairOrientationIndex(ori);
  return wi;
}

test('a rough stair wall is recognised and decomposed into 2 rects, not one bounding rect', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = addRoughStairWall(world, 0, 0);
  assert.equal(isStairsWall(world, wi), true);
  const rects: number[][] = [];
  forEachWallSolidRect(world, wi, (x0, y0, x1, y1) => rects.push([x0, y0, x1, y1]));
  assert.equal(rects.length, 2);
});

test('rough stair collision respects mask solidity, not the full bounding rectangle', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = addRoughStairWall(world, 0, 0);
  assert.equal(aabbOverlapsWallSolid(world, wi, 5, 5, 7, 7), true);
  assert.equal(aabbOverlapsWallSolid(world, wi, 0, 0, 2, 2), false);
});

test('an existing rectangular wall is unaffected by rough stair dispatch', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0;
  world.wallYWorld[wi] = 0;
  world.wallWWorld[wi] = 8;
  world.wallHWorld[wi] = 8;
  world.wallIsPlatformFlag[wi] = 0;
  world.wallRampOrientationIndex[wi] = SHAPE_ORIENTATION_NONE;
  assert.equal(isStairsWall(world, wi), false);
  assert.equal(aabbOverlapsWallSolid(world, wi, 0, 0, 2, 2), true);
});

// ── Player collision against the stepped profile ───────────────────────────────

test('a falling player lands on the tall side of a rough stair (orientation 0)', () => {
  const world = createWorldState(1000 / 60, 1);
  addRoughStairWall(world, 0, 0, 0); // tall side on the right (x=4..8)

  const player = createClusterState(0, 6, 0, 1, 100);
  const hh = player.halfHeightWorld;
  const prevY = -hh - 1;
  player.positionYWorld = 0 - hh + 0.5;
  player.velocityYWorld = 4;

  const landed = resolveStairsSurfaces(player, world, 6, prevY);
  assert.equal(landed, true);
  assert.equal(player.isGroundedFlag, 1);
  assert.equal(player.velocityYWorld, 0);
  assert.ok(Math.abs((player.positionYWorld + hh) - 0) < 1e-6, 'should rest on the full-height top at y=0');
});

test('a falling player lands on the low ledge of a rough stair (orientation 0)', () => {
  const world = createWorldState(1000 / 60, 1);
  addRoughStairWall(world, 0, 0, 0); // ledge on the left, top at y=4

  const player = createClusterState(0, 2, 0, 1, 100);
  const hh = player.halfHeightWorld;
  const prevY = 4 - hh - 1;
  player.positionYWorld = 4 - hh + 0.5;
  player.velocityYWorld = 4;

  const landed = resolveStairsSurfaces(player, world, 2, prevY);
  assert.equal(landed, true);
  assert.equal(player.isGroundedFlag, 1);
  assert.ok(Math.abs((player.positionYWorld + hh) - 4) < 1e-6, 'should rest on the ledge top at y=4');
});

test('a body inside a rough stair AABB but in its empty quadrant is not pushed', () => {
  const world = createWorldState(1000 / 60, 1);
  addRoughStairWall(world, 0, 0, 0);
  const body = createClusterState(0, 2, 2, 0, 100);
  body.halfWidthWorld = 1;
  body.halfHeightWorld = 1;
  body.velocityYWorld = 0;
  const beforeX = body.positionXWorld;
  const beforeY = body.positionYWorld;
  const landed = resolveStairsSurfaces(body, world, beforeX, beforeY);
  assert.equal(landed, false);
  assert.equal(body.positionXWorld, beforeX);
  assert.equal(body.positionYWorld, beforeY);
});

// ── Auto-climb via the real movement loop ──────────────────────────────────────

test('walking into the tall side of a floor rough stair auto-climbs without jump input, preserving horizontal motion', () => {
  const world = createWorldState();
  world.dtMs = 1000 / 60;
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 100;

  // Orientation 0: ledge (top at y=floorY-4) on the left, full-height (top at
  // y=floorY-8) on the right — walking right climbs a half-block riser.
  const floorTop = world.worldHeightWorld - BLOCK_SIZE_SMALL;
  addRoughStairWall(world, 40, floorTop, 0);

  const player = createClusterState(1, 20, 0, 0, 100);
  player.isPlayerFlag = 1;
  player.positionYWorld = floorTop + BLOCK_SIZE_SMALL / 2 - player.halfHeightWorld; // resting on the ledge height
  player.isGroundedFlag = 1;
  world.clusters.push(player);

  let jumpAnimTriggered = false;

  for (let tick = 0; tick < 60; tick++) {
    world.playerMoveInputDxWorld = 1;
    // No jump input at any point in this traversal.
    applyClusterMovement(world);
    if (player.velocityYWorld < -1) jumpAnimTriggered = true; // an upward launch would look like a jump
    if (player.positionXWorld > 40 + BLOCK_SIZE_SMALL) break;
  }

  assert.ok(player.positionXWorld > 40 + BLOCK_SIZE_SMALL,
    `player should cross onto the tall side, got x=${player.positionXWorld}`);
  assert.equal(player.isGroundedFlag, 1, 'player should stay grounded through the climb');
  assert.ok(!jumpAnimTriggered, 'no artificial upward launch velocity should occur');
  // Resting on the tall side's top face (y = floorTop).
  assert.ok(Math.abs((player.positionYWorld + player.halfHeightWorld) - floorTop) < 1e-6,
    `expected to rest at y=${floorTop}, got ${player.positionYWorld + player.halfHeightWorld}`);
});

test('a ceiling rough stair (orientation 2) does not auto-climb — its top surface is flat', () => {
  const world = createWorldState();
  world.dtMs = 1000 / 60;
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 100;

  // Orientation 2 (bottom-left absent): flat top at floorTop, stepped underside.
  // Standing on top and walking across it should never trigger a step-up pop
  // since there is no foot-level riser — verified indirectly by confirming
  // ground level never changes while walking across the block's top.
  const floorTop = 40;
  addRoughStairWall(world, 40, floorTop, 2);
  // Floor to stand on before/after the rough stair block, at the same height.
  const wiFloorLeft = world.wallCount++;
  world.wallXWorld[wiFloorLeft] = 0;
  world.wallYWorld[wiFloorLeft] = floorTop;
  world.wallWWorld[wiFloorLeft] = 40;
  world.wallHWorld[wiFloorLeft] = 8;
  world.wallRampOrientationIndex[wiFloorLeft] = SHAPE_ORIENTATION_NONE;
  // Floor continues past the rough stair too, so the player has solid ground
  // for the whole traversal under test (this test is about the absence of a
  // climb, not about falling off the far edge of the block).
  const wiFloorRight = world.wallCount++;
  world.wallXWorld[wiFloorRight] = 48;
  world.wallYWorld[wiFloorRight] = floorTop;
  world.wallWWorld[wiFloorRight] = 40;
  world.wallHWorld[wiFloorRight] = 8;
  world.wallRampOrientationIndex[wiFloorRight] = SHAPE_ORIENTATION_NONE;

  const player = createClusterState(1, 20, 0, 0, 100);
  player.isPlayerFlag = 1;
  player.positionYWorld = floorTop - player.halfHeightWorld;
  player.isGroundedFlag = 1;
  world.clusters.push(player);

  for (let tick = 0; tick < 90; tick++) {
    world.playerMoveInputDxWorld = 1;
    applyClusterMovement(world);
    // The top of a ceiling rough stair is flush with the floor either side —
    // grounded Y should never move, since there is nothing to step up onto.
    assert.ok(Math.abs((player.positionYWorld + player.halfHeightWorld) - floorTop) < 1e-6,
      `tick ${tick}: unexpected vertical movement, y=${player.positionYWorld + player.halfHeightWorld}`);
    if (player.positionXWorld > 80) break;
  }
});

// ── Editor integration ─────────────────────────────────────────────────────────

test('rough stair is available in the editor palette as a fixed 1x1 item', () => {
  const item = PALETTE_ITEMS.find(i => i.id === 'rough_stair_1x1');
  assert.ok(item !== undefined, 'missing palette item rough_stair_1x1');
  assert.equal(item!.category, 'blocks');
  assert.equal(item!.isRoughStairItem, 1);
  assert.equal(item!.defaultWidthBlocks, 1);
  assert.equal(item!.defaultHeightBlocks, 1);
});

// ── Serialization round-trip ────────────────────────────────────────────────────

test('roughStairOrientation round-trips through wallShapeOrientationIndex for every orientation', () => {
  for (const ori of [0, 1, 2, 3] as const) {
    const idx = wallShapeOrientationIndex({ roughStairOrientation: ori });
    assert.equal(isRoughStairOrientationIndex(idx), true);
    assert.equal(decodeRoughStairOrientationIndex(idx), ori);
  }
});

test('a plain wall and a stairs wall are unaffected by rough stair orientation encoding', () => {
  assert.equal(wallShapeOrientationIndex({}), SHAPE_ORIENTATION_NONE);
  assert.equal(isRoughStairOrientationIndex(SHAPE_ORIENTATION_NONE), false);
  const stairsIdx = wallShapeOrientationIndex({ stairsOrientation: 0 });
  assert.equal(isRoughStairOrientationIndex(stairsIdx), false);
  assert.equal(isStairsOrientationIndex(stairsIdx), true);
});
