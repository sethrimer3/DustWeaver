import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { buildEditorRenderMask } from '../editor/editorRenderMask';
import { drawEditorUIOverlays } from '../editor/editorPlacementPreviewDrawer';
import { isClusterVisibleInMask } from '../render/clusters/clusterVisibility';
import { packFluidParticleVertices, FLOATS_PER_VERTEX } from '../render/particles/webglVertexPacking';
import { renderParticles } from '../render/particles/renderer';
import { ParticleKind } from '../sim/particles/kinds';
import { MAX_PARTICLES } from '../sim/particles/state';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    blockTheme: 'blackRock',
    backgroundId: 'cave',
    lightingEffect: 'DEFAULT',
    songId: '_continue',
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [18, 18],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    dustContainers: [],
    dustContainerPieces: [],
    dustBoostJars: [],
    dustSwarms: [],
    lambdaAnchors: [],
    dustPiles: [],
    grasshopperAreas: [],
    fireflyAreas: [],
    decorations: [],
    ambientLightBlockers: [],
    lightSources: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Fake ctx for drawEditorUIOverlays ───────────────────────────────────────

function makeUiOverlaysFakeCtx() {
  let fillRectCalls = 0;
  let strokeCalls = 0;
  const ctx = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px monospace',
    fillRect() { fillRectCalls++; },
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { strokeCalls++; },
    fillText() {},
    setLineDash() {},
    measureText() { return { width: 10 }; },
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fillRectCalls: () => fillRectCalls,
    strokeCalls: () => strokeCalls,
  };
}

test('Metadata off: hides the informational ambient-light indicator but NOT selection/cursor affordances', () => {
  const room = makeRoom({ ambientLightDirection: 'up' } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.isSelectionBoxActive = true;
  state.selectionBoxStartBlockX = 2;
  state.selectionBoxStartBlockY = 2;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;

  const visibleMask = buildEditorRenderMask(state);
  const { ctx: ctxVisible, fillRectCalls: fillsVisible, strokeCalls: strokesVisible } = makeUiOverlaysFakeCtx();
  drawEditorUIOverlays(ctxVisible, room, state, 0, 0, 1, 480, 270, visibleMask);
  assert.ok(strokesVisible() > 0, 'expected the ambient-light arrow to draw (2x stroke) when Metadata is visible');
  const fillsWithMetadataVisible = fillsVisible();

  state.layers.editorMetadata.visible = false;
  const hiddenMask = buildEditorRenderMask(state);
  const { ctx: ctxHidden, fillRectCalls: fillsHidden, strokeCalls: strokesHidden } = makeUiOverlaysFakeCtx();
  drawEditorUIOverlays(ctxHidden, room, state, 0, 0, 1, 480, 270, hiddenMask);

  assert.equal(strokesHidden(), 0, 'expected the ambient-light arrow to be suppressed when Metadata is hidden');
  // Selection box (fillRect+strokeRect) and cursor highlight (drawBlockRect ->
  // fillRect+strokeRect) are always-visible editor infrastructure — the
  // fillRect count must be identical whether Metadata is visible or hidden.
  assert.equal(fillsHidden(), fillsWithMetadataVisible, 'expected selection box + cursor highlight fillRect calls to be unaffected by Metadata visibility');
  assert.ok(fillsHidden() > 0, 'expected selection box and cursor highlight to still draw');
});

// ── renderClusters' gating logic (isClusterVisibleInMask): Enemies-layer ───
// renderClusters itself transitively imports blockSpriteRenderer, which
// touches `Image` at module load and cannot be required in this project's
// DOM-less Node test runner — so the exact filtering predicate it calls per
// cluster (isClusterVisibleInMask) is extracted to its own module and tested
// directly here; see clusterVisibility.ts's doc comment.

test('isClusterVisibleInMask: runtime (null mask) shows an enemy cluster', () => {
  assert.equal(isClusterVisibleInMask(0, null), true);
});

test('isClusterVisibleInMask: hidden Enemies layer suppresses non-player clusters', () => {
  const state = createEditorState();
  state.layers.enemies.visible = false;
  const mask = buildEditorRenderMask(state);
  assert.equal(isClusterVisibleInMask(0, mask), false);
});

test('isClusterVisibleInMask: the player cluster still shows when Enemies is hidden (always-visible)', () => {
  const state = createEditorState();
  state.layers.enemies.visible = false;
  const mask = buildEditorRenderMask(state);
  assert.equal(isClusterVisibleInMask(1, mask), true);
});

test('isClusterVisibleInMask: solo on a different layer excludes enemies the same as hiding them', () => {
  const state = createEditorState();
  state.layers.lighting.solo = true; // solo a layer that is NOT enemies
  const mask = buildEditorRenderMask(state);
  assert.equal(isClusterVisibleInMask(0, mask), false);
  assert.equal(isClusterVisibleInMask(1, mask), true, 'player remains visible even under an unrelated solo');
});

// ── WebGL vertex packing: stale-frame prevention + Canvas2D/WebGL parity ────

function makeParticles(kind: ParticleKind, disturbanceFactor: number) {
  return {
    particleCount: 1,
    isAliveFlag: Uint8Array.from([1]),
    positionXWorld: Float32Array.from([10]),
    positionYWorld: Float32Array.from([10]),
    kindBuffer: Uint8Array.from([kind]),
    ageTicks: Float32Array.from([0]),
    lifetimeTicks: Float32Array.from([100]),
    disturbanceFactor: Float32Array.from([disturbanceFactor]),
    behaviorMode: Uint8Array.from([0]),
    particleMoteSlotState: Uint8Array.from([0]),
  } as unknown as import('../render/snapshot').WorldSnapshot['particles'];
}

test('packFluidParticleVertices: runtime (null mask) packs the Fluid particle', () => {
  const out = new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);
  const count = packFluidParticleVertices(makeParticles(ParticleKind.Fluid, 1.0), 0, 0, 1, null, out);
  assert.equal(count, 1);
  assert.notEqual(out[0], 0, 'expected the packed x coordinate to be written');
});

test('packFluidParticleVertices: hidden Lighting particle family (Light kind) is filtered, Liquids (Fluid) is not', () => {
  const state = createEditorState();
  state.layers.lighting.visible = false;
  const mask = buildEditorRenderMask(state);
  const out = new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);
  // Fluid maps to 'liquids', not 'lighting' — hiding Lighting must not affect it.
  const count = packFluidParticleVertices(makeParticles(ParticleKind.Fluid, 1.0), 0, 0, 1, mask, out);
  assert.equal(count, 1, 'expected the Fluid (liquids-classified) particle to remain visible when only Lighting is hidden');
});

test('packFluidParticleVertices: hidden Liquids layer filters the Fluid particle', () => {
  const state = createEditorState();
  state.layers.liquids.visible = false;
  const mask = buildEditorRenderMask(state);
  const out = new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);
  const count = packFluidParticleVertices(makeParticles(ParticleKind.Fluid, 1.0), 0, 0, 1, mask, out);
  assert.equal(count, 0);
});

test('packFluidParticleVertices: no stale frame — hiding a layer after a visible frame zero-fills prior vertex data', () => {
  const out = new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);

  // Frame 1: liquids visible — particle packs at slot 0 with a nonzero x.
  const visibleCount = packFluidParticleVertices(makeParticles(ParticleKind.Fluid, 1.0), 100, 0, 1, null, out);
  assert.equal(visibleCount, 1);
  assert.notEqual(out[0], 0);

  // Frame 2: liquids hidden — must not leave frame 1's vertex sitting in the buffer.
  const state = createEditorState();
  state.layers.liquids.visible = false;
  const mask = buildEditorRenderMask(state);
  const hiddenCount = packFluidParticleVertices(makeParticles(ParticleKind.Fluid, 1.0), 100, 0, 1, mask, out);
  assert.equal(hiddenCount, 0);
  for (let i = 0; i < FLOATS_PER_VERTEX; i++) {
    assert.equal(out[i], 0, `expected out[${i}] to be zeroed after the layer was hidden`);
  }
});

test('WebGL (packFluidParticleVertices) and Canvas2D (renderParticles) agree on Liquids visibility for the Fluid family', () => {
  const state = createEditorState();
  state.layers.liquids.visible = false;
  const mask = buildEditorRenderMask(state);

  const out = new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);
  const webglCount = packFluidParticleVertices(makeParticles(ParticleKind.Fluid, 1.0), 0, 0, 1, mask, out);

  let canvasDrawCalls = 0;
  const fakeCtx = {
    globalAlpha: 1, fillStyle: '#000',
    beginPath() {}, arc() {}, fill() { canvasDrawCalls++; },
    moveTo() {}, lineTo() {}, closePath() {},
    imageSmoothingEnabled: false,
    fillRect() { canvasDrawCalls++; },
  } as unknown as CanvasRenderingContext2D;
  const snapshot = { particles: makeParticles(ParticleKind.Fluid, 1.0) } as unknown as import('../render/snapshot').WorldSnapshot;
  renderParticles(fakeCtx, snapshot, 0, 0, 1, mask);

  assert.equal(webglCount, 0, 'WebGL path: Fluid particle filtered out when Liquids is hidden');
  assert.equal(canvasDrawCalls, 0, 'Canvas2D path: Fluid particle filtered out when Liquids is hidden');
});

test('drawEditorUIOverlays: unrelated hidden layer (Debug) does not suppress the Metadata-classified indicator', () => {
  const room = makeRoom({ ambientLightDirection: 'up' } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.layers.debug.visible = false;
  const mask = buildEditorRenderMask(state);
  const { ctx, strokeCalls } = makeUiOverlaysFakeCtx();
  drawEditorUIOverlays(ctx, room, state, 0, 0, 1, 480, 270, mask);
  assert.ok(strokeCalls() > 0, 'expected the ambient-light arrow to still draw when only Debug is hidden');
});
