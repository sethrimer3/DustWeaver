import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { SolidMask } from '../sim/pixelMaterials/pixelMaterialSolid';
import {
  MATERIAL_SAND, MATERIAL_SAND_2X2, getMaterialWindResponse,
} from '../sim/pixelMaterials/pixelMaterialTypes';

// ── Part 2: dedupe / allocation-reduction correctness ───────────────────────

test('a 2x2 particle touched via multiple footprint cells is affected exactly once per wind call', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 8, 20, 20); // floor right under the particle so it rests in place
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 6, MATERIAL_SAND_2X2);
  for (let i = 0; i < 25; i++) sys.step(); // let it settle/sleep at (5,6)
  sys.resetWindDiagnostics();

  // Radius wide enough to cover all 4 footprint cells (5,6)-(6,7).
  sys.applyWindForce({ centerXPx: 5.5, centerYPx: 6.5, radiusPx: 5, forceX: 50, forceY: 0 });

  assert.equal(sys.windImpulsesThisTick, 1);
  assert.equal(sys.windParticlesAffectedThisTick, 1); // NOT 4 — deduped despite 4 covered cells
});

test('repeated wind calls do not leak dedupe state between calls (each call recomputes its own affected set)', () => {
  const sys = new PixelMaterialSystem(20, 20, new SolidMask(20, 20));
  sys.place(2, 2, MATERIAL_SAND);
  sys.place(15, 15, MATERIAL_SAND);
  sys.resetWindDiagnostics();

  sys.applyWindForce({ centerXPx: 2, centerYPx: 2, radiusPx: 2, forceX: 50, forceY: 0 });
  assert.equal(sys.windParticlesAffectedThisTick, 1);

  sys.applyWindForce({ centerXPx: 15, centerYPx: 15, radiusPx: 2, forceX: 50, forceY: 0 });
  // Second call's count should reflect only its own affected particle (1),
  // accumulated on top of the first (total 2) — not double-counting the
  // first call's particle again via stale scratch-set state.
  assert.equal(sys.windParticlesAffectedThisTick, 2);
});

// ── Part 3: 2x2 wind response tuning ─────────────────────────────────────────

test('material wind-response table: 1x1 sand is full response, 2x2 sand is reduced', () => {
  assert.equal(getMaterialWindResponse(MATERIAL_SAND), 1);
  assert.ok(getMaterialWindResponse(MATERIAL_SAND_2X2) < 1);
  assert.ok(getMaterialWindResponse(MATERIAL_SAND_2X2) > 0);
});

test('the same wind impulse affects both a 1x1 and a 2x2 particle', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 15, 20, 20); // floor so both particles come to rest and sleep
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(2, 14, MATERIAL_SAND);
  sys.place(10, 13, MATERIAL_SAND_2X2);
  for (let i = 0; i < 25; i++) sys.step();
  assert.equal(sys.activeCount, 0);

  sys.applyWindForce({ centerXPx: 2, centerYPx: 14, radiusPx: 3, forceX: 200, forceY: 0 });
  sys.applyWindForce({ centerXPx: 10, centerYPx: 14, radiusPx: 3, forceX: 200, forceY: 0 });
  assert.equal(sys.activeCount, 2); // both woken
});

test('under an identical wind impulse, 2x2 sand moves less than 1x1 sand (heavier feel)', () => {
  // A floor is required: sideways wind displacement only applies once a
  // particle is resting (gravity/diagonal fall always takes priority over
  // wind while a downward move is available — see stepParticle()).
  const solid1x1 = new SolidMask(30, 30);
  solid1x1.markRect(0, 20, 30, 30);
  const solid2x2 = new SolidMask(30, 30);
  solid2x2.markRect(0, 20, 30, 30);
  const sys1x1 = new PixelMaterialSystem(30, 30, solid1x1);
  const sys2x2 = new PixelMaterialSystem(30, 30, solid2x2);

  sys1x1.place(5, 19, MATERIAL_SAND);
  sys2x2.place(5, 18, MATERIAL_SAND_2X2);
  for (let i = 0; i < 25; i++) { sys1x1.step(); sys2x2.step(); }
  assert.equal(sys1x1.activeCount, 0);
  assert.equal(sys2x2.activeCount, 0);

  const wind = { centerXPx: 5, centerYPx: 19, radiusPx: 4, forceX: 150, forceY: 0 };
  sys1x1.applyWindForce(wind);
  sys2x2.applyWindForce(wind);

  for (let i = 0; i < 6; i++) { sys1x1.step(); sys2x2.step(); }

  let x1x1 = -1;
  let x2x2 = -1;
  sys1x1.forEachParticle(x => { x1x1 = x; });
  sys2x2.forEachParticle(x => { x2x2 = x; });

  const displacement1x1 = x1x1 - 5;
  const displacement2x2 = x2x2 - 5;
  assert.ok(displacement1x1 > 0, '1x1 sand should have moved under wind');
  assert.ok(displacement2x2 <= displacement1x1, '2x2 sand should move no further than 1x1 sand under the same gust');
});
