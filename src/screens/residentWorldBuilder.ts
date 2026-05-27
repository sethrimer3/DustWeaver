/**
 * residentWorldBuilder.ts — Builds a frozen WorldState for a resident room.
 *
 * Produces a fully initialised WorldState (enemies, hazards, ropes, falling
 * blocks, grasshoppers, background fluid, walls) WITHOUT a player cluster.
 * The result can be stored as a frozen resident world and activated later by
 * inserting the player + applying renderer state (see activateResidentRoom in
 * gameScreen.ts).
 *
 * Equivalent to Phases A/C/D/E of makeLoadRoomPhases, intentionally omitting:
 *  - Phase B: player spawn (player is inserted on activation)
 *  - Phase F: renderer state, camera snap, schedule hooks (applied on activation)
 *
 * Module-level singleton resets (resetSnakeRuntimeState, resetRadiantTetherState,
 * resetRadiantWebState) are NOT called here because they affect the currently
 * active world.  They are called in activateResidentRoom instead.
 *
 * RNG isolation (BUILD 417):
 *   Background resident builds use a deterministic per-room RNG derived from
 *   `campaignSeed`, `room.id`, and `room.worldNumber`.  This RNG is local to
 *   the build call and never shared with the active gameplay RNG, so idle
 *   resident builds cannot perturb active randomness regardless of timing or
 *   room-load order.
 *
 * BUILD 416, hardened in BUILD 417
 */

import { WorldState, createWorldState } from '../sim/world';
import { RoomDef, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { createRng, type RngState } from '../sim/rng';
import { spawnBackgroundFluidParticles, spawnAllDustPiles, BACKGROUND_FLUID_COUNT } from './gameSpawn';
import { spawnEnemyClusters } from './gameEnemySpawn';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import { loadRoomHazards, loadRoomRopes, loadRoomFallingBlocks, loadRoomGrasshoppers } from './gameRoom';
import { buildRoomWallTemplate, applyRoomWallTemplate } from './gameRoomWalls';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import * as FP from '../debug/perfFreezeProfiler';

const FIXED_DT_MS = 16.666;

// ── Per-room RNG ──────────────────────────────────────────────────────────────

/**
 * A simple djb2-style string hash used to derive a numeric seed from a room id.
 * Uses XOR (rather than the canonical addition variant) for slightly better
 * avalanche behaviour on short room-id strings.
 * Not cryptographic — just needs good bit distribution for seed mixing.
 */
function _hashRoomId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h, 33) ^ id.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Create a deterministic per-room RNG for resident world builds.
 *
 * The seed is derived from:
 *   - `campaignSeed` — session-level seed (e.g. the active gameplay seed).
 *   - `room.id`      — stable string identifier for the room.
 *   - `room.worldNumber` — world tier (1–N); prevents collisions between rooms
 *                          with similar ids across different worlds.
 *
 * The resulting RNG is independent from the active gameplay `levelRng` so
 * background resident builds cannot perturb active randomness.
 *
 * @param room          Room definition being built.
 * @param campaignSeed  Numeric seed for the current campaign/session.
 * @returns             A fresh RngState local to this build call.
 */
export function createResidentRoomRng(room: RoomDef, campaignSeed: number): RngState {
  const roomIdHash   = _hashRoomId(room.id);
  // Use the Knuth multiplicative hash constant (2654435761) to spread
  // worldNumber contributions across the seed bits.
  const worldContrib = Math.imul(room.worldNumber, 2654435761) >>> 0;
  const combined     = (campaignSeed ^ roomIdHash ^ worldContrib) >>> 0;
  return createRng(combined);
}

// ── buildResidentWorldState ───────────────────────────────────────────────────

/**
 * Build a frozen WorldState for `room` without a player cluster.
 *
 * Uses the provided `roomRuntimeCache` to skip the expensive wall-merge pass
 * for rooms that are already prepared (e.g. by roomPreloadScheduler).
 *
 * The RNG used for enemy and background fluid spawning is a deterministic
 * per-room RNG derived from `campaignSeed` and the room's id/worldNumber.
 * It is never shared with the active gameplay RNG, so this call is safe
 * to make at any time without perturbing active randomness.
 *
 * @param room             Room definition to build.
 * @param campaignSeed     Numeric campaign/session seed for per-room RNG derivation.
 * @param roomRuntimeCache Runtime cache for wall templates and blocker keys.
 * @returns                A fully-built WorldState ready to be frozen.
 */
export function buildResidentWorldState(
  room: RoomDef,
  campaignSeed: number,
  roomRuntimeCache: RoomRuntimeCache,
): WorldState {
  const t0 = import.meta.env.DEV ? performance.now() : 0;

  // Derive a local per-room RNG — never shared with active gameplay levelRng.
  const levelRng: RngState = createResidentRoomRng(room, campaignSeed);

  const rw = createWorldState(FIXED_DT_MS, 42);

  // ── Phase A equivalent: world dimensions + reset ─────────────────────────
  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;

  rw.worldWidthWorld  = roomWidthWorld;
  rw.worldHeightWorld = roomHeightWorld;

  // The remaining WorldState fields are already initialised to the correct
  // defaults by createWorldState() (tick=0, particleCount=0, clusters=[],
  // wallCount=0, all grapple flags=0, hasGrappleChargeFlag=1, etc.).

  FP.recordLoadPhaseStep('Resident:phaseA', import.meta.env.DEV ? performance.now() - t0 : 0);

  // ── Phase C equivalent: bgWallGrid + spawn enemies ────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    rw.bgWallGridWidth  = room.widthBlocks;
    rw.bgWallGridHeight = room.heightBlocks;
    const bgWallCellCount = room.widthBlocks * room.heightBlocks;
    if (rw.bgWallGrid.length !== bgWallCellCount) {
      rw.bgWallGrid = new Uint8Array(bgWallCellCount);
    } else {
      rw.bgWallGrid.fill(0);
    }
    if (room.backgroundBlocks) {
      for (const b of room.backgroundBlocks) {
        for (let dy = 0; dy < b.hBlock; dy++) {
          for (let dx = 0; dx < b.wBlock; dx++) {
            const col = b.xBlock + dx;
            const row = b.yBlock + dy;
            if (col >= 0 && col < room.widthBlocks && row >= 0 && row < room.heightBlocks) {
              rw.bgWallGrid[col + row * room.widthBlocks] = 1;
            }
          }
        }
      }
    }
    // Enemy entityIds start at 2 (same as in the active world).
    spawnEnemyClusters(rw, room.enemies, 2, levelRng);
    FP.recordLoadPhaseStep('Resident:phaseC', import.meta.env.DEV ? performance.now() - _t : 0);
  }

  // ── Phase D equivalent: bg fluid + grapple hunter chains + walls ─────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    spawnBackgroundFluidParticles(rw, BACKGROUND_FLUID_COUNT, levelRng);
    FP.recordLoadPhaseStep('Resident:bgFluid', import.meta.env.DEV ? performance.now() - _t : 0);
  }

  {
    // Grapple hunter chains (no player chain — player entityId=1 is absent).
    const _t = import.meta.env.DEV ? performance.now() : 0;
    for (let ci = 0; ci < rw.clusters.length; ci++) {
      const cl = rw.clusters[ci];
      if (cl.isGrappleHunterFlag === 1) {
        initGrappleHunterChainParticles(rw, cl);
      }
    }
    FP.recordLoadPhaseStep('Resident:grappleChains', import.meta.env.DEV ? performance.now() - _t : 0);
  }

  {
    // Wall template — use cache if available.
    const _t = import.meta.env.DEV ? performance.now() : 0;
    const cacheEntry = roomRuntimeCache.get(room.id);
    if (cacheEntry !== undefined) {
      applyRoomWallTemplate(rw, cacheEntry.wallTemplate);
      if (import.meta.env.DEV) {
        console.log(`[residentBuild] ${room.id} walls: cache HIT`);
      }
    } else {
      const wallTemplate = buildRoomWallTemplate(room);
      applyRoomWallTemplate(rw, wallTemplate);
      roomRuntimeCache.set(room.id, {
        wallTemplate,
        edgeExtension: null,
        blockerKeys:    null,
        darkBlockerKeys: null,
        wallDecorations: null,
      });
      if (import.meta.env.DEV) {
        console.log(`[residentBuild] ${room.id} walls: cache MISS (built in ${(performance.now() - _t).toFixed(1)}ms)`);
      }
    }
    FP.recordLoadPhaseStep('Resident:walls', import.meta.env.DEV ? performance.now() - _t : 0);
  }

  // ── Phase E equivalent: hazards + ropes + falling blocks + grasshoppers ───
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    loadRoomHazards(rw, room);
    FP.recordLoadPhaseStep('Resident:hazards', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    loadRoomRopes(rw, room);
    FP.recordLoadPhaseStep('Resident:ropes', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    loadRoomFallingBlocks(rw, room);
    FP.recordLoadPhaseStep('Resident:fallingBlocks', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    loadRoomGrasshoppers(rw, room);
    FP.recordLoadPhaseStep('Resident:grasshoppers', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    spawnAllDustPiles(rw);
    FP.recordLoadPhaseStep('Resident:dustPiles', import.meta.env.DEV ? performance.now() - _t : 0);
  }

  if (import.meta.env.DEV) {
    console.log(
      `[residentBuild] ${room.id} built in ${(performance.now() - t0).toFixed(1)}ms` +
      ` (${rw.clusters.length} enemies, wallCount=${rw.wallCount}, particles=${rw.particleCount})`,
    );
  }

  return rw;
}

// ── createResidentBuildGenerator ─────────────────────────────────────────────

/**
 * Incremental generator version of buildResidentWorldState.
 *
 * Spreads the build across multiple RAF frames by yielding a phase-description
 * string after each bounded chunk of work.  The caller advances one phase per
 * frame so no single phase can cause a large gameplay hitch.
 *
 * Phases and their approximate cost per room:
 *   phaseA       — world dimensions         (~0.1 ms)
 *   phaseC       — bgWallGrid + enemies      (~1–4 ms, varies with enemy count)
 *   phaseD_fluid — background fluid          (~0.5 ms)
 *   phaseD_chains— grapple hunter chains     (~0.1 ms)
 *   phaseD_walls — wall template (expensive) (~3–10 ms)
 *   phaseE_sim   — hazards/ropes/blocks/grass (~1–3 ms)
 *   phaseE_dust  — dust piles                (~0.5 ms)
 *
 * Usage:
 *   const gen = createResidentBuildGenerator(room, campaignSeed, cache);
 *   let result = gen.next();
 *   while (!result.done) {
 *     // suspend until next frame, then:
 *     result = gen.next();
 *   }
 *   const builtWorld: WorldState = result.value;
 *
 * The caller is responsible for discarding the result if the room definition
 * changed while the generator was suspended (stale-build guard).
 *
 * BUILD 418
 */
export function* createResidentBuildGenerator(
  room: RoomDef,
  campaignSeed: number,
  roomRuntimeCache: RoomRuntimeCache,
): Generator<string, WorldState, void> {
  const t0 = import.meta.env.DEV ? performance.now() : 0;

  // Derive a local per-room RNG — never shared with active gameplay levelRng.
  const levelRng: RngState = createResidentRoomRng(room, campaignSeed);

  const rw = createWorldState(FIXED_DT_MS, 42);

  // ── Phase A: world dimensions ─────────────────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    rw.worldWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
    rw.worldHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;
    FP.recordLoadPhaseStep('Resident:phaseA', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseA';

  // ── Phase C: bgWallGrid + spawn enemies ───────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    rw.bgWallGridWidth  = room.widthBlocks;
    rw.bgWallGridHeight = room.heightBlocks;
    const bgWallCellCount = room.widthBlocks * room.heightBlocks;
    if (rw.bgWallGrid.length !== bgWallCellCount) {
      rw.bgWallGrid = new Uint8Array(bgWallCellCount);
    } else {
      rw.bgWallGrid.fill(0);
    }
    if (room.backgroundBlocks) {
      for (const b of room.backgroundBlocks) {
        for (let dy = 0; dy < b.hBlock; dy++) {
          for (let dx = 0; dx < b.wBlock; dx++) {
            const col = b.xBlock + dx;
            const row = b.yBlock + dy;
            if (col >= 0 && col < room.widthBlocks && row >= 0 && row < room.heightBlocks) {
              rw.bgWallGrid[col + row * room.widthBlocks] = 1;
            }
          }
        }
      }
    }
    spawnEnemyClusters(rw, room.enemies, 2, levelRng);
    FP.recordLoadPhaseStep('Resident:phaseC', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseC';

  // ── Phase D step 1: background fluid ─────────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    spawnBackgroundFluidParticles(rw, BACKGROUND_FLUID_COUNT, levelRng);
    FP.recordLoadPhaseStep('Resident:bgFluid', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseD_fluid';

  // ── Phase D step 2: grapple hunter chains ────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    for (let ci = 0; ci < rw.clusters.length; ci++) {
      const cl = rw.clusters[ci];
      if (cl.isGrappleHunterFlag === 1) {
        initGrappleHunterChainParticles(rw, cl);
      }
    }
    FP.recordLoadPhaseStep('Resident:grappleChains', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseD_chains';

  // ── Phase D step 3: wall template (most expensive phase) ─────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    const cacheEntry = roomRuntimeCache.get(room.id);
    if (cacheEntry !== undefined) {
      applyRoomWallTemplate(rw, cacheEntry.wallTemplate);
      if (import.meta.env.DEV) {
        console.log(`[residentBuild:gen] ${room.id} walls: cache HIT`);
      }
    } else {
      const wallTemplate = buildRoomWallTemplate(room);
      applyRoomWallTemplate(rw, wallTemplate);
      roomRuntimeCache.set(room.id, {
        wallTemplate,
        edgeExtension: null,
        blockerKeys:    null,
        darkBlockerKeys: null,
        wallDecorations: null,
      });
      if (import.meta.env.DEV) {
        console.log(`[residentBuild:gen] ${room.id} walls: cache MISS (built in ${(performance.now() - _t).toFixed(1)}ms)`);
      }
    }
    FP.recordLoadPhaseStep('Resident:walls', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseD_walls';

  // ── Phase E step 1: hazards + ropes + falling blocks + grasshoppers ───────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    loadRoomHazards(rw, room);
    FP.recordLoadPhaseStep('Resident:hazards', import.meta.env.DEV ? performance.now() - _t : 0);
    loadRoomRopes(rw, room);
    FP.recordLoadPhaseStep('Resident:ropes', import.meta.env.DEV ? performance.now() - _t : 0);
    loadRoomFallingBlocks(rw, room);
    FP.recordLoadPhaseStep('Resident:fallingBlocks', import.meta.env.DEV ? performance.now() - _t : 0);
    loadRoomGrasshoppers(rw, room);
    FP.recordLoadPhaseStep('Resident:grasshoppers', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseE_sim';

  // ── Phase E step 2: dust piles ────────────────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    spawnAllDustPiles(rw);
    FP.recordLoadPhaseStep('Resident:dustPiles', import.meta.env.DEV ? performance.now() - _t : 0);
  }
  yield 'phaseE_dust';

  if (import.meta.env.DEV) {
    console.log(
      `[residentBuild:gen] ${room.id} built in ${(performance.now() - t0).toFixed(1)}ms` +
      ` (${rw.clusters.length} enemies, wallCount=${rw.wallCount}, particles=${rw.particleCount})`,
    );
  }

  return rw;
}
