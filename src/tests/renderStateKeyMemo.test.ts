/**
 * Unit tests for computeRenderStateKey memoization (BUILD 428).
 *
 * Verifies that repeated calls with the same blockerKeys Set identity and
 * matching primitive args return the cached string without re-sorting the Set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRenderStateKey } from '../render/walls/roomRenderCacheStore';

const BASE_ARGS = {
  blockTheme: null as string | null,
  worldNumber: 1,
  lightingEffect: 'Ambient',
  ambientDirection: 'omni',
  seamBlending: 'off',
  roomWidthBlocks: 40,
  roomHeightBlocks: 30,
  directionalBias: 0.5,
  sideExposureStrength: 0.5,
  minimumWallLight: 0.25,
  falloffPower: 1.0,
  backgroundLightSpill: 0.5,
  solidLightSoftness: 0.5,
};

function callKey(blockerKeys: ReadonlySet<string>): string {
  return computeRenderStateKey(
    BASE_ARGS.blockTheme, BASE_ARGS.worldNumber,
    BASE_ARGS.lightingEffect, BASE_ARGS.ambientDirection, BASE_ARGS.seamBlending,
    blockerKeys,
    BASE_ARGS.roomWidthBlocks, BASE_ARGS.roomHeightBlocks,
    BASE_ARGS.directionalBias, BASE_ARGS.sideExposureStrength,
    BASE_ARGS.minimumWallLight, BASE_ARGS.falloffPower,
    BASE_ARGS.backgroundLightSpill, BASE_ARGS.solidLightSoftness,
  );
}

test('computeRenderStateKey returns identical key for repeated calls on same Set', () => {
  const s = new Set<string>(['3,1', '1,2', '5,9', '0,0']);
  const k1 = callKey(s);
  const k2 = callKey(s);
  const k3 = callKey(s);
  assert.equal(k1, k2);
  assert.equal(k2, k3);
});

test('computeRenderStateKey key contains sorted blocker signature', () => {
  const s = new Set<string>(['3,1', '1,2', '5,9', '0,0']);
  const k = callKey(s);
  // The sorted order is "0,0;1,2;3,1;5,9".
  assert.match(k, /0,0;1,2;3,1;5,9/);
});

test('computeRenderStateKey distinct keys for different Sets', () => {
  const a = new Set<string>(['1,1']);
  const b = new Set<string>(['2,2']);
  assert.notEqual(callKey(a), callKey(b));
});

test('computeRenderStateKey uses shared cache slot for empty Sets', () => {
  const e1 = new Set<string>();
  const e2 = new Set<string>();
  // Both empty Sets must yield identical strings even though the Set
  // identities differ — this is the empty-Set sentinel path.
  assert.equal(callKey(e1), callKey(e2));
});

test('computeRenderStateKey invalidates cache when primitive args change', () => {
  const s = new Set<string>(['1,1']);
  const a = computeRenderStateKey(
    null, 1, 'Ambient', 'omni', 'off', s,
    40, 30, 0.5, 0.5, 0.25, 1.0, 0.5, 0.5,
  );
  // Different worldNumber must produce a different key for the same Set.
  const b = computeRenderStateKey(
    null, 2, 'Ambient', 'omni', 'off', s,
    40, 30, 0.5, 0.5, 0.25, 1.0, 0.5, 0.5,
  );
  assert.notEqual(a, b);
  // Calling with original args again should reproduce the first key (cache miss
  // and rebuild — not a stale return).
  const aAgain = computeRenderStateKey(
    null, 1, 'Ambient', 'omni', 'off', s,
    40, 30, 0.5, 0.5, 0.25, 1.0, 0.5, 0.5,
  );
  assert.equal(a, aAgain);
});
