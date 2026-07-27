/**
 * Pure vertex-packing logic for WebGLParticleRenderer, split out so it can be
 * unit-tested without a real WebGL context (this project's Node test runner
 * has no DOM/GL — see webglRenderer.ts's class, which cannot be instantiated
 * outside a browser).
 */

import type { WorldSnapshot } from '../snapshot';
import { BEHAVIOR_MODE_GRAPPLE_CHAIN } from '../../sim/clusters/grappleShared';
import { ParticleKind } from '../../sim/particles/kinds';
import type { EditorRenderMask } from '../../editor/editorRenderMask';
import { isLayerVisibleInMask } from '../../editor/editorRenderMask';
import { getLayerForParticleKind } from '../../editor/editorParticleLayers';

export const FLOATS_PER_VERTEX = 7;

/**
 * Packs alive, non-grapple-chain, Fluid-kind particles that pass the layer
 * mask into `out` starting at index 0, returning the vertex count.
 *
 * `out` is explicitly zero-filled first: this is Phase-4-required insurance
 * against stale prior-frame data — a layer hidden this frame must not leave
 * its old vertices sitting past the new (shorter) vertexCount. The caller's
 * gl.drawArrays(POINTS, 0, vertexCount) already only reads [0, vertexCount),
 * so the zero-fill is defense-in-depth rather than strictly required for
 * correctness, but it makes "no stale data can survive a visibility toggle"
 * true by construction instead of by relying on drawArrays' count argument.
 */
export function packFluidParticleVertices(
  particles: WorldSnapshot['particles'],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  mask: EditorRenderMask | null | undefined,
  out: Float32Array,
): number {
  out.fill(0);

  const {
    particleCount, isAliveFlag,
    positionXWorld, positionYWorld,
    kindBuffer, ageTicks, lifetimeTicks,
    disturbanceFactor, behaviorMode,
  } = particles;

  let vertexCount = 0;
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (behaviorMode[i] === BEHAVIOR_MODE_GRAPPLE_CHAIN) continue;
    if (kindBuffer[i] !== ParticleKind.Fluid) continue;
    if (!isLayerVisibleInMask(mask, getLayerForParticleKind(kindBuffer[i]))) continue;

    const base = vertexCount * FLOATS_PER_VERTEX;
    const lt = lifetimeTicks[i];
    const normAge = lt > 0 ? Math.min(1.0, ageTicks[i] / lt) : 0.0;
    out[base + 0] = positionXWorld[i] * scalePx + offsetXPx;
    out[base + 1] = positionYWorld[i] * scalePx + offsetYPx;
    out[base + 2] = kindBuffer[i];
    out[base + 3] = normAge;
    out[base + 4] = disturbanceFactor[i];
    out[base + 5] = behaviorMode[i] === 1 ? 1.0 : 0.0;
    out[base + 6] = 0.0;
    vertexCount++;
  }

  return vertexCount;
}
