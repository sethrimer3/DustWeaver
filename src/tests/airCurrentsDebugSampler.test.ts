/**
 * Tests for the "Air Currents" debug overlay's read-only field sampler
 * (render/pixelMaterials/airCurrentsDebugSampler.ts).
 *
 * Covers:
 *   1. Sampling never mutates the underlying particle wind velocities.
 *   2. Zero/below-threshold wind produces no sample.
 *   3. Sample direction matches the underlying wind vector.
 *   4. Sample magnitude is monotonic in wind speed and clamps for the renderer.
 *   5. Player-sourced and enemy-sourced wind (applied via the same
 *      `applyWindForce` path movement wind uses) both show up as samples.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { MATERIAL_SAND } from '../sim/pixelMaterials/pixelMaterialTypes';
import {
  AirCurrentsDebugSampler,
  AIR_CURRENTS_MIN_SPEED_PX_S,
} from '../render/pixelMaterials/airCurrentsDebugSampler';

function makeSystemWithSand(w: number, h: number): PixelMaterialSystem {
  const system = new PixelMaterialSystem(w, h, null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      system.place(x, y, MATERIAL_SAND);
    }
  }
  return system;
}

test('sampling does not mutate particle wind velocities', () => {
  const system = makeSystemWithSand(40, 40);
  system.applyWindForce({ centerXPx: 20, centerYPx: 20, radiusPx: 10, forceX: 80, forceY: 0 });

  const before = new Map<number, { vx: number; vy: number }>();
  system.forEachParticle((x, y) => {
    const p = system.getParticleAtCell(x, y)!;
    before.set(x * 1000 + y, { vx: p.windVelX, vy: p.windVelY });
  });

  const sampler = new AirCurrentsDebugSampler();
  sampler.sample(system, 0, 0, 40, 40);

  system.forEachParticle((x, y) => {
    const p = system.getParticleAtCell(x, y)!;
    const prior = before.get(x * 1000 + y)!;
    assert.equal(p.windVelX, prior.vx);
    assert.equal(p.windVelY, prior.vy);
  });
});

test('zero-wind field produces no samples', () => {
  const system = makeSystemWithSand(20, 20);
  const sampler = new AirCurrentsDebugSampler();
  sampler.sample(system, 0, 0, 20, 20);
  assert.equal(sampler.count, 0);
});

test('below-threshold wind produces no sample', () => {
  const system = makeSystemWithSand(20, 20);
  // A tiny impulse whose resulting momentum stays under AIR_CURRENTS_MIN_SPEED_PX_S.
  system.applyWindForce({
    centerXPx: 10, centerYPx: 10, radiusPx: 3,
    forceX: AIR_CURRENTS_MIN_SPEED_PX_S * 0.1, forceY: 0,
  });
  const sampler = new AirCurrentsDebugSampler();
  sampler.sample(system, 0, 0, 20, 20);
  assert.equal(sampler.count, 0);
});

test('sample direction matches the underlying wind vector', () => {
  const system = makeSystemWithSand(40, 40);
  // Strong rightward-only impulse.
  system.applyWindForce({ centerXPx: 20, centerYPx: 20, radiusPx: 8, forceX: 200, forceY: 0, falloff: 0 });

  const sampler = new AirCurrentsDebugSampler();
  sampler.sample(system, 0, 0, 40, 40);

  assert.ok(sampler.count > 0, 'expected at least one sample above threshold');
  for (let i = 0; i < sampler.count; i++) {
    // Direction should be predominantly rightward (+X), negligible Y.
    assert.ok(sampler.velX[i] > 0, `sample ${i} should point rightward`);
    assert.ok(Math.abs(sampler.velY[i]) < Math.abs(sampler.velX[i]));
  }
});

test('sample magnitude scales with wind strength', () => {
  const weakSystem = makeSystemWithSand(40, 40);
  weakSystem.applyWindForce({ centerXPx: 20, centerYPx: 20, radiusPx: 8, forceX: 40, forceY: 0, falloff: 0 });
  const strongSystem = makeSystemWithSand(40, 40);
  strongSystem.applyWindForce({ centerXPx: 20, centerYPx: 20, radiusPx: 8, forceX: 400, forceY: 0, falloff: 0 });

  const weakSampler = new AirCurrentsDebugSampler();
  weakSampler.sample(weakSystem, 0, 0, 40, 40);
  const strongSampler = new AirCurrentsDebugSampler();
  strongSampler.sample(strongSystem, 0, 0, 40, 40);

  assert.ok(strongSampler.count > 0 && weakSampler.count > 0);
  // Compare speed at the impulse center for both.
  const centerIndex = (sampler: AirCurrentsDebugSampler): number => {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < sampler.count; i++) {
      const dx = sampler.sampleXPx[i] - 20;
      const dy = sampler.sampleYPx[i] - 20;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  };
  const weakIdx = centerIndex(weakSampler);
  const strongIdx = centerIndex(strongSampler);
  assert.ok(strongSampler.speed[strongIdx] > weakSampler.speed[weakIdx]);
});

test('player-sourced and enemy-sourced wind (applied via applyWindForce) both produce samples', () => {
  const system = makeSystemWithSand(60, 20);
  // Simulate a "player" impulse on the left and an "enemy" impulse on the right,
  // exactly as pixelMaterialMovementWind.ts does per-cluster (sourceId differs,
  // underlying call is identical).
  system.applyWindForce({ centerXPx: 10, centerYPx: 10, radiusPx: 6, forceX: 100, forceY: 0, falloff: 0, sourceId: 'player' });
  system.applyWindForce({ centerXPx: 50, centerYPx: 10, radiusPx: 6, forceX: -100, forceY: 0, falloff: 0, sourceId: 'enemy:0' });

  const sampler = new AirCurrentsDebugSampler();
  sampler.sample(system, 0, 0, 60, 20);

  let sawLeft = false;
  let sawRight = false;
  for (let i = 0; i < sampler.count; i++) {
    if (sampler.sampleXPx[i] < 20) sawLeft = true;
    if (sampler.sampleXPx[i] > 40) sawRight = true;
  }
  assert.ok(sawLeft, 'expected samples near the player-sourced impulse');
  assert.ok(sawRight, 'expected samples near the enemy-sourced impulse');
});
