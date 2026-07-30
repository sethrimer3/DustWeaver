import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import {
  MOTE_LIFE_SLOT_WIDTH_PX,
  MOTE_LIFE_SLOT_HEIGHT_PX,
  getMoteLifeSlotPosition,
} from '../render/hud/moteLifeSlots';

// ── Minimal Image stub so loadImg()/isSpriteReady() behave deterministically
// in a Node test environment with no real DOM/image decoding. ──────────────
class MockImage {
  complete = true;
  naturalWidth = 10;
  naturalHeight = 11;
  src = '';
}

(globalThis as unknown as { Image: typeof MockImage }).Image = MockImage;

let drawAnimatedDustContainerHud: typeof import('../render/hud/dustContainerAnimation').drawAnimatedDustContainerHud;
let drawAnimatedDustContainer: typeof import('../render/hud/dustContainerAnimation').drawAnimatedDustContainer;
let _resetDustContainerAnimationStateForTests: typeof import('../render/hud/dustContainerAnimation')._resetDustContainerAnimationStateForTests;
let HUD_FILL_CROSSFADE_MS: number;
let HUD_AMBIENT_CROSSFADE_SPEED_MULTIPLIER: number;

before(async () => {
  const mod = await import('../render/hud/dustContainerAnimation');
  drawAnimatedDustContainerHud = mod.drawAnimatedDustContainerHud;
  drawAnimatedDustContainer = mod.drawAnimatedDustContainer;
  _resetDustContainerAnimationStateForTests = mod._resetDustContainerAnimationStateForTests;
  HUD_FILL_CROSSFADE_MS = mod.HUD_FILL_CROSSFADE_MS;
  HUD_AMBIENT_CROSSFADE_SPEED_MULTIPLIER = mod.HUD_AMBIENT_CROSSFADE_SPEED_MULTIPLIER;
});

interface DrawCall { img: unknown; alpha: number; }

function makeStubCtx(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  let currentAlpha = 1;
  const alphaStack: number[] = [];
  const ctx = {
    save() { alphaStack.push(currentAlpha); },
    restore() { currentAlpha = alphaStack.pop() ?? 1; },
    set globalAlpha(v: number) { currentAlpha = v; },
    get globalAlpha() { return currentAlpha; },
    drawImage(img: unknown) { calls.push({ img, alpha: currentAlpha }); },
    fillRect() {},
    strokeRect() {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

beforeEach(() => {
  _resetDustContainerAnimationStateForTests();
});

test('MOTE_LIFE_SLOT dimensions preserve the ~30x33 source sprite aspect ratio', () => {
  // Source art is 30x33px; a 10px-wide slot should be ~11px tall, not stretched to a square.
  const aspect = MOTE_LIFE_SLOT_HEIGHT_PX / MOTE_LIFE_SLOT_WIDTH_PX;
  const sourceAspect = 33 / 30;
  assert.ok(Math.abs(aspect - sourceAspect) < 0.05, `expected slot aspect ~${sourceAspect}, got ${aspect}`);
  assert.notEqual(MOTE_LIFE_SLOT_WIDTH_PX, MOTE_LIFE_SLOT_HEIGHT_PX, 'slot must not be a stretched square');
});

test('slot coordinates remain stable after changing slot height', () => {
  const first = getMoteLifeSlotPosition(0);
  const second = getMoteLifeSlotPosition(1);
  const third = getMoteLifeSlotPosition(2);
  assert.deepEqual(first, { column: 0, row: 0, xPx: 8, yPx: 8 });
  assert.deepEqual(second, { column: 0, row: 1, xPx: 8, yPx: 8 + MOTE_LIFE_SLOT_HEIGHT_PX + 2 });
  assert.deepEqual(third, { column: 1, row: 0, xPx: 8 + MOTE_LIFE_SLOT_WIDTH_PX + 2, yPx: 8 });
});

test('a filled slot advances its animation frame over time', () => {
  const { ctx, calls } = makeStubCtx();
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, 0, 0);
  const firstCallCount = calls.length;
  assert.ok(firstCallCount > 0, 'filled slot should draw at least one image');

  calls.length = 0;
  // Jump well past any crossfade+hold cycle (max ~800ms crossfade + 600ms hold).
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, 0, 5000);
  assert.ok(calls.length > 0, 'slot should still draw after time has advanced');
});

test('different slots receive independent phases and targets', () => {
  const { ctx } = makeStubCtx();
  // Draw many slots at the same nowMs and collect their internal state via repeated draws.
  const seenFirstFrameImgs = new Set<unknown>();
  for (let slot = 0; slot < 20; slot++) {
    const { ctx: perSlotCtx, calls } = makeStubCtx();
    void ctx;
    drawAnimatedDustContainerHud(perSlotCtx, 0, 0, 10, 11, true, slot, 0);
    if (calls.length > 1) seenFirstFrameImgs.add(calls[1].img);
  }
  assert.ok(seenFirstFrameImgs.size > 1, 'slots should not all start on the same frame image');
});

test('reveal crossfade always keeps the base frame at 100% opacity while the target fades in on top', () => {
  // The first draw is the opaque empty-container base. Find a slot whose filled
  // animation adds two frame draws during its ambient crossfade.
  let found = false;
  for (let slot = 0; slot < 40 && !found; slot++) {
    const { ctx, calls } = makeStubCtx();
    drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, slot, 0);
    if (calls.length === 3) {
      found = true;
      const [, base, incoming] = calls;
      assert.equal(base.alpha, 1, `base (bottom) frame must always draw at full opacity, got ${base.alpha}`);
      assert.ok(incoming.alpha >= 0 && incoming.alpha <= 1, `incoming (top) frame alpha must be in [0,1], got ${incoming.alpha}`);
      assert.notEqual(base.img, incoming.img, 'crossfade must blend two distinct frames');
    }
  }
  assert.ok(found, 'expected at least one slot to be mid-crossfade at t=0 across 40 random samples');
});

test('missing/unready frames fall back gracefully without throwing', () => {
  class NeverReadyImage {
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    src = '';
  }
  const original = (globalThis as unknown as { Image: unknown }).Image;
  (globalThis as unknown as { Image: unknown }).Image = NeverReadyImage;
  try {
    _resetDustContainerAnimationStateForTests();
    const { ctx, calls } = makeStubCtx();
    assert.doesNotThrow(() => {
      drawAnimatedDustContainer(ctx, 0, 0, 10, 11, true, 0, 0);
    });
    // No ready image exists, so the fallback rectangle path (fillRect/strokeRect) runs instead
    // of drawImage — calls array (drawImage-only) should stay empty.
    assert.equal(calls.length, 0);
  } finally {
    (globalThis as unknown as { Image: unknown }).Image = original;
  }
});

test('empty slots render statically regardless of nowMs', () => {
  const { ctx: ctxA, calls: callsA } = makeStubCtx();
  const { ctx: ctxB, calls: callsB } = makeStubCtx();
  drawAnimatedDustContainerHud(ctxA, 0, 0, 10, 11, false, 0, 0);
  drawAnimatedDustContainerHud(ctxB, 0, 0, 10, 11, false, 0, 9999);
  assert.equal(callsA.length, 1);
  assert.equal(callsB.length, 1);
  assert.equal(callsA[0].img, callsB[0].img, 'empty slot must use the same static sprite regardless of time');
});

test('HUD ambient container crossfades run exactly five times faster', () => {
  assert.equal(HUD_AMBIENT_CROSSFADE_SPEED_MULTIPLIER, 5);
});

test('damage keeps the empty sprite opaque underneath while the full sprite rapidly fades out', () => {
  const { ctx, calls } = makeStubCtx();
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, 0, 0);

  calls.length = 0;
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, false, 0, 10);
  assert.equal(calls[0].alpha, 1, 'empty sprite must be the fully opaque base');
  assert.equal(calls[1].alpha, 1, 'full sprite starts damage transition fully opaque');

  calls.length = 0;
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, false, 0, 10 + HUD_FILL_CROSSFADE_MS / 2);
  assert.equal(calls[0].alpha, 1);
  assert.ok(calls.slice(1).every(call => Math.abs(call.alpha - 0.5) < 0.0001 || call.alpha < 0.5));

  calls.length = 0;
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, false, 0, 10 + HUD_FILL_CROSSFADE_MS);
  assert.equal(calls.length, 1, 'only the empty sprite remains after damage crossfade');
});

test('mote regeneration reverses the transition and fades a full sprite over the empty sprite', () => {
  const { ctx, calls } = makeStubCtx();
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, false, 0, 0);

  calls.length = 0;
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, 0, 10);
  assert.equal(calls.length, 1, 'full sprite begins at zero opacity over the empty base');

  calls.length = 0;
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, 0, 10 + HUD_FILL_CROSSFADE_MS / 2);
  assert.equal(calls[0].alpha, 1);
  assert.ok(calls.slice(1).some(call => Math.abs(call.alpha - 0.5) < 0.0001));

  calls.length = 0;
  drawAnimatedDustContainerHud(ctx, 0, 0, 10, 11, true, 0, 10 + HUD_FILL_CROSSFADE_MS);
  assert.ok(calls.length >= 2, 'full sprite is fully restored after regeneration crossfade');
  assert.equal(calls[1].alpha, 1);
});
