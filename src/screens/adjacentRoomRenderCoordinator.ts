/**
 * adjacentRoomRenderCoordinator.ts — Owns the live `ConnectedRoomRenderState`
 * for the render-only radius-1 "Render Adjacent Rooms" view.
 *
 * This is the integration brain that sits between the pure layout module
 * (`render/adjacent/connectedRoomLayout.ts`) and the frame renderer. It:
 *   - recomputes the connected layout only when something render-affecting
 *     changes (active room, effective setting, or an explicit invalidation),
 *     never every frame;
 *   - resolves each neighbour's terrain source in preference order — a valid
 *     frozen resident world (matching `builtForRoomId`), then a prepared wall
 *     template, then an async fallback — and marks views not-ready until safe
 *     render data exists;
 *   - requests missing / not-yet-ready neighbours through the async room-loading
 *     path (never loads synchronously);
 *   - does ZERO work (no neighbour lookups) when the effective setting is off.
 *
 * All environment access is injected through ports so the coordinator is pure
 * and Node-testable. gameScreen constructs the ports once against
 * `ROOM_REGISTRY`, the resident room manager, and the preload scheduler.
 */

import type { RoomDef } from '../levels/roomDef';
import {
  computeConnectedRoomLayout,
  type ConnectedLayoutRoom,
  type ConnectedRoomInstance,
} from '../render/adjacent/connectedRoomLayout';
import {
  isResidentWorldUsableForRoom,
  type AdjacentRoomView,
  type AdjacentTerrainSource,
  type ConnectedRoomRenderState,
  EMPTY_CONNECTED_RENDER_STATE,
} from '../render/adjacent/adjacentRoomView';

/** Minimal resident-world view the coordinator needs for terrain sourcing. */
export interface ResidentWorldInfo {
  /** The room id this world's geometry was actually built for. */
  readonly builtForRoomId: string;
  /** True when the world is fully built and safe to read structural state from. */
  readonly runtimeReady: boolean;
}

/** Injected environment access. All calls are cheap and side-effect-free except
 *  `requestNeighborLoad`, which schedules an async load and never blocks. */
export interface AdjacentRoomCoordinatorPorts {
  /** The effective (parent && child) setting. */
  readonly isEffectiveEnabled: () => boolean;
  /** Resolve a room definition by id (e.g. ROOM_REGISTRY.get). Null if unknown/unloaded. */
  readonly resolveRoomDef: (roomId: string) => RoomDef | null;
  /** The frozen resident world for a room, if any (for `builtForRoomId` validation). */
  readonly getResidentWorld: (roomId: string) => ResidentWorldInfo | null;
  /** Schedule an async load/preload for a neighbour not yet render-ready. */
  readonly requestNeighborLoad: (roomId: string) => void;
  /** Whether a secret transition has been revealed/used this session. */
  readonly isTransitionRevealed?: (sourceRoomId: string, transitionIndex: number) => boolean;
}

/** Low-overhead DEV diagnostics for the debug overlay. */
export interface AdjacentRoomDiagnostics {
  activeRoomId: string;
  enabled: boolean;
  visibleInstances: number;
  readyViews: number;
  pendingViews: number;
  skippedCount: number;
  residentSourced: number;
  templateSourced: number;
  asyncFallback: number;
  invalidResidentPairings: number;
  rebuildCount: number;
}

function toLayoutRoom(room: RoomDef): ConnectedLayoutRoom {
  return {
    id: room.id,
    widthBlocks: room.widthBlocks,
    heightBlocks: room.heightBlocks,
    transitions: room.transitions,
  };
}

export class AdjacentRoomRenderCoordinator {
  private readonly ports: AdjacentRoomCoordinatorPorts;

  /** Cached render state; rebuilt only when the cache key changes. */
  private cached: ConnectedRoomRenderState = EMPTY_CONNECTED_RENDER_STATE;
  /** The (activeRoomId | version | enabled) signature the cache was built for. */
  private cacheSignature = '';
  /** Bumped by invalidate() so edits/version changes force a rebuild. */
  private version = 0;
  private lastActiveRoomId = '';

  private diagnostics: AdjacentRoomDiagnostics = {
    activeRoomId: '', enabled: false, visibleInstances: 0, readyViews: 0,
    pendingViews: 0, skippedCount: 0, residentSourced: 0, templateSourced: 0,
    asyncFallback: 0, invalidResidentPairings: 0, rebuildCount: 0,
  };

  constructor(ports: AdjacentRoomCoordinatorPorts) {
    this.ports = ports;
  }

  /** Force a rebuild on the next `getRenderState` (edit / version / registry change). */
  invalidate(): void {
    this.version++;
  }

  /**
   * Return the current connected-room render state for the given active room,
   * rebuilding only when the active room, effective setting, or version changed.
   * When the effective setting is off, returns the shared empty state and does
   * no neighbour work.
   */
  getRenderState(activeRoom: RoomDef): ConnectedRoomRenderState {
    const enabled = this.ports.isEffectiveEnabled();
    if (!enabled) {
      if (this.cached !== EMPTY_CONNECTED_RENDER_STATE) {
        this.cached = EMPTY_CONNECTED_RENDER_STATE;
        this.cacheSignature = '';
        this.resetDiagnostics(activeRoom.id, false);
      }
      this.lastActiveRoomId = activeRoom.id;
      return EMPTY_CONNECTED_RENDER_STATE;
    }

    const signature = `${activeRoom.id}|v${this.version}|1`;
    if (signature === this.cacheSignature && activeRoom.id === this.lastActiveRoomId) {
      return this.cached;
    }
    this.cacheSignature = signature;
    this.lastActiveRoomId = activeRoom.id;
    this.cached = this.rebuild(activeRoom);
    return this.cached;
  }

  /** True when the active room changed since the last observed room. */
  hasActiveRoomChanged(activeRoomId: string): boolean {
    return activeRoomId !== this.lastActiveRoomId;
  }

  getDiagnostics(): Readonly<AdjacentRoomDiagnostics> {
    return this.diagnostics;
  }

  private rebuild(activeRoom: RoomDef): ConnectedRoomRenderState {
    const layout = computeConnectedRoomLayout({
      activeRoom: toLayoutRoom(activeRoom),
      resolveRoom: (id) => {
        const def = this.ports.resolveRoomDef(id);
        return def === null ? null : toLayoutRoom(def);
      },
      isTransitionRevealed: this.ports.isTransitionRevealed,
      enabled: true,
    });

    const views: AdjacentRoomView[] = [];
    const connectedTargetRoomIds = new Set<string>();
    let residentSourced = 0;
    let templateSourced = 0;
    let asyncFallback = 0;
    let readyViews = 0;
    let invalidResidentPairings = 0;

    for (const instance of layout.instances) {
      const roomId = instance.targetRoomId;
      const def = this.ports.resolveRoomDef(roomId);
      const { source, ready, invalidResident } = this.resolveTerrainSource(roomId, def);
      if (invalidResident) invalidResidentPairings++;

      if (source === 'resident-world') residentSourced++;
      else if (source === 'wall-template') templateSourced++;
      else asyncFallback++;

      if (ready) {
        readyViews++;
        connectedTargetRoomIds.add(roomId);
      } else {
        // Not render-ready yet — ask the async path to prepare it; keep the
        // existing void/transition presentation until it is ready.
        this.ports.requestNeighborLoad(roomId);
      }

      views.push({ instance, terrainSource: source, ready });
    }

    // Missing targets are surfaced by the layout as skips — request their load.
    for (const skip of layout.skipped) {
      if (skip.reason === 'missing-target') {
        this.ports.requestNeighborLoad(skip.targetRoomId);
      }
    }

    if (typeof console !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      for (const w of layout.warnings) console.warn(`[adjacentRooms] ${w}`);
    }

    this.diagnostics = {
      activeRoomId: activeRoom.id,
      enabled: true,
      visibleInstances: views.length,
      readyViews,
      pendingViews: views.length - readyViews,
      skippedCount: layout.skipped.length,
      residentSourced,
      templateSourced,
      asyncFallback,
      invalidResidentPairings,
      rebuildCount: this.diagnostics.rebuildCount + 1,
    };

    return { activeRoomId: activeRoom.id, views, connectedTargetRoomIds };
  }

  private resolveTerrainSource(
    roomId: string,
    def: RoomDef | null,
  ): { source: AdjacentTerrainSource; ready: boolean; invalidResident: boolean } {
    // 1. Prefer a valid frozen resident world for dynamic structural state.
    const resident = this.ports.getResidentWorld(roomId);
    if (resident !== null) {
      if (isResidentWorldUsableForRoom(resident.builtForRoomId, roomId)) {
        if (resident.runtimeReady) {
          return { source: 'resident-world', ready: true, invalidResident: false };
        }
      } else {
        // A resident world exists but was built for a different room — never
        // draw another room's walls. Log loudly in DEV and skip this source.
        if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
          console.warn(
            `[adjacentRooms] resident world for "${roomId}" has builtForRoomId ` +
            `"${resident.builtForRoomId}" — skipping, requesting rebuild.`,
          );
        }
        return { source: 'async-fallback', ready: false, invalidResident: true };
      }
    }

    // 2. A prepared/baked wall template renders the room's authored geometry.
    if (def !== null && def.bakedWallTemplate !== undefined) {
      return { source: 'wall-template', ready: true, invalidResident: false };
    }

    // 3. Nothing render-ready yet — async fallback (request load, keep void).
    return { source: 'async-fallback', ready: false, invalidResident: false };
  }

  private resetDiagnostics(activeRoomId: string, enabled: boolean): void {
    this.diagnostics = {
      activeRoomId, enabled, visibleInstances: 0, readyViews: 0, pendingViews: 0,
      skippedCount: 0, residentSourced: 0, templateSourced: 0, asyncFallback: 0,
      invalidResidentPairings: 0, rebuildCount: this.diagnostics.rebuildCount,
    };
  }
}

export type { ConnectedRoomRenderState, ConnectedRoomInstance };
