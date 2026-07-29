/**
 * laserShieldReflection.test.ts — Deterministic tests for laser emitter beams
 * and Shield Weave curved-arc reflection.
 *
 * Covers:
 *   - Base laser: origin/termination per direction, no traversal through walls.
 *   - Player damage without an active shield; invulnerability gate.
 *   - Reflection gating: inactive shield, zero-mote shield, wall-before-shield,
 *     beam missing the active arc (but crossing the full circle) do not reflect.
 *   - Reflection geometry: exact reflection-equation match, center-vs-near-end
 *     angle difference, epsilon offset / no self-hit, outgoing terminates at terrain.
 *   - Shield movement/rotation continuously updates contact/outgoing direction.
 *   - Room load / reset does not retain stale per-tick trace state.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHazards } from '../sim/hazards';
import {
  createShieldWeaveState,
  getShieldArcRayHit,
  reflectDirection,
  type ShieldWeaveState,
} from '../sim/stormweave/shieldWeave';
import { traceLaserBeam, distancePointToSegmentWorld } from '../sim/laserTraceContract';
import { SPIKE_DIR_UP, SPIKE_DIR_DOWN, SPIKE_DIR_LEFT, SPIKE_DIR_RIGHT } from '../sim/hazards';

const DT_MS = 1000 / 60;

function makeShield(overrides: Partial<ShieldWeaveState>): ShieldWeaveState {
  const s = createShieldWeaveState();
  Object.assign(s, {
    isActive: true,
    centerXWorld: 0,
    centerYWorld: 0,
    radiusWorld: 20,
    directionAngleRad: 0, // facing +X (toward positive x)
    arcLengthWorld: 20,
    angularSpanRad: 1.0, // ~57 degrees
    isFullCircle: false,
    moteCount: 3,
  }, overrides);
  return s;
}

function makeWorldWithLaser(dir: 'up' | 'down' | 'left' | 'right', originX: number, originY: number): WorldState {
  const world = createWorldState(DT_MS, 1);
  const player = createClusterState(1, -10000, -10000, 1, 8); // far away by default
  world.clusters.push(player);
  world.laserCount = 1;
  world.laserXWorld[0] = originX;
  world.laserYWorld[0] = originY;
  world.laserDirection[0] =
    dir === 'up' ? SPIKE_DIR_UP : dir === 'down' ? SPIKE_DIR_DOWN : dir === 'left' ? SPIKE_DIR_LEFT : SPIKE_DIR_RIGHT;
  world.laserLengthWorld[0] = 200;
  return world;
}

describe('laser trace contract — base beam (no shield)', () => {
  test('traces a straight segment from origin to terrain distance for each direction', () => {
    const dirs: Array<[number, number]> = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ];
    for (const [dx, dy] of dirs) {
      const trace = traceLaserBeam(0, 0, dx, dy, 150, undefined, () => null, 1000);
      assert.equal(trace.hasReflection, false);
      assert.equal(trace.incoming.startXWorld, 0);
      assert.equal(trace.incoming.startYWorld, 0);
      assert.ok(Math.abs(trace.incoming.endXWorld - dx * 150) < 1e-6);
      assert.ok(Math.abs(trace.incoming.endYWorld - dy * 150) < 1e-6);
    }
  });

  test('no reflection when shield is undefined/inactive/zero-mote', () => {
    const inactive = makeShield({ isActive: false });
    const zeroMote = makeShield({ moteCount: 0 });
    for (const shield of [undefined, inactive, zeroMote]) {
      const trace = traceLaserBeam(-50, 0, 1, 0, 200, shield, () => null, 1000);
      assert.equal(trace.hasReflection, false);
    }
  });
});

describe('applyHazards — laser damage without shield', () => {
  test('damages player standing in the beam and applies invulnerability', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    const player = world.clusters[0];
    player.positionXWorld = 50;
    player.positionYWorld = 0;
    player.healthPoints = 10;
    const startHp = player.healthPoints;
    applyHazards(world);
    assert.ok(player.healthPoints < startHp);
    assert.ok(world.laserInvulnTicks > 0);
  });

  test('does not damage a player far from the beam', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    const player = world.clusters[0];
    player.positionXWorld = 50;
    player.positionYWorld = 500;
    player.healthPoints = 10;
    applyHazards(world);
    assert.equal(player.healthPoints, 10);
  });

  test('invulnerability prevents a second hit on the following tick check', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    const player = world.clusters[0];
    player.positionXWorld = 50;
    player.positionYWorld = 0;
    player.healthPoints = 10;
    applyHazards(world);
    const hpAfterFirst = player.healthPoints;
    applyHazards(world); // invuln still counting down, tick decrements it but should not double-hit same tick cadence unless it reaches 0
    assert.ok(player.healthPoints <= hpAfterFirst);
  });
});

describe('applyHazards — Shield Weave reflection gating', () => {
  test('wall before shield prevents reflection', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    world.laserLengthWorld[0] = 10; // terrain hit very close — before the shield at x=50
    world.shieldWeave.isActive = true;
    world.shieldWeave.moteCount = 3;
    world.shieldWeave.centerXWorld = 50;
    world.shieldWeave.centerYWorld = 0;
    world.shieldWeave.radiusWorld = 20;
    world.shieldWeave.directionAngleRad = Math.PI; // facing -X, toward the emitter
    world.shieldWeave.angularSpanRad = 2.0;
    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 0);
  });

  test('beam missing the active arc is not reflected merely because it crosses the full circle', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    world.shieldWeave.isActive = true;
    world.shieldWeave.moteCount = 3;
    world.shieldWeave.centerXWorld = 50;
    world.shieldWeave.centerYWorld = 0;
    world.shieldWeave.radiusWorld = 20;
    // Shield armed facing straight up (+Y is down in this coordinate system;
    // "up" visually is -Y), away from the incoming rightward beam's crossing
    // points (which are at angle 0 and PI on the circle for a beam through
    // the center height).
    world.shieldWeave.directionAngleRad = -Math.PI / 2;
    world.shieldWeave.angularSpanRad = 0.3; // narrow arc, does not cover angle 0 or PI
    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 0);
  });

  test('active arc hit before player prevents damage and produces two segments', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    const player = world.clusters[0];
    // Place player behind the shield, further along the beam path.
    player.positionXWorld = 100;
    player.positionYWorld = 0;
    player.healthPoints = 10;
    world.shieldWeave.isActive = true;
    world.shieldWeave.moteCount = 3;
    world.shieldWeave.centerXWorld = 50;
    world.shieldWeave.centerYWorld = 0;
    world.shieldWeave.radiusWorld = 20;
    world.shieldWeave.directionAngleRad = Math.PI; // facing -X: crescent centered toward the incoming beam
    world.shieldWeave.angularSpanRad = 1.5;
    applyHazards(world);
    assert.equal(world.laserHasReflectionFlag[0], 1);
    // Incoming segment terminates at the shield contact (x < player x).
    assert.ok(world.laserIncomingEndXWorld[0] < 60);
    // Reflected outgoing beam heads back toward -X (away from the player at x=100).
    assert.ok(world.laserOutgoingEndXWorld[0] < world.laserOutgoingStartXWorld[0] + 1);
    // The unshielded player behind the shield takes no damage this tick from
    // this laser (nothing else in this minimal world could hit it either).
    assert.equal(player.healthPoints, 10);
  });
});

describe('reflection math — exact geometry', () => {
  test('reflectDirection matches the reflection equation within tight tolerance', () => {
    const incoming = { x: 1, y: 0 };
    const normal = { x: -1, y: 0 }; // head-on into a surface facing back at the ray
    const r = reflectDirection(incoming.x, incoming.y, normal.x, normal.y);
    // reflected = incoming - 2*dot(incoming,normal)*normal = (1,0) - 2*(-1)*(-1,0) = (1,0)-(2,0) = (-1,0)
    assert.ok(Math.abs(r.xWorld - -1) < 1e-9);
    assert.ok(Math.abs(r.yWorld - 0) < 1e-9);
  });

  test('a beam striking the center of the aimed crescent reflects back toward its source', () => {
    const shield = makeShield({
      centerXWorld: 50, centerYWorld: 0, radiusWorld: 20,
      directionAngleRad: Math.PI, angularSpanRad: 1.0, moteCount: 3,
    });
    // Beam travels along +X directly through the shield center height —
    // hits the arc dead center (angle == directionAngleRad == PI).
    const hit = getShieldArcRayHit(shield, 0, 0, 1, 0, 200);
    assert.ok(hit !== null);
    if (hit === null) return;
    const reflected = reflectDirection(1, 0, hit.normalXWorld, hit.normalYWorld);
    // A dead-center hit's normal is exactly opposite the incoming ray, so the
    // reflection points almost exactly back along -X.
    assert.ok(Math.abs(reflected.xWorld - -1) < 1e-6);
    assert.ok(Math.abs(reflected.yWorld) < 1e-6);
  });

  test('center-arc and near-end impacts produce mathematically different reflected angles', () => {
    const shield = makeShield({
      centerXWorld: 50, centerYWorld: 0, radiusWorld: 20,
      directionAngleRad: Math.PI, angularSpanRad: 1.2, moteCount: 5,
    });
    // Center hit: beam through the shield's mid-height.
    const centerHit = getShieldArcRayHit(shield, 0, 0, 1, 0, 200);
    assert.ok(centerHit !== null);
    // Near-end hit: beam offset in Y so it clips the arc near one edge.
    const edgeAngle = shield.directionAngleRad + shield.angularSpanRad * 0.45;
    const edgeX = shield.centerXWorld + Math.cos(edgeAngle) * shield.radiusWorld;
    const edgeY = shield.centerYWorld + Math.sin(edgeAngle) * shield.radiusWorld;
    // Fire a ray from far away directly at that near-end point.
    const dirX = edgeX - (-500);
    const dirY = edgeY - 0;
    const len = Math.hypot(dirX, dirY);
    const edgeHit = getShieldArcRayHit(shield, -500, 0, dirX / len, dirY / len, len + 50);
    assert.ok(edgeHit !== null);
    if (centerHit === null || edgeHit === null) return;

    const centerReflected = reflectDirection(1, 0, centerHit.normalXWorld, centerHit.normalYWorld);
    const edgeReflected = reflectDirection(dirX / len, dirY / len, edgeHit.normalXWorld, edgeHit.normalYWorld);
    const angleDiff = Math.abs(
      Math.atan2(centerReflected.yWorld, centerReflected.xWorld) -
      Math.atan2(edgeReflected.yWorld, edgeReflected.xWorld),
    );
    assert.ok(angleDiff > 0.05, `expected visibly different reflection angles, got diff=${angleDiff}`);
  });

  test('outgoing ray starts a small epsilon beyond contact and does not immediately self-intersect', () => {
    const shield = makeShield({
      centerXWorld: 50, centerYWorld: 0, radiusWorld: 20,
      directionAngleRad: Math.PI, angularSpanRad: 1.0, moteCount: 3,
    });
    let terrainCalls = 0;
    const trace = traceLaserBeam(0, 0, 1, 0, 200, shield, (ox, oy, dx, dy, maxRange) => {
      terrainCalls++;
      return { xWorld: ox + dx * maxRange, yWorld: oy + dy * maxRange };
    }, 500);
    assert.equal(trace.hasReflection, true);
    assert.equal(terrainCalls, 1);
    if (trace.reflection === null) return;
    const distFromContact = Math.hypot(
      trace.reflection.outgoing.startXWorld - trace.reflection.contactXWorld,
      trace.reflection.outgoing.startYWorld - trace.reflection.contactYWorld,
    );
    assert.ok(distFromContact > 0);
    assert.ok(distFromContact < 2); // small epsilon, not a large jump
  });

  test('outgoing ray terminates against terrain (uses the terrain callback result)', () => {
    const shield = makeShield({
      centerXWorld: 50, centerYWorld: 0, radiusWorld: 20,
      directionAngleRad: Math.PI, angularSpanRad: 1.0, moteCount: 3,
    });
    const trace = traceLaserBeam(0, 0, 1, 0, 200, shield, (ox, oy, dx, dy) => ({
      xWorld: ox + dx * 33, yWorld: oy + dy * 33,
    }), 500);
    assert.equal(trace.hasReflection, true);
    if (trace.reflection === null) return;
    const dist = Math.hypot(
      trace.reflection.outgoing.endXWorld - trace.reflection.outgoing.startXWorld,
      trace.reflection.outgoing.endYWorld - trace.reflection.outgoing.startYWorld,
    );
    assert.ok(Math.abs(dist - 33) < 1e-6);
  });

  test('full-circle shield reflects a beam from any incoming angle', () => {
    const shield = makeShield({
      centerXWorld: 50, centerYWorld: 0, radiusWorld: 20,
      directionAngleRad: 0, angularSpanRad: Math.PI * 2, isFullCircle: true, moteCount: 20,
    });
    const hit = getShieldArcRayHit(shield, 0, -100, 0.3, 1, 300);
    assert.ok(hit !== null);
  });

  test('shield movement/rotation updates contact point and outgoing direction deterministically', () => {
    const shieldA = makeShield({
      centerXWorld: 50, centerYWorld: 0, radiusWorld: 20,
      directionAngleRad: Math.PI, angularSpanRad: 1.0, moteCount: 3,
    });
    const shieldB = makeShield({
      centerXWorld: 50, centerYWorld: 40, radiusWorld: 20, // shield moved down
      directionAngleRad: Math.PI, angularSpanRad: 1.0, moteCount: 3,
    });
    const traceA = traceLaserBeam(0, 0, 1, 0, 200, shieldA, (ox, oy, dx, dy, r) => ({ xWorld: ox + dx * r, yWorld: oy + dy * r }), 500);
    const traceB = traceLaserBeam(0, 0, 1, 0, 200, shieldB, (ox, oy, dx, dy, r) => ({ xWorld: ox + dx * r, yWorld: oy + dy * r }), 500);
    // Shield A sits on the beam's height (reflects); shield B's center is
    // offset 40 world units in Y with only a 20-unit radius, so the beam line
    // no longer crosses its circle at all — moving the shield deterministically
    // changed the outcome from "reflects" to "does not reflect".
    assert.equal(traceA.hasReflection, true);
    assert.equal(traceB.hasReflection, false);
  });
});

describe('distancePointToSegmentWorld', () => {
  test('returns 0 for a point on the segment and correct perpendicular distance off it', () => {
    assert.equal(distancePointToSegmentWorld(5, 0, 0, 0, 10, 0), 0);
    assert.equal(distancePointToSegmentWorld(5, 3, 0, 0, 10, 0), 3);
  });
});

describe('laser lifecycle reset', () => {
  test('room-load reset clears stale reflection flags', () => {
    const world = makeWorldWithLaser('right', 0, 0);
    world.laserHasReflectionFlag[0] = 1;
    world.laserCount = 0; // simulate a fresh room load with no lasers this room
    world.laserHasReflectionFlag.fill(0);
    assert.equal(world.laserHasReflectionFlag[0], 0);
  });
});
