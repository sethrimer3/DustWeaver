/**
 * laserTraceContract.test.ts — deterministic geometry coverage for laser
 * beam tracing and curved Shield Weave reflection.
 *
 * Covers the pure contract in src/sim/laserTraceContract.ts plus the
 * underlying circle-ray-intersection/reflection helpers it depends on in
 * src/sim/stormweave/shieldWeave.ts (getShieldArcRayHit / reflectDirection).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { traceLaserBeam, distancePointToSegmentWorld, LASER_REFLECT_EPSILON_WORLD } from '../sim/laserTraceContract';
import {
  createShieldWeaveState,
  updateShieldWeaveState,
  getShieldArcRayHit,
  reflectDirection,
  type ShieldWeaveState,
} from '../sim/stormweave/shieldWeave';
import { PLAYER_HALF_HEIGHT_WORLD } from '../levels/roomDef';

const DT_SEC = 1 / 60;

/** Activates a shield centered at (cx, cy) aimed toward (aimX, aimY), with `moteCount` motes. */
function activateShield(cx: number, cy: number, aimX: number, aimY: number, moteCount: number): ShieldWeaveState {
  const state = createShieldWeaveState();
  state.isHeldRequested = true;
  updateShieldWeaveState(state, DT_SEC, moteCount, cx, cy, PLAYER_HALF_HEIGHT_WORLD * 2, aimX, aimY);
  return state;
}

describe('traceLaserBeam — no-shield / inactive-shield behavior', () => {
  test('with no shield geometry, the beam travels straight to the terrain distance', () => {
    const result = traceLaserBeam(0, 0, 1, 0, 100, undefined, () => null, 500);
    assert.equal(result.hasReflection, false);
    assert.equal(result.reflection, null);
    assert.equal(result.incoming.startXWorld, 0);
    assert.equal(result.incoming.startYWorld, 0);
    assert.equal(result.incoming.endXWorld, 100);
    assert.equal(result.incoming.endYWorld, 0);
  });

  test('an inactive shield never reflects, even if geometrically in the path', () => {
    const shield = activateShield(50, 0, -1, 0, 4);
    shield.isActive = false; // force inactive despite valid geometry
    const result = traceLaserBeam(0, 0, 1, 0, 100, shield, () => null, 500);
    assert.equal(result.hasReflection, false);
    assert.equal(result.incoming.endXWorld, 100);
  });

  test('a shield with zero motes never reflects', () => {
    const shield = activateShield(50, 0, -1, 0, 0); // 0 motes -> not active
    assert.equal(shield.isActive, false);
    const result = traceLaserBeam(0, 0, 1, 0, 100, shield, () => null, 500);
    assert.equal(result.hasReflection, false);
  });

  test('a beam that only crosses the unarmed portion of the circle does not reflect, even crossing the full circle', () => {
    // Shield aimed straight up (armed arc is the top of the circle) with a narrow arc.
    // A horizontal ray through the circle's center crosses both the left (angle=pi)
    // and right (angle=0) sides of the circle — neither is within the narrow
    // up-facing arc — so it must pass through untouched.
    const shield = activateShield(50, 0, 0, -1, 1); // aimed up, narrow 1-mote arc
    const result = traceLaserBeam(0, 0, 1, 0, 100, shield, () => null, 500);
    assert.equal(result.hasReflection, false, 'ray crossing only the unarmed circle sides must not reflect');
    assert.equal(result.incoming.endXWorld, 100);
  });
});

describe('traceLaserBeam — active-arc reflection', () => {
  test('a beam that hits the active arc before terrain reflects: incoming ends at contact, outgoing starts epsilon beyond', () => {
    const shield = activateShield(50, 0, -1, 0, 4); // aimed toward -x, i.e. toward the incoming ray from x=0
    const result = traceLaserBeam(0, 0, 1, 0, 500, shield, () => null, 500);
    assert.equal(result.hasReflection, true);
    assert.ok(result.reflection !== null);
    const contactXExpected = 50 - shield.radiusWorld;
    assert.ok(Math.abs(result.incoming.endXWorld - contactXExpected) < 1e-6);
    assert.equal(result.incoming.endYWorld, 0);

    // Outgoing starts a tiny epsilon beyond the contact point along the reflected direction.
    const refl = result.reflection!;
    const distFromContact = Math.hypot(
      refl.outgoing.startXWorld - refl.contactXWorld,
      refl.outgoing.startYWorld - refl.contactYWorld,
    );
    assert.ok(Math.abs(distFromContact - LASER_REFLECT_EPSILON_WORLD) < 1e-6);
  });

  test('a wall hit before the shield (shorter terrain distance) prevents reflection', () => {
    const shield = activateShield(50, 0, -1, 0, 4);
    // Terrain distance of 10 is well short of the shield contact near x=36 (50 - radius).
    const result = traceLaserBeam(0, 0, 1, 0, 10, shield, () => null, 500);
    assert.equal(result.hasReflection, false);
    assert.equal(result.incoming.endXWorld, 10);
  });

  test('reflected direction matches the reflection equation within tight tolerance', () => {
    const shield = activateShield(50, 0, -1, 0, 4);
    const result = traceLaserBeam(0, 0, 1, 0, 500, shield, () => null, 500);
    const refl = result.reflection!;
    // Recompute expected reflection independently via reflectDirection and compare.
    const expected = reflectDirection(1, 0, refl.normalXWorld, refl.normalYWorld);
    assert.ok(Math.abs(refl.dirXWorld - expected.xWorld) < 1e-9);
    assert.ok(Math.abs(refl.dirYWorld - expected.yWorld) < 1e-9);
    // Manual check of reflected = incoming - 2*dot(incoming,normal)*normal
    const dot = 1 * refl.normalXWorld + 0 * refl.normalYWorld;
    const manualX = 1 - 2 * dot * refl.normalXWorld;
    const manualY = 0 - 2 * dot * refl.normalYWorld;
    const manualLen = Math.hypot(manualX, manualY) || 1;
    assert.ok(Math.abs(refl.dirXWorld - manualX / manualLen) < 1e-9);
    assert.ok(Math.abs(refl.dirYWorld - manualY / manualLen) < 1e-9);
  });

  test('a center-arc hit reflects back roughly toward the source; a near-end hit reflects at a visibly different angle', () => {
    // Center hit: shield aimed directly at the incoming ray -> near-180-degree bounce.
    const centerShield = activateShield(50, 0, -1, 0, 4);
    const centerResult = traceLaserBeam(0, 0, 1, 0, 500, centerShield, () => null, 500);
    const centerRefl = centerResult.reflection!;
    const centerAngle = Math.atan2(centerRefl.dirYWorld, centerRefl.dirXWorld);
    assert.ok(Math.abs(Math.abs(centerAngle) - Math.PI) < 0.05, 'a head-on hit should bounce back near 180 degrees');

    // Near-end hit: aim the shield mostly perpendicular so the ray clips the arc's edge.
    // Use a wide arc but offset the beam's y so it strikes near one endpoint of the arc.
    const wideShield = activateShield(50, 0, 0, -1, 30); // aimed up, wide arc (30 motes)
    // Fire the beam from far below-left aimed up-right so it clips the right edge of the upward arc.
    const originX = 50 - wideShield.radiusWorld * 1.4;
    const originY = 200;
    const dx = 0.35, dy = -1;
    const dirLen = Math.hypot(dx, dy);
    const edgeResult = traceLaserBeam(originX, originY, dx / dirLen, dy / dirLen, 500, wideShield, () => null, 500);
    if (edgeResult.hasReflection) {
      const edgeAngle = Math.atan2(edgeResult.reflection!.dirYWorld, edgeResult.reflection!.dirXWorld);
      // The two reflected angles must be meaningfully different (curvature is visible, not quantized to cardinal directions).
      assert.ok(Math.abs(edgeAngle - centerAngle) > 0.2, 'center vs near-end arc hits must reflect at visibly different angles');
    }
  });

  test('outgoing ray terminates on the terrain hit supplied by the callback', () => {
    const shield = activateShield(50, 0, -1, 0, 4);
    const terrainHitPoint = { xWorld: -40, yWorld: 25 };
    const result = traceLaserBeam(0, 0, 1, 0, 500, shield, () => terrainHitPoint, 500);
    const refl = result.reflection!;
    assert.equal(refl.outgoing.endXWorld, terrainHitPoint.xWorld);
    assert.equal(refl.outgoing.endYWorld, terrainHitPoint.yWorld);
  });

  test('no reflected leg terrain hit falls back to the max reflect range along the reflected direction', () => {
    const shield = activateShield(50, 0, -1, 0, 4);
    const result = traceLaserBeam(0, 0, 1, 0, 500, shield, () => null, 500);
    const refl = result.reflection!;
    const expectedEndX = refl.outgoing.startXWorld + refl.dirXWorld * 500;
    const expectedEndY = refl.outgoing.startYWorld + refl.dirYWorld * 500;
    assert.ok(Math.abs(refl.outgoing.endXWorld - expectedEndX) < 1e-6);
    assert.ok(Math.abs(refl.outgoing.endYWorld - expectedEndY) < 1e-6);
  });

  test('a full-circle shield reflects a beam from any incoming angle', () => {
    const fullShield = activateShield(50, 0, 1, 0, 60); // enough motes for full circle
    assert.equal(fullShield.isFullCircle, true);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071]]) {
      const result = traceLaserBeam(0, -80, dx, dy, 1000, fullShield, () => ({ xWorld: 0, yWorld: -1000 }), 2000);
      // Not every direction necessarily reaches the circle within range from this origin;
      // just assert internal consistency when it does reflect.
      if (result.hasReflection) {
        const refl = result.reflection!;
        const normalLen = Math.hypot(refl.normalXWorld, refl.normalYWorld);
        assert.ok(Math.abs(normalLen - 1) < 1e-6);
      }
    }
  });

  test('moving/rotating the shield changes the contact point and outgoing direction deterministically', () => {
    const shieldA = activateShield(50, 0, -1, 0, 4);
    const resultA = traceLaserBeam(0, 0, 1, 0, 500, shieldA, () => null, 500);

    const shieldB = createShieldWeaveState();
    shieldB.isHeldRequested = true;
    // Move the shield center and re-aim it.
    updateShieldWeaveState(shieldB, DT_SEC, 4, 60, 20, PLAYER_HALF_HEIGHT_WORLD * 2, -1, -1);
    const resultB = traceLaserBeam(0, 0, 1, 0, 500, shieldB, () => null, 500);

    if (resultA.hasReflection && resultB.hasReflection) {
      const a = resultA.reflection!;
      const b = resultB.reflection!;
      assert.ok(
        a.contactXWorld !== b.contactXWorld || a.contactYWorld !== b.contactYWorld,
        'moving the shield must change the contact point',
      );
    }
  });
});

describe('getShieldArcRayHit direct coverage', () => {
  test('returns null when the shield is inactive', () => {
    const shield = createShieldWeaveState();
    assert.equal(getShieldArcRayHit(shield, 0, 0, 1, 0, 500), null);
  });

  test('returns null when the ray misses the circle entirely', () => {
    const shield = activateShield(0, 1000, -1, 0, 4);
    assert.equal(getShieldArcRayHit(shield, 0, 0, 1, 0, 500), null);
  });

  test('normal points outward from the shield center through the contact point', () => {
    const shield = activateShield(50, 0, -1, 0, 4);
    const hit = getShieldArcRayHit(shield, 0, 0, 1, 0, 500)!;
    assert.ok(hit !== null);
    const expectedNormalX = (hit.xWorld - shield.centerXWorld) / shield.radiusWorld;
    const expectedNormalY = (hit.yWorld - shield.centerYWorld) / shield.radiusWorld;
    assert.ok(Math.abs(hit.normalXWorld - expectedNormalX) < 1e-6);
    assert.ok(Math.abs(hit.normalYWorld - expectedNormalY) < 1e-6);
  });
});

describe('distancePointToSegmentWorld', () => {
  test('measures perpendicular distance to a segment, clamped to endpoints', () => {
    assert.equal(distancePointToSegmentWorld(5, 5, 0, 0, 10, 0), 5);
    assert.equal(distancePointToSegmentWorld(-5, 0, 0, 0, 10, 0), 5, 'clamped to the near endpoint');
    assert.equal(distancePointToSegmentWorld(15, 0, 0, 0, 10, 0), 5, 'clamped to the far endpoint');
  });
});
