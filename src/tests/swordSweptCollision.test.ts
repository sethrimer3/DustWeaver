import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import {
  startNewSwordSwipe,
  tickNewSwordSwipe,
  NEW_SWORD_SLASH_TICKS,
} from '../sim/weaves/swordWeave';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 8) {
  const world = createWorldState(DT_MS, 21);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  player.healthPoints = moteCount;
  player.maxHealthPoints = moteCount;
  return { world, player };
}

function addEnemy(world: ReturnType<typeof createWorldState>, x: number, y: number, hp = 20) {
  const enemy = createClusterState(1, x, y, 0, hp);
  world.clusters.push(enemy);
  return enemy;
}

interface Sample { rank: number; x: number; y: number; tick: number }

/** Runs a full swipe with no enemies present and records every mote's position at every tick. */
function recordSwordPath(world: ReturnType<typeof createWorldState>, player: ReturnType<typeof createClusterState>): Sample[] {
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  const samples: Sample[] = [];
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) {
    tickNewSwordSwipe(world);
    for (let r = 0; r < world.newSwordMoteCount; r++) {
      const pidx = world.newSwordMoteParticleIndex[r];
      if (pidx < 0) continue;
      samples.push({ rank: r, x: world.canonicalMoteXWorld[pidx], y: world.canonicalMoteYWorld[pidx], tick: i });
    }
  }
  return samples;
}

test('an enemy positioned exactly where an outer visible mote sweeps is hit (visual geometry == damage geometry)', () => {
  const { world, player } = makeFixture(8);
  const samples = recordSwordPath(world, player);
  // The swipe has already completed and released by now (newSwordMoteCount
  // reset to 0) — derive the actual blade mote count from the recorded
  // samples themselves rather than reading the now-reset world field.
  const moteCount = 1 + samples.reduce((m, s) => Math.max(m, s.rank), 0);

  // Pick a sample from the HIGHEST rank (outer mote, farthest visual radius)
  // partway through the sweep — this is exactly where the old fixed-radius/
  // angle-cone hitbox could disagree with the true outer-mote position.
  const outerSample = samples
    .filter(s => s.rank === moteCount - 1)
    .find(s => s.tick >= Math.floor(NEW_SWORD_SLASH_TICKS * 0.4));
  assert.ok(outerSample, 'expected at least one late-sweep sample from the outermost rank');

  const { world: world2, player: player2 } = makeFixture(8);
  const enemy = addEnemy(world2, outerSample!.x, outerSample!.y, 20);
  startNewSwordSwipe(world2, player2, 1, player2.positionXWorld + 20, player2.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) tickNewSwordSwipe(world2);

  assert.ok(enemy.healthPoints < 20, 'enemy positioned exactly on the outer mote\'s swept path must be hit');
});

test('an enemy well outside every swept mote path is not hit', () => {
  const { world, player } = makeFixture(8);
  // Directly behind the player, far from the crescent's forward-sweeping arc.
  const enemy = addEnemy(world, player.positionXWorld - 200, player.positionYWorld - 200, 20);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) tickNewSwordSwipe(world);
  assert.equal(enemy.healthPoints, 20, 'an enemy far outside the swept crescent must take no damage');
});

test('low mote-count reach matches the visible (single) mote — an enemy beyond its actual radius is not hit', () => {
  const { world, player } = makeFixture(1);
  const samples = recordSwordPath(world, player);
  const maxRadius = samples.reduce((m, s) => {
    const d = Math.hypot(s.x - player.positionXWorld, s.y - player.positionYWorld);
    return Math.max(m, d);
  }, 0);

  const { world: world2, player: player2 } = makeFixture(1);
  // Place an enemy well beyond the single mote's actual maximum swept radius
  // PLUS the combined mote/enemy hit-radius margin, along its forward aim
  // direction — the old fixed-reach hitbox (independent of visible mote
  // count) could still hit this if reach didn't shrink with the blade; the
  // new geometry must not. Shrink the enemy's own half-size to near-zero so
  // only the mote's own hit radius is in play (isolates the reach itself).
  const enemy = addEnemy(world2, player2.positionXWorld + maxRadius + 20, player2.positionYWorld, 20);
  enemy.halfWidthWorld = 0.01;
  enemy.halfHeightWorld = 0.01;
  startNewSwordSwipe(world2, player2, 1, player2.positionXWorld + 20, player2.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) tickNewSwordSwipe(world2);
  assert.equal(enemy.healthPoints, 20, 'reach with a single available mote must match that mote\'s actual visible path, not a larger abstract cone');
});

test('high mote-count reach matches the visible outer mote — an enemy at the full 8-mote outer radius is hit', () => {
  const { world, player } = makeFixture(8);
  const samples = recordSwordPath(world, player);
  // The swipe has already completed and released by now (newSwordMoteCount
  // reset to 0) — derive the actual blade mote count from the recorded
  // samples themselves rather than reading the now-reset world field.
  const moteCount = 1 + samples.reduce((m, s) => Math.max(m, s.rank), 0);
  // Find the peak radius reached by the OUTERMOST rank specifically.
  const outerRankSamples = samples.filter(s => s.rank === moteCount - 1);
  let bestSample = outerRankSamples[0];
  let bestRadius = 0;
  for (const s of outerRankSamples) {
    const d = Math.hypot(s.x - player.positionXWorld, s.y - player.positionYWorld);
    if (d > bestRadius) { bestRadius = d; bestSample = s; }
  }

  const { world: world2, player: player2 } = makeFixture(8);
  const enemy = addEnemy(world2, bestSample.x, bestSample.y, 20);
  startNewSwordSwipe(world2, player2, 1, player2.positionXWorld + 20, player2.positionYWorld);
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) tickNewSwordSwipe(world2);
  assert.ok(enemy.healthPoints < 20, 'an enemy at the outermost mote\'s actual peak radius (8-mote blade) must be hit — reach extends with more motes');
});

test('one enemy takes damage only once per swipe, even though multiple motes cross it', () => {
  const { world, player } = makeFixture(8);
  // Place the enemy at the player's own position offset toward the aim, at a
  // shallow radius most/all ranks will sweep near at some point.
  const enemy = addEnemy(world, player.positionXWorld + 10, player.positionYWorld, 100);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  const hpTrace: number[] = [enemy.healthPoints];
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS; i++) {
    tickNewSwordSwipe(world);
    hpTrace.push(enemy.healthPoints);
  }
  let dropCount = 0;
  for (let i = 1; i < hpTrace.length; i++) {
    if (hpTrace[i] < hpTrace[i - 1]) dropCount++;
  }
  assert.ok(dropCount <= 1, `enemy must be damaged at most once across the whole swipe, saw ${dropCount} drops`);
});
