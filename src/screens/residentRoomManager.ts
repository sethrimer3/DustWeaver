/**
 * residentRoomManager.ts — Resident Room Runtime manager.
 *
 * Tracks frozen enemy state per room so that revisiting a room restores
 * enemies to the state they were in when the player left, instead of
 * respawning them at full health.
 *
 * Architecture:
 *   Each visited room gets a ResidentRoomInstance that stores the frozen
 *   enemy cluster snapshots.  On transition to a previously visited room:
 *     1. Freeze the outgoing room (snapshot its enemy clusters).
 *     2. Run loadRoom normally (spawns fresh enemies via Phase C).
 *     3. Restore the frozen enemies in-place (replacing the fresh spawn).
 *
 * Phase-1 scope:
 *   - Enemy health, alive status, position, and AI state are preserved.
 *   - Complex enemies (radiant tether, dust constellation, etc.) are skipped
 *     in this pass and respawn fresh on revisit.  See nextSteps.md.
 *   - Hazard state, falling-block positions, and background fluid are not
 *     persisted in Phase 1.  See nextSteps.md for full simulation residency.
 *
 * Fallback behaviour:
 *   If restoration is skipped (first visit or complex enemies), loadRoom's
 *   fresh spawn is used unchanged.  No crash path — missing residents are
 *   transparent to gameplay.
 */

import type { ClusterState } from '../sim/clusters/state';
import type { RoomDef, RoomEnemyDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnLoadoutParticles } from './gameSpawn';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import type { RngState } from '../sim/rng';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A frozen snapshot of a single enemy cluster plus the metadata needed to
 * respawn its particles on activation.
 */
export interface FrozenEnemyEntry {
  /** Shallow copy of the cluster state at freeze time. */
  readonly cluster: ClusterState;
  /** Original room enemy definition (provides particle kinds and count). */
  readonly enemyDef: RoomEnemyDef;
}

/** Lifecycle of a resident room instance. */
export type ResidentLifecycle = 'active' | 'frozen' | 'evictable';

/** A resident room entry. Holds frozen simulation state for one room. */
export interface ResidentRoomInstance {
  readonly roomId: string;
  readonly roomDef: RoomDef;
  lifecycle: ResidentLifecycle;
  hasEverBeenActivated: boolean;
  lastActiveFrame: number;
  lastTouchedFrame: number;
  /**
   * Enemy cluster snapshot taken on last freeze.
   * null = room has never been frozen (first visit gets fresh enemies).
   */
  frozenEnemies: FrozenEnemyEntry[] | null;
}

/** Diagnostic snapshot for the debug overlay. */
export interface ResidentRoomDiagnostics {
  activeRoomId: string | null;
  residentCount: number;
  frozenCount: number;
  lastTransitionMode: 'residentHot' | 'residentFallback' | 'legacyLoad' | 'entryWarm' | 'none';
  lastResidentMissReason: string;
  lastActivationMs: number;
  evictionsTotal: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of rooms kept resident simultaneously.
 * Active room + up to (MAX_RESIDENTS - 1) frozen neighbours.
 * LRU eviction by lastTouchedFrame when exceeded.
 */
const MAX_RESIDENTS = 8;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if this enemy type can be safely shallow-copied and
 * re-inserted into a fresh WorldState.
 *
 * Complex enemies whose simulation state is spread across multiple world-level
 * arrays (radiant tether connections, dust constellation rings, etc.) are NOT
 * restorable in Phase 1.  They respawn fresh on revisit.
 */
function _isSimpleRestorable(cl: ClusterState): boolean {
  return (
    cl.isRadiantTetherFlag       === 0 &&
    cl.isRadiantWebFlag          === 0 &&
    cl.isDustConstellationFlag   === 0 &&
    cl.isOrbitalDustCoreFlag     === 0 &&
    cl.isDustBlockMimicFlag      === 0 &&
    cl.isDustWeaverArchitectFlag === 0 &&
    cl.isVoidSingularityFlag     === 0 &&
    cl.isDustLeechFlag           === 0
  );
}

/**
 * Returns true if this enemy type skips the particle loadout spawn.
 * Mirrors the skipParticleSpawn condition in gameEnemySpawn.ts.
 */
function _skipParticleSpawn(cl: ClusterState): boolean {
  return (
    cl.isRadiantTetherFlag       === 1 ||
    cl.isRadiantWebFlag          === 1 ||
    cl.isDustConstellationFlag   === 1 ||
    cl.isOrbitalDustCoreFlag     === 1 ||
    cl.isDustBlockMimicFlag      === 1 ||
    cl.isDustWeaverArchitectFlag === 1 ||
    cl.isVoidSingularityFlag     === 1 ||
    cl.isDustLeechFlag           === 1
  );
}

// ── ResidentRoomManager ───────────────────────────────────────────────────────

export class ResidentRoomManager {
  private readonly _residents = new Map<string, ResidentRoomInstance>();
  private _activeRoomId: string | null = null;
  private _currentFrame = 0;
  private _evictionsTotal = 0;
  private _lastTransitionMode: ResidentRoomDiagnostics['lastTransitionMode'] = 'none';
  private _lastResidentMissReason = '';
  private _lastActivationMs = 0;

  // ── Frame tracking ─────────────────────────────────────────────────────────

  /** Advance internal frame counter. Call once per RAF iteration. */
  tickFrame(): void {
    this._currentFrame++;
  }

  // ── Resident registration ──────────────────────────────────────────────────

  /** Returns an existing resident instance for roomId, or undefined. */
  getResident(roomId: string): ResidentRoomInstance | undefined {
    return this._residents.get(roomId);
  }

  /**
   * Ensure a resident shell exists for roomDef.  Creates one if absent.
   * Does not snapshot world state — safe to call speculatively after loading
   * a room to pre-register its neighbours.
   */
  ensureResident(roomDef: RoomDef): ResidentRoomInstance {
    const existing = this._residents.get(roomDef.id);
    if (existing !== undefined) {
      existing.lastTouchedFrame = this._currentFrame;
      return existing;
    }
    const instance: ResidentRoomInstance = {
      roomId:               roomDef.id,
      roomDef,
      lifecycle:            'frozen',
      hasEverBeenActivated: false,
      lastActiveFrame:      0,
      lastTouchedFrame:     this._currentFrame,
      frozenEnemies:        null,
    };
    this._residents.set(roomDef.id, instance);
    return instance;
  }

  // ── Active room management ─────────────────────────────────────────────────

  /**
   * Mark roomId as the current active room.
   * The previously active room is demoted to 'frozen'.
   * The room must have been registered via ensureResident() first.
   */
  setActiveResidentId(roomId: string): void {
    if (this._activeRoomId !== null && this._activeRoomId !== roomId) {
      const prev = this._residents.get(this._activeRoomId);
      if (prev !== undefined && prev.lifecycle === 'active') {
        prev.lifecycle = 'frozen';
      }
    }
    this._activeRoomId = roomId;
    const current = this._residents.get(roomId);
    if (current !== undefined) {
      current.lifecycle            = 'active';
      current.hasEverBeenActivated = true;
      current.lastActiveFrame      = this._currentFrame;
      current.lastTouchedFrame     = this._currentFrame;
    }
  }

  // ── Freeze / restore ───────────────────────────────────────────────────────

  /**
   * Snapshot all non-player enemy clusters from world into the named resident.
   * Call this BEFORE loadRoom() to preserve the outgoing room's enemy state.
   *
   * @param world   Live WorldState (enemies at world.clusters[1..]).
   * @param roomId  Id of the room being frozen.
   * @param room    RoomDef for that room (used to retrieve RoomEnemyDef.kinds).
   */
  freezeRoom(world: WorldState, roomId: string, room: RoomDef): void {
    const resident = this._residents.get(roomId);
    if (resident === undefined) return;

    const frozen: FrozenEnemyEntry[] = [];
    const enemies = room.enemies ?? [];
    for (let ci = 1; ci < world.clusters.length; ci++) {
      const cl = world.clusters[ci];
      // Cluster index ci-1 maps to room.enemies[ci-1] (spawn order is stable).
      const enemyDef = enemies[ci - 1];
      if (enemyDef === undefined) continue; // guard against spawn anomalies
      frozen.push({
        cluster:  { ...cl } as ClusterState, // shallow copy — ClusterState fields are all
        // number/0|1 primitives; the only "index" field (grappleHunterChainStartIndex) is
        // a number offset into the particle buffer, not a reference.  It is reset to -1
        // in restoreFrozenEnemies() before the cluster is inserted into a new WorldState.
        enemyDef,
      });
    }
    resident.frozenEnemies = frozen;
    resident.lifecycle     = 'frozen';
  }

  /**
   * Returns the frozen enemy snapshot for roomId, or null if the room has
   * never been frozen (first visit — fresh spawn from loadRoom is correct).
   */
  getFrozenEnemies(roomId: string): FrozenEnemyEntry[] | null {
    return this._residents.get(roomId)?.frozenEnemies ?? null;
  }

  /**
   * Restore frozen enemies into world AFTER loadRoom() has already run and
   * spawned fresh enemies via Phase C.
   *
   * For each restorable frozen enemy:
   *   - Kills its freshly-spawned particles (the fresh spawn used stale HP).
   *   - Replaces the fresh cluster with the frozen snapshot.
   *   - Respawns particles matching the frozen HP.
   *   - Re-initialises grapple hunter chain particles at the new indices.
   *
   * Complex enemies (radiant tether, dust constellation, etc.) are left as
   * fresh spawns — see _isSimpleRestorable().
   *
   * Returns the number of enemies whose state was restored.
   *
   * @param world         Live WorldState after loadRoom.
   * @param frozenEnemies Snapshot from getFrozenEnemies().
   * @param levelRng      Room-level RNG (same instance used by loadRoom).
   */
  restoreFrozenEnemies(
    world: WorldState,
    frozenEnemies: FrozenEnemyEntry[],
    levelRng: RngState,
  ): number {
    if (frozenEnemies.length === 0) return 0;

    // Build lookup: entityId → frozen entry (only for restorable enemies).
    const frozenByEntityId = new Map<number, FrozenEnemyEntry>();
    for (const entry of frozenEnemies) {
      if (_isSimpleRestorable(entry.cluster)) {
        frozenByEntityId.set(entry.cluster.entityId, entry);
      }
    }
    if (frozenByEntityId.size === 0) return 0;

    // Kill particles owned by enemies that will be restored.
    // (The fresh spawn used full HP; we will respawn at frozen HP below.)
    for (let pi = 0; pi < world.particleCount; pi++) {
      if (frozenByEntityId.has(world.ownerEntityId[pi])) {
        world.isAliveFlag[pi] = 0;
      }
    }

    let restoredCount = 0;

    // Replace restorable clusters in-place; non-restorable clusters remain fresh.
    for (let ci = 1; ci < world.clusters.length; ci++) {
      const freshCluster = world.clusters[ci];
      const entry = frozenByEntityId.get(freshCluster.entityId);
      if (entry === undefined) continue; // non-restorable — keep fresh

      const frozen = entry.cluster;

      // Shallow copy with reset chain index (old index pointed into the previous
      // particle buffer layout; Phase D will have re-allocated in the new buffer).
      const restored: ClusterState = {
        ...frozen,
        grappleHunterChainStartIndex: -1,
      };
      world.clusters[ci] = restored;
      restoredCount++;

      if (frozen.isAliveFlag === 0) {
        // Dead enemy — no particles needed.
        continue;
      }

      const hp = frozen.healthPoints;
      if (hp > 0 && !_skipParticleSpawn(frozen)) {
        spawnLoadoutParticles(
          world,
          frozen.entityId,
          frozen.positionXWorld,
          frozen.positionYWorld,
          entry.enemyDef.kinds as ParticleKind[],
          hp,
          levelRng,
        );
      }

      // Re-initialise grapple hunter chain particles at their new buffer slot.
      if (frozen.isGrappleHunterFlag === 1) {
        initGrappleHunterChainParticles(world, restored);
      }
    }

    return restoredCount;
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Record the outcome of the most recent transition for the debug overlay.
   */
  recordTransitionMode(
    mode: ResidentRoomDiagnostics['lastTransitionMode'],
    missReason = '',
    activationMs = 0,
  ): void {
    this._lastTransitionMode     = mode;
    this._lastResidentMissReason = missReason;
    this._lastActivationMs       = activationMs;
  }

  getDiagnostics(): ResidentRoomDiagnostics {
    let frozenCount = 0;
    for (const r of this._residents.values()) {
      if (r.lifecycle !== 'active') frozenCount++;
    }
    return {
      activeRoomId:           this._activeRoomId,
      residentCount:          this._residents.size,
      frozenCount,
      lastTransitionMode:     this._lastTransitionMode,
      lastResidentMissReason: this._lastResidentMissReason,
      lastActivationMs:       this._lastActivationMs,
      evictionsTotal:         this._evictionsTotal,
    };
  }

  // ── Eviction ───────────────────────────────────────────────────────────────

  /**
   * Evict stale residents to stay within MAX_RESIDENTS.
   * Keeps the active room and the (MAX_RESIDENTS − 1) most recently touched
   * frozen rooms.  Call after every room transition.
   */
  evictDistant(currentRoomId: string): void {
    if (this._residents.size <= MAX_RESIDENTS) return;
    const candidates = [...this._residents.values()]
      .filter(r => r.roomId !== currentRoomId && r.lifecycle !== 'active')
      .sort((a, b) => a.lastTouchedFrame - b.lastTouchedFrame);
    const toEvict = this._residents.size - MAX_RESIDENTS;
    for (let i = 0; i < toEvict && i < candidates.length; i++) {
      this._residents.delete(candidates[i].roomId);
      this._evictionsTotal++;
    }
  }
}
