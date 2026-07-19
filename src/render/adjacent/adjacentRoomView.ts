/**
 * adjacentRoomView.ts — Explicit render-state and cache-identity types for the
 * connected-room ("Render Adjacent Rooms") feature.
 *
 * This introduces a dedicated `AdjacentRoomView` rather than overloading the
 * deprecated single `stagedRoom` field on the legacy two-room-crossing path.
 * The view is render-only data: which rooms to draw, where, and which frozen
 * source supplies their dynamic structural state. It never carries a mutable
 * simulation world.
 */

import type { ConnectedRoomInstance } from './connectedRoomLayout';

/**
 * Where an adjacent room's dynamic *structural* state (broken/crumbled/falling
 * blocks, etc.) comes from, in preference order. Entities are never drawn from
 * any of these — only terrain/presentation.
 */
export type AdjacentTerrainSource =
  /** A valid frozen resident WorldState whose builtForRoomId matches the room. */
  | 'resident-world'
  /** A prepared wall template / render snapshot (no dynamic mutation applied). */
  | 'wall-template'
  /** An asynchronously prepared fallback that is still pending or minimal. */
  | 'async-fallback';

/** One drawable adjacent-room instance plus its resolved terrain source. */
export interface AdjacentRoomView {
  readonly instance: ConnectedRoomInstance;
  /** Resolved source for this room's dynamic structural state this frame. */
  readonly terrainSource: AdjacentTerrainSource;
  /** True once safe render data exists; false keeps void/transition presentation. */
  readonly ready: boolean;
}

/**
 * The full connected-room render state handed to the frame renderer. Empty
 * (and cheap) whenever the effective setting is off.
 */
export interface ConnectedRoomRenderState {
  readonly activeRoomId: string;
  readonly views: readonly AdjacentRoomView[];
  /** Target room ids that have a rendered destination this frame (for void-edge
   *  suppression on the corresponding active-room transitions). */
  readonly connectedTargetRoomIds: ReadonlySet<string>;
}

/** An empty, allocation-light render state for the effective-off path. */
export const EMPTY_CONNECTED_RENDER_STATE: ConnectedRoomRenderState = {
  activeRoomId: '',
  views: [],
  connectedTargetRoomIds: new Set<string>(),
};

/**
 * Build a stable cache key for an adjacent room's drawn chunks. Keyed by room
 * id, the canonical render-state key (from `computeRoomRenderStateKey` — passed
 * in, never re-derived here), the render scale/zoom, and an optional
 * dynamic-geometry generation counter so structural changes invalidate cleanly.
 */
export function makeAdjacentRoomCacheKey(
  roomId: string,
  renderStateKey: string,
  scale: number,
  dynamicGeneration = 0,
): string {
  return `${roomId}|${renderStateKey}|@${scale}|g${dynamicGeneration}`;
}

/**
 * A frozen resident world may only supply an adjacent room's dynamic structural
 * state when it was actually built for that room. A mismatch means the singleton
 * was adopted/swapped for a different room — using it would paint another room's
 * walls. Callers must skip such a world, log loudly in DEV, and request a
 * rebuild instead.
 */
export function isResidentWorldUsableForRoom(
  residentBuiltForRoomId: string | null | undefined,
  roomId: string,
): boolean {
  return (
    typeof residentBuiltForRoomId === 'string' &&
    residentBuiltForRoomId.length > 0 &&
    residentBuiltForRoomId === roomId
  );
}
