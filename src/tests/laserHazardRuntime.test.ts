/**
 * laserHazardRuntime.test.ts — runtime coverage for the Laser Emitter hazard:
 * room-load beam derivation (origin/direction/wall-or-boundary termination),
 * player damage without an active shield, invulnerability, curved Shield
 * Weave reflection (contact-before-player, wall-before-shield, moving
 * shield), and lifecycle reset (no stale traces across room loads).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState, type WorldState, MAX_WALLS } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHazards } from '../sim/hazards';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import { BLOCK_SIZE_MEDIUM, PLAYER_HALF_HEIGHT_WORLD, type RoomDef, type SpikeDirection } from '../levels/roomDef';
import { createShieldWeaveState, updateShieldWeaveState } from '../sim/stormweave/shieldWeave';

const DT_SEC = 1 / 60;

function makeWorldWithPlayer(px: number, py: number): WorldState {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, px, py, 1, 10);
  player.halfWidthWorld = 6;
  player.halfHeightWorld = 8;
  world.clusters = [player];
  return world;
}

/** Adds a plain solid wall rect directly to the world's wall buffers (bypassing full room-wall building). */
function addWall(world: WorldState, xWorld: number, yWorld: number, wWorld: number, hWorld: number): void {
  if (world.wallCount >= MAX_WALLS) throw new Error('MAX_WALLS exceeded in test');
  const i = world.wallCount++;
  world.wallXWorld[i] = xWorld;
  world.wallYWorld[i] = yWorld;
  world.wallWWorld[i] = wWorld;
  world.wallHWorld[i] = hWorld;
}

function makeLaserRoom(xBlock: number, yBlock: number, direction: SpikeDirection): RoomDef {
  return { lasers: [{ xBlock, yBlock, direction }] } as unknown as RoomDef;
}

describe('laser room-load derivation', () => {
  for (const direction of ['up', 'down', 'left', 'right'] as const) {
    test(`a laser fired ${direction} terminates at the first solid wall/boundary along that axis`, () => {
      const world = makeWorldWithPlayer(-1000, -1000); // player far away, doesn't interfere
      // Surround the emitter tile at block (10,10) with a distant wall on every side, at a fixed distance.
      const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
      const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
      const distance = 200;
      if (direction === 'up') addWall(world, originXWorld - 50, originYWorld - distance - 50, 100, 50);
      if (direction === 'down') addWall(world, originXWorld - 50, originYWorld + distance, 100, 50);
      if (direction === 'left') addWall(world, originXWorld - distance - 50, originYWorld - 50, 50, 100);
      if (direction === 'right') addWall(world, originXWorld + distance, originYWorld - 50, 50, 100);

      loadRoomHazards(world, makeLaserRoom(10, 10, direction));
      assert.equal(world.laserCount, 1, 'exactly one laser must be registered');
      assert.ok(Math.abs(world.laserLengthWorld[0] - distance) < BLOCK_SIZE_MEDIUM, `beam length should be ~${distance}, got ${world.laserLengthWorld[0]}`);
      assert.equal(world.laserXWorld[0], originXWorld);
      assert.equal(world.laserYWorld[0], originYWorld);
    });
  }

  test('a laser emitter flush against a wall (degenerate beam) is skipped rather than registered with zero length', () => {
    const world = makeWorldWithPlayer(-1000, -1000);
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    addWall(world, originXWorld - 50, originYWorld, 100, 50); // wall immediately below/adjacent
    loadRoomHazards(world, makeLaserRoom(10, 10, 'down'));
    assert.equal(world.laserCount, 0);
  });

  test('a laser with no wall/boundary within range is skipped rather than firing unbounded', () => {
    const world = makeWorldWithPlayer(-1000, -1000);
    loadRoomHazards(world, makeLaserRoom(10, 10, 'right')); // no walls at all
    assert.equal(world.laserCount, 0);
  });

  test('room reload resets stale laser state — no duplication or leftover lasers from a previous room', () => {
    const world = makeWorldWithPlayer(-1000, -1000);
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    addWall(world, originXWorld + 200, originYWorld - 50, 50, 100);
    loadRoomHazards(world, makeLaserRoom(10, 10, 'right'));
    assert.equal(world.laserCount, 1);

    // Reload with a room containing no lasers — count must reset to zero.
    world.wallCount = 0;
    loadRoomHazards(world, {} as RoomDef);
    assert.equal(world.laserCount, 0, 'laser count must reset on room load even with no lasers authored');
    assert.equal(world.laserInvulnTicks, 0, 'laser invuln cooldown must reset on room load');
  });
});

describe('laser damage without an active shield', () => {
  function setupHorizontalBeamRoom(playerXWorld: number, playerYWorld: number): WorldState {
    const world = makeWorldWithPlayer(playerXWorld, playerYWorld);
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    addWall(world, originXWorld + 300, originYWorld - 50, 50, 100);
    loadRoomHazards(world, makeLaserRoom(10, 10, 'right'));
    return world;
  }

  test('standing in the unobstructed beam path damages the player through the canonical damage pipeline', () => {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = setupHorizontalBeamRoom(originXWorld + 100, originYWorld);
    const player = world.clusters[0];
    const healthBefore = player.healthPoints;
    applyHazards(world);
    assert.ok(player.healthPoints < healthBefore, 'player must take laser damage when standing in the beam');
    assert.ok(world.laserInvulnTicks > 0, 'the laser cooldown must be armed after a hit');
  });

  test('the laser-specific cooldown prevents repeat damage on the very next tick while still overlapping', () => {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = setupHorizontalBeamRoom(originXWorld + 100, originYWorld);
    const player = world.clusters[0];
    applyHazards(world);
    const healthAfterFirstHit = player.healthPoints;
    player.invulnerabilityTicks = 0; // clear only the player-level i-frames to isolate the laser-specific cooldown
    applyHazards(world);
    assert.equal(player.healthPoints, healthAfterFirstHit, 'the laser cooldown alone must prevent an immediate repeat hit');
  });

  test('the canonical player invulnerability window blocks a second laser hit even after the laser cooldown expires', () => {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = setupHorizontalBeamRoom(originXWorld + 100, originYWorld);
    const player = world.clusters[0];
    applyHazards(world);
    const healthAfterFirstHit = player.healthPoints;
    world.laserInvulnTicks = 0; // clear only the laser-specific cooldown
    applyHazards(world);
    assert.equal(player.healthPoints, healthAfterFirstHit, 'standard player invulnerability must still apply');
  });

  test('standing outside the beam path takes no damage', () => {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = setupHorizontalBeamRoom(originXWorld + 100, originYWorld - 500);
    const player = world.clusters[0];
    const healthBefore = player.healthPoints;
    applyHazards(world);
    assert.equal(player.healthPoints, healthBefore);
  });
});

describe('laser reflection off an active Shield Weave arc', () => {
  function setupShieldedBeam(shieldCenterXOffset: number): { world: WorldState; originXWorld: number; originYWorld: number } {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = makeWorldWithPlayer(-5000, -5000); // player far from the direct beam path
    addWall(world, originXWorld + 400, originYWorld - 50, 50, 100);
    loadRoomHazards(world, makeLaserRoom(10, 10, 'right'));

    // Place an active shield between the emitter and the wall, aimed back at the emitter.
    const shield = createShieldWeaveState();
    shield.isHeldRequested = true;
    const shieldCenterX = originXWorld + shieldCenterXOffset;
    updateShieldWeaveState(shield, DT_SEC, 6, shieldCenterX, originYWorld, PLAYER_HALF_HEIGHT_WORLD * 2, -1, 0);
    world.shieldWeave = shield;
    return { world, originXWorld, originYWorld };
  }

  test('an active arc before the wall reflects the beam and produces incoming + outgoing segments', () => {
    const { world } = setupShieldedBeam(150);
    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 1, 'the beam must register a reflection');
    assert.ok(world.laserIncomingEndXWorld[0] < world.laserXWorld[0] + 150 + 1, 'incoming leg ends at/before the shield');
  });

  test('a player near the contact point but off the reflected beam line is not spuriously hit by epsilon overlap', () => {
    const { world, originXWorld, originYWorld } = setupShieldedBeam(150);
    // Put the player near the shield contact point but well off the beam's line
    // (perpendicular offset), so only a numerical-overlap bug would hit them.
    const player = world.clusters[0];
    player.positionXWorld = originXWorld + 150 - 14;
    player.positionYWorld = originYWorld + 200; // far off the horizontal beam line
    const healthBefore = player.healthPoints;
    applyHazards(world);
    assert.equal(player.healthPoints, healthBefore);
  });

  test('active-arc contact before the player on the beam path prevents incoming-leg damage', () => {
    const { world, originXWorld, originYWorld } = setupShieldedBeam(150);
    const player = world.clusters[0];
    // Player stands directly behind the shield (further along +x than the shield), where the
    // unreflected beam would have hit them absent the shield.
    player.positionXWorld = originXWorld + 300;
    player.positionYWorld = originYWorld;
    const healthBefore = player.healthPoints;
    applyHazards(world);
    assert.equal(player.healthPoints, healthBefore, 'the shield must intercept the beam before it reaches the player');
  });

  test('a wall between the emitter and the shield prevents reflection entirely', () => {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = makeWorldWithPlayer(-5000, -5000);
    // Wall placed well before where the shield would be.
    addWall(world, originXWorld + 60, originYWorld - 50, 20, 100);
    loadRoomHazards(world, makeLaserRoom(10, 10, 'right'));
    assert.equal(world.laserCount, 1);
    assert.ok(world.laserLengthWorld[0] < 100, 'beam terminates at the near wall well before any shield position');

    const shield = createShieldWeaveState();
    shield.isHeldRequested = true;
    updateShieldWeaveState(shield, DT_SEC, 6, originXWorld + 150, originYWorld, PLAYER_HALF_HEIGHT_WORLD * 2, -1, 0);
    world.shieldWeave = shield;

    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 0, 'a wall short-circuiting the beam must prevent any reflection');
  });

  test('an inactive shield never reflects the beam', () => {
    const { world } = setupShieldedBeam(150);
    world.shieldWeave.isActive = false;
    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 0);
  });

  test('a zero-mote shield never reflects the beam', () => {
    const { world, originXWorld, originYWorld } = setupShieldedBeam(150);
    const shield = createShieldWeaveState();
    shield.isHeldRequested = false;
    updateShieldWeaveState(shield, DT_SEC, 0, originXWorld + 150, originYWorld, PLAYER_HALF_HEIGHT_WORLD * 2, -1, 0);
    world.shieldWeave = shield;
    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 0);
  });

  test('a full-circle shield still reflects consistently with a real curved surface (non-cardinal-quantized)', () => {
    const originXWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const originYWorld = (10 + 0.5) * BLOCK_SIZE_MEDIUM;
    const world = makeWorldWithPlayer(-5000, -5000);
    addWall(world, originXWorld + 400, originYWorld - 50, 50, 100);
    loadRoomHazards(world, makeLaserRoom(10, 10, 'right'));

    const shield = createShieldWeaveState();
    shield.isHeldRequested = true;
    updateShieldWeaveState(shield, DT_SEC, 60, originXWorld + 150, originYWorld, PLAYER_HALF_HEIGHT_WORLD * 2, 1, 0);
    assert.equal(shield.isFullCircle, true);
    world.shieldWeave = shield;

    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 1);
  });

  test('moving the shield between ticks deterministically updates the contact point and outgoing segment', () => {
    const { world } = setupShieldedBeam(150);
    applyHazards(world);
    const contactXFirst = world.laserContactXWorld[0];

    // Move the shield further along the beam.
    updateShieldWeaveState(world.shieldWeave, DT_SEC, 6, world.shieldWeave.centerXWorld + 40, world.shieldWeave.centerYWorld, PLAYER_HALF_HEIGHT_WORLD * 2, -1, 0);
    applyHazards(world);
    const contactXSecond = world.laserContactXWorld[0];

    assert.notEqual(contactXFirst, contactXSecond, 'moving the shield must change the beam contact point on the next tick');
  });
});
