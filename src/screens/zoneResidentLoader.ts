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
  isZoneEntryReadinessComplete,
  addZoneEntryViewportTasks,
  runChunkPrewarmSliceNow,
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

// ── ZoneResidentLoader ────────────────────────────────────────────────────────

export class ZoneResidentLoader {
  private readonly _registry:     ReadonlyMap<string, RoomDef>;
  private readonly _runtimeCache: RoomRuntimeCache;

  /** The currently active zone-load session, or null when idle. */
  private _activeZone: ZoneLoadState | null = null;

  /** World numbers of zones that have been fully readied at least once. */
  private readonly _readyZones = new Set<number>();

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
    
    // Pin all zone rooms in the runtime cache so they aren't evicted during loading.
    this._runtimeCache.setPinnedRooms(roomIds);

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
    };

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

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _isZoneReadyNow(
    state:               ZoneLoadState,
    residentRoomManager: ResidentRoomManager,
    vpWPx:               number,
    vpHPx:               number,
    scalePx:             number,
  ): boolean {
    // All builds must be done (no active generator, full queue walk complete).
    if (state.activeGen !== null) {
      console.log(`[zoneLoader diag] activeGen is not null`);
      return false;
    }
    if (state.buildIdx < state.roomIds.length) {
      console.log(`[zoneLoader diag] buildIdx ${state.buildIdx} < ${state.roomIds.length}`);
      return false;
    }

    // Every room must be runtimeReady, sprites decoded, background decoded.
    for (const roomId of state.roomIds) {
      const resident = residentRoomManager.getResident(roomId);
      if (resident === undefined || !resident.runtimeReady) {
        console.log(`[zoneLoader diag] room ${roomId} not runtimeReady`);
        return false;
      }
      const room = this._registry.get(roomId);
      if (room === undefined) continue;
      if (!areRoomSpritesReady(room)) {
        console.log(`[zoneLoader diag] room ${roomId} sprites not ready`);
        return false;
      }
      if (!isRoomBackgroundDecodeReady(room)) {
        console.log(`[zoneLoader diag] room ${roomId} bg not ready`);
        return false;
      }
    }

    // Queue directed-entry tasks exactly once after all builds finish.
    if (!state.tasksQueued) {
      addZoneEntryViewportTasks(state.roomIds, this._registry, this._runtimeCache, vpWPx, vpHPx, scalePx);
      state.tasksQueued = true;
    }

    // Drive prewarm work deterministically while the overlay is visible.
    // Give it a healthy time budget per frame (e.g. 16ms) to chew through chunks quickly.
    runChunkPrewarmSliceNow(16);

    // Finally, strictly validate directed-entry foreground/background coverage.
    if (!isZoneEntryReadinessComplete(state.roomIds, this._registry, this._runtimeCache, vpWPx, vpHPx, scalePx)) {
      console.log(`[zoneLoader diag] isZoneEntryReadinessComplete returned false`);
      return false;
    }

    return true;
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
