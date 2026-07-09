import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideEntryWarm,
  type EntryWarmCoverageSnapshot,
  type EntryWarmDecisionInput,
} from '../screens/entryWarmDecision';

/**
 * Coverage for the pure entry-warm readiness decision helper. This is the
 * logic that used to be inlined in `entryViewportWarm.ts::tickEntryWarm` —
 * extracted so the soft/hard timeout and core-vs-margin coverage semantics
 * can be verified with plain `node --test`, without DOM, canvas, Vite
 * `import.meta.glob`, or any renderer module.
 */

const SOFT_MAX_FRAMES = 8;
const SOFT_BUDGET_MS = 120;
const HARD_BUDGET_MS = 2000;

function makeCoverage(overrides: Partial<EntryWarmCoverageSnapshot> = {}): EntryWarmCoverageSnapshot {
  return {
    wallCoreCovered: false,
    bgCoreCovered: false,
    wallMarginCovered: false,
    bgMarginCovered: false,
    fullReady: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<EntryWarmDecisionInput> = {}): EntryWarmDecisionInput {
  return {
    nowMs: 0,
    enteredAtMs: 0,
    frameCount: 0,
    softMaxFrames: SOFT_MAX_FRAMES,
    softBudgetMs: SOFT_BUDGET_MS,
    hardBudgetMs: HARD_BUDGET_MS,
    coverage: makeCoverage(),
    ...overrides,
  };
}

test('full margin coverage returns ready, even before any timeout', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: 10, enteredAtMs: 0, frameCount: 1,
    coverage: makeCoverage({ fullReady: true }),
  }));
  assert.deepEqual(decision, { kind: 'ready' });
});

test('full margin coverage returns ready even if the hard budget has also been exceeded', () => {
  // fullReady must win regardless of timing — there's no more work to do.
  const decision = decideEntryWarm(makeInput({
    nowMs: 5000, enteredAtMs: 0, frameCount: 999,
    coverage: makeCoverage({ fullReady: true, wallCoreCovered: false, bgCoreCovered: false }),
  }));
  assert.deepEqual(decision, { kind: 'ready' });
});

test('soft timeout with missing wall core coverage returns continue', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: SOFT_BUDGET_MS + 1, enteredAtMs: 0, frameCount: SOFT_MAX_FRAMES,
    coverage: makeCoverage({ wallCoreCovered: false, bgCoreCovered: true }),
  }));
  assert.equal(decision.kind, 'continue');
});

test('soft timeout with missing background core coverage returns continue', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: SOFT_BUDGET_MS + 1, enteredAtMs: 0, frameCount: SOFT_MAX_FRAMES,
    coverage: makeCoverage({ wallCoreCovered: true, bgCoreCovered: false }),
  }));
  assert.equal(decision.kind, 'continue');
});

test('soft timeout with both core coverages true but margin coverage false returns softTimedOut', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: SOFT_BUDGET_MS + 1, enteredAtMs: 0, frameCount: SOFT_MAX_FRAMES,
    coverage: makeCoverage({
      wallCoreCovered: true, bgCoreCovered: true,
      wallMarginCovered: false, bgMarginCovered: false,
      fullReady: false,
    }),
  }));
  assert.equal(decision.kind, 'softTimedOut');
  if (decision.kind === 'softTimedOut') {
    assert.equal(typeof decision.reason, 'string');
    assert.ok(decision.reason.length > 0);
  }
});

test('soft timeout triggered by frame count alone (before the ms budget) still requires core coverage', () => {
  const decisionNotCovered = decideEntryWarm(makeInput({
    nowMs: 1, enteredAtMs: 0, frameCount: SOFT_MAX_FRAMES, // ms budget not exceeded, frame budget is
    coverage: makeCoverage({ wallCoreCovered: false, bgCoreCovered: false }),
  }));
  assert.equal(decisionNotCovered.kind, 'continue');

  const decisionCovered = decideEntryWarm(makeInput({
    nowMs: 1, enteredAtMs: 0, frameCount: SOFT_MAX_FRAMES,
    coverage: makeCoverage({ wallCoreCovered: true, bgCoreCovered: true }),
  }));
  assert.equal(decisionCovered.kind, 'softTimedOut');
});

test('hard timeout returns hardTimedOut even if core coverage is false', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: HARD_BUDGET_MS + 1, enteredAtMs: 0, frameCount: 50,
    coverage: makeCoverage({ wallCoreCovered: false, bgCoreCovered: false }),
  }));
  assert.equal(decision.kind, 'hardTimedOut');
  if (decision.kind === 'hardTimedOut') {
    assert.match(decision.reason, /hard timeout/i);
  }
});

test('hard timeout returns hardTimedOut even if core coverage is true (still not fullReady)', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: HARD_BUDGET_MS + 1, enteredAtMs: 0, frameCount: 50,
    coverage: makeCoverage({ wallCoreCovered: true, bgCoreCovered: true, fullReady: false }),
  }));
  assert.equal(decision.kind, 'hardTimedOut');
});

test('hard timeout takes priority over soft timeout when both are exceeded', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: HARD_BUDGET_MS + 1, enteredAtMs: 0, frameCount: 999,
    coverage: makeCoverage({ wallCoreCovered: true, bgCoreCovered: true }),
  }));
  assert.equal(decision.kind, 'hardTimedOut');
});

test('no timeout and incomplete coverage returns continue', () => {
  const decision = decideEntryWarm(makeInput({
    nowMs: 10, enteredAtMs: 0, frameCount: 1,
    coverage: makeCoverage({ wallCoreCovered: false, bgCoreCovered: false, fullReady: false }),
  }));
  assert.deepEqual(decision, { kind: 'continue' });
});

test('no timeout even with full core coverage still returns continue (soft timeout has not fired yet)', () => {
  // Core coverage alone is not sufficient to release before the soft budget —
  // only a soft/hard timeout (or fullReady) triggers a finish.
  const decision = decideEntryWarm(makeInput({
    nowMs: 1, enteredAtMs: 0, frameCount: 1,
    coverage: makeCoverage({ wallCoreCovered: true, bgCoreCovered: true, fullReady: false }),
  }));
  assert.deepEqual(decision, { kind: 'continue' });
});
