/**
 * roomPreparationCostModel.test.ts — the deadline arithmetic behind the graded
 * transition fallback.
 *
 * The properties asserted here are the ones that keep the seamless inline path
 * safe: it must stay closed until there is real measured evidence, it must
 * close again under frame pressure, and background streaming must not chatter
 * on and off around a single threshold.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RoomPreparationCostModel,
  RESIDENT_BUILD_PHASE_ORDER,
  SEED_PHASE_COST_MS,
  INLINE_COMPLETION_BUDGET_MS,
  FRAME_BUDGET_HIGH_MS,
  FRAME_BUDGET_LOW_MS,
  classifyFallbackCause,
  decideTransitionFallback,
} from '../screens/roomPreparationCostModel';

// ── Bootstrapping safety ─────────────────────────────────────────────────────

test('an unmeasured model never qualifies a build for inline completion', () => {
  const model = new RoomPreparationCostModel();
  // Even one phase from the end, the pessimistic seed must exceed the budget:
  // this is what stops the model gambling on guesses before it has evidence.
  const last = RESIDENT_BUILD_PHASE_ORDER[RESIDENT_BUILD_PHASE_ORDER.length - 2];
  assert.ok(model.estimateRemainingMs(last) > INLINE_COMPLETION_BUDGET_MS);
  assert.equal(SEED_PHASE_COST_MS > INLINE_COMPLETION_BUDGET_MS, true);
});

test('estimate covers the whole generator for a build that has not yielded', () => {
  const model = new RoomPreparationCostModel();
  const full = model.estimateRemainingMs(null);
  const nearEnd = model.estimateRemainingMs('phaseE_sim');
  assert.ok(full > nearEnd, 'a fresh build must estimate higher than a nearly-done one');
  // An unrecognised label (e.g. the scheduler's 'starting') is treated as
  // "nothing finished yet" rather than silently estimating zero.
  assert.equal(model.estimateRemainingMs('starting'), full);
});

test('estimate shrinks monotonically as phases complete', () => {
  const model = new RoomPreparationCostModel();
  let prev = model.estimateRemainingMs(null);
  for (const label of RESIDENT_BUILD_PHASE_ORDER) {
    const next = model.estimateRemainingMs(label);
    assert.ok(next <= prev, `estimate rose after ${label}: ${prev} → ${next}`);
    prev = next;
  }
  assert.equal(prev, 0, 'nothing remains after the final phase');
});

// ── Measurement ──────────────────────────────────────────────────────────────

test('measured phases replace the seed and drive the estimate down', () => {
  const model = new RoomPreparationCostModel();
  // Feed cheap measurements for every phase, repeatedly so the EWMA converges.
  for (let i = 0; i < 40; i++) {
    for (const label of RESIDENT_BUILD_PHASE_ORDER) model.noteMeasuredPhase(label, 0.2);
    // A build with a baked wall template emits no merge slices at all, which is
    // what pulls the merge-repeat estimate down to near zero.
    model.noteMeasuredPhase('phaseD_walls_build', 0.2);
  }
  const remaining = model.estimateRemainingMs('phaseD_walls_lookup');
  assert.ok(
    remaining < INLINE_COMPLETION_BUDGET_MS,
    `cheap measured phases should fit the inline budget, got ${remaining}ms`,
  );
});

test('negative and non-finite samples are ignored rather than poisoning the EWMA', () => {
  const model = new RoomPreparationCostModel();
  const before = model.phaseCostMs('phaseA');
  model.noteMeasuredPhase('phaseA', Number.NaN);
  model.noteMeasuredPhase('phaseA', -5);
  model.noteMeasuredPhase('phaseA', Number.POSITIVE_INFINITY);
  assert.equal(model.phaseCostMs('phaseA'), before);
  model.noteFrameMs(Number.NaN);
  assert.equal(model.smoothedFrameMs(), 0);
});

// ── Frame headroom and hysteresis ────────────────────────────────────────────

test('background work stops above the high threshold and only resumes below the low one', () => {
  const model = new RoomPreparationCostModel();
  assert.equal(model.isBackgroundWorkAllowed(), true, 'permissive before any sample');

  // Sustained heavy frames must close the gate.
  for (let i = 0; i < 60; i++) model.noteFrameMs(FRAME_BUDGET_HIGH_MS + 6);
  assert.equal(model.isBackgroundWorkAllowed(), false);

  // Recovering only into the hysteresis band must NOT reopen it — this is the
  // whole point of the band: a frame time hovering at the threshold would
  // otherwise toggle streaming every frame.
  const mid = (FRAME_BUDGET_HIGH_MS + FRAME_BUDGET_LOW_MS) / 2;
  for (let i = 0; i < 60; i++) model.noteFrameMs(mid);
  assert.equal(model.isBackgroundWorkAllowed(), false, 'reopened inside the hysteresis band');

  // Falling clearly below the low threshold reopens it.
  for (let i = 0; i < 60; i++) model.noteFrameMs(2);
  assert.equal(model.isBackgroundWorkAllowed(), true);
});

test('a single anomalous frame does not swing the smoothed signal', () => {
  const model = new RoomPreparationCostModel();
  for (let i = 0; i < 60; i++) model.noteFrameMs(4);
  model.noteFrameMs(120); // one GC pause
  assert.equal(
    model.isBackgroundWorkAllowed(), true,
    'one outlier frame must not shut down streaming',
  );

  // But a SUSTAINED regression at the same cost must still be caught promptly —
  // outlier resistance must not become blindness.
  for (let i = 0; i < 30; i++) model.noteFrameMs(120);
  assert.equal(
    model.isBackgroundWorkAllowed(), false,
    'sustained heavy frames must still shut down streaming',
  );
});

test('inline budget collapses to zero once the frame is already at budget', () => {
  const model = new RoomPreparationCostModel();
  for (let i = 0; i < 60; i++) model.noteFrameMs(FRAME_BUDGET_HIGH_MS + 4);
  assert.equal(model.inlineCompletionBudgetMs(), 0);
  // With zero budget the decision must refuse the inline path outright.
  const decision = decideTransitionFallback({
    estimatedRemainingMs: 0.1, inlineBudgetMs: 0, hasGenerator: true, assetsReady: true,
  });
  assert.equal(decision.grade, 'covered');
  assert.equal(decision.rejectedBecause, 'noFrameHeadroom');
});

test('inline budget is capped even when the frame is completely idle', () => {
  const model = new RoomPreparationCostModel();
  for (let i = 0; i < 60; i++) model.noteFrameMs(0.5);
  assert.ok(model.inlineCompletionBudgetMs() <= INLINE_COMPLETION_BUDGET_MS);
});

// ── Graded decision ──────────────────────────────────────────────────────────

test('inline completion is taken only when every precondition holds', () => {
  const base = {
    estimatedRemainingMs: 1, inlineBudgetMs: 6, hasGenerator: true, assetsReady: true,
  };
  assert.equal(decideTransitionFallback(base).grade, 'inlineCompletion');
  assert.equal(decideTransitionFallback({ ...base, hasGenerator: false }).rejectedBecause, 'noGenerator');
  // Assets are an I/O wait, not CPU work: no amount of frame budget makes an
  // undecoded sprite land, so this must fall back regardless of the estimate.
  assert.equal(decideTransitionFallback({ ...base, assetsReady: false }).rejectedBecause, 'assetsNotReady');
  assert.equal(
    decideTransitionFallback({ ...base, estimatedRemainingMs: 50 }).grade, 'covered',
    'an estimate over budget must not attempt the inline path',
  );
});

test('every fallback rejection carries a reason', () => {
  const cases = [
    { estimatedRemainingMs: 1,  inlineBudgetMs: 6, hasGenerator: false, assetsReady: true },
    { estimatedRemainingMs: 1,  inlineBudgetMs: 6, hasGenerator: true,  assetsReady: false },
    { estimatedRemainingMs: 1,  inlineBudgetMs: 0, hasGenerator: true,  assetsReady: true },
    { estimatedRemainingMs: 99, inlineBudgetMs: 6, hasGenerator: true,  assetsReady: true },
  ];
  for (const c of cases) {
    const d = decideTransitionFallback(c);
    assert.equal(d.grade, 'covered');
    assert.notEqual(d.rejectedBecause, '', `no reason given for ${JSON.stringify(c)}`);
  }
});

// ── Cause classification ─────────────────────────────────────────────────────

test('miss reasons map onto structured fallback causes', () => {
  assert.equal(classifyFallbackCause('none'), 'NONE');
  assert.equal(classifyFallbackCause(''), 'NONE');
  assert.equal(classifyFallbackCause('residentMissing'), 'UNPREDICTED_DESTINATION');
  assert.equal(classifyFallbackCause('runtimeNotReady'), 'CPU_BUILD_LATE');
  assert.equal(classifyFallbackCause('buildQueued'), 'CPU_BUILD_LATE');
  assert.equal(classifyFallbackCause('buildInProgress:phaseD_walls_build'), 'CPU_BUILD_LATE');
  assert.equal(classifyFallbackCause('worldNull'), 'MEMORY_EVICTED');
  assert.equal(classifyFallbackCause('roomIdMismatch'), 'MEMORY_EVICTED');
  assert.equal(classifyFallbackCause('entryViewportNotCovered'), 'GPU_WARMUP_LATE');
  assert.equal(classifyFallbackCause('crossZone'), 'CROSS_ZONE');
  assert.equal(classifyFallbackCause('something-new'), 'OTHER');
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

test('reset returns the model to its pessimistic starting state', () => {
  const model = new RoomPreparationCostModel();
  for (let i = 0; i < 40; i++) {
    for (const label of RESIDENT_BUILD_PHASE_ORDER) model.noteMeasuredPhase(label, 0.1);
    model.noteFrameMs(30);
  }
  model.reset();
  assert.equal(model.smoothedFrameMs(), 0);
  assert.equal(model.isBackgroundWorkAllowed(), true);
  assert.equal(model.phaseCostMs('phaseA'), SEED_PHASE_COST_MS);
  assert.ok(model.estimateRemainingMs('phaseE_sim') > INLINE_COMPLETION_BUDGET_MS);
});
