import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStraightBowAimEnd,
  computeBowPreviewShouldBeVisible,
  BowTrajectoryPreviewRenderer,
  BOW_PREVIEW_MAX_RANGE_WORLD,
} from '../render/effects/bowTrajectoryPreviewRenderer';
import { SecondaryWeaveGesturePhase } from '../input/secondaryWeaveGesture';
import { BOW_ARROW_PHASE_ASSEMBLING, BOW_ARROW_PHASE_NONE, BOW_ARROW_PHASE_OUTBOUND } from '../sim/weaves/bowArrow';
import { GOLD_DUST_MAX_TRAVEL_PX } from '../sim/motes/moteTypeConfig';

test('bow aim preview is a straight line of the Gold Dust max travel length', () => {
  assert.equal(BOW_PREVIEW_MAX_RANGE_WORLD, GOLD_DUST_MAX_TRAVEL_PX);
  const out = { x: 0, y: 0 };
  computeStraightBowAimEnd(out, 0, 0, 1, 0, BOW_PREVIEW_MAX_RANGE_WORLD, null);
  assert.equal(out.x, GOLD_DUST_MAX_TRAVEL_PX, 'straight along +x');
  assert.equal(out.y, 0, 'no vertical drop — the aim line is always straight');
});

test('bow aim preview stays straight for a diagonal aim (no ballistic curve)', () => {
  const out = { x: 0, y: 0 };
  const inv = 1 / Math.SQRT2;
  computeStraightBowAimEnd(out, 10, 10, 1, 1, 100, null);
  // End lies exactly on the ray from the start along the normalized aim.
  assert.ok(Math.abs(out.x - (10 + inv * 100)) < 1e-4);
  assert.ok(Math.abs(out.y - (10 + inv * 100)) < 1e-4);
});

test('bow aim preview clips at a terrain raycast hit', () => {
  const out = { x: 0, y: 0 };
  const raycast = () => ({ x: 5, y: 0 });
  computeStraightBowAimEnd(out, 0, 0, 1, 0, BOW_PREVIEW_MAX_RANGE_WORLD, raycast);
  assert.equal(out.x, 5);
  assert.equal(out.y, 0);
});

// ── Task section 8: zero-length aim uses the simulation's own fallback ──────

test('zero-length aim delta falls back to the caller-supplied (simulation-owned) direction, not a hardcoded default', () => {
  const out = { x: 0, y: 0 };
  // Simulation is holding a previously-resolved "aimed up" direction.
  computeStraightBowAimEnd(out, 0, 0, 0, 0, 100, null, 0, -1);
  assert.ok(Math.abs(out.x - 0) < 1e-6, 'must stay pointed up (x=0), not snap to the hardcoded (1,0) default');
  assert.ok(Math.abs(out.y - -100) < 1e-6, 'must extend upward using the supplied fallback');
});

test('regression: aim upward, then move the cursor exactly onto the player — preview stays aimed upward', () => {
  const out = { x: 0, y: 0 };
  // Step 1: player aims upward — simulation resolves and stores dir=(0,-1)
  // (this mirrors what tickBowArrowAssembly does internally).
  const aimLen1 = Math.hypot(0, -40);
  const simulatedDirX = 0 / aimLen1;
  const simulatedDirY = -40 / aimLen1;
  assert.ok(Math.abs(simulatedDirX - 0) < 1e-9 && Math.abs(simulatedDirY - -1) < 1e-9);

  // Step 2: cursor moves exactly onto the player (zero-length aim delta this
  // frame). The preview must use the simulation's last-resolved direction
  // (captured above) as its fallback — exactly what the render() call site
  // now passes via snapshot.bowArrowDirXWorld/YWorld.
  computeStraightBowAimEnd(out, 0, 0, 0, 0, 100, null, simulatedDirX, simulatedDirY);
  assert.ok(Math.abs(out.x - 0) < 1e-6, 'preview remains aimed upward (x=0)');
  assert.ok(out.y < 0, 'preview remains aimed upward (negative y = up)');
  assert.ok(Math.abs(out.y - -100) < 1e-6, 'extends the full range in the up direction, not the hardcoded rightward default');
});

test('default fallback (no explicit args) matches the prior always-rightward behavior for callers that pass none', () => {
  const out = { x: 0, y: 0 };
  computeStraightBowAimEnd(out, 0, 0, 0, 0, 100, null);
  assert.equal(out.x, 100);
  assert.equal(out.y, 0);
});

test('bow preview visibility requires unlock + held gesture + assembling arrow', () => {
  assert.equal(computeBowPreviewShouldBeVisible(0, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_ASSEMBLING), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Idle, BOW_ARROW_PHASE_ASSEMBLING), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_NONE), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_OUTBOUND), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_ASSEMBLING), true);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Press, BOW_ARROW_PHASE_ASSEMBLING), true);
});

test('renderer reset() clears stale fade-alpha interpolation state back to fresh-load default', () => {
  const renderer = new BowTrajectoryPreviewRenderer();
  const rendererAny = renderer as unknown as { _visibleAlpha: number };
  rendererAny._visibleAlpha = 0.85;
  renderer.reset();
  assert.equal(rendererAny._visibleAlpha, 0, 'visible alpha must reset to 0');
});
