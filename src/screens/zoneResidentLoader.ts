/**
 * zoneResidentLoader.ts — Zone-level resident world and asset preparation.
 *
 * Builds and maintains resident WorldStates, decoded sprites, decoded
 * backgrounds, and entry-viewport render chunk prewarms for every room in
 * the active worldNumber zone.  Goals:
 *
 *  1. Intra-zone transitions use residentWorldHot and never show entryWarm.
 *  2. Cross-zone transitions show a loading screen, prepare the new zone
 *     before gameplay resumes, then activate the target room.
 *  3. Old-zone residents are evicted after a safe handoff period.
 *
 * Readiness criteria for a zone to be fully ready (isZoneReady()):
 *  1. Every room's resident WorldState is built  (runtimeReady === true).
 *  2. Every room's theme sprites are decoded      (areRoomSpritesReady()).
 *  3. Every room's background image is decoded    (isRoomBackgroundDecodeReady()).
 *
 * Entry-viewport chunk prewarm is kicked off via addZoneEntryViewportTasks()
 * but does NOT gate zone readiness — it completes asynchronously via the idle
 * scheduler alongside the build loop.
 *
 * Usage (gameScreen.ts):
 *   const zoneLoader = new ZoneResidentLoader(ROOM_REGISTRY, roomRuntimeCache);
 *
 *   // Startup:
 *   zoneLoader.startZoneLoad(startingWorldNumber, residentRoomManager, campaignSeed);
 *   // Each RAF frame while zone is loading:
 *   const done = zoneLoader.tickZoneLoad(residentRoomManager, campaignSeed);
 *   const prog = zoneLoader.getZoneProgress();   // for overlay text
 *
 *   // Cross-zone transition:
 *   zoneLoader.startZoneLoad(targetWorldNumber, residentRoomManager, campaignSeed);
 *   // ... tick loop as above ...
 *
 *   // After zone transition:
 *   zoneLoader.evictInactiveZoneResidents(activeWorldNumber, residentRoomManager);
 *
 * BUILD 430
 */

import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { createResidentBuildGenerator } from './residentWorldBuilder';
import { completeRuntimeEntryPreparation } from './preparedRoomRuntime';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import type { ResidentRoomManager } from './residentRoomManager';
import {
  areRoomSpritesReady,
  isRoomBackgroundDecodeReady,
  decodeRoomThemeSprites,
  decodeRoomBackground,
} from '../render/roomAssetPreloader';
import { getActiveManifest } from '../levels/roomFileCacheState';
import {
  collectZoneEntryReadinessReport,
  addZoneEntryViewportTasks,
  runChunkPrewarmSliceNow,
  getPrewarmStats,
  setPinnedPrewarmRooms,
} from './roomRenderChunkWarmScheduler';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Progress snapshot exposed to the loading overlay. */
export interface ZoneLoadProgress {
  /** World number for the zone being loaded. */
  worldNumber: number;
  /** Total rooms in the zone. */
  totalRooms: number;
  /** Resident worlds built so far (including already-ready). */
  residentsReady: number;
  /** Rooms whose sprites and backgrounds are fully decoded. */
  decodeReady: number;
  /** True when all readiness criteria are satisfied. */
  isReady: boolean;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface ZoneLoadState {
  worldNumber:  number;
  roomIds:      readonly string[];
  /** Index into roomIds for the next room to attempt building. */
  buildIdx:     number;
  /** Active incremental build generator, or null when idle. */
  activeGen:    Generator<string, WorldState, void> | null;
  /** Room ID whose generator is active, or null. */
  activeRoomId: string | null;
  /** performance.now() when activeGen was created. */
  activeGenT0:  number;
  /** Rooms that have had decode() triggered (fire-and-forget). */
  decodeStarted: Set<string>;
  /** Frames to skip before starting builds (let overlay paint first). */
  yieldFrames:  number;
  /** Total fresh builds completed by this zone-load session. */
  builtCount:   number;
  /** Total build failures (skipped with fresh-spawn fallback). */
  failedCount:  number;
  /** performance.now() when building started (after yield frames). */
  t0:           number;
  /** True if we have queued the prewarm tasks for this zone yet. */
  tasksQueued:  boolean;
  /**
   * Index into roomIds for the next room whose `RoomRuntimeCache` entry should
   * be completed (blocker sets + wall decorations).  Advanced one room per
   * frame so the O(room-area) blocker pass never lands entirely in one frame.
   */
  prepIdx:      number;
  /** Rooms whose runtime entry preparation has been completed by this session. */
  prepDone:     Set<string>;
}

// ── Module-level constants ────────────────────────────────────────────────────

/**
 * Frames to yield before the first build so the browser paints the loading
 * overlay before any synchronous build cost is incurred.
 */
const ZONE_LOAD_YIELD_FRAMES = 2;

/**
 * Maximum rooms per zone that the zone loader will attempt to build.
 * Zones larger than this cap are handled with graceful fallback — excess
 * rooms are built incrementally by the background resident scheduler as the
 * player approaches them.  Prevents unbounded memory use in large custom
 * campaigns.
 */
export const ZONE_ROOM_CAP = 64;

/**
 * Measured typed-array cost of one resident `WorldState`, in KB.
 *
 * Deliberately a flat constant rather than a per-room estimate: measurement
 * (scripts/measure-resident-memory.mts) showed an EMPTY world is already
 * ~695 KB of fixed-capacity buffers, and room content moves the total by only
 * a few percent — chasm (area 60000) is 753 KB, the_squeeze (area 4000) is
 * 698 KB.  Sizing the budget off room area would therefore be false precision.
 */
export const RESIDENT_WORLD_COST_KB = 700;

/**
 * Memory ceiling for speculative neighbour-zone residency, in KB.
 *
 * Only bounds the SPECULATIVE set — the active zone is never counted against
 * it and never evicted for it.  32 MB buys roughly 45 rooms of look-ahead,
 * comfortably more than one typical zone, while keeping the worst case well
 * under what the shipping campaign needs for every zone at once (~22 MB).
 */
export const NEIGHBOUR_PRELOAD_BUDGET_KB = 32 * 1024;

/**
 * Frame-time ceiling (ms) above which neighbour preloading yields entirely.
 *
 * Stricter than the resident scheduler's background budget: this work is
 * purely speculative and must never be the reason the ACTIVE zone drops a
 * frame.  A boundary the player has not reached yet is worth zero dropped
 * frames.
 */
export const NEIGHBOUR_PRELOAD_FRAME_BUDGET_MS = 8;

// ── ZoneResidentLoader ────────────────────────────────────────────────────────

export class ZoneResidentLoader {
  private readonly _registry:     ReadonlyMap<string, RoomDef>;
  private readonly _runtimeCache: RoomRuntimeCache;

  /** The currently active zone-load session, or null when idle. */
  private _activeZone: ZoneLoadState | null = null;

  /** World numbers of zones that have been fully readied at least once. */
  private readonly _readyZones = new Set<number>();

  /**
   * Speculative neighbour-zone preload session, or null when idle.
   *
   * Structurally the same work as `_activeZone`, but driven from the GAMEPLAY
   * frame path instead of a blocking overlay, and abandoned the instant the
   * frame budget or memory budget says so.  Kept separate from `_activeZone`
   * precisely so the two can never be confused: `isLoading()` (which gates the
   * overlay and blocks gameplay) must stay false while this runs.
   */
  private _neighbourPreload: ZoneLoadState | null = null;

  /** Zones fully prepared speculatively; retained against eviction. */
  private readonly _preloadedZones = new Set<number>();

  /** Zones that filled the budget or otherwise gave up; not retried this session. */
  private readonly _preloadAbandoned = new Set<number>();

  constructor(registry: ReadonlyMap<string, RoomDef>, runtimeCache: RoomRuntimeCache) {
    this._registry     = registry;
    this._runtimeCache = runtimeCache;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns all room IDs in the given worldNumber, capped at ZONE_ROOM_CAP.
   * Returns an empty array if no rooms match (or the registry is empty).
   */
  getZoneRoomIds(worldNumber: number): string[] {
    const ids: string[] = [];
    for (const [id, room] of this._registry) {
      if ((room.worldNumber ?? 1) === worldNumber) {
        ids.push(id);
        if (ids.length >= ZONE_ROOM_CAP) break;
      }
    }
    return ids;
  }

  /**
   * Starts (or restarts) a zone-load session for `worldNumber`.
   * If the same zone is already loading, this is a no-op unless `force` is true.
   *
   * @param worldNumber        Target zone.
   * @param residentRoomManager  To pre-register resident shells.
   * @param force              If true, restart even if already loading this zone.
   */
  startZoneLoad(
    worldNumber: number,
    residentRoomManager: ResidentRoomManager,
    force = false,
  ): void {
    if (!force && this._activeZone?.worldNumber === worldNumber) return;

    const roomIds = this.getZoneRoomIds(worldNumber);
    if (roomIds.length === 0) {
      // No rooms to load — immediately mark ready.
      this._readyZones.add(worldNumber);
      this._activeZone = null;
      return;
    }

    // Pre-register resident shells for all zone rooms immediately so the
    // eviction policy can protect them from the very first eviction call.
    for (const roomId of roomIds) {
      const room = this._registry.get(roomId);
      if (room !== undefined) residentRoomManager.ensureResident(room);
    }
    
    // Pin all zone rooms so nothing they contribute to zone readiness can be
    // evicted mid-load.  Both caches must be pinned together: the runtime cache
    // backs `isEntryFullyPrepared`, the render-chunk store backs entry-viewport
    // coverage, and readiness requires both for every room in the zone.
    this._runtimeCache.setPinnedRooms(roomIds);
    setPinnedPrewarmRooms(roomIds);

    this._activeZone = {
      worldNumber,
      roomIds,
      buildIdx:      0,
      activeGen:     null,
      activeRoomId:  null,
      activeGenT0:   0,
      decodeStarted: new Set(),
      yieldFrames:   ZONE_LOAD_YIELD_FRAMES,
      builtCount:    0,
      failedCount:   0,
      t0:            0,
      tasksQueued:   false,
      prepIdx:       0,
      prepDone:      new Set(),
    };

    // Fresh session → fresh diagnostic snapshot.
    this._diagSnapshotTaken     = false;
    this._diagLastUnresolvedStr = '';

    if (import.meta.env?.DEV) {
      const manifest = getActiveManifest();
      const manifestRooms = manifest ? Object.keys(manifest.rooms).length : 'N/A';
      console.log(
        '[startup:rooms]',
        `\n  manifestRooms=${manifestRooms}`,
        `\n  registryRooms=${this._registry.size}`,
        `\n  startingZoneRooms=${roomIds.length}`,
      );
      if (manifest && this._registry.size < Object.keys(manifest.rooms).length) {
        console.warn(
          `[zoneLoader] WARNING: Registry size (${this._registry.size}) is smaller than ` +
          `manifest size (${manifestRooms}). Zone readiness may be inaccurate.`
        );
      }
      console.log(`[zoneLoader] startZoneLoad world=${worldNumber}, ${roomIds.length} rooms`);
    }
  }

  /**
   * Advances the active zone-load session by one step (one generator phase).
   * Also triggers decode for not-yet-decoded rooms (fire-and-forget).
   *
   * Call once per RAF frame while a zone is loading.
   *
   * @param residentRoomManager  Updated with newly built resident worlds.
   * @param campaignSeed         Same seed used in startZoneLoad.
   * @returns True when the active zone satisfies all readiness criteria.
   */
  tickZoneLoad(
    residentRoomManager: ResidentRoomManager,
    campaignSeed: number,
    vpWPx: number,
    vpHPx: number,
    scalePx: number,
  ): boolean {
    const state = this._activeZone;
    if (state === null) return true;

    // Yield frames: let browser paint overlay before build starts.
    if (state.yieldFrames > 0) {
      state.yieldFrames--;
      return false;
    }
    if (state.t0 === 0) state.t0 = performance.now();

    // ── Fire-and-forget decode for all zone rooms ─────────────────────────
    // Trigger sprite and background decodes for every room in the zone up-front
    // so GPU uploads overlap with resident world builds.  Each call is idempotent.
    for (const roomId of state.roomIds) {
      if (!state.decodeStarted.has(roomId)) {
        const room = this._registry.get(roomId);
        if (room !== undefined) {
          void decodeRoomThemeSprites(room);
          decodeRoomBackground(room);
          state.decodeStarted.add(roomId);
        }
      }
    }

    // ── Advance active build generator one phase ──────────────────────────
    if (state.activeGen !== null) {
      const roomId = state.activeRoomId!;
      try {
        const result = state.activeGen.next();
        if (result.done) {
          // Generator finished — commit the built WorldState.
          const room = this._registry.get(roomId);
          if (room !== undefined) {
            residentRoomManager.ensureResident(room);
            residentRoomManager.setResidentWorld(roomId, result.value, false);
            residentRoomManager.setLastBuildInfo(roomId, performance.now() - state.activeGenT0);
          }
          state.builtCount++;
          state.activeGen     = null;
          state.activeRoomId  = null;
          if (import.meta.env?.DEV) {
            console.log(
              `[zoneLoader] built ${state.builtCount}/${state.roomIds.length} — ${roomId}` +
              ` (${(performance.now() - state.activeGenT0).toFixed(0)}ms)`,
            );
          }
        }
      } catch (err) {
        state.failedCount++;
        state.activeGen    = null;
        state.activeRoomId = null;
        if (import.meta.env?.DEV) {
          console.warn(`[zoneLoader] build failed: ${roomId}`, err);
        }
      }
    }

    // ── Dequeue the next room when the generator slot is free ────────────
    if (state.activeGen === null) {
      while (state.buildIdx < state.roomIds.length) {
        const roomId = state.roomIds[state.buildIdx++];
        const resident = residentRoomManager.getResident(roomId);
        if (resident?.runtimeReady) {
          // Already ready — skip without consuming a frame.
          continue;
        }
        const room = this._registry.get(roomId);
        if (room === undefined) continue;
        residentRoomManager.ensureResident(room);
        const capturedRoom = room;
        state.activeGen = createResidentBuildGenerator(
          room,
          campaignSeed,
          this._runtimeCache,
          {
            reason:      'zoneLoad',
            priority:    0,
            onLongPhase: (phase, ms) => {
              residentRoomManager.recordLongPhase(phase, ms, capturedRoom.id);
            },
          },
        );
        state.activeRoomId  = roomId;
        state.activeGenT0   = performance.now();
        break;
      }
    }

    // ── Complete static runtime preparation for one room per frame ────────
    // The resident build above caches only a wall template; the zone-entry
    // readiness barrier additionally requires blocker sets and decorations
    // (isEntryFullyPrepared).  No other scheduler runs while the zone overlay
    // is up, so this loop must produce that data itself or the barrier can
    // never be satisfied.  One room per frame keeps the cost bounded.
    this._advanceRuntimePreparation(state);

    // ── Check zone readiness ──────────────────────────────────────────────
    if (this._isZoneReadyNow(state, residentRoomManager, vpWPx, vpHPx, scalePx)) {
      const elapsed = performance.now() - state.t0;
      this._readyZones.add(state.worldNumber);
      if (import.meta.env?.DEV) {
        this._logZoneReadySummary(state, elapsed);
      }
      this._activeZone = null;
      return true;
    }

    return false;
  }

  /**
   * Returns true when every room in the given zone satisfies all readiness
   * criteria.  Returns false if the zone has never been started.
   */
  isZoneReady(worldNumber: number, residentRoomManager: ResidentRoomManager): boolean {
    if (this._readyZones.has(worldNumber)) {
      // Previously confirmed ready — do a cheap re-verify in case of invalidation.
      const roomIds = this.getZoneRoomIds(worldNumber);
      for (const roomId of roomIds) {
        const room = this._registry.get(roomId);
        if (room === undefined) continue;
        const resident = residentRoomManager.getResident(roomId);
        if (resident === undefined || !resident.runtimeReady) {
          this._readyZones.delete(worldNumber);
          return false;
        }
        if (!areRoomSpritesReady(room) || !isRoomBackgroundDecodeReady(room)) {
          this._readyZones.delete(worldNumber);
          return false;
        }
      }
      // Note: Full directed-entry readiness is not re-verified here because it requires viewport sizes,
      // and this cheap check is mainly for quick validations.
      return true;
    }
    return false;
  }

  /**
   * Returns the progress of the currently active zone-load session, or null
   * if no zone is currently loading.
   */
  getZoneProgress(residentRoomManager: ResidentRoomManager): ZoneLoadProgress | null {
    const state = this._activeZone;
    if (state === null) return null;

    let residentsReady = 0;
    let decodeReady    = 0;
    for (const roomId of state.roomIds) {
      const resident = residentRoomManager.getResident(roomId);
      if (resident?.runtimeReady) residentsReady++;
      const room = this._registry.get(roomId);
      if (room !== undefined && areRoomSpritesReady(room) && isRoomBackgroundDecodeReady(room)) {
        decodeReady++;
      }
    }

    return {
      worldNumber:   state.worldNumber,
      totalRooms:    state.roomIds.length,
      residentsReady,
      decodeReady,
      isReady:       false, // still active session → not ready yet
    };
  }

  /**
   * The world number currently being loaded, or null if no load is in progress.
   */
  getActiveWorldNumber(): number | null {
    return this._activeZone?.worldNumber ?? null;
  }

  /**
   * Returns true if a zone-load session is currently in progress.
   */
  isLoading(): boolean {
    return this._activeZone !== null;
  }

  /**
   * Invalidates a zone, clearing its ready state and cancelling any active
   * build session for it.  Should be called when an editor edit affects rooms
   * in that zone so stale residents are never considered zone-ready.
   *
   * @param worldNumber  The zone to invalidate.
   */
  invalidateZone(worldNumber: number): void {
    this._readyZones.delete(worldNumber);
    if (this._activeZone?.worldNumber === worldNumber) {
      // Cancel active session — let the caller restart it if desired.
      this._activeZone = null;
    }
    if (import.meta.env?.DEV) {
      console.log(`[zoneLoader] invalidateZone world=${worldNumber}`);
    }
  }

  /**
   * Returns the set of room IDs belonging to the active zone, for use by
   * the eviction policy in ResidentRoomManager.
   * Returns an empty set if no zone load is active.
   */
  getActiveZoneRoomIdSet(): ReadonlySet<string> {
    if (this._activeZone === null) return _EMPTY_SET;
    const result = new Set<string>(this._activeZone.roomIds);
    return result;
  }

  /**
   * Returns the room IDs for the given worldNumber as a Set, useful for
   * protecting them from eviction even after the zone load completes.
   */
  buildZoneRoomIdSet(worldNumber: number): Set<string> {
    const result = new Set<string>();
    for (const [id, room] of this._registry) {
      if ((room.worldNumber ?? 1) === worldNumber) {
        result.add(id);
        if (result.size >= ZONE_ROOM_CAP) break;
      }
    }
    return result;
  }

  /**
   * Evicts resident worlds that belong to zones other than `activeWorldNumber`.
   * Safe to call after a successful zone transition.  Keeps the immediately
   * previous zone for a short backtrack window (at most `backtrackBudget` rooms).
   *
   * @param activeWorldNumber   The zone to keep entirely.
   * @param prevWorldNumber     Previous zone to partially keep (backtrack).
   * @param residentRoomManager Manager whose eviction to invoke.
   * @param backtrackBudget     Max inactive-zone rooms to keep (default 4).
   */
  evictInactiveZoneResidents(
    activeWorldNumber: number,
    prevWorldNumber:   number | null,
    residentRoomManager: ResidentRoomManager,
  ): void {
    const activeRoomIds = this.buildZoneRoomIdSet(activeWorldNumber);
    residentRoomManager.evictDistantZoneAware(activeRoomIds);
    if (import.meta.env?.DEV) {
      console.log(
        `[zoneLoader] evictInactiveZoneResidents: kept world=${activeWorldNumber} (${activeRoomIds.size} rooms)` +
        (prevWorldNumber !== null ? `, prev world=${prevWorldNumber}` : ''),
      );
    }
  }

  // ── Neighbour-zone preloading ───────────────────────────────────────────────

  /**
   * World numbers reachable by one transition out of `activeWorldNumber`.
   *
   * Derived from real transition links rather than numeric adjacency, so a
   * campaign whose zones are not numbered contiguously still preloads the zone
   * the player can actually walk into.
   */
  getNeighbourZoneNumbers(activeWorldNumber: number): number[] {
    const out = new Set<number>();
    for (const [, room] of this._registry) {
      if ((room.worldNumber ?? 1) !== activeWorldNumber) continue;
      for (const t of room.transitions) {
        const target = this._registry.get(t.targetRoomId);
        if (target === undefined) continue;
        const z = target.worldNumber ?? 1;
        if (z !== activeWorldNumber) out.add(z);
      }
    }
    return [...out];
  }

  /**
   * Picks the neighbour zone worth preparing next, or null when there is
   * nothing useful to do.
   *
   * Priority, highest first:
   *   1. a zone the CURRENT room opens directly into (the player is standing at
   *      the boundary — this is the one about to be needed);
   *   2. a zone reachable within `lookaheadRadius` rooms of the current room;
   *   3. any other neighbour of the active zone.
   *
   * Already-ready, already-preloaded, in-flight and abandoned zones are skipped,
   * so this is safe to call every frame.
   */
  chooseNeighbourZoneToPreload(
    activeWorldNumber: number,
    currentRoomId: string,
    lookaheadRadius = 3,
  ): number | null {
    const candidates = this.getNeighbourZoneNumbers(activeWorldNumber)
      .filter(z =>
        !this._readyZones.has(z) &&
        !this._preloadedZones.has(z) &&
        !this._preloadAbandoned.has(z) &&
        this._neighbourPreload?.worldNumber !== z);
    if (candidates.length === 0) return null;

    // Rank by hop distance from the current room to a door into that zone.
    const distance = new Map<number, number>();
    const visited = new Set<string>([currentRoomId]);
    let frontier = [currentRoomId];
    for (let hop = 0; hop <= lookaheadRadius && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        const room = this._registry.get(id);
        if (room === undefined) continue;
        for (const t of room.transitions) {
          const target = this._registry.get(t.targetRoomId);
          if (target === undefined) continue;
          const z = target.worldNumber ?? 1;
          if (z !== activeWorldNumber && candidates.includes(z) && !distance.has(z)) {
            distance.set(z, hop);
          }
          if (visited.has(t.targetRoomId)) continue;
          visited.add(t.targetRoomId);
          if ((target.worldNumber ?? 1) === activeWorldNumber) next.push(t.targetRoomId);
        }
      }
      frontier = next;
    }

    let best: number | null = null;
    let bestDist = Infinity;
    for (const z of candidates) {
      const dist = distance.get(z) ?? Infinity;
      if (dist < bestDist) { bestDist = dist; best = z; }
    }
    // Nothing within the look-ahead radius: leave it for when the player is
    // closer rather than spending frames on a zone they may never approach.
    return bestDist === Infinity ? null : best;
  }

  /** KB currently attributed to speculative (non-active-zone) residency. */
  getSpeculativeMemoryKB(activeWorldNumber: number, manager: ResidentRoomManager): number {
    let rooms = 0;
    for (const z of [...this._preloadedZones, ...(this._neighbourPreload !== null ? [this._neighbourPreload.worldNumber] : [])]) {
      if (z === activeWorldNumber) continue;
      for (const id of this.getZoneRoomIds(z)) {
        if (manager.getResident(id)?.runtimeReady === true) rooms++;
      }
    }
    return rooms * RESIDENT_WORLD_COST_KB;
  }

  /**
   * Advances speculative neighbour-zone preparation by at most one generator
   * phase.  Call once per GAMEPLAY frame (never while a blocking load is up).
   *
   * Yields immediately — doing nothing at all — when the previous frame was
   * over budget, when the memory ceiling is reached, or when the active zone is
   * not itself ready.  Those three guards are what keep this from ever being
   * the cause of a dropped frame or an eviction in the zone being played.
   *
   * @returns True when a zone finished preparing on this call.
   */
  tickNeighbourPreload(
    activeWorldNumber: number,
    currentRoomId: string,
    manager: ResidentRoomManager,
    campaignSeed: number,
    lastFrameMs: number,
  ): boolean {
    // Never compete with a blocking load, and never run before the zone the
    // player is actually in is finished.
    if (this._activeZone !== null) return false;
    if (!this._readyZones.has(activeWorldNumber)) return false;
    if (lastFrameMs >= NEIGHBOUR_PRELOAD_FRAME_BUDGET_MS) return false;

    if (this._neighbourPreload === null) {
      if (this.getSpeculativeMemoryKB(activeWorldNumber, manager) >= NEIGHBOUR_PRELOAD_BUDGET_KB) return false;
      const target = this.chooseNeighbourZoneToPreload(activeWorldNumber, currentRoomId);
      if (target === null) return false;
      const roomIds = this.getZoneRoomIds(target);
      if (roomIds.length === 0) { this._preloadAbandoned.add(target); return false; }
      this._neighbourPreload = {
        worldNumber: target, roomIds,
        buildIdx: 0, activeGen: null, activeRoomId: null, activeGenT0: 0,
        decodeStarted: new Set(), yieldFrames: 0, builtCount: 0, failedCount: 0,
        t0: performance.now(), tasksQueued: false, prepIdx: 0, prepDone: new Set(),
      };
      if (import.meta.env?.DEV) {
        console.log(`[zoneLoader] neighbour preload START world=${target} (${roomIds.length} rooms)`);
      }
      return false;
    }

    const state = this._neighbourPreload;

    // Memory ceiling can be crossed mid-session as rooms complete.
    if (this.getSpeculativeMemoryKB(activeWorldNumber, manager) >= NEIGHBOUR_PRELOAD_BUDGET_KB) {
      if (import.meta.env?.DEV) {
        console.log(`[zoneLoader] neighbour preload world=${state.worldNumber} stopped at memory budget`);
      }
      this._preloadAbandoned.add(state.worldNumber);
      this._neighbourPreload = null;
      return false;
    }

    // Decode assets for one not-yet-started room per tick (fire and forget).
    for (const roomId of state.roomIds) {
      if (state.decodeStarted.has(roomId)) continue;
      const room = this._registry.get(roomId);
      if (room !== undefined) {
        void decodeRoomThemeSprites(room);
        decodeRoomBackground(room);
        state.decodeStarted.add(roomId);
      }
      break; // one per tick — decode is cheap to start but not free
    }

    // Advance the in-flight build by exactly one phase.
    if (state.activeGen !== null) {
      const roomId = state.activeRoomId!;
      try {
        const result = state.activeGen.next();
        if (result.done) {
          const room = this._registry.get(roomId);
          if (room !== undefined) {
            manager.ensureResident(room);
            manager.setResidentWorld(roomId, result.value, false);
          }
          state.builtCount++;
          state.activeGen = null;
          state.activeRoomId = null;
        }
      } catch {
        state.failedCount++;
        state.activeGen = null;
        state.activeRoomId = null;
      }
      return false;
    }

    // Start the next room that still needs building.
    while (state.buildIdx < state.roomIds.length) {
      const roomId = state.roomIds[state.buildIdx++];
      if (manager.getResident(roomId)?.runtimeReady === true) continue;
      const room = this._registry.get(roomId);
      if (room === undefined) continue;
      manager.ensureResident(room);
      state.activeGen = createResidentBuildGenerator(room, campaignSeed, this._runtimeCache, {
        reason: 'zoneLoad', priority: 4,
      });
      state.activeRoomId = roomId;
      state.activeGenT0 = performance.now();
      return false;
    }

    // Every room built — complete the static runtime preparation sweep.
    this._advanceRuntimePreparation(state);
    if (state.prepDone.size < state.roomIds.length) return false;

    this._preloadedZones.add(state.worldNumber);
    this._readyZones.add(state.worldNumber);
    if (import.meta.env?.DEV) {
      console.log(
        `[zoneLoader] neighbour preload DONE world=${state.worldNumber} — ` +
        `${state.builtCount} built, ${state.failedCount} failed, ` +
        `${(performance.now() - state.t0).toFixed(0)}ms`,
      );
    }
    this._neighbourPreload = null;
    return true;
  }

  /**
   * Room IDs that must survive eviction: the active zone plus any zone brought
   * to readiness speculatively.  Discarding a preloaded zone would throw away
   * exactly the work that makes its boundary seamless.
   */
  buildRetainedRoomIdSet(activeWorldNumber: number): Set<string> {
    const out = this.buildZoneRoomIdSet(activeWorldNumber);
    for (const z of this._preloadedZones) {
      if (z === activeWorldNumber) continue;
      for (const id of this.getZoneRoomIds(z)) out.add(id);
    }
    return out;
  }

  /** Diagnostics for the debug overlay and tests. */
  getNeighbourPreloadStatus(activeWorldNumber: number, manager: ResidentRoomManager): {
    inFlightZone: number | null;
    inFlightBuilt: number;
    inFlightTotal: number;
    preloadedZones: number[];
    abandonedZones: number[];
    speculativeMemoryKB: number;
    budgetKB: number;
  } {
    return {
      inFlightZone:  this._neighbourPreload?.worldNumber ?? null,
      inFlightBuilt: this._neighbourPreload?.builtCount ?? 0,
      inFlightTotal: this._neighbourPreload?.roomIds.length ?? 0,
      preloadedZones: [...this._preloadedZones],
      abandonedZones: [...this._preloadAbandoned],
      speculativeMemoryKB: this.getSpeculativeMemoryKB(activeWorldNumber, manager),
      budgetKB: NEIGHBOUR_PRELOAD_BUDGET_KB,
    };
  }

  /** Drops speculative preload state (zone change, editor edit, shutdown). */
  resetNeighbourPreload(): void {
    this._neighbourPreload = null;
    this._preloadAbandoned.clear();
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Completes the static runtime-cache preparation for at most one zone room
   * per call, cycling until every room in the zone is fully prepared.
   *
   * A room is only considered once its resident build has cached a runtime
   * entry; rooms not yet in the cache are retried on a later pass (the index
   * wraps), so ordering between builds and preparation does not matter.
   */
  private _advanceRuntimePreparation(state: ZoneLoadState): void {
    const total = state.roomIds.length;
    if (state.prepDone.size >= total) return;

    // Scan forward from prepIdx for the next room that still needs work,
    // wrapping at most once so this is O(total) worst case and O(1) typical.
    for (let scanned = 0; scanned < total; scanned++) {
      const idx    = (state.prepIdx + scanned) % total;
      const roomId = state.roomIds[idx];
      if (state.prepDone.has(roomId)) continue;

      const entry = this._runtimeCache.get(roomId);
      if (entry === undefined) continue; // Not built yet — retry on a later tick.

      const room = this._registry.get(roomId);
      if (room === undefined) {
        // Not buildable; mark done so the sweep can terminate. The readiness
        // check reports it separately as a registry failure.
        state.prepDone.add(roomId);
        continue;
      }

      completeRuntimeEntryPreparation(room, entry);
      state.prepDone.add(roomId);
      state.prepIdx = (idx + 1) % total;
      return; // One room per frame.
    }
  }

  /** True once the base-readiness snapshot has been emitted for this session. */
  private _diagSnapshotTaken = false;
  /** Serialised last-emitted unresolved snapshot, for change detection. */
  private _diagLastUnresolvedStr = '';

  /**
   * Authoritative zone-readiness predicate.
   *
   * Evaluated in two stages, and the ordering is load-bearing:
   *
   *  1. **Base readiness** — all resident builds complete, and every zone room
   *     has a resident world, decoded sprites, and a decoded background.
   *  2. **Directed-entry readiness** — every same-zone transition's entry
   *     viewport is covered by pre-warmed render chunks.
   *
   * Stage 2's task producer (`addZoneEntryViewportTasks`) reads each room's
   * `RoomRuntimeCache` entry, which only exists once that room has been built.
   * Running it before stage 1 holds therefore queues nothing.  Stage 1 must
   * short-circuit, not merely record a failure and fall through.
   */
  private _isZoneReadyNow(
    state:               ZoneLoadState,
    residentRoomManager: ResidentRoomManager,
    vpWPx:               number,
    vpHPx:               number,
    scalePx:             number,
  ): boolean {
    // ── Stage 1: base readiness ───────────────────────────────────────────
    let baseReady = true;
    const incompleteRooms: Record<string, string[]> = {};

    if (state.activeGen !== null)                  baseReady = false;
    if (state.buildIdx < state.roomIds.length)     baseReady = false;

    for (const roomId of state.roomIds) {
      const resident = residentRoomManager.getResident(roomId);
      const room     = this._registry.get(roomId);

      const fails: string[] = [];
      if (resident === undefined || !resident.runtimeReady) fails.push('residentBuildIncomplete');
      if (room === undefined) fails.push('roomNotInRegistry');
      else {
        if (!areRoomSpritesReady(room))          fails.push('spritesNotDecoded');
        if (!isRoomBackgroundDecodeReady(room))  fails.push('backgroundNotDecoded');
      }
      if (fails.length > 0) {
        incompleteRooms[roomId] = fails;
        baseReady = false;
      }
    }

    if (!baseReady) return false;

    // ── Stage 2: directed-entry readiness ─────────────────────────────────
    // Idempotent: re-ensures a task exists for every uncovered requirement on
    // every frame, so a requirement can never be left waiting on a task that
    // was never created, was dropped, or terminated without achieving
    // coverage.  (The previous one-shot `tasksQueued` latch is what allowed a
    // permanent stall — see addZoneEntryViewportTasks' doc comment.)
    const queueResult = addZoneEntryViewportTasks(
      state.roomIds, this._registry, this._runtimeCache, vpWPx, vpHPx, scalePx,
    );
    state.tasksQueued = true;

    // Drive prewarm work deterministically while the overlay is visible; the
    // idle scheduler alone makes no reliable progress on a continuously
    // rendering canvas.
    runChunkPrewarmSliceNow(16);

    const entryReport = collectZoneEntryReadinessReport(
      state.roomIds, this._registry, this._runtimeCache, vpWPx, vpHPx, scalePx,
    );
    const allReady = entryReport.failures.length === 0;

    this._emitZoneLoadDiagnostic(state, incompleteRooms, queueResult, entryReport, allReady);

    return allReady;
  }

  /**
   * Emits one structured snapshot when base readiness is first satisfied (the
   * moment the overlay reads "N/N"), then only when the unresolved state
   * changes.  Never per-frame.
   */
  private _emitZoneLoadDiagnostic(
    state:            ZoneLoadState,
    incompleteRooms:  Record<string, string[]>,
    queueResult:      ReturnType<typeof addZoneEntryViewportTasks>,
    entryReport:      ReturnType<typeof collectZoneEntryReadinessReport>,
    allReady:         boolean,
  ): void {
    const prewarm = getPrewarmStats();
    // Group failures by reason so a 24-room zone yields a readable summary.
    const failuresByReason: Record<string, string[]> = {};
    for (const f of entryReport.failures) {
      (failuresByReason[f.reason] ??= []).push(
        f.targetRoomId !== null ? `${f.sourceRoomId}->${f.targetRoomId}` : f.sourceRoomId,
      );
    }

    const diag = {
      worldNumber:   state.worldNumber,
      phase:         allReady ? 'zoneReady' : 'awaitingDirectedEntryCoverage',
      isZoneReadyNow: allReady,
      progress: {
        totalRooms:            state.roomIds.length,
        residentBuildsDone:    state.buildIdx,
        residentBuildsBuilt:   state.builtCount,
        residentBuildsFailed:  state.failedCount,
        activeGeneratorRoomId: state.activeRoomId,
        incompleteRooms,
      },
      runtimeCache: {
        size:                 this._runtimeCache.size,
        expectedKeys:         state.roomIds.length,
        missingExpectedKeys:  state.roomIds.filter(id => !this._runtimeCache.has(id)),
        fullyPreparedCount:   state.prepDone.size,
        notYetPreparedKeys:   state.roomIds.filter(id => !state.prepDone.has(id)),
      },
      directedEntryRequirements: {
        required:       entryReport.required,
        satisfied:      entryReport.satisfied,
        unsatisfied:    entryReport.failures.length,
        failuresByReason,
      },
      taskProduction: queueResult,
      chunkWarmScheduler: {
        queueLength:            prewarm.queueLength,
        suspendedRadius3Count:  prewarm.suspendedRadius3Count,
        activeRadius3Count:     prewarm.activeRadius3Count,
        chunksLastSlice:        prewarm.chunksLastSlice,
        chunksSkippedLastSlice: prewarm.chunksSkippedLastSlice,
        msLastSlice:            prewarm.msLastSlice,
        deferredNotReady:       prewarm.deferredNotReady,
        deferredSpritesNotReady: prewarm.deferredSpritesNotReady,
        pausedForFrameTime:     prewarm.pausedForFrameTime,
        totalWallChunks:        prewarm.totalWallChunks,
        totalBgChunks:          prewarm.totalBgChunks,
        totalPrewarmMemoryKB:   prewarm.totalPrewarmMemoryKB,
        memoryBudgetKB:         prewarm.memoryBudgetKB,
        // Non-zero during a zone load means readiness-critical coverage is
        // being destroyed as fast as it is built.
        totalEvictions:         prewarm.totalEvictions,
      },
      // Invariant: no unsatisfied requirement may lack an executable task.
      // A non-empty list here is the signature of a load that cannot progress.
      requirementsWithoutExecutableTask:
        prewarm.queueLength === 0 && !allReady ? entryReport.failures.map(f => f.entryKey) : [],
      elapsedMs: Math.round(performance.now() - state.t0),
    };

    // Change-detection key deliberately excludes continuously-churning fields
    // (elapsed time, per-slice counters) so "state changed" means the *load
    // state* changed, not merely that another frame elapsed.
    const diagStr = JSON.stringify({
      phase:        diag.phase,
      incomplete:   diag.progress.incompleteRooms,
      buildsDone:   diag.progress.residentBuildsDone,
      prepared:     diag.runtimeCache.fullyPreparedCount,
      missingKeys:  diag.runtimeCache.missingExpectedKeys,
      satisfied:    diag.directedEntryRequirements.satisfied,
      failures:     diag.directedEntryRequirements.failuresByReason,
      blocked:      diag.taskProduction.blocked,
      noTaskFor:    diag.requirementsWithoutExecutableTask,
    });
    if (!this._diagSnapshotTaken) {
      this._diagSnapshotTaken     = true;
      this._diagLastUnresolvedStr = diagStr;
      console.log('[zoneLoader] === ZONE LOAD SNAPSHOT (base readiness reached) ===');
      console.log(JSON.stringify(diag, null, 2));
    } else if (!allReady && diagStr !== this._diagLastUnresolvedStr) {
      this._diagLastUnresolvedStr = diagStr;
      console.log('[zoneLoader] === ZONE LOAD SNAPSHOT (state changed) ===');
      console.log(JSON.stringify(diag, null, 2));
    }
  }

  private _logZoneReadySummary(
    state:     ZoneLoadState,
    elapsedMs: number,
  ): void {
    let decodeReady = 0;
    for (const roomId of state.roomIds) {
      const room = this._registry.get(roomId);
      if (room !== undefined && areRoomSpritesReady(room) && isRoomBackgroundDecodeReady(room)) {
        decodeReady++;
      }
    }
    console.log(
      `[zoneLoader] zone ${state.worldNumber} ready — ` +
      `${state.roomIds.length} rooms, ` +
      `built ${state.builtCount}, ` +
      `failed ${state.failedCount}, ` +
      `decode ${decodeReady}/${state.roomIds.length}, ` +
      `${elapsedMs.toFixed(0)}ms`,
    );
  }
}

// ── Module-level singleton helpers ───────────────────────────────────────────

const _EMPTY_SET: ReadonlySet<string> = new Set<string>();
