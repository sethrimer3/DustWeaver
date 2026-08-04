/**
 * transitionEntryGeometry.ts — Single source of truth for *where a directed
 * room transition actually deposits the player*, and therefore for which entry
 * viewport must be pre-warmed before that crossing can be seamless.
 *
 * ## Why this module exists
 *
 * The zone-load readiness barrier promises that every intra-zone crossing can
 * activate without an entry warm.  It verified that promise against
 * `sourceTransition.targetSpawnBlock` — a *static authored field on the source
 * room*.  The runtime never uses that value.  `checkRoomTransitions` instead:
 *
 *   1. finds the TARGET room's return transition (opposite direction, pointing
 *      back at the source room);
 *   2. calls `computeSpawnBlockForTransition` on it with an `entryOffsetFraction`
 *      derived from where along the opening the player physically crossed — so
 *      the spawn slides along the doorway and is *different on every crossing*;
 *   3. passes the result through `resolveSpawnBlock`, which nudges it out of
 *      any solid geometry.
 *
 * Measured on the shipping campaign, **62 of 62** intra-zone directed
 * transitions had a prewarm-vs-activation offset mismatch, and **62 of 62**
 * produced a spawn that varies with the crossing fraction.  A "ready" zone was
 * therefore certifying coverage of a viewport the player never enters at, and
 * `canSkipEntryWarm()` correctly reported `entryViewportNotCovered` on
 * essentially every crossing — producing the entry-warm overlay this module
 * exists to eliminate.
 *
 * ## What is exported
 *
 * `enumerateEntrySpawnCandidates` reproduces the runtime spawn derivation
 * exactly, sampled across the full fraction range, so producers and predicates
 * agree with activation by construction.
 *
 * `computeSweptEntryViewport` collapses those candidates into ONE inflated
 * viewport rectangle whose coverage implies coverage at every reachable spawn.
 * It is expressed as an `{offsetXPx, offsetYPx, vpWPx, vpHPx}` tuple so it
 * drops straight into the existing `isViewportCovered(offset, vpW, vpH, …)`
 * cache predicates with no changes to the chunk layer.
 *
 * Both functions are pure and free of DOM/renderer imports so the readiness
 * contract is testable under plain `node --test`.
 */

import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { computeSpawnBlockForTransition, getOppositeTransitionDirection } from './gameTransitions';
import { resolveSpawnBlock } from './gameRoom';

/**
 * `entryOffsetFraction` samples used to enumerate reachable spawns.
 *
 * `computeSpawnBlockForTransition` maps the fraction onto an integer opening
 * offset via `Math.round(fraction * maxOffset)`, so the reachable spawn set is
 * finite and small (`openingSizeBlocks` entries at most).  Sampling at
 * `1 / (2 * maxOffset)` granularity therefore visits every attainable integer
 * offset rather than approximating the range.
 *
 * The endpoints 0 and 1 are always included: those are the extreme crossings
 * (player hugging either edge of the doorway) and they define the swept bounds.
 */
function _fractionSamplesFor(openingSizeBlocks: number): number[] {
  const maxOffset = Math.max(1, openingSizeBlocks - 1);
  const steps = Math.max(2, maxOffset * 2);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(i / steps);
  return out;
}

/** One reachable activation spawn for a directed transition, in block units. */
export interface EntrySpawnCandidate {
  xBlock: number;
  yBlock: number;
}

/**
 * Finds the transition in `targetRoom` that the runtime will use to place the
 * player when they cross `sourceTransition` out of `sourceRoom`.
 *
 * Mirrors the lookup in `checkRoomTransitions` exactly: opposite direction,
 * pointing back at the source room.  Returns `undefined` when the link is
 * one-way, in which case the runtime falls back to `targetSpawnBlock`.
 */
export function findReturnTransition(
  sourceRoomId: string,
  sourceTransition: RoomTransitionDef,
  targetRoom: RoomDef,
): RoomTransitionDef | undefined {
  const opposite = getOppositeTransitionDirection(sourceTransition.direction);
  return targetRoom.transitions.find(
    tt => tt.targetRoomId === sourceRoomId && tt.direction === opposite,
  );
}

/**
 * Enumerates every spawn block the runtime can actually place the player at
 * when they cross `sourceRoom.transitions[transitionIndex]` into `targetRoom`.
 *
 * This is the *authoritative* answer — it runs the same two functions the
 * gameplay path runs (`computeSpawnBlockForTransition` → `resolveSpawnBlock`)
 * rather than reading the authored `targetSpawnBlock` hint.
 *
 * Deduplicated and stable-ordered so callers can use it as a cache key input.
 */
export function enumerateEntrySpawnCandidates(
  sourceRoom: RoomDef,
  transitionIndex: number,
  targetRoom: RoomDef,
): EntrySpawnCandidate[] {
  const t = sourceRoom.transitions[transitionIndex];
  if (t === undefined) return [];

  const ret = findReturnTransition(sourceRoom.id, t, targetRoom);
  const seen = new Set<string>();
  const out: EntrySpawnCandidate[] = [];
  const push = (xy: readonly [number, number]): void => {
    const resolved = resolveSpawnBlock(targetRoom, xy[0], xy[1]);
    const key = `${resolved[0]},${resolved[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ xBlock: resolved[0], yBlock: resolved[1] });
  };

  if (ret === undefined) {
    // One-way link: `checkRoomTransitions` warns and uses the authored hint.
    push(t.targetSpawnBlock);
    return out;
  }

  for (const frac of _fractionSamplesFor(ret.openingSizeBlocks)) {
    push(computeSpawnBlockForTransition(targetRoom, ret, frac));
  }
  return out;
}

/** An entry viewport rectangle in the same units the chunk caches use. */
export interface SweptEntryViewport {
  offsetXPx: number;
  offsetYPx: number;
  vpWPx: number;
  vpHPx: number;
}

/**
 * The camera centre the renderer will actually use on the first frame after
 * spawning at `(spawnXBlock, spawnYBlock)` in `room`.
 *
 * `applyResidentRoomActivation` calls `snapCamera`, which centres on the spawn
 * and then applies `clampCameraToRoom`.  Every boundary transition spawns the
 * player within half a viewport of a room edge, so the clamp fires on at least
 * one axis on essentially *every* crossing — meaning the naive
 * `vpW/2 - spawnWorld*scale` offset (what the prewarm and `canSkipEntryWarm`
 * both used) describes a viewport that is off by up to half a screen from what
 * is drawn, and half of it lies outside the room entirely.
 *
 * Mirrors `clampCameraToRoom` in render/camera.ts exactly, including its
 * "room smaller than the viewport ⇒ centre the room" branch.
 */
export function computeEntryCameraCenterWorld(
  room: RoomDef,
  spawnXBlock: number,
  spawnYBlock: number,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): { centerXWorld: number; centerYWorld: number } {
  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;
  const halfViewW = vpWPx / (2 * scalePx);
  const halfViewH = vpHPx / (2 * scalePx);

  let cx = spawnXBlock * BLOCK_SIZE_MEDIUM;
  let cy = spawnYBlock * BLOCK_SIZE_MEDIUM;

  if (roomWidthWorld <= halfViewW * 2) {
    cx = roomWidthWorld * 0.5;
  } else {
    if (cx < halfViewW) cx = halfViewW;
    if (cx > roomWidthWorld - halfViewW) cx = roomWidthWorld - halfViewW;
  }

  if (roomHeightWorld <= halfViewH * 2) {
    cy = roomHeightWorld * 0.5;
  } else {
    if (cy < halfViewH) cy = halfViewH;
    if (cy > roomHeightWorld - halfViewH) cy = roomHeightWorld - halfViewH;
  }

  return { centerXWorld: cx, centerYWorld: cy };
}

/**
 * Collapses a set of reachable spawns into one viewport rectangle that
 * contains the camera viewport for *every* one of them.
 *
 * The camera centres on the spawn, so spawn `s` is visible through the rect
 * `[s*BS*scale - vpW/2, s*BS*scale + vpW/2]`.  The union over all spawns is
 * therefore the single-viewport rect grown by the spawn spread on each axis.
 * Returning it in `(offset, vpW, vpH)` form keeps every existing coverage
 * predicate — which computes `worldX = (px - offset) / scale` — correct without
 * modification.
 *
 * Returns `null` for an empty candidate set (nothing to require coverage of).
 */
export function computeSweptEntryViewport(
  candidates: readonly EntrySpawnCandidate[],
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
  /**
   * Target room, so each candidate's camera centre can be clamped exactly as
   * the renderer will clamp it.  Optional only to keep the pure-geometry unit
   * tests able to exercise the union maths in isolation; production callers
   * always pass it, and omitting it reproduces the old unclamped behaviour.
   */
  room?: RoomDef,
): SweptEntryViewport | null {
  if (candidates.length === 0) return null;

  let minXWorld = Infinity, maxXWorld = -Infinity;
  let minYWorld = Infinity, maxYWorld = -Infinity;
  for (const c of candidates) {
    // Use the CLAMPED camera centre — that is the offset the renderer uses.
    const center = room !== undefined
      ? computeEntryCameraCenterWorld(room, c.xBlock, c.yBlock, vpWPx, vpHPx, scalePx)
      : { centerXWorld: c.xBlock * BLOCK_SIZE_MEDIUM, centerYWorld: c.yBlock * BLOCK_SIZE_MEDIUM };
    const xw = center.centerXWorld;
    const yw = center.centerYWorld;
    if (xw < minXWorld) minXWorld = xw;
    if (xw > maxXWorld) maxXWorld = xw;
    if (yw < minYWorld) minYWorld = yw;
    if (yw > maxYWorld) maxYWorld = yw;
  }

  // A viewport at offset O shows world-px span [-O, -O + vp].  A camera centre
  // C gives O = vp/2 - C*scale, hence span [C*scale - vp/2, C*scale + vp/2].
  // Unioning over C ∈ [minC, maxC] gives [minC*scale - vp/2, maxC*scale + vp/2]:
  // the union's LEFT edge comes from the smallest centre, so the union offset
  // is derived from `min`, and its width grows by the centre spread.
  const offsetXPx = vpWPx / 2 - minXWorld * scalePx;
  const offsetYPx = vpHPx / 2 - minYWorld * scalePx;
  const spreadXPx = (maxXWorld - minXWorld) * scalePx;
  const spreadYPx = (maxYWorld - minYWorld) * scalePx;

  return {
    offsetXPx,
    offsetYPx,
    vpWPx: vpWPx + spreadXPx,
    vpHPx: vpHPx + spreadYPx,
  };
}

/**
 * Convenience wrapper: the swept entry viewport for one directed transition,
 * or `null` when the transition index is invalid or yields no candidates.
 *
 * This is the function both `addZoneEntryViewportTasks` (producer) and
 * `collectZoneEntryReadinessReport` (predicate) call, which is what guarantees
 * they enumerate the identical requirement — the property whose absence let a
 * zone report ready while activation still needed an entry warm.
 */
export function computeDirectedEntryViewport(
  sourceRoom: RoomDef,
  transitionIndex: number,
  targetRoom: RoomDef,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): SweptEntryViewport | null {
  const candidates = enumerateEntrySpawnCandidates(sourceRoom, transitionIndex, targetRoom);
  return computeSweptEntryViewport(candidates, vpWPx, vpHPx, scalePx, targetRoom);
}
