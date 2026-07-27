/**
 * Stair object tests.
 *
 * Covers the four things that make stairs different from the ramps they
 * replaced: the template masks are the authority for solidity, collision sees
 * individual steps rather than a triangle or a full rectangle, dust settles on
 * each tread, and grapple/exposure sees exposed step faces but not buried ones.
 *
 * Also asserts the retirement contract: ramps are gone from normal editor
 * placement, but ramp data still loads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

import {
  getStairsSolidRects,
  isStairsSolidAtLocalPx,
  stairsMaskPatternRows,
  encodeStairsOrientationIndex,
  decodeStairsOrientationIndex,
  isStairsOrientationIndex,
  isRampOrientationIndex,
  isPlainRectOrientationIndex,
  wallShapeOrientationIndex,
  SHAPE_ORIENTATION_NONE,
  STAIRS_RISER_HEIGHT_PX,
} from '../levels/stairsGeometry';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { resolveStairsSurfaces } from '../sim/clusters/movementStairsCollision';
import { buildSolidMaskFromWorld } from '../sim/pixelMaterials/pixelMaterialSolid';
import { aabbOverlapsWallSolid, forEachWallSolidRect, isStairsWall } from '../sim/stairsWorldGeometry';
import { raycastWalls } from '../sim/clusters/grappleShared';
// Imported from editorPaletteItems, not editorDropdownData: the latter pulls in
// the folder block-theme catalogue, which needs Vite's import.meta.glob.
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
import { canPlacePixelMaterialAt } from '../editor/editorHitTest';
import type { EditorRoomData } from '../editor/editorState';

// ── Template PNG decoding ─────────────────────────────────────────────────────

const TEMPLATE_DIR = path.resolve('ASSETS/SPRITES/BLOCKS/block_templates');

/**
 * Minimal 8-bit RGBA PNG decoder — enough for the template masks, which are
 * always colour type 6, bit depth 8. Returns one string per pixel row, using
 * '#' for opaque and '.' for transparent, matching `stairsMaskPatternRows`.
 */
function decodePngAlphaRows(filePath: string): { width: number; height: number; rows: string[] } {
  const buf = fs.readFileSync(filePath);
  let offset = 8; // skip signature
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

  // Undo per-scanline PNG filtering.
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

const STAIR_TEMPLATES = [
  { name: '1x1 stairs', width: 8, height: 8 },
  { name: '1x2 stairs', width: 16, height: 8 },
  { name: '2x2 stairs', width: 16, height: 16 },
] as const;

// ── Templates load and match the geometry module ──────────────────────────────

test('all stair templates exist and decode at the expected size', () => {
  for (const tpl of STAIR_TEMPLATES) {
    const file = path.join(TEMPLATE_DIR, tpl.name, `${tpl.name}_template.png`);
    assert.ok(fs.existsSync(file), `missing template: ${file}`);
    const decoded = decodePngAlphaRows(file);
    assert.equal(decoded.width, tpl.width);
    assert.equal(decoded.height, tpl.height);
  }
});

test('generated stair masks match the authored template PNGs pixel-for-pixel', () => {
  for (const tpl of STAIR_TEMPLATES) {
    const file = path.join(TEMPLATE_DIR, tpl.name, `${tpl.name}_template.png`);
    const decoded = decodePngAlphaRows(file);
    const generated = stairsMaskPatternRows(0, tpl.width, tpl.height);
    assert.deepEqual(generated, decoded.rows, `${tpl.name} mask mismatch`);
  }
});

test('1x1 stair mask has the expected stepped solid/empty pattern', () => {
  assert.deepEqual(stairsMaskPatternRows(0, 8, 8), [
    '......##',
    '......##',
    '....####',
    '....####',
    '..######',
    '..######',
    '########',
    '########',
  ]);
});

test('2x2 stair mask has eight steps, each one riser tall', () => {
  const rows = stairsMaskPatternRows(0, 16, 16);
  assert.equal(rows.length, 16);
  // Each pair of rows (one riser) widens by exactly one 2px tread.
  for (let step = 0; step < 8; step++) {
    const expectedSolid = (step + 1) * 2;
    for (let sub = 0; sub < STAIRS_RISER_HEIGHT_PX; sub++) {
      const row = rows[step * STAIRS_RISER_HEIGHT_PX + sub];
      assert.equal(row.length - row.indexOf('#'), expectedSolid);
    }
  }
});

test('stair orientations are axis mirrors of the base mask', () => {
  const base = stairsMaskPatternRows(0, 8, 8);
  const flipX = stairsMaskPatternRows(1, 8, 8);
  const flipY = stairsMaskPatternRows(2, 8, 8);
  const flipBoth = stairsMaskPatternRows(3, 8, 8);

  assert.deepEqual(flipX, base.map(r => [...r].reverse().join('')));
  assert.deepEqual(flipY, [...base].reverse());
  assert.deepEqual(flipBoth, [...base].reverse().map(r => [...r].reverse().join('')));
});

// ── Solid rectangle decomposition ─────────────────────────────────────────────

test('stair rects cover exactly the solid mask cells and nothing else', () => {
  for (const tpl of STAIR_TEMPLATES) {
    for (const ori of [0, 1, 2, 3] as const) {
      const rects = getStairsSolidRects(ori, tpl.width, tpl.height);
      for (let y = 0; y < tpl.height; y++) {
        for (let x = 0; x < tpl.width; x++) {
          const inRect = rects.some(r =>
            x >= r.xPx && x < r.xPx + r.wPx && y >= r.yPx && y < r.yPx + r.hPx,
          );
          const inMask = isStairsSolidAtLocalPx(ori, tpl.width, tpl.height, x, y);
          assert.equal(inRect, inMask, `${tpl.name} ori=${ori} at (${x},${y})`);
        }
      }
    }
  }
});

test('stair decomposition yields one rect per step, not one per mask pixel', () => {
  assert.equal(getStairsSolidRects(0, 8, 8).length, 4);
  assert.equal(getStairsSolidRects(0, 16, 8).length, 4);
  assert.equal(getStairsSolidRects(0, 16, 16).length, 8);
});

// ── Orientation index encoding ────────────────────────────────────────────────

test('shape orientation slot cleanly partitions ramps, stairs, and plain rects', () => {
  for (const ori of [0, 1, 2, 3] as const) {
    const encoded = encodeStairsOrientationIndex(ori);
    assert.equal(isStairsOrientationIndex(encoded), true);
    assert.equal(isRampOrientationIndex(encoded), false);
    assert.equal(isPlainRectOrientationIndex(encoded), false);
    assert.equal(decodeStairsOrientationIndex(encoded), ori);

    assert.equal(isRampOrientationIndex(ori), true);
    assert.equal(isStairsOrientationIndex(ori), false);
  }
  assert.equal(isPlainRectOrientationIndex(SHAPE_ORIENTATION_NONE), true);
  assert.equal(isRampOrientationIndex(SHAPE_ORIENTATION_NONE), false);
  assert.equal(isStairsOrientationIndex(SHAPE_ORIENTATION_NONE), false);
});

test('wallShapeOrientationIndex packs stairs, legacy ramps, and plain walls', () => {
  assert.equal(wallShapeOrientationIndex({ stairsOrientation: 2 }), 6);
  assert.equal(wallShapeOrientationIndex({ rampOrientation: 2 }), 2);
  assert.equal(wallShapeOrientationIndex({}), SHAPE_ORIENTATION_NONE);
});

// ── World-space collision ─────────────────────────────────────────────────────

/** Adds a 1x1 stair wall (8x8 px) at native-pixel (x, y) with orientation 0. */
function addStairWall(world: ReturnType<typeof createWorldState>, x: number, y: number, w = 8, h = 8): number {
  const wi = world.wallCount++;
  world.wallXWorld[wi] = x;
  world.wallYWorld[wi] = y;
  world.wallWWorld[wi] = w;
  world.wallHWorld[wi] = h;
  world.wallIsPlatformFlag[wi] = 0;
  world.wallRampOrientationIndex[wi] = encodeStairsOrientationIndex(0);
  return wi;
}

test('a stair wall is recognised and decomposed into step rects, not one bounding rect', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = addStairWall(world, 0, 0);
  assert.equal(isStairsWall(world, wi), true);

  const rects: number[][] = [];
  forEachWallSolidRect(world, wi, (x0, y0, x1, y1) => rects.push([x0, y0, x1, y1]));
  assert.equal(rects.length, 4);
});

test('stair collision respects mask solidity rather than full-rectangle collision', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = addStairWall(world, 0, 0);

  // Bottom-right corner is solid; top-left corner is cut away by the mask.
  assert.equal(aabbOverlapsWallSolid(world, wi, 6, 6, 8, 8), true);
  assert.equal(aabbOverlapsWallSolid(world, wi, 0, 0, 2, 2), false);
  // A full-rectangle implementation would report true for the empty top-left.
});

test('a plain rectangular wall still collides across its whole AABB', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0;
  world.wallYWorld[wi] = 0;
  world.wallWWorld[wi] = 8;
  world.wallHWorld[wi] = 8;
  world.wallIsPlatformFlag[wi] = 0;
  world.wallRampOrientationIndex[wi] = SHAPE_ORIENTATION_NONE;

  assert.equal(aabbOverlapsWallSolid(world, wi, 0, 0, 2, 2), true);
  assert.equal(isStairsWall(world, wi), false);
});

// ── Dust / particle world collision ───────────────────────────────────────────

test('the sand solid mask follows the stair mask, so particles can reach each step', () => {
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0);
  const mask = buildSolidMaskFromWorld(world, 16, 16);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      assert.equal(
        mask.isSolid(x, y),
        isStairsSolidAtLocalPx(0, 8, 8, x, y),
        `solid mask disagrees with stair mask at (${x},${y})`,
      );
    }
  }
});

test('particle/world collision can detect individual stair steps', () => {
  const world = createWorldState(1000 / 60, 1);
  // Offset the stair so every tread has open air above it inside the mask
  // (SolidMask treats out-of-bounds as solid, which would mask the assertion).
  const originX = 4;
  const originY = 4;
  addStairWall(world, originX, originY);
  const mask = buildSolidMaskFromWorld(world, 24, 24);

  // Step 0 is the topmost step. Its tread top is at local y = 0, and each step
  // below it drops one riser (2px) and extends two px further left.
  for (let step = 0; step < 4; step++) {
    const treadTopY = originY + step * 2;
    const treadX = originX + 7 - step * 2;
    assert.equal(mask.isSolid(treadX, treadTopY), true, `step ${step} tread not solid`);
    assert.equal(
      mask.isSolid(treadX, treadTopY - 1), false,
      `step ${step} has no open air above its tread — sand could not settle on it`,
    );
  }
});

test('a legacy ramp still fills its whole rect in the sand mask (unchanged behaviour)', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0;
  world.wallYWorld[wi] = 0;
  world.wallWWorld[wi] = 8;
  world.wallHWorld[wi] = 8;
  world.wallIsPlatformFlag[wi] = 0;
  world.wallRampOrientationIndex[wi] = 0; // legacy ramp
  const mask = buildSolidMaskFromWorld(world, 16, 16);
  assert.equal(mask.isSolid(0, 0), true);
});

// ── Player collision against the stepped profile ──────────────────────────────

/**
 * The tread top a body spanning `[left, right)` should come to rest on: the
 * highest (smallest y) step rect its X-span overlaps.
 */
function expectedRestTopY(left: number, right: number): number {
  let best = Infinity;
  for (const r of getStairsSolidRects(0, 16, 16)) {
    if (right <= r.xPx || left >= r.xPx + r.wPx) continue;
    if (r.yPx < best) best = r.yPx;
  }
  return best;
}

test('a falling player rests on a stair tread top, quantized per step rather than a slope', () => {
  // 2x2 stairs (16x16 px). The player AABB is 7x20 px — wider than one 2px
  // tread — so it rests on the highest step its span overlaps. What matters is
  // that the resting height is always exactly a tread top: an even local y, one
  // of the discrete step surfaces, never an interpolated ramp height.
  for (const centerX of [3, 7, 11, 15]) {
    const world = createWorldState(1000 / 60, 1);
    addStairWall(world, 0, 0, 16, 16);

    const player = createClusterState(0, centerX, 0, 1, 100);
    const halfW = player.halfWidthWorld;
    const halfH = player.halfHeightWorld;
    const expectedTop = expectedRestTopY(centerX - halfW, centerX + halfW);

    // The resolver runs after position integration, so pose the player already
    // penetrating the tread, with prevY placing them above it last tick.
    const prevY = expectedTop - halfH - 1;
    player.positionYWorld = expectedTop - halfH + 0.5;
    player.velocityYWorld = 4;

    const landed = resolveStairsSurfaces(player, world, centerX, prevY);

    assert.equal(landed, true, `x=${centerX}: player should land`);
    assert.equal(player.isGroundedFlag, 1, `x=${centerX}: player should be grounded`);
    assert.equal(player.velocityYWorld, 0, `x=${centerX}: vertical velocity should be zeroed`);

    const restTop = player.positionYWorld + halfH;
    assert.ok(Math.abs(restTop - expectedTop) < 1e-6,
      `x=${centerX}: expected to rest on tread top ${expectedTop}, got ${restTop}`);
    assert.equal(restTop % STAIRS_RISER_HEIGHT_PX, 0,
      `x=${centerX}: rest height ${restTop} is not a discrete tread top`);
  }
});

test('resting on a stair tread is stable — a second resolve does not move the player', () => {
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0, 16, 16);

  const centerX = 11;
  const player = createClusterState(0, centerX, 0, 1, 100);
  const expectedTop = expectedRestTopY(centerX - player.halfWidthWorld, centerX + player.halfWidthWorld);
  const prevY = expectedTop - player.halfHeightWorld - 1;
  player.positionYWorld = expectedTop - player.halfHeightWorld + 0.5;
  player.velocityYWorld = 4;
  resolveStairsSurfaces(player, world, centerX, prevY);

  const restX = player.positionXWorld;
  const restY = player.positionYWorld;

  // Re-resolve from the settled pose: nothing should shift. In particular the
  // player must not be ejected sideways by the riser rects that share an edge
  // with the tread they are standing on.
  resolveStairsSurfaces(player, world, restX, restY);
  assert.ok(Math.abs(player.positionXWorld - restX) < 1e-6, 'player drifted on X while resting');
  assert.ok(Math.abs(player.positionYWorld - restY) < 1e-6, 'player drifted on Y while resting');
});

test('walking into the tall face of a stair blocks horizontally instead of launching the player up it', () => {
  // Regression: an ori-0 stair's right face is solid for its full 16px height.
  // A minimum-penetration resolve that preferred the vertical axis would teleport
  // the player onto the top step instead of stopping them.
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0, 16, 16);

  const player = createClusterState(0, 0, 0, 1, 100);
  const hw = player.halfWidthWorld;
  const hh = player.halfHeightWorld;

  player.positionYWorld = 16 - hh;         // feet level with the stair's base
  player.positionXWorld = 16 + hw - 0.5;   // just penetrating the right face
  player.velocityXWorld = -30;             // walking left into it
  player.velocityYWorld = 0;
  const prevX = 16 + hw + 1;
  const restY = player.positionYWorld;

  const landed = resolveStairsSurfaces(player, world, prevX, player.positionYWorld);

  assert.equal(landed, false, 'player should not be treated as landing on the stair top');
  assert.ok(Math.abs(player.positionXWorld - (16 + hw)) < 1e-6,
    `expected to be pushed out to x=${16 + hw}, got ${player.positionXWorld}`);
  assert.ok(Math.abs(player.positionYWorld - restY) < 1e-6,
    `player was lifted vertically to ${player.positionYWorld}`);
  assert.equal(player.velocityXWorld, 0, 'horizontal velocity should be stopped');
});

test('a body inside a stair bounding box but in its empty corner is not pushed', () => {
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0, 16, 16);

  // A small (2x2) body at local (3,3): inside the AABB, but in the region the
  // mask cuts away. A full-rectangle implementation would eject it.
  const body = createClusterState(0, 3, 3, 0, 100);
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

// ── Grapple / exposed-surface detection ───────────────────────────────────────

test('grapple raycast strikes an exposed stair tread, not the bounding box', () => {
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0);

  // Fire straight down onto the topmost step's tread (x in [6,8), tread top y=0).
  const onTread = raycastWalls(world, 7, -10, 0, 1, 40);
  assert.notEqual(onTread, null);
  assert.ok(Math.abs(onTread!.t - 10) < 1e-6, 'should hit the top tread at y=0');
  assert.equal(onTread!.normalY, -1);

  // Fire down through the stair's empty upper-left region. The bounding box
  // spans it, but the mask does not — the ray must fall through to the tread
  // that actually exists at that column (x=1 → solid from y=6).
  const throughGap = raycastWalls(world, 1, -10, 0, 1, 40);
  assert.notEqual(throughGap, null);
  assert.ok(Math.abs(throughGap!.t - 16) < 1e-6, 'should pass the empty corner and hit the lowest tread at y=6');
});

test('grapple raycast hits an exposed riser face from the side', () => {
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0);

  // Travel right along y=1, inside the topmost riser's row. The first solid
  // face on that row is the riser at x=6.
  const hit = raycastWalls(world, -10, 1, 1, 0, 40);
  assert.notEqual(hit, null);
  assert.ok(Math.abs(hit!.t - 16) < 1e-6, 'should hit the top step riser at x=6');
  assert.equal(hit!.normalX, -1);
});

test('rays from open air stop on exposed stair faces, never on buried interior seams', () => {
  const world = createWorldState(1000 / 60, 1);
  addStairWall(world, 0, 0);

  // The column-wise rect decomposition creates internal vertical boundaries at
  // x = 2, 4, 6 where solid meets solid. Those are buried, not surfaces: a ray
  // crossing the solid bottom row must stop at the stair's exposed left face
  // (x = 0) and never at one of those seams.
  const fromLeft = raycastWalls(world, -10, 7, 1, 0, 40);
  assert.notEqual(fromLeft, null);
  assert.ok(Math.abs(fromLeft!.t - 10) < 1e-6, `expected exposed left face at x=0, got t=${fromLeft!.t}`);
  assert.equal(fromLeft!.normalX, -1);

  // Likewise from below: the exposed bottom face is y = 8, and the horizontal
  // seams between step rects at y = 2, 4, 6 must not be reported.
  const fromBelow = raycastWalls(world, 1, 20, 0, -1, 40);
  assert.notEqual(fromBelow, null);
  assert.ok(Math.abs(fromBelow!.t - 12) < 1e-6, `expected exposed bottom face at y=8, got t=${fromBelow!.t}`);
  assert.equal(fromBelow!.normalY, 1);
});

// ── Editor: smooth ramps (stairs collision, smooth diagonal render) ──────────

test('legacy diagonal-physics ramp items are no longer offered for normal editor placement', () => {
  const rampBlockItems = PALETTE_ITEMS.filter(i => i.category === 'blocks' && i.isRampItem === 1);
  assert.equal(rampBlockItems.length, 0, 'plain diagonal-physics ramps must not appear in the blocks palette');
});

test('smooth ramps (stairs collision, smooth render) are available in the editor in all three sizes', () => {
  for (const id of ['ramp_1x1', 'ramp_1x2', 'ramp_2x2']) {
    const item = PALETTE_ITEMS.find(i => i.id === id);
    assert.ok(item !== undefined, `missing palette item ${id}`);
    assert.equal(item!.category, 'blocks');
    assert.equal(item!.isSmoothRampItem, 1);
    assert.equal(item!.isRampItem, undefined, 'smooth ramps must not use the legacy diagonal-physics flag');
  }
});

test('stairs are available in the editor in all three sizes', () => {
  for (const id of ['stairs_1x1', 'stairs_1x2', 'stairs_2x2']) {
    const item = PALETTE_ITEMS.find(i => i.id === id);
    assert.ok(item !== undefined, `missing palette item ${id}`);
    assert.equal(item!.category, 'blocks');
    assert.equal(item!.isStairsItem, 1);
  }
});

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test', name: 'Test', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [],
    ...overrides,
  } as EditorRoomData;
}

test('editor sand placement follows the stair mask, matching the runtime solid mask', () => {
  const room = makeRoom({
    interiorWalls: [{
      uid: 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1,
      isPlatformFlag: 0, stairsOrientation: 0,
    }],
  } as unknown as Partial<EditorRoomData>);

  const originX = 2 * 8;
  const originY = 2 * 8;
  // Bottom-left of the stair block is solid → placement rejected.
  assert.equal(canPlacePixelMaterialAt(room, originX + 0, originY + 7), false);
  // Top-left is cut away by the mask → sand may rest there, exactly as it can at runtime.
  assert.equal(canPlacePixelMaterialAt(room, originX + 0, originY + 0), true);
});
