import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PLAYER_HALF_HEIGHT_WORLD } from '../levels/roomDef';
import { CommandKind } from '../input/commands';
import { collectCommands, createInputState } from '../input/handler';
import {
  arbitrateExclusivePlayerActions,
  ExclusivePlayerAction,
} from '../input/playerActionArbitration';
import { applyPlayerDamageWithKnockback, type PlayerDamageTarget } from '../sim/playerDamage';
import { StormweaveLifeMotes } from '../sim/stormweave/lifeMotes';
import {
  createShieldWeaveState,
  deactivateShieldWeave,
  doesSegmentIntersectShield,
  getEffectiveShieldArcLengthWorld,
  getRequestedShieldArcLengthWorld,
  getShieldAngularSpanRad,
  getShieldMoteAngleRad,
  getShieldRadiusWorld,
  isPointBlockedByShield,
  resetShieldWeaveState,
  resolveShieldDirectionAngleRad,
  tryBlockHostileProjectile,
  updateShieldWeaveState,
} from '../sim/stormweave/shieldWeave';

const DT_SEC = 1 / 60;

function activate(moteCount: number, aimX = 1, aimY = 0) {
  const state = createShieldWeaveState();
  state.isHeldRequested = true;
  updateShieldWeaveState(state, DT_SEC, moteCount, 0, 0, PLAYER_HALF_HEIGHT_WORLD * 2, aimX, aimY);
  return state;
}

function makePlayer(healthPoints = 8): PlayerDamageTarget {
  return {
    healthPoints,
    isAliveFlag: 1,
    positionXWorld: 0,
    positionYWorld: 0,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isGroundedFlag: 1,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
  };
}

describe('Shield Weave activation and geometry', () => {
  test('cannot activate with zero motes and activates with one or more', () => {
    assert.equal(activate(0).isActive, false);
    assert.equal(activate(1).isActive, true);
    assert.equal(activate(4).moteCount, 4);
  });

  test('right mouse produces the central Shield Weave hold/end actions immediately', () => {
    const input = createInputState();
    input.mouseXPx = 120;
    input.mouseYPx = 40;
    input.isRightMouseDownFlag = 1;
    const held = collectCommands(input);
    assert.ok(held.some(command => command.kind === CommandKind.ShieldWeaveHold));
    input.isRightMouseDownFlag = 0;
    const released = collectCommands(input);
    assert.ok(released.some(command => command.kind === CommandKind.ShieldWeaveEnd));
  });

  test('diameter is canonical player collision height plus eight pixels', () => {
    const playerHeight = PLAYER_HALF_HEIGHT_WORLD * 2;
    assert.equal(getShieldRadiusWorld(playerHeight) * 2, playerHeight + 8);
    assert.equal(getShieldRadiusWorld(playerHeight), 14);
  });

  test('one mote gives 10 pixels and every additional mote adds exactly 3', () => {
    assert.equal(getRequestedShieldArcLengthWorld(1), 10);
    assert.equal(getRequestedShieldArcLengthWorld(2), 13);
    assert.equal(getRequestedShieldArcLengthWorld(5), 22);
  });

  test('arc length caps at circumference and angular span is length divided by radius', () => {
    const radius = 3;
    const length = getEffectiveShieldArcLengthWorld(100, radius);
    assert.equal(length, Math.PI * 2 * radius);
    assert.equal(getShieldAngularSpanRad(100, radius), length / radius);
  });

  test('one mote is centered and partial-arc motes are evenly distributed including endpoints', () => {
    const one = activate(1, 0, 1);
    assert.equal(getShieldMoteAngleRad(one, 0), one.directionAngleRad);

    const four = activate(4);
    const angles = Array.from({ length: 4 }, (_, i) => getShieldMoteAngleRad(four, i));
    const step = angles[1] - angles[0];
    assert.ok(Math.abs((angles[2] - angles[1]) - step) < 1e-9);
    assert.ok(Math.abs((angles[3] - angles[2]) - step) < 1e-9);
    assert.ok(Math.abs((angles[3] - angles[0]) - four.angularSpanRad) < 1e-9);
  });

  test('full-circle placement uses nonduplicated equal intervals', () => {
    const full = activate(30);
    assert.equal(full.isFullCircle, true);
    const first = getShieldMoteAngleRad(full, 0);
    const last = getShieldMoteAngleRad(full, full.moteCount - 1);
    assert.ok(Math.abs(last - first) < Math.PI * 2);
    assert.ok(Math.abs((last - first) - Math.PI * 2 * (full.moteCount - 1) / full.moteCount) < 1e-9);
  });

  test('direction follows the cursor angle and center cursor retains a finite fallback', () => {
    assert.equal(resolveShieldDirectionAngleRad(0, 10, 0, 0, 0), Math.PI / 2);
    const fallback = resolveShieldDirectionAngleRad(0, 0, 0, 0, 1.25);
    assert.equal(fallback, 1.25);
    assert.ok(Number.isFinite(fallback));
  });
});

describe('grapple and Shield Weave input arbitration', () => {
  test('Shield Weave cannot activate during an active grapple', () => {
    const result = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.Grapple,
      { grapple: false, shieldWeave: true },
    );
    assert.equal(result.allowShieldWeave, false);
    assert.equal(result.owner, ExclusivePlayerAction.Grapple);
  });

  test('grappling cannot begin while Shield Weave is active', () => {
    const result = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.ShieldWeave,
      { grapple: true, shieldWeave: true },
    );
    assert.equal(result.allowGrapple, false);
    assert.equal(result.owner, ExclusivePlayerAction.ShieldWeave);
  });

  test('a blocked input does not cancel the currently active ability', () => {
    const grappleOwner = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.Grapple,
      { grapple: false, shieldWeave: true },
    );
    const shieldOwner = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.ShieldWeave,
      { grapple: true, shieldWeave: false },
    );
    assert.equal(grappleOwner.owner, ExclusivePlayerAction.Grapple);
    assert.equal(shieldOwner.owner, ExclusivePlayerAction.ShieldWeave);
  });

  test('releasing the current ability restores the other ability on a subsequent input', () => {
    const grappleAfterShieldRelease = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.None,
      { grapple: true, shieldWeave: false },
    );
    const shieldAfterGrappleRelease = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.None,
      { grapple: false, shieldWeave: true },
    );
    assert.equal(grappleAfterShieldRelease.allowGrapple, true);
    assert.equal(shieldAfterGrappleRelease.allowShieldWeave, true);
  });

  test('simultaneous idle inputs resolve deterministically to grapple priority', () => {
    const result = arbitrateExclusivePlayerActions(
      ExclusivePlayerAction.None,
      { grapple: true, shieldWeave: true },
    );
    assert.equal(result.owner, ExclusivePlayerAction.Grapple);
    assert.equal(result.allowGrapple, true);
    assert.equal(result.allowShieldWeave, false);
  });
});

describe('shared Stormweave mote behavior', () => {
  test('Shield Weave target replaces normal Stormweave attraction while active', () => {
    const shieldCloud = new StormweaveLifeMotes();
    const stormCloud = new StormweaveLifeMotes();
    shieldCloud.reset(0, 0, 1);
    stormCloud.reset(0, 0, 1);
    shieldCloud.setMoteState(0, 12, 0);
    stormCloud.setMoteState(0, 12, 0);
    const shield = activate(1);
    shieldCloud.update(DT_SEC, 0, 0, 0, 0, false, shield);
    stormCloud.update(DT_SEC, 0, 0, 0, 0, false);
    const shieldMote = shieldCloud.getMote(0)!;
    const stormMote = stormCloud.getMote(0)!;
    assert.ok(Math.hypot(shieldMote.velocityXWorld, shieldMote.velocityYWorld)
      < Math.hypot(stormMote.velocityXWorld, stormMote.velocityYWorld));
  });

  test('release returns to Stormweave mode and count changes update assignments safely', () => {
    const cloud = new StormweaveLifeMotes();
    const shield = activate(4);
    cloud.reset(0, 0, 4);
    cloud.update(DT_SEC, 0, 0, 0, 0, false, shield);
    deactivateShieldWeave(shield);
    cloud.update(DT_SEC, 0, 0, 0, 0, false, shield);
    assert.equal(shield.isActive, false);

    shield.isHeldRequested = true;
    updateShieldWeaveState(shield, DT_SEC, 2, 0, 0, 20, 1, 0);
    cloud.reconcile(2, 0, 0);
    assert.equal(shield.moteCount, 2);
    assert.equal(cloud.moteCount, 2);
  });

  test('reaching zero motes immediately removes collision and stale state', () => {
    const shield = activate(2);
    assert.equal(doesSegmentIntersectShield(shield, 30, 0, 0, 0), true);
    updateShieldWeaveState(shield, DT_SEC, 0, 0, 0, 20, 1, 0);
    assert.equal(shield.isActive, false);
    assert.equal(shield.moteCount, 0);
    assert.equal(doesSegmentIntersectShield(shield, 30, 0, 0, 0), false);
  });
});

describe('Shield Weave collision and projectile protection', () => {
  test('front projectile is blocked without damage; an unshielded-side projectile damages normally', () => {
    const shield = activate(4);
    const blockedPlayer = makePlayer();
    const blocked = tryBlockHostileProjectile(shield, 30, 0, 0, 0);
    if (!blocked) applyPlayerDamageWithKnockback(blockedPlayer, 1, 30, 0);
    assert.equal(blocked, true);
    assert.equal(blockedPlayer.healthPoints, 8);
    assert.ok(shield.impactTicksLeft > 0);

    const exposedPlayer = makePlayer();
    const exposedBlocked = tryBlockHostileProjectile(shield, -30, 0, 0, 0);
    if (!exposedBlocked) applyPlayerDamageWithKnockback(exposedPlayer, 1, -30, 0);
    assert.equal(exposedBlocked, false);
    assert.equal(exposedPlayer.healthPoints, 7);
  });

  test('collision follows only the visible arc and never acts as a filled disk', () => {
    const shield = activate(4);
    assert.equal(isPointBlockedByShield(shield, 0, 0), false);
    assert.equal(isPointBlockedByShield(shield, shield.radiusWorld, 0), true);
    assert.equal(isPointBlockedByShield(shield, -shield.radiusWorld, 0), false);
    assert.equal(doesSegmentIntersectShield(shield, 1, 0, 0, 0), false, 'inside-origin attacks are not blocked');
  });

  test('reset/death/load lifecycle clearing removes active state and impacts', () => {
    const shield = activate(3);
    tryBlockHostileProjectile(shield, 30, 0, 0, 0);
    resetShieldWeaveState(shield);
    assert.equal(shield.isActive, false);
    assert.equal(shield.isHeldRequested, false);
    assert.equal(shield.moteCount, 0);
    assert.equal(shield.impactTicksLeft, 0);
  });
});
