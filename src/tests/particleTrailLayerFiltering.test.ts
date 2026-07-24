import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import { buildEditorRenderMask } from '../editor/editorRenderMask';
import { ParticleTrailRenderer, TRAIL_START_SPEED_WORLD } from '../render/particles/trailRenderer';
import { ParticleKind } from '../sim/particles/kinds';

/**
 * Minimal fake WebGLRenderingContext — sufficient for ParticleTrailRenderer's
 * constructor to succeed (isAvailable = true) so render()'s gl.drawArrays
 * call can be spied on. This project's Node test runner has no real GL, so
 * every method just returns a truthy placeholder / records calls.
 */
function makeFakeGl() {
  let drawArraysCallCount = 0;
  let lastDrawVertexCount = -1;
  const gl = {
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    detachShader: () => {},
    deleteProgram: () => {},
    getProgramParameter: () => true,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    useProgram: () => {},
    uniform2f: () => {},
    uniform1f: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    drawArrays: (_mode: number, _first: number, count: number) => {
      drawArraysCallCount++;
      lastDrawVertexCount = count;
    },
    ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, FLOAT: 3, TRIANGLES: 4,
    VERTEX_SHADER: 5, FRAGMENT_SHADER: 6,
  };
  return {
    gl: gl as unknown as WebGLRenderingContext,
    drawArraysCallCount: () => drawArraysCallCount,
    lastDrawVertexCount: () => lastDrawVertexCount,
  };
}

function makeParticleSnapshot(overrides: {
  isAliveFlag?: number;
  behaviorMode?: number;
  kind?: ParticleKind;
  positionX?: number;
  positionY?: number;
  velocityX?: number;
  velocityY?: number;
} = {}) {
  return {
    particleCount: 1,
    isAliveFlag: Uint8Array.from([overrides.isAliveFlag ?? 1]),
    behaviorMode: Uint8Array.from([overrides.behaviorMode ?? 1]),
    kindBuffer: Uint8Array.from([overrides.kind ?? ParticleKind.Golden]),
    positionXWorld: Float32Array.from([overrides.positionX ?? 0]),
    positionYWorld: Float32Array.from([overrides.positionY ?? 0]),
    velocityXWorld: Float32Array.from([overrides.velocityX ?? TRAIL_START_SPEED_WORLD + 10]),
    velocityYWorld: Float32Array.from([overrides.velocityY ?? 0]),
  } as unknown as import('../render/snapshotTypes').ParticleSnapshot;
}

/** Runs `update()` for several ticks with the particle moving, so trail history accumulates. */
function runMovingTicks(trail: ParticleTrailRenderer, ticks: number, kind: ParticleKind, mask?: Parameters<ParticleTrailRenderer['update']>[1]) {
  let x = 0;
  for (let t = 0; t < ticks; t++) {
    x += 5; // exceeds TRAIL_SAMPLE_DIST_WORLD each tick
    trail.update(makeParticleSnapshot({ kind, positionX: x }), mask);
  }
}

test('runtime (null mask): trail samples and renders exactly as before', () => {
  const trail = new ParticleTrailRenderer(makeFakeGl().gl);
  runMovingTicks(trail, 5, ParticleKind.Golden, null);
  assert.ok(trail.getTrailCountForTesting(0) >= 2, 'expected trail history to accumulate under a null (runtime) mask');
  assert.equal(trail.getTrailActiveForTesting(0), true);
});

test('Powder hidden: powder-classified trail (Golden) is not sampled and renders none', () => {
  const state = createEditorState();
  state.layers.powder.visible = false;
  const mask = buildEditorRenderMask(state);

  const trail = new ParticleTrailRenderer(makeFakeGl().gl);
  runMovingTicks(trail, 5, ParticleKind.Golden, mask);

  assert.equal(trail.getTrailCountForTesting(0), 0, 'expected no trail history to accumulate while Powder is hidden');
  assert.equal(trail.getTrailActiveForTesting(0), false);

  const { gl, drawArraysCallCount } = makeFakeGl();
  const renderTrail = new ParticleTrailRenderer(gl);
  runMovingTicks(renderTrail, 5, ParticleKind.Golden, mask);
  renderTrail.render(makeParticleSnapshot({ kind: ParticleKind.Golden }), 0, 0, 1, 480, 270, mask);
  assert.equal(drawArraysCallCount(), 0, 'expected no draw call when the only trail family is hidden');
});

test('Unrelated layer visibility change does not affect an unrelated trail family', () => {
  const state = createEditorState();
  state.layers.liquids.visible = false; // unrelated to Golden (powder)
  const mask = buildEditorRenderMask(state);

  const trail = new ParticleTrailRenderer(makeFakeGl().gl);
  runMovingTicks(trail, 5, ParticleKind.Golden, mask);

  assert.ok(trail.getTrailCountForTesting(0) >= 2, 'expected the Golden (powder) trail to still accumulate when Liquids is hidden');
});

test('Solo: only the soloed layer\'s trail family renders', () => {
  const state = createEditorState();
  state.layers.lighting.solo = true; // solo lighting; Golden is powder-classified
  const mask = buildEditorRenderMask(state);

  const trail = new ParticleTrailRenderer(makeFakeGl().gl);
  runMovingTicks(trail, 5, ParticleKind.Golden, mask);
  assert.equal(trail.getTrailCountForTesting(0), 0, 'expected the non-soloed Golden trail to accumulate no history');

  const lightTrail = new ParticleTrailRenderer(makeFakeGl().gl);
  runMovingTicks(lightTrail, 5, ParticleKind.Light, mask);
  assert.ok(lightTrail.getTrailCountForTesting(0) >= 2, 'expected the soloed Light (lighting) trail to accumulate history');
});

test('Hide -> show: no stale trail history survives the hidden period', () => {
  const trail = new ParticleTrailRenderer(makeFakeGl().gl);

  // Visible: accumulate some history.
  runMovingTicks(trail, 5, ParticleKind.Golden, null);
  assert.ok(trail.getTrailCountForTesting(0) >= 2);

  // Hide Powder for several ticks of continued movement.
  const state = createEditorState();
  state.layers.powder.visible = false;
  const hiddenMask = buildEditorRenderMask(state);
  let x = 100;
  for (let t = 0; t < 5; t++) {
    x += 5;
    trail.update(makeParticleSnapshot({ kind: ParticleKind.Golden, positionX: x }), hiddenMask);
  }
  assert.equal(trail.getTrailCountForTesting(0), 0, 'expected history to be cleared while hidden');

  // Re-show: only new samples from this point on should count.
  const visibleAgainState = createEditorState();
  const visibleAgainMask = buildEditorRenderMask(visibleAgainState);
  trail.update(makeParticleSnapshot({ kind: ParticleKind.Golden, positionX: x }), visibleAgainMask);
  // First tick after re-show seeds the ring buffer fresh (count === 1), proving
  // the movement accumulated while hidden was never sampled.
  assert.equal(trail.getTrailCountForTesting(0), 1, 'expected a fresh seed on re-show, not resumed pre-hidden history');
});
