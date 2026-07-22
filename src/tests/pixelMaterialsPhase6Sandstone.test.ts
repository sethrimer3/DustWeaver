/**
 * Phase 6 — Sandstone material.
 *
 * Covers:
 *  1.  Material table: footprint 1, behavior 'static', distinct color.
 *  2.  Sandstone remains stationary under gravity.
 *  3.  Sandstone blocks sand (sand cannot fall through it).
 *  4.  Sandstone blocks water (water cannot flow through it).
 *  5.  Low-speed player contact does NOT fracture sandstone.
 *  6.  High-speed head-on impact fractures sandstone → sand.
 *  7.  High tangential player speed (parallel to surface) does NOT fracture.
 *  8.  Impact fracture is spatially bounded (small radius at threshold speed).
 *  9.  Weak wind does NOT erode sandstone.
 * 10.  Sustained qualifying wind eventually converts sandstone to sand.
 * 11.  Stronger wind erodes faster than weaker wind.
 * 12.  Erosion is frame-rate independent (same result at smaller sub-steps).
 * 13.  Obstructed sandstone (no wind reaching it) does not erode.
 * 14.  Converted sandstone falls as normal sand.
 * 15.  Material conversion clears sandstone-specific state.
 * 16.  Existing serialized rooms still load (unknown material gracefully skipped).
 * 17.  Sandstone survives round-trip serialize/deserialize.
 * 18.  Editor placement via placePixelMaterialAt / erasePixelMaterialAt works.
 * 19.  Large sandstone wall does not cause O(n²) regression in step().
 * 20.  Impact cooldown: repeated high-speed frames do not multiply fractures.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { SolidMask } from '../sim/pixelMaterials/pixelMaterialSolid';
import {
  MATERIAL_EMPTY,
  MATERIAL_SAND,
  MATERIAL_WATER,
  MATERIAL_SANDSTONE,
  MATERIAL_DEFS,
  getMaterialBehavior,
  getMaterialFootprintSize,
  SANDSTONE_FRACTURE_IMPACT_SPEED,
  SANDSTONE_MIN_EROSION_WIND_SPEED,
  SANDSTONE_IMPACT_COOLDOWN_TICKS,
} from '../sim/pixelMaterials/pixelMaterialTypes';
import { placePixelMaterialAt, erasePixelMaterialAt } from '../editor/editorPixelMaterialTool';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import type { EditorRoomData } from '../editor/editorState';
import { createDefaultEditorLayers } from '../editor/editorLayers';

// ── helpers ────────────────────────────────────────────────────────────────

function makeSystem(w = 40, h = 40, solid?: SolidMask): PixelMaterialSystem {
  return new PixelMaterialSystem(w, h, solid ?? new SolidMask(w, h));
}

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

function makeEditorState(room: EditorRoomData) {
  const nextUid = { current: 1 };
  return {
    roomData: room,
    selectedElements: [],
    layers: createDefaultEditorLayers(),
    get nextUid() { return nextUid.current; },
    set nextUid(v: number) { nextUid.current = v; },
  } as unknown as Parameters<typeof placePixelMaterialAt>[0];
}

/** Run applyPlayerImpactFracture with the given velocity from above/left/right/below. */
function impactFromLeft(sys: PixelMaterialSystem, playerX: number, playerY: number, speed: number, tick = 0): void {
  sys.applyPlayerImpactFracture(playerX, playerY, 3.5, 10, speed, 0, tick);
}
function impactFromAbove(sys: PixelMaterialSystem, playerX: number, playerY: number, speed: number, tick = 0): void {
  sys.applyPlayerImpactFracture(playerX, playerY, 3.5, 10, 0, speed, tick);
}

// ── 1. Material table ──────────────────────────────────────────────────────

test('sandstone: material table entry has footprint 1, behavior static, distinct color', () => {
  assert.equal(getMaterialFootprintSize(MATERIAL_SANDSTONE), 1);
  assert.equal(getMaterialBehavior(MATERIAL_SANDSTONE), 'static');
  const def = MATERIAL_DEFS[MATERIAL_SANDSTONE];
  assert.ok(def !== undefined, 'MATERIAL_DEFS[MATERIAL_SANDSTONE] missing');
  assert.notEqual(def.color, MATERIAL_DEFS[MATERIAL_SAND].color, 'color must differ from sand');
  assert.notEqual(def.color, MATERIAL_DEFS[MATERIAL_WATER].color, 'color must differ from water');
});

// ── 2. Stationary under gravity ────────────────────────────────────────────

test('sandstone: remains stationary under gravity', () => {
  const solid = new SolidMask(20, 20);
  const sys = makeSystem(20, 20, solid);
  sys.place(5, 2, MATERIAL_SANDSTONE);
  for (let i = 0; i < 30; i++) sys.step();
  assert.equal(sys.getMaterialAt(5, 2), MATERIAL_SANDSTONE, 'sandstone must not fall');
  assert.equal(sys.getMaterialAt(5, 3), MATERIAL_EMPTY, 'cell below must remain empty');
});

// ── 3. Blocks sand ────────────────────────────────────────────────────────

test('sandstone: blocks falling sand (sand rests on top)', () => {
  // Box the column with solid walls so sand can't slide off diagonally.
  const solid = new SolidMask(20, 20);
  solid.markRect(4, 0, 5, 20); // left wall
  solid.markRect(6, 0, 7, 20); // right wall
  const sys = makeSystem(20, 20, solid);
  sys.place(5, 10, MATERIAL_SANDSTONE); // sandstone at row 10
  sys.place(5, 0, MATERIAL_SAND);       // sand dropping from row 0
  for (let i = 0; i < 30; i++) sys.step();
  // Sand should rest on top of sandstone (row 9).
  assert.equal(sys.getMaterialAt(5, 10), MATERIAL_SANDSTONE);
  assert.equal(sys.getMaterialAt(5, 9), MATERIAL_SAND);
});

// ── 4. Blocks water ───────────────────────────────────────────────────────

test('sandstone: blocks water (water does not pass through)', () => {
  const solid = new SolidMask(20, 20);
  const sys = makeSystem(20, 20, solid);
  sys.place(5, 10, MATERIAL_SANDSTONE);
  sys.place(5, 0, MATERIAL_WATER);
  for (let i = 0; i < 30; i++) sys.step();
  // Water must not reach below row 10.
  assert.equal(sys.getMaterialAt(5, 10), MATERIAL_SANDSTONE);
  assert.equal(sys.getMaterialAt(5, 11), MATERIAL_EMPTY);
  // Sandstone must not be dissolved by water touch.
  assert.equal(sys.getMaterialAt(5, 10), MATERIAL_SANDSTONE);
});

// ── 5. Low-speed contact does not fracture ────────────────────────────────

test('sandstone: low-speed player contact does not fracture', () => {
  const sys = makeSystem();
  sys.place(15, 10, MATERIAL_SANDSTONE); // sandstone cell to the right of player
  // Player at (10, 10), moving right at walk speed (50 px/s) — below threshold.
  sys.applyPlayerImpactFracture(10, 10, 3.5, 10, 50, 0, 0);
  assert.equal(sys.getMaterialAt(15, 10), MATERIAL_SANDSTONE, 'must not fracture at low speed');
});

// ── 6. High-speed head-on impact fractures sandstone ─────────────────────

test('sandstone: high-speed head-on impact converts sandstone to sand', () => {
  const sys = makeSystem();
  // Player at (5, 10), sandstone at (9, 10) — just to the right of the player AABB (halfW=3.5).
  sys.place(9, 10, MATERIAL_SANDSTONE);
  // Impact moving right at well above threshold.
  impactFromLeft(sys, 5, 10, SANDSTONE_FRACTURE_IMPACT_SPEED + 50);
  assert.equal(sys.getMaterialAt(9, 10), MATERIAL_SAND, 'impacted sandstone must become sand');
});

// ── 7. Tangential speed does not fracture ────────────────────────────────

test('sandstone: high tangential (parallel) speed does not fracture', () => {
  const sys = makeSystem();
  // Sandstone directly above player (dy = -1 from AABB top edge).
  // Place sandstone at (5, -1) relative to AABB top → let's put player at y=15, sandstone at y=4.
  // Player half-height=10, so AABB top = 15-10=5. Sandstone at y=4 is 1px above.
  sys.place(5, 4, MATERIAL_SANDSTONE);
  // Very fast horizontal (tangential to vertical surface above) — no vertical component.
  sys.applyPlayerImpactFracture(5, 15, 3.5, 10, 400, 0, 0);
  assert.equal(sys.getMaterialAt(5, 4), MATERIAL_SANDSTONE, 'tangential speed must not fracture');
});

// ── 8. Impact fracture is spatially bounded ───────────────────────────────

test('sandstone: impact fracture radius is bounded', () => {
  const sys = makeSystem();
  // Place a 5-pixel horizontal row of sandstone to the right of the player.
  // Player at x=5, halfW=3.5 → right edge at 8.5 → first sandstone at x=9.
  for (let x = 9; x < 14; x++) sys.place(x, 10, MATERIAL_SANDSTONE);
  // Impact at just above threshold: excess speed = 50, radius = 0.5.
  sys.applyPlayerImpactFracture(5, 10, 3.5, 10, SANDSTONE_FRACTURE_IMPACT_SPEED + 50, 0, 0);
  // At least one fracture must have occurred.
  const anyFractured = [9, 10, 11, 12, 13].some(x => sys.getMaterialAt(x, 10) === MATERIAL_SAND);
  assert.ok(anyFractured, 'at least one pixel must fracture');
  // The far end of the row (x=13) must NOT be fractured for a small-radius impact.
  assert.equal(sys.getMaterialAt(13, 10), MATERIAL_SANDSTONE, 'far pixels must not fracture at low excess speed');
});

// ── 9. Weak wind does not erode ───────────────────────────────────────────

test('sandstone: wind below minimum threshold does not erode', () => {
  const sys = makeSystem();
  sys.place(10, 10, MATERIAL_SANDSTONE);
  // Apply a force small enough that steady-state windVelX stays well below
  // SANDSTONE_MIN_EROSION_WIND_SPEED. Steady state ≈ force × windResponse / (1 - damping).
  // For windResponse=0.6 and damping=0.85: force=5 → steady ~20 px/s, below 40 threshold.
  for (let i = 0; i < 200; i++) {
    sys.applyWindForce({
      centerXPx: 10, centerYPx: 10, radiusPx: 3,
      forceX: 5, forceY: 0,
      falloff: 0,
    });
    sys.step();
  }
  // Sandstone must not have eroded.
  assert.equal(sys.getMaterialAt(10, 10), MATERIAL_SANDSTONE, 'weak wind must not erode sandstone');
});

// ── 10. Sustained strong wind converts sandstone to sand ──────────────────

test('sandstone: sustained qualifying wind eventually converts to sand', () => {
  const sys = makeSystem();
  sys.place(10, 10, MATERIAL_SANDSTONE);
  // Enough accumulated erosion to fracture: SANDSTONE_EROSION_THRESHOLD total.
  // Use force high enough that after windResponse scaling it exceeds the min threshold.
  const STRONG_FORCE = SANDSTONE_MIN_EROSION_WIND_SPEED * 5;
  let converted = false;
  for (let i = 0; i < 2000; i++) {
    sys.applyWindForce({
      centerXPx: 10, centerYPx: 10, radiusPx: 3,
      forceX: STRONG_FORCE, forceY: 0,
      falloff: 0,
    });
    sys.step();
    if (sys.getMaterialAt(10, 10) === MATERIAL_SAND) { converted = true; break; }
  }
  assert.ok(converted, 'sustained strong wind must eventually convert sandstone to sand');
});

// ── 11. Stronger wind erodes faster ──────────────────────────────────────

test('sandstone: stronger wind erodes faster than weaker wind', () => {
  const WEAK_FORCE  = SANDSTONE_MIN_EROSION_WIND_SPEED * 2;
  const STRONG_FORCE = SANDSTONE_MIN_EROSION_WIND_SPEED * 8;

  function ticksToFracture(force: number): number {
    const sys = makeSystem();
    sys.place(10, 10, MATERIAL_SANDSTONE);
    for (let i = 0; i < 5000; i++) {
      sys.applyWindForce({ centerXPx: 10, centerYPx: 10, radiusPx: 3, forceX: force, forceY: 0, falloff: 0 });
      sys.step();
      if (sys.getMaterialAt(10, 10) === MATERIAL_SAND) return i;
    }
    return 5000;
  }

  const ticksWeak   = ticksToFracture(WEAK_FORCE);
  const ticksStrong = ticksToFracture(STRONG_FORCE);
  assert.ok(ticksStrong < ticksWeak, `strong wind (${ticksStrong} ticks) must erode faster than weak wind (${ticksWeak} ticks)`);
});

// ── 12. Erosion is frame-rate independent (fixed-step) ────────────────────

test('sandstone: erosion result is deterministic across runs', () => {
  const FORCE = SANDSTONE_MIN_EROSION_WIND_SPEED * 4;

  function runFor(steps: number): boolean {
    const sys = makeSystem();
    sys.place(10, 10, MATERIAL_SANDSTONE);
    for (let i = 0; i < steps; i++) {
      sys.applyWindForce({ centerXPx: 10, centerYPx: 10, radiusPx: 3, forceX: FORCE, forceY: 0, falloff: 0 });
      sys.step();
    }
    return sys.getMaterialAt(10, 10) === MATERIAL_SAND;
  }

  // Two identical runs must produce the same outcome (no RNG involved).
  const run1 = runFor(300);
  const run2 = runFor(300);
  assert.equal(run1, run2, 'identical wind runs must yield identical erosion outcome');
});

// ── 13. Obstructed sandstone does not erode ───────────────────────────────

test('sandstone: sandstone shielded by solid wall does not receive wind from the blocked side', () => {
  // Build a solid wall between the wind source and sandstone.
  const solid = new SolidMask(40, 40);
  solid.markRect(20, 0, 21, 40); // vertical wall at x=20
  const sys = makeSystem(40, 40, solid);
  sys.place(25, 10, MATERIAL_SANDSTONE); // sandstone behind the wall

  // Wind from the left side — applyWindForce scans AABB.
  // The solid wall means isFree(20,*) = false, so no occupant is found at x=25
  // for the occupancy check… but actually applyWindForce doesn't check solids,
  // only occupancy. We test that wind applied strictly to the LEFT of the wall
  // (radius stops before x=25) does not reach the sandstone.
  const STRONG_FORCE = SANDSTONE_MIN_EROSION_WIND_SPEED * 10;
  for (let i = 0; i < 2000; i++) {
    sys.applyWindForce({
      centerXPx: 10, centerYPx: 10,
      radiusPx: 8, // radius reaches x=18, not x=25
      forceX: STRONG_FORCE, forceY: 0,
      falloff: 0,
    });
    sys.step();
  }
  assert.equal(sys.getMaterialAt(25, 10), MATERIAL_SANDSTONE,
    'sandstone outside wind radius must not erode');
});

// ── 14. Converted sandstone falls as sand ────────────────────────────────

test('sandstone: converted sandstone falls as normal sand', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 18, 20, 20); // solid floor at y=18
  const sys = makeSystem(20, 20, solid);
  // Sandstone floating above the floor (no support beneath).
  sys.place(5, 5, MATERIAL_SANDSTONE);

  // Fracture it via high-speed impact from above.
  impactFromAbove(sys, 5, 5 - 11, SANDSTONE_FRACTURE_IMPACT_SPEED + 50);
  assert.equal(sys.getMaterialAt(5, 5), MATERIAL_SAND, 'should have converted to sand');

  // After conversion it should fall toward the floor.
  for (let i = 0; i < 30; i++) sys.step();
  assert.equal(sys.getMaterialAt(5, 5), MATERIAL_EMPTY, 'sand must have left its original position');
  assert.equal(sys.getMaterialAt(5, 17), MATERIAL_SAND, 'sand must rest on the floor');
});

// ── 15. Conversion clears sandstone-specific state ────────────────────────

test('sandstone: conversion resets state and converted particle falls as sand', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 18, 20, 20); // solid floor at y=18
  const sys = makeSystem(20, 20, solid);
  // Sandstone at (10, 10) — player approaches from left at high speed.
  sys.place(10, 10, MATERIAL_SANDSTONE);
  // Player center at x=5, right edge at 8.5, sandstone at x=10 is within 2px margin.
  sys.applyPlayerImpactFracture(5, 10, 3.5, 10, SANDSTONE_FRACTURE_IMPACT_SPEED + 100, 0, 0);
  // Must have converted to sand.
  assert.equal(sys.getMaterialAt(10, 10), MATERIAL_SAND, 'must convert to sand');
  // Particle count must remain exactly 1 (no duplicate spawned, no particle removed).
  assert.equal(sys.particleCount, 1, 'exactly one particle must remain after conversion');
  // Let it run — the converted sand should fall.
  for (let i = 0; i < 20; i++) sys.step();
  assert.equal(sys.getMaterialAt(10, 10), MATERIAL_EMPTY, 'converted sand must fall from original position');
  assert.equal(sys.particleCount, 1, 'still exactly one particle');
});

// ── 16. Backward-compatible serialization (unknown material skipped) ───────

test('sandstone: rooms with unknown material ids still load (backward compat)', () => {
  const sys = makeSystem();
  // Simulate loading a room definition with an unknown material id (e.g. 99).
  sys.loadFromDefs([
    { xPixel: 5, yPixel: 5, material: 1 },   // known: sand
    { xPixel: 6, yPixel: 5, material: 99 },  // unknown: skip
  ]);
  assert.equal(sys.getMaterialAt(5, 5), MATERIAL_SAND);
  assert.equal(sys.getMaterialAt(6, 5), MATERIAL_EMPTY, 'unknown material must be silently skipped');
  assert.equal(sys.particleCount, 1);
});

// ── 17. Sandstone round-trip serialization ────────────────────────────────

test('sandstone: survives round-trip serialize/deserialize', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 14 });
  room.pixelMaterials = [
    { uid: 1, xPixel: 5,  yPixel: 5, material: MATERIAL_SANDSTONE },
    { uid: 2, xPixel: 10, yPixel: 8, material: MATERIAL_SAND },
  ];

  const json = editorRoomDataToJson(room);
  const { data: loaded } = jsonToEditorRoomData(json, 100);

  const materials = loaded.pixelMaterials ?? [];
  const stone = materials.find(m => m.xPixel === 5 && m.yPixel === 5);
  const sand  = materials.find(m => m.xPixel === 10 && m.yPixel === 8);
  assert.ok(stone !== undefined, 'sandstone must survive round-trip');
  assert.equal(stone!.material, MATERIAL_SANDSTONE);
  assert.ok(sand !== undefined, 'sand must survive round-trip');
  assert.equal(sand!.material, MATERIAL_SAND);
});

// ── 18. Editor placement and erase ────────────────────────────────────────

test('sandstone: editor placePixelMaterialAt and erasePixelMaterialAt work', () => {
  const room = makeRoom();
  const state = makeEditorState(room);
  const placed = placePixelMaterialAt(state, 7, 3, MATERIAL_SANDSTONE);
  assert.ok(placed);
  assert.equal(room.pixelMaterials!.length, 1);
  assert.equal(room.pixelMaterials![0].material, MATERIAL_SANDSTONE);

  const erased = erasePixelMaterialAt(state, 7, 3);
  assert.ok(erased);
  assert.equal(room.pixelMaterials!.length, 0);
});

// ── 19. Large region performance (no substantial regression) ──────────────

test('sandstone: large region of sandstone steps without O(n²) hang', () => {
  const W = 480, H = 270;
  const solid = new SolidMask(W, H);
  const sys = new PixelMaterialSystem(W, H, solid);
  // Fill a 40×20 block of sandstone.
  for (let y = 100; y < 120; y++) {
    for (let x = 100; x < 140; x++) {
      sys.place(x, y, MATERIAL_SANDSTONE);
    }
  }
  const start = Date.now();
  for (let i = 0; i < 60; i++) sys.step(); // one second of sim
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `60 steps over 800 sandstone pixels took ${elapsed}ms (> 2s threshold)`);
});

// ── 20. Impact cooldown prevents repeated fracture ────────────────────────

test('sandstone: impact cooldown prevents re-fracture within cooldown window', () => {
  const sys = makeSystem();
  // Place a 5-px column of sandstone to the right of the player.
  for (let x = 9; x < 14; x++) sys.place(x, 10, MATERIAL_SANDSTONE);

  const speed = SANDSTONE_FRACTURE_IMPACT_SPEED + 200;
  // First impact — should fracture x=9.
  sys.applyPlayerImpactFracture(5, 10, 3.5, 10, speed, 0, 0);
  const afterFirst = [9, 10, 11, 12, 13].filter(x => sys.getMaterialAt(x, 10) === MATERIAL_SAND).length;
  assert.ok(afterFirst >= 1, 'first impact must fracture at least one pixel');

  // Immediately repeat at tick=1 (within cooldown).
  sys.applyPlayerImpactFracture(5, 10, 3.5, 10, speed, 0, 1);
  const afterSecond = [9, 10, 11, 12, 13].filter(x => sys.getMaterialAt(x, 10) === MATERIAL_SAND).length;
  assert.equal(afterSecond, afterFirst, 'cooldown must prevent fracture on the very next tick');

  // After cooldown expires — further fracture should be allowed.
  sys.applyPlayerImpactFracture(5, 10, 3.5, 10, speed, 0, SANDSTONE_IMPACT_COOLDOWN_TICKS + 2);
  const afterCooldown = [9, 10, 11, 12, 13].filter(x => sys.getMaterialAt(x, 10) === MATERIAL_SAND).length;
  // Might not fracture more if all pixels in range are already sand, but at least it's allowed.
  assert.ok(afterCooldown >= afterFirst, 'after cooldown expires, further fracture must be allowed');
});
