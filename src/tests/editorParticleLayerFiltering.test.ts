import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import { buildEditorRenderMask } from '../editor/editorRenderMask';
import { renderParticles } from '../render/particles/renderer';
import { renderPixelLockedDust } from '../render/particles/pixelLockedDustRenderer';
import { ParticleKind } from '../sim/particles/kinds';
import { drawTunnelDarkness } from '../screens/gameRoomHelpers';

/**
 * Minimal fake CanvasRenderingContext2D — this project's Node test runner has
 * no DOM, so only the subset of the 2D context API the particle renderers
 * actually call is implemented (matches the pattern in blockEdgeShading.test.ts).
 */
function makeFakeCtx() {
  let fillRectCalls = 0;
  let fillCalls = 0;
  const ctx = {
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    fillStyle: '#000',
    fillRect() { fillRectCalls++; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    fill() { fillCalls++; },
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls: () => fillRectCalls + fillCalls,
  };
}

function makeSnapshotWithOneParticle(kind: ParticleKind, disturbanceFactor: number) {
  return {
    particles: {
      particleCount: 1,
      isAliveFlag: Uint8Array.from([1]),
      positionXWorld: Float32Array.from([10]),
      positionYWorld: Float32Array.from([10]),
      kindBuffer: Uint8Array.from([kind]),
      ageTicks: Float32Array.from([0]),
      lifetimeTicks: Float32Array.from([100]),
      disturbanceFactor: Float32Array.from([disturbanceFactor]),
      behaviorMode: Uint8Array.from([0]),
      noiseTickSeed: Uint32Array.from([0]),
    },
  } as unknown as import('../render/snapshot').WorldSnapshot;
}

test('Canvas2D particle (Fluid, renderParticles): runtime (null mask) draws it', () => {
  const snapshot = makeSnapshotWithOneParticle(ParticleKind.Fluid, 1.0);
  const { ctx, calls } = makeFakeCtx();
  renderParticles(ctx, snapshot, 0, 0, 1, null);
  assert.ok(calls() > 0, 'expected the Fluid particle to be drawn under a null (runtime) mask');
});

test('Canvas2D particle (Fluid, renderParticles): hidden liquids layer filters it out', () => {
  const snapshot = makeSnapshotWithOneParticle(ParticleKind.Fluid, 1.0);
  const { ctx, calls } = makeFakeCtx();
  const state = createEditorState();
  state.layers.liquids.visible = false;
  const mask = buildEditorRenderMask(state);
  renderParticles(ctx, snapshot, 0, 0, 1, mask);
  assert.equal(calls(), 0, 'expected the Fluid particle to be filtered out when the liquids layer is hidden');
});

test('Canvas2D particle (Golden, renderPixelLockedDust): runtime (null mask) draws it', () => {
  const snapshot = makeSnapshotWithOneParticle(ParticleKind.Golden, 0);
  const { ctx, calls } = makeFakeCtx();
  renderPixelLockedDust(ctx, snapshot, 0, 0, 1, null);
  assert.ok(calls() > 0, 'expected the Golden mote to be drawn under a null (runtime) mask');
});

test('Canvas2D particle (Golden, renderPixelLockedDust): hidden powder layer filters it out', () => {
  const snapshot = makeSnapshotWithOneParticle(ParticleKind.Golden, 0);
  const { ctx, calls } = makeFakeCtx();
  const state = createEditorState();
  state.layers.powder.visible = false;
  const mask = buildEditorRenderMask(state);
  renderPixelLockedDust(ctx, snapshot, 0, 0, 1, mask);
  assert.equal(calls(), 0, 'expected the Golden mote to be filtered out when the powder layer is hidden');
});

test('Canvas2D particle: unrelated hidden layer does not affect a different layer\'s particle', () => {
  const snapshot = makeSnapshotWithOneParticle(ParticleKind.Golden, 0);
  const { ctx, calls } = makeFakeCtx();
  const state = createEditorState();
  state.layers.debug.visible = false;
  const mask = buildEditorRenderMask(state);
  renderPixelLockedDust(ctx, snapshot, 0, 0, 1, mask);
  assert.ok(calls() > 0, 'expected the Golden mote to still draw when an unrelated layer is hidden');
});

// ── Tunnel darkness / Lighting layer gating ─────────────────────────────────

function makeFakeTunnelCtx() {
  let fillRectCalls = 0;
  const ctx = {
    save() {},
    restore() {},
    fillStyle: '#000',
    fillRect() { fillRectCalls++; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls: () => fillRectCalls };
}

function makeRoomWithTransition() {
  return {
    widthBlocks: 20,
    heightBlocks: 20,
    transitions: [
      { direction: 'left', xBlock: 0, yBlock: 0, openingSizeBlocks: 4, gradientWidthBlocks: 3 },
    ],
  } as unknown as import('../levels/roomDef').RoomDef;
}

test('drawTunnelDarkness: runtime (null mask) draws the gradient', () => {
  const room = makeRoomWithTransition();
  const { ctx, calls } = makeFakeTunnelCtx();
  drawTunnelDarkness(ctx, room, 0, 0, 1, null);
  assert.ok(calls() > 0, 'expected tunnel darkness to draw under a null (runtime) mask');
});

test('drawTunnelDarkness: hidden Lighting layer skips the composite pass entirely', () => {
  const room = makeRoomWithTransition();
  const { ctx, calls } = makeFakeTunnelCtx();
  const state = createEditorState();
  state.layers.lighting.visible = false;
  const mask = buildEditorRenderMask(state);
  drawTunnelDarkness(ctx, room, 0, 0, 1, mask);
  assert.equal(calls(), 0, 'expected tunnel darkness to be skipped when the Lighting layer is hidden');
});
