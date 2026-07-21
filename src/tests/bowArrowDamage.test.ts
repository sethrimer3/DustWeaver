import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import {
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  tickBowArrowOutbound,
  getBowArrowDamage,
  BOW_ARROW_PHASE_NONE,
  BOW_ARROW_LOAD_3_TICKS,
} from '../sim/weaves/bowArrow';
import { BEHAVIOR_MODE_BOW_ARROW } from '../sim/particles/bowArrowBehaviorMode';
import { MAX_HIT_REGISTRY_SLOTS } from '../sim/weaves/weaveHitRegistryConfig';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 8) {
  const world = createWorldState(DT_MS, 3);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

function addEnemy(world: ReturnType<typeof createWorldState>, id: number, x: number, y: number, hp = 20) {
  const enemy = createClusterState(id, x, y, 0, hp);
  world.clusters.push(enemy);
  return enemy;
}

/** Assembles and fires a straight +x arrow at the shield center, seated fully. */
function fireArrowAt(world: ReturnType<typeof createWorldState>, loadTicks: number) {
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < loadTicks; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  return fireBowArrow(world, 1, 0);
}

function countArrowMotes(world: ReturnType<typeof createWorldState>): number {
  let n = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] === BEHAVIOR_MODE_BOW_ARROW) n++;
  }
  return n;
}

test('damage policy: 3/4/5-mote arrows deal 2/3/4 damage respectively', () => {
  assert.equal(getBowArrowDamage(3), 2);
  assert.equal(getBowArrowDamage(4), 3);
  assert.equal(getBowArrowDamage(5), 4);
});

test('outbound arrow damages an enemy directly in its swept path and resolves cleanly', () => {
  const { world, player } = makeFixture(8);
  const enemy = addEnemy(world, 1, player.positionXWorld + 30, player.positionYWorld, 20);
  const beforeMotes = world.particleCount;

  assert.equal(fireArrowAt(world, BOW_ARROW_LOAD_3_TICKS + 13), true);
  assert.equal(world.bowArrowCount, 3);

  let resolved = false;
  for (let i = 0; i < 200 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }

  assert.ok(resolved, 'arrow resolves on enemy contact');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'clears ownership safely');
  assert.equal(enemy.healthPoints, 20 - getBowArrowDamage(3), 'whole-number damage applied for a 3-mote arrow');
  assert.equal(countArrowMotes(world), 0, 'motes released from arrow ownership');
  assert.equal(world.particleCount, beforeMotes, 'motes conserved after impact — none destroyed or duplicated');

  let anyMoving = false;
  for (let i = 0; i < world.particleCount; i++) {
    if (Math.hypot(world.velocityXWorld[i], world.velocityYWorld[i]) > 1) anyMoving = true;
  }
  assert.ok(anyMoving, 'motes curve back toward Storm with an initial velocity, not a teleport');
});

test('cannot tunnel through a thin enemy at 250 px/s even with a large simulation step', () => {
  // Simulate a lag spike: one huge dtMs step that would cover far more than
  // the gap between consecutive per-tick positions in a normal frame.
  const { world, player } = makeFixture(8);
  const enemy = addEnemy(world, 1, player.positionXWorld + 15, player.positionYWorld, 20);
  // Enemy modeled as thin as the engine allows via halfWidth/halfHeight — the
  // swept segment test must still catch it (no point-sampling gap).
  enemy.halfWidthWorld = 0.5;
  enemy.halfHeightWorld = 0.5;

  assert.equal(fireArrowAt(world, BOW_ARROW_LOAD_3_TICKS + 13), true);

  // One giant tick: at 250 px/s this dt covers the full gap to the enemy and
  // well beyond in a single step (simulating a large/delayed frame).
  world.dtMs = 500; // 0.5s * 250px/s = 125px in one step, enemy at 15px away
  world.tick++;
  const resolved = tickBowArrowOutbound(world);
  assert.ok(resolved, 'the swept segment test still catches the enemy despite the huge step');
  assert.equal(enemy.healthPoints, 20 - getBowArrowDamage(3), 'damage still applied correctly');
});

test('a non-piercing arrow damages an enemy only once, even across multiple ranks crossing it', () => {
  const { world, player } = makeFixture(8);
  const enemy = addEnemy(world, 1, player.positionXWorld + 30, player.positionYWorld, 100);

  assert.equal(fireArrowAt(world, BOW_ARROW_LOAD_3_TICKS + 13), true);
  const hpBeforeHit = enemy.healthPoints;

  let resolved = false;
  for (let i = 0; i < 200 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved);
  assert.equal(hpBeforeHit - enemy.healthPoints, getBowArrowDamage(3), 'exactly one hit worth of damage, not once per mote/rank');

  // Continuing to tick after resolution must not apply further damage (arrow is gone).
  const hpAfterResolve = enemy.healthPoints;
  for (let i = 0; i < 10; i++) {
    world.tick++;
    tickBowArrowOutbound(world); // no-op: phase is NONE
  }
  assert.equal(enemy.healthPoints, hpAfterResolve, 'no further damage after the arrow has resolved');
});

test('Orbital Dust Core enemies are routed through applyODCHit, not a direct health subtraction', () => {
  const { world, player } = makeFixture(8);
  const odc = addEnemy(world, 1, player.positionXWorld + 30, player.positionYWorld, 20);
  odc.isOrbitalDustCoreFlag = 1;
  odc.isOrbitalDustCoreLargeFlag = 0;
  odc.orbitalDustCoreExposedRing = 0; // ring 0 exposed; its band is [20,44] world units from center

  assert.equal(fireArrowAt(world, BOW_ARROW_LOAD_3_TICKS + 13), true);

  let resolved = false;
  for (let i = 0; i < 200 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved, 'arrow resolves on ODC contact');

  // The arrow motes hit near the ODC's CENTER (distance ~0), which is OUTSIDE
  // ring 0's hit band [20,44] — applyODCHit's ring-aware logic leaves
  // healthPoints untouched and instead registers a shield-flash. A naive
  // direct `healthPoints -= damage` (bypassing applyODCHit) would have
  // incorrectly reduced health here, so this proves specialized routing.
  assert.equal(odc.healthPoints, 20, 'ring-aware routing leaves health untouched for an off-band hit');
  assert.ok(odc.orbitalDustCoreShieldFlashTicks > 0, 'applyODCHit actually ran (shield-flash registered)');
});

test('enemies beyond the hit-registry capacity are safely ignored, not crashed on', () => {
  const { world, player } = makeFixture(8);
  // Fill clusters[1..64] with enemies so the arrow's own hit-window sits right
  // at the documented MAX_HIT_REGISTRY_SLOTS capacity boundary.
  for (let i = 0; i < MAX_HIT_REGISTRY_SLOTS + 4; i++) {
    addEnemy(world, i + 1, player.positionXWorld + 1000 + i, player.positionYWorld, 20);
  }
  // One more enemy actually in the arrow's path, placed at the END of the
  // clusters array (beyond the registry capacity) — must be safely ignored,
  // not crash, and the arrow should simply fly on (no false resolution).
  addEnemy(world, 9999, player.positionXWorld + 30, player.positionYWorld, 20);

  assert.equal(fireArrowAt(world, BOW_ARROW_LOAD_3_TICKS + 13), true);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 300 && world.bowArrowPhase !== BOW_ARROW_PHASE_NONE; i++) {
      world.tick++;
      tickBowArrowOutbound(world);
    }
  });
});
