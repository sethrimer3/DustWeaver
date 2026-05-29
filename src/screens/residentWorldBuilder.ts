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
import { applyRoomWallTemplate, buildRoomWallTemplateIncremental } from './gameRoomWalls';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { resolveRoomWallTemplate } from './preparedRoomRuntime';
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
    let occupiedCells = 0;
    if (room.backgroundBlocks) {
      for (const b of room.backgroundBlocks) {
        for (let dy = 0; dy < b.hBlock; dy++) {
          for (let dx = 0; dx < b.wBlock; dx++) {
            const col = b.xBlock + dx;
            const row = b.yBlock + dy;
            if (col >= 0 && col < room.widthBlocks && row >= 0 && row < room.heightBlocks) {
              const idx = col + row * room.widthBlocks;
              if (rw.bgWallGrid[idx] === 0) occupiedCells++;
              rw.bgWallGrid[idx] = 1;
            }
          }
        }
      }
    }
    if (import.meta.env.DEV && bgWallCellCount > 65536) {
      const bgBlockCount = room.backgroundBlocks?.length ?? 0;
      const sparsePct = bgWallCellCount > 0 ? ((occupiedCells / bgWallCellCount) * 100).toFixed(2) : '0';
      console.log(
        `[largeRoom] resident bgWallGrid: roomId=${room.id}` +
        ` ${room.widthBlocks}×${room.heightBlocks} area=${bgWallCellCount}` +
        ` bgBlocks=${bgBlockCount} occupiedCells=${occupiedCells} (${sparsePct}%)`,
      );
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
    // Wall template — priority: cache → baked JSON template → runtime build.
    const _t = import.meta.env.DEV ? performance.now() : 0;
    const resolution = resolveRoomWallTemplate(room, roomRuntimeCache);
    applyRoomWallTemplate(rw, resolution.template);
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      if (resolution.source === 'cache') {
        console.log(`[wallTemplate] roomId=${room.id} source=cache wallCount=${resolution.template.wallCount}`);
      } else if (resolution.source === 'baked') {
        console.log(`[wallTemplate] roomId=${room.id} source=baked wallCount=${resolution.template.wallCount}` +
          ` (apply ${_ms.toFixed(1)}ms)`);
      } else {
        console.log(`[wallTemplate] roomId=${room.id} source=fallback reason=missing wallCount=${resolution.template.wallCount}` +
          ` (build ${resolution.buildMs.toFixed(1)}ms)`);
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
 *   phaseA              — world dimensions                  (~0.1 ms)
 *   phaseC              — bgWallGrid + enemies              (~1–4 ms, varies with enemy count)
 *   phaseD_fluid        — background fluid                  (~0.5 ms)
 *   phaseD_chains       — grapple hunter chains             (~0.1 ms)
 *   phaseD_walls_lookup — wall template cache probe + apply (~0.1 ms on hit, cache check only on miss)
 *   phaseD_walls_build  — wall template build (miss only)   (~3–10 ms; skipped on cache hit)
 *   phaseE_sim          — hazards/ropes/blocks/grass        (~1–3 ms)
 *   phaseE_dust         — dust piles                        (~0.5 ms)
 *
 * Note: phaseD_walls_build is only emitted on a cache miss.  On a cache hit the
 * generator emits phaseD_walls_lookup and proceeds directly to phaseE_sim.
 * On a cache+baked miss, buildRoomWallTemplateIncremental() spreads the O(n²)
 * merge pass across frames (4 ms budget per yield), emitting zero or more
 * 'phaseD_walls_merge' yields before the final 'phaseD_walls_build' yield.
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
/**
 * Optional diagnostics context passed to createResidentBuildGenerator.
 *
 * Provides build reason and priority for per-phase warning messages, and an
 * optional callback that fires when any phase exceeds the 8 ms threshold.
 * All fields are optional so callers can pass partial context.
 */
export interface ResidentBuildDiagContext {
  /** Human-readable build reason (e.g. 'adjacent', 'initial', 'hotSwapTarget'). */
  reason?: string;
  /** Numeric priority of the build task (1 = most urgent). */
  priority?: number;
  /**
   * Called in DEV when a generator phase exceeds LONG_PHASE_WARN_MS.
   * @param phase  Phase label (e.g. 'phaseD_walls_build').
   * @param ms     Measured wall-clock time for the phase in milliseconds.
   */
  onLongPhase?: (phase: string, ms: number) => void;
}

/** Threshold in ms above which a resident build phase is considered slow. */
const LONG_PHASE_WARN_MS = 8;

/**
 * DEV-only helper: emits a console.warn and fires the diagContext callback
 * when a generator phase exceeds LONG_PHASE_WARN_MS.
 */
function _warnLongPhase(
  phase: string,
  ms: number,
  roomId: string,
  diagContext: ResidentBuildDiagContext | undefined,
): void {
  if (ms <= LONG_PHASE_WARN_MS) return;
  const rStr = diagContext?.reason   !== undefined ? ` reason=${diagContext.reason}`   : '';
  const pStr = diagContext?.priority !== undefined ? ` pri=${diagContext.priority}`     : '';
  console.warn(`[resident] long phase roomId=${roomId}${rStr}${pStr} phase=${phase} ms=${ms.toFixed(1)}`);
  diagContext?.onLongPhase?.(phase, ms);
}

export function* createResidentBuildGenerator(
  room: RoomDef,
  campaignSeed: number,
  roomRuntimeCache: RoomRuntimeCache,
  diagContext?: ResidentBuildDiagContext,
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
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:phaseA', _ms);
      _warnLongPhase('phaseA', _ms, room.id, diagContext);
    } else { FP.recordLoadPhaseStep('Resident:phaseA', 0); }
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
    let occupiedCells = 0;
    if (room.backgroundBlocks) {
      for (const b of room.backgroundBlocks) {
        for (let dy = 0; dy < b.hBlock; dy++) {
          for (let dx = 0; dx < b.wBlock; dx++) {
            const col = b.xBlock + dx;
            const row = b.yBlock + dy;
            if (col >= 0 && col < room.widthBlocks && row >= 0 && row < room.heightBlocks) {
              const idx = col + row * room.widthBlocks;
              if (rw.bgWallGrid[idx] === 0) occupiedCells++;
              rw.bgWallGrid[idx] = 1;
            }
          }
        }
      }
    }
    if (import.meta.env.DEV && bgWallCellCount > 65536) {
      const bgBlockCount = room.backgroundBlocks?.length ?? 0;
      const sparsePct = bgWallCellCount > 0 ? ((occupiedCells / bgWallCellCount) * 100).toFixed(2) : '0';
      console.log(
        `[largeRoom] resident(gen) bgWallGrid: roomId=${room.id}` +
        ` ${room.widthBlocks}×${room.heightBlocks} area=${bgWallCellCount}` +
        ` bgBlocks=${bgBlockCount} occupiedCells=${occupiedCells} (${sparsePct}%)`,
      );
    }
    spawnEnemyClusters(rw, room.enemies, 2, levelRng);
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:phaseC', _ms);
      _warnLongPhase('phaseC', _ms, room.id, diagContext);
    } else { FP.recordLoadPhaseStep('Resident:phaseC', 0); }
  }
  yield 'phaseC';

  // ── Phase D step 1: background fluid ─────────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    spawnBackgroundFluidParticles(rw, BACKGROUND_FLUID_COUNT, levelRng);
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:bgFluid', _ms);
      _warnLongPhase('phaseD_fluid', _ms, room.id, diagContext);
    } else { FP.recordLoadPhaseStep('Resident:bgFluid', 0); }
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
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:grappleChains', _ms);
      _warnLongPhase('phaseD_chains', _ms, room.id, diagContext);
    } else { FP.recordLoadPhaseStep('Resident:grappleChains', 0); }
  }
  yield 'phaseD_chains';

  // ── Phase D step 3: wall template cache/baked probe ─────────────────────
  // Split into two phases so the expensive buildRoomWallTemplate() step on a
  // cache+baked miss occupies its own frame rather than being bundled with the
  // lookup. On a cache or baked hit only phaseD_walls_lookup is emitted;
  // phaseD_walls_build is skipped and we proceed directly to phaseE_sim.
  let _wallsCacheHit = false;
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    const cacheEntry = roomRuntimeCache.get(room.id);
    if (cacheEntry !== undefined) {
      applyRoomWallTemplate(rw, cacheEntry.wallTemplate);
      _wallsCacheHit = true;
      if (import.meta.env.DEV) {
        const _ms = performance.now() - _t;
        FP.recordLoadPhaseStep('Resident:walls_lookup_hit', _ms);
        _warnLongPhase('phaseD_walls_lookup', _ms, room.id, diagContext);
        console.log(`[residentBuild:gen] ${room.id} walls: cache HIT`);
      } else { FP.recordLoadPhaseStep('Resident:walls_lookup_hit', 0); }
    } else if (room.bakedWallTemplate !== undefined) {
      // Baked template present — apply it and store in cache so subsequent
      // visitors get a cache hit.  Skip phaseD_walls_build entirely.
      applyRoomWallTemplate(rw, room.bakedWallTemplate);
      roomRuntimeCache.set(room.id, {
        wallTemplate:    room.bakedWallTemplate,
        edgeExtension:   null,
        blockerKeys:     null,
        darkBlockerKeys: null,
        wallDecorations: null,
      });
      _wallsCacheHit = true; // treat as hit so phaseD_walls_build is skipped
      if (import.meta.env.DEV) {
        const _ms = performance.now() - _t;
        FP.recordLoadPhaseStep('Resident:walls_lookup_hit', _ms);
        _warnLongPhase('phaseD_walls_lookup', _ms, room.id, diagContext);
        console.log(`[residentBuild:gen] ${room.id} walls: baked HIT wallCount=${room.bakedWallTemplate.wallCount}`);
      } else { FP.recordLoadPhaseStep('Resident:walls_lookup_hit', 0); }
    } else {
      if (import.meta.env.DEV) {
        const _ms = performance.now() - _t;
        FP.recordLoadPhaseStep('Resident:walls_lookup_miss', _ms);
        _warnLongPhase('phaseD_walls_lookup', _ms, room.id, diagContext);
      } else { FP.recordLoadPhaseStep('Resident:walls_lookup_miss', 0); }
    }
  }
  yield 'phaseD_walls_lookup';

  // ── Phase D step 4: wall template build (cache+baked miss only) ─────────
  // Only reached when neither the runtime cache nor bakedWallTemplate had the
  // template.  buildRoomWallTemplateIncremental() spreads the O(n²) merge pass
  // across multiple frames (4 ms budget per yield) so no single frame exceeds
  // the 8 ms LONG_PHASE_WARN_MS threshold.  Each mid-build yield emits the
  // 'phaseD_walls_merge' phase label so callers can observe progress.
  if (!_wallsCacheHit) {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    const mergeGen = buildRoomWallTemplateIncremental(room);
    let mergeStep = mergeGen.next();
    while (!mergeStep.done) {
      // Merge budget elapsed — hand back to the scheduler and resume next frame.
      if (import.meta.env.DEV) FP.recordLoadPhaseStep('Resident:walls_merge_slice', performance.now() - _t);
      yield 'phaseD_walls_merge';
      mergeStep = mergeGen.next();
    }
    const wallTemplate = mergeStep.value;
    applyRoomWallTemplate(rw, wallTemplate);
    // Cache the result so subsequent visitors get a fast hit.
    roomRuntimeCache.set(room.id, {
      wallTemplate,
      edgeExtension:   null,
      blockerKeys:     null,
      darkBlockerKeys: null,
      wallDecorations: null,
    });
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:walls_build', _ms);
      console.log(`[residentBuild:gen] ${room.id} walls: incremental build in ${_ms.toFixed(1)}ms` +
        ` wallCount=${wallTemplate.wallCount}`);
    } else { FP.recordLoadPhaseStep('Resident:walls_build', 0); }
    yield 'phaseD_walls_build';
  }

  // ── Phase E step 1: hazards + ropes + falling blocks + grasshoppers ───────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    loadRoomHazards(rw, room);
    loadRoomRopes(rw, room);
    loadRoomFallingBlocks(rw, room);
    loadRoomGrasshoppers(rw, room);
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:phaseE_sim', _ms);
      _warnLongPhase('phaseE_sim', _ms, room.id, diagContext);
    } else { FP.recordLoadPhaseStep('Resident:phaseE_sim', 0); }
  }
  yield 'phaseE_sim';

  // ── Phase E step 2: dust piles ────────────────────────────────────────────
  {
    const _t = import.meta.env.DEV ? performance.now() : 0;
    spawnAllDustPiles(rw);
    if (import.meta.env.DEV) {
      const _ms = performance.now() - _t;
      FP.recordLoadPhaseStep('Resident:dustPiles', _ms);
      _warnLongPhase('phaseE_dust', _ms, room.id, diagContext);
    } else { FP.recordLoadPhaseStep('Resident:dustPiles', 0); }
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
