/**
 * Coverage for the room-transition entity crossfade controller
 * (render/adjacent/adjacentEntityFade.ts).
 *
 * Verifies: incoming/outgoing alpha curves and completion, the outgoing ghost
 * only exists when a snapshot is retained (player/player-owned visuals are never
 * routed through this controller and so never fade), rapid transitions replace
 * and retire the prior snapshot without accumulating, pausing (dt = 0) freezes
 * timing, and a blocking overlay clears the stale outgoing ghost.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AdjacentEntityFadeController,
  easeInOutCubic,
  DEFAULT_ENTITY_FADE_MS,
} from '../render/adjacent/adjacentEntityFade';

test('default duration is ~180ms and eases smoothly', () => {
  assert.equal(DEFAULT_ENTITY_FADE_MS, 180);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9);
  assert.equal(easeInOutCubic(-5), 0, 'clamps below 0');
  assert.equal(easeInOutCubic(5), 1, 'clamps above 1');
});

test('incoming fades 0→1 and outgoing fades 1→0 over the interval', () => {
  const c = new AdjacentEntityFadeController<string>();
  c.beginCrossing('outgoing-snapshot');
  assert.ok(c.incomingAlpha < 0.01, 'incoming starts near 0');
  assert.ok(c.outgoingAlpha > 0.99, 'outgoing starts near 1');

  c.advance(90); // halfway
  assert.ok(Math.abs(c.incomingAlpha - 0.5) < 1e-6);
  assert.ok(Math.abs(c.outgoingAlpha - 0.5) < 1e-6);
  assert.ok(Math.abs(c.incomingAlpha + c.outgoingAlpha - 1) < 1e-9, 'alphas are complementary');

  c.advance(90); // complete
  assert.equal(c.isComplete, true);
  assert.equal(c.incomingAlpha, 1);
  assert.equal(c.outgoingAlpha, 0, 'outgoing snapshot released on completion');
  assert.equal(c.outgoingSnapshot, null);
});

test('no outgoing snapshot means no ghost (outgoing alpha stays 0)', () => {
  const c = new AdjacentEntityFadeController<string>();
  c.beginCrossing(null);
  assert.equal(c.outgoingAlpha, 0);
  c.advance(90);
  assert.equal(c.outgoingAlpha, 0);
  assert.ok(c.incomingAlpha > 0, 'incoming still fades in');
});

test('pausing (dt = 0) freezes fade timing instead of advancing', () => {
  const c = new AdjacentEntityFadeController<string>();
  c.beginCrossing('snap');
  c.advance(45);
  const frozen = c.incomingAlpha;
  for (let i = 0; i < 100; i++) c.advance(0); // paused frames
  assert.equal(c.incomingAlpha, frozen, 'no wall-clock advance while paused');
  c.advance(135); // resume to completion
  assert.equal(c.isComplete, true);
});

test('rapid transitions replace and retire the prior snapshot without accumulating', () => {
  const retired: string[] = [];
  const c = new AdjacentEntityFadeController<string>({ onRetireSnapshot: (s) => retired.push(s) });
  c.beginCrossing('snap-A');
  c.advance(20);
  c.beginCrossing('snap-B'); // interrupts mid-fade
  assert.deepEqual(retired, ['snap-A'], 'previous snapshot retired exactly once');
  assert.equal(c.outgoingSnapshot, 'snap-B', 'only the newest snapshot is retained');
  assert.ok(c.incomingAlpha < 0.01, 'fade restarts from 0');

  c.advance(180);
  assert.deepEqual(retired, ['snap-A', 'snap-B'], 'completing retires the current snapshot too');
});

test('blocking overlay clears the stale outgoing ghost and restarts incoming fade', () => {
  const retired: string[] = [];
  const c = new AdjacentEntityFadeController<string>({ onRetireSnapshot: (s) => retired.push(s) });
  c.beginCrossing('snap');
  c.advance(30);
  c.clearForBlockingOverlay();
  assert.deepEqual(retired, ['snap'], 'stale ghost dropped');
  assert.equal(c.outgoingAlpha, 0);
  assert.ok(c.incomingAlpha < 0.01, 'incoming restarts once gameplay is visible');
});

test('reset (non-transition activation) returns to fully-visible with no ghost', () => {
  const retired: string[] = [];
  const c = new AdjacentEntityFadeController<string>({ onRetireSnapshot: (s) => retired.push(s) });
  c.beginCrossing('snap');
  c.advance(30);
  c.reset();
  assert.deepEqual(retired, ['snap']);
  assert.equal(c.isComplete, true);
  assert.equal(c.incomingAlpha, 1, 'active layer is fully visible after a hard reset');
  assert.equal(c.outgoingAlpha, 0);
});
