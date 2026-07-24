/**
 * Characterization tests for roomRenderState.ts — the single source of truth
 * for the RoomDef → render-state parameter mapping.
 *
 * These lock in the exact defaults previously hand-duplicated in
 * `gameLoadRoomPhases.ts` (Phase A + resident activation),
 * `entryViewportWarm.ts`, and `roomRenderChunkWarmScheduler.ts`.  The critical
 * invariant: the key derived from a RoomDef at adoption time must equal the
 * key derived through a WallPrewarmContext at prewarm time, or prewarmed
 * chunks are silently discarded as `staleRenderState`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomDef, RoomWallTemplate } from '../levels/roomDef';
import { computeRenderStateKey } from '../render/walls/roomRenderCacheStore';
import {
  deriveRoomRenderStateParams,
  computeRoomRenderStateKey,
  makeWallPrewarmCtx,
  wallTemplateToSnapshot,
} from '../render/walls/roomRenderState';
import {
  DEFAULT_DIRECTIONAL_BIAS,
  DEFAULT_SIDE_EXPOSURE_STRENGTH,
  DEFAULT_MINIMUM_WALL_LIGHT,
  DEFAULT_FALLOFF_POWER,
  DEFAULT_BACKGROUND_LIGHT_SPILL,
  DEFAULT_SOLID_LIGHT_SOFTNESS,
} from '../render/walls/ambientLightDepths';

/** Minimal RoomDef stub — only the fields the deriver reads are populated. */
function makeRoom(partial: Partial<RoomDef>): RoomDef {
  return { widthBlocks: 40, heightBlocks: 30, ...partial } as RoomDef;
}

/** A room with every render-state-relevant field explicitly set. */
function makeFullySpecifiedRoom(): RoomDef {
  return makeRoom({
    blockTheme: 'Brownstone',
    worldNumber: 3,
    lightingEffect: 'DarkRoom',
    ambientLightDirection: 'left',
    blockSeamBlending: 'organic',
    widthBlocks: 55,
    heightBlocks: 21,
    directionalBias: 0.75,
    sideExposureStrength: 0.3,
    minimumWallLight: 0.1,
    falloffPower: 2.5,
    backgroundLightSpill: 0.4,
    solidLightSoftness: 0.9,
  });
}

// ── Default derivation (characterizes the historical `??` fallback chains) ────

test('minimal room derives the documented defaults', () => {
  const p = deriveRoomRenderStateParams(makeRoom({}), undefined);
  assert.equal(p.blockTheme, null);
  assert.equal(p.worldNumber, 1);
  assert.equal(p.lightingEffect, 'Ambient');
  assert.equal(p.ambientDirection, 'omni');
  assert.equal(p.seamBlending, 'off');
  assert.equal(p.roomWidthBlocks, 40);
  assert.equal(p.roomHeightBlocks, 30);
  assert.equal(p.blockerKeys.size, 0);
  assert.equal(p.directionalBias, DEFAULT_DIRECTIONAL_BIAS);
  assert.equal(p.sideExposureStrength, DEFAULT_SIDE_EXPOSURE_STRENGTH);
  assert.equal(p.minimumWallLight, DEFAULT_MINIMUM_WALL_LIGHT);
  assert.equal(p.falloffPower, DEFAULT_FALLOFF_POWER);
  assert.equal(p.backgroundLightSpill, DEFAULT_BACKGROUND_LIGHT_SPILL);
  assert.equal(p.solidLightSoftness, DEFAULT_SOLID_LIGHT_SOFTNESS);
});

test('fully-specified room passes every field through unchanged', () => {
  const blockers = new Set(['3,1', '5,9']);
  const p = deriveRoomRenderStateParams(makeFullySpecifiedRoom(), blockers);
  assert.equal(p.blockTheme, 'Brownstone');
  assert.equal(p.worldNumber, 3);
  assert.equal(p.lightingEffect, 'DarkRoom');
  assert.equal(p.ambientDirection, 'left');
  assert.equal(p.seamBlending, 'organic');
  assert.equal(p.roomWidthBlocks, 55);
  assert.equal(p.roomHeightBlocks, 21);
  assert.equal(p.blockerKeys, blockers);
  assert.equal(p.directionalBias, 0.75);
  assert.equal(p.sideExposureStrength, 0.3);
  assert.equal(p.minimumWallLight, 0.1);
  assert.equal(p.falloffPower, 2.5);
  assert.equal(p.backgroundLightSpill, 0.4);
  assert.equal(p.solidLightSoftness, 0.9);
});

// ── Key parity with the historical inline expansion ───────────────────────────
// Replicates the exact 14-argument call that Phase A of makeLoadRoomPhases and
// applyResidentRoomActivation used before consolidation.  If this ever fails,
// previously prewarmed chunks would stop being adopted after the refactor.

function legacyInlineKey(room: RoomDef, blockerKeys: Set<string> | undefined): string {
  return computeRenderStateKey(
    room.blockTheme ?? null,
    room.worldNumber ?? 1,
    room.lightingEffect ?? 'Ambient',
    room.ambientLightDirection ?? 'omni',
    room.blockSeamBlending ?? 'off',
    blockerKeys ?? new Set<string>(),
    room.widthBlocks,
    room.heightBlocks,
    room.directionalBias    ?? DEFAULT_DIRECTIONAL_BIAS,
    room.sideExposureStrength ?? DEFAULT_SIDE_EXPOSURE_STRENGTH,
    room.minimumWallLight   ?? DEFAULT_MINIMUM_WALL_LIGHT,
    room.falloffPower       ?? DEFAULT_FALLOFF_POWER,
    room.backgroundLightSpill ?? DEFAULT_BACKGROUND_LIGHT_SPILL,
    room.solidLightSoftness ?? DEFAULT_SOLID_LIGHT_SOFTNESS,
  );
}

test('computeRoomRenderStateKey matches the legacy inline expansion (minimal room)', () => {
  const room = makeRoom({});
  assert.equal(computeRoomRenderStateKey(room, undefined), legacyInlineKey(room, undefined));
});

test('computeRoomRenderStateKey matches the legacy inline expansion (fully-specified room)', () => {
  const room = makeFullySpecifiedRoom();
  const blockers = new Set(['7,2', '1,14']);
  assert.equal(computeRoomRenderStateKey(room, blockers), legacyInlineKey(room, blockers));
});

// ── Prewarm/adopt key invariant ───────────────────────────────────────────────
// prewarmWallChunksForRoom computes its key from WallPrewarmContext fields;
// adoption computes it from the RoomDef.  Both must agree for adoption to work.

function keyFromPrewarmCtx(room: RoomDef, blockers: Set<string> | undefined): string {
  const ctx = makeWallPrewarmCtx(room, wallTemplateToSnapshot(makeEmptyTemplate()), blockers);
  // Mirror of the computeRenderStateKey call at the top of prewarmWallChunksForRoom.
  return computeRenderStateKey(
    ctx.blockTheme,
    ctx.worldNumber,
    ctx.lightingEffect,
    ctx.ambientDirection,
    ctx.seamBlending,
    ctx.blockerKeys,
    ctx.roomWidthBlocks,
    ctx.roomHeightBlocks,
    ctx.directionalBias,
    ctx.sideExposureStrength,
    ctx.minimumWallLight,
    ctx.falloffPower,
    ctx.backgroundLightSpill,
    ctx.solidLightSoftness,
  );
}

test('prewarm-time key equals adopt-time key (minimal room)', () => {
  const room = makeRoom({});
  assert.equal(keyFromPrewarmCtx(room, undefined), computeRoomRenderStateKey(room, undefined));
});

test('prewarm-time key equals adopt-time key (fully-specified room with blockers)', () => {
  const room = makeFullySpecifiedRoom();
  const blockers = new Set(['4,4']);
  assert.equal(keyFromPrewarmCtx(room, blockers), computeRoomRenderStateKey(room, blockers));
});

// ── wallTemplateToSnapshot ────────────────────────────────────────────────────

function makeEmptyTemplate(): RoomWallTemplate {
  return {
    wallCount: 0,
    xWorld: new Float32Array(0),
    yWorld: new Float32Array(0),
    wWorld: new Float32Array(0),
    hWorld: new Float32Array(0),
    isPlatformFlag: new Uint8Array(0),
    platformEdge: new Uint8Array(0),
    themeIndex: new Uint8Array(0),
    soundHardnessIndex: new Uint8Array(0),
    isInvisibleFlag: new Uint8Array(0),
    rampOrientationIndex: new Uint8Array(0),
    isPillarHalfWidthFlag: new Uint8Array(0),
    isIceFlag: new Uint8Array(0),
    isUltraIceFlag: new Uint8Array(0),
    rimStyleIndex: new Uint16Array(0),
    rimStyleTable: [],
  } as RoomWallTemplate;
}

test('wallTemplateToSnapshot is a zero-copy view (shared typed arrays)', () => {
  const t: RoomWallTemplate = {
    ...makeEmptyTemplate(),
    wallCount: 2,
    xWorld: new Float32Array([8, 16]),
    yWorld: new Float32Array([24, 32]),
    wWorld: new Float32Array([8, 8]),
    hWorld: new Float32Array([8, 8]),
    isPlatformFlag: new Uint8Array([0, 1]),
    platformEdge: new Uint8Array([0, 2]),
    themeIndex: new Uint8Array([255, 1]),
    isInvisibleFlag: new Uint8Array([0, 0]),
    rampOrientationIndex: new Uint8Array([255, 4]),
    isPillarHalfWidthFlag: new Uint8Array([0, 1]),
    rimStyleIndex: new Uint16Array([0xFFFF, 0xFFFF]),
    rimStyleTable: [],
  } as RoomWallTemplate;
  const s = wallTemplateToSnapshot(t);
  assert.equal(s.count, 2);
  // Identity — not copies.  The prewarm path depends on zero-copy sharing.
  assert.equal(s.xWorld, t.xWorld);
  assert.equal(s.yWorld, t.yWorld);
  assert.equal(s.wWorld, t.wWorld);
  assert.equal(s.hWorld, t.hWorld);
  assert.equal(s.isPlatformFlag, t.isPlatformFlag);
  assert.equal(s.platformEdge, t.platformEdge);
  assert.equal(s.themeIndex, t.themeIndex);
  assert.equal(s.isInvisibleFlag, t.isInvisibleFlag);
  assert.equal(s.rampOrientationIndex, t.rampOrientationIndex);
  assert.equal(s.isPillarHalfWidthFlag, t.isPillarHalfWidthFlag);
});
