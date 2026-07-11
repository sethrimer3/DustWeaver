/**
 * roomRenderState.ts — Single source of truth for deriving renderer-facing
 * room render-state parameters from a `RoomDef`.
 *
 * ## Why this module exists
 *
 * The render-state key (see `computeRenderStateKey` in roomRenderCacheStore.ts)
 * must be computed from *identical* inputs at prewarm time and at adoption
 * time, or prewarmed wall/background chunks are silently discarded as
 * `staleRenderState` — an invisible performance regression.  Before this
 * module, the RoomDef → parameter mapping (14 fields, each with a `??`
 * default) was hand-duplicated in `gameLoadRoomPhases.ts` (twice),
 * `entryViewportWarm.ts`, and `roomRenderChunkWarmScheduler.ts`.  A drift in
 * any single fallback would break chunk adoption without any error.
 *
 * ## Responsibility and ownership
 *
 * - Owns the canonical `RoomDef` field → render-state parameter mapping,
 *   including every default value.
 * - Pure derivation only: no DOM, no canvas, no mutable module state.
 *   Safe to import from plain `node --test` tests.
 * - Allowed dependencies: `levels/roomDef` (types), `roomRenderCacheStore`
 *   (key computation), `ambientLightDepths` (default constants), and
 *   type-only imports from `blockSpriteRenderer` / `snapshotTypes`.
 *
 * ## Compatibility constraint
 *
 * The derived parameter values feed `computeRenderStateKey`.  Changing any
 * default here invalidates every previously computed render-state key for
 * rooms that rely on that default (prewarmed chunks rebuild once — no
 * persistent-data impact, but do not change defaults casually).
 */

import type { RoomDef, RoomWallTemplate, LightingEffect, AmbientLightDirection, BlockSeamBlending } from '../../levels/roomDef';
import type { BlockTheme } from '../../levels/blockTheme';
import type { WallSnapshot } from '../snapshotTypes';
import type { WallPrewarmContext } from './blockSpriteRenderer';
import { computeRenderStateKey } from './roomRenderCacheStore';
import {
  DEFAULT_DIRECTIONAL_BIAS,
  DEFAULT_SIDE_EXPOSURE_STRENGTH,
  DEFAULT_MINIMUM_WALL_LIGHT,
  DEFAULT_FALLOFF_POWER,
  DEFAULT_BACKGROUND_LIGHT_SPILL,
  DEFAULT_SOLID_LIGHT_SOFTNESS,
} from './ambientLightDepths';

/**
 * Canonical render-state parameters for a room, with all defaults applied.
 * Field-for-field this matches the non-`wallSnapshot` portion of
 * `WallPrewarmContext` so both the prewarm and adoption paths derive keys
 * from the same values.
 */
export interface RoomRenderStateParams {
  readonly blockTheme: BlockTheme | null;
  readonly worldNumber: number;
  readonly lightingEffect: LightingEffect;
  readonly ambientDirection: AmbientLightDirection;
  readonly seamBlending: BlockSeamBlending;
  readonly roomWidthBlocks: number;
  readonly roomHeightBlocks: number;
  readonly blockerKeys: ReadonlySet<string>;
  readonly directionalBias: number;
  readonly sideExposureStrength: number;
  readonly minimumWallLight: number;
  readonly falloffPower: number;
  readonly backgroundLightSpill: number;
  readonly solidLightSoftness: number;
}

/** Shared empty blocker set so repeat calls without blockers reuse one object. */
const _EMPTY_BLOCKERS: ReadonlySet<string> = new Set();

/**
 * Derives the canonical render-state parameters for `room`, applying the
 * same defaults everywhere: `worldNumber ?? 1`, `lightingEffect ?? 'Ambient'`,
 * `ambientLightDirection ?? 'omni'`, `blockSeamBlending ?? 'off'`, and the
 * `DEFAULT_*` ambient-light constants.
 *
 * @param blockerKeys Precomputed ambient-light blocker keys for the room
 *   (from `buildRoomAmbientBlockerKeys` or the room runtime cache).
 *   `undefined` means "computed, no blockers" and maps to an empty set.
 */
export function deriveRoomRenderStateParams(
  room: RoomDef,
  blockerKeys: ReadonlySet<string> | undefined,
): RoomRenderStateParams {
  return {
    blockTheme:           room.blockTheme ?? null,
    worldNumber:          room.worldNumber ?? 1,
    lightingEffect:       room.lightingEffect ?? 'Ambient',
    ambientDirection:     room.ambientLightDirection ?? 'omni',
    seamBlending:         room.blockSeamBlending ?? 'off',
    roomWidthBlocks:      room.widthBlocks,
    roomHeightBlocks:     room.heightBlocks,
    blockerKeys:          blockerKeys ?? _EMPTY_BLOCKERS,
    directionalBias:      room.directionalBias       ?? DEFAULT_DIRECTIONAL_BIAS,
    sideExposureStrength: room.sideExposureStrength  ?? DEFAULT_SIDE_EXPOSURE_STRENGTH,
    minimumWallLight:     room.minimumWallLight      ?? DEFAULT_MINIMUM_WALL_LIGHT,
    falloffPower:         room.falloffPower          ?? DEFAULT_FALLOFF_POWER,
    backgroundLightSpill: room.backgroundLightSpill  ?? DEFAULT_BACKGROUND_LIGHT_SPILL,
    solidLightSoftness:   room.solidLightSoftness    ?? DEFAULT_SOLID_LIGHT_SOFTNESS,
  };
}

/**
 * Computes the render-state key for `room` from the canonical derived
 * parameters.  This is the adoption-time / load-time counterpart of the
 * prewarm-time key computed inside `prewarmWallChunksForRoom` from a
 * `WallPrewarmContext` — both must agree, which
 * `makeWallPrewarmCtx` guarantees by deriving from the same params.
 */
export function computeRoomRenderStateKey(
  room: RoomDef,
  blockerKeys: ReadonlySet<string> | undefined,
): string {
  const p = deriveRoomRenderStateParams(room, blockerKeys);
  return computeRenderStateKey(
    p.blockTheme,
    p.worldNumber,
    p.lightingEffect,
    p.ambientDirection,
    p.seamBlending,
    p.blockerKeys,
    p.roomWidthBlocks,
    p.roomHeightBlocks,
    p.directionalBias,
    p.sideExposureStrength,
    p.minimumWallLight,
    p.falloffPower,
    p.backgroundLightSpill,
    p.solidLightSoftness,
  );
}

/**
 * Constructs a `WallPrewarmContext` for `room` from the canonical derived
 * parameters.  Replaces the formerly duplicated private `_makeWallPrewarmCtx`
 * helpers in `roomRenderChunkWarmScheduler.ts` and `entryViewportWarm.ts`.
 */
export function makeWallPrewarmCtx(
  room: RoomDef,
  wallSnapshot: WallSnapshot,
  blockerKeys: ReadonlySet<string> | undefined,
): WallPrewarmContext {
  const p = deriveRoomRenderStateParams(room, blockerKeys);
  return {
    wallSnapshot,
    worldNumber:          p.worldNumber,
    blockTheme:           p.blockTheme,
    lightingEffect:       p.lightingEffect,
    ambientDirection:     p.ambientDirection,
    roomWidthBlocks:      p.roomWidthBlocks,
    roomHeightBlocks:     p.roomHeightBlocks,
    blockerKeys:          p.blockerKeys,
    directionalBias:      p.directionalBias,
    sideExposureStrength: p.sideExposureStrength,
    minimumWallLight:     p.minimumWallLight,
    falloffPower:         p.falloffPower,
    backgroundLightSpill: p.backgroundLightSpill,
    solidLightSoftness:   p.solidLightSoftness,
    seamBlending:         p.seamBlending,
  };
}

/**
 * Zero-copy view of a `RoomWallTemplate` as a `WallSnapshot` — both share the
 * same underlying typed-array buffers.  Replaces the formerly duplicated
 * private `_wallTemplateToSnapshot` helpers in
 * `roomRenderChunkWarmScheduler.ts` and `entryViewportWarm.ts`.
 */
export function wallTemplateToSnapshot(t: RoomWallTemplate): WallSnapshot {
  return {
    count:                 t.wallCount,
    xWorld:                t.xWorld,
    yWorld:                t.yWorld,
    wWorld:                t.wWorld,
    hWorld:                t.hWorld,
    isPlatformFlag:        t.isPlatformFlag,
    platformEdge:          t.platformEdge,
    themeIndex:            t.themeIndex,
    isInvisibleFlag:       t.isInvisibleFlag,
    rampOrientationIndex:  t.rampOrientationIndex,
    isPillarHalfWidthFlag: t.isPillarHalfWidthFlag,
  };
}
