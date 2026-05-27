/**
 * residentRoomManager.ts — Resident Room Runtime manager.
 *
 * Tracks frozen enemy state and dynamic simulation state per room so that
 * revisiting a room restores it to the state it was in when the player left,
 * instead of respawning enemies/hazards at their initial conditions.
 *
 * Architecture:
 *   Each visited room gets a ResidentRoomInstance that stores the frozen
 *   enemy cluster snapshots (Phase 1) and simulation-state snapshots (Phase 2).
 *   On transition to a previously visited room:
 *     1. Freeze the outgoing room (snapshot clusters + sim state).
 *     2. Run loadRoom normally (spawns fresh enemies/hazards via Phase C–E).
 *     3. Restore frozen enemies in-place (replacing the fresh spawn).
 *     4. Restore frozen sim state (overwriting freshly-loaded hazard/rope/block state).
 *
 * Phase-1 scope:
 *   - Enemy health, alive status, position, and AI state are preserved.
 *   - Complex enemies (radiant tether, dust constellation, etc.) are skipped
 *     in this pass and respawn fresh on revisit.  See nextSteps.md.
 *
 * Phase-2 scope (this file):
 *   - Falling block state machine (warning, falling, landed, crumbling, removed).
 *   - Rope Verlet positions (ropes remember their settled shape).
 *   - Breakable block damage (broken blocks stay broken on revisit).
 *   - Crumble block damage (cracked/destroyed blocks persist on revisit).
 *   - Grasshopper positions and velocities (critters stay where they hopped to).
 *   - Background fluid particle positions (fluid settles into same visual state).
 *
 * Fallback behaviour:
 *   If restoration is skipped (first visit) or throws, loadRoom's fresh spawn
 *   is used unchanged.  No crash path — missing residents are transparent.
 */

import type { ClusterState } from '../sim/clusters/state';
import type { RoomDef, RoomEnemyDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { MAX_ROPE_SEGMENTS } from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnLoadoutParticles } from './gameSpawn';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import type { RngState } from '../sim/rng';
import {
  type FallingBlockState,
  FB_STATE_IDLE_STABLE,
  FB_STATE_REMOVED,
  getFBGroupTopWorld,
  getFBGroupLeftWorld,
} from '../sim/fallingBlocks/fallingBlockTypes';

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

// ── Phase-2 simulation-state snapshots ───────────────────────────────────────

/**
 * Per-group falling block state snapshot.
 * Only groups that are NOT in `FB_STATE_IDLE_STABLE` are stored —
 * idle-stable groups need no restoration (loadRoom puts them there by default).
 */
export interface FrozenFallingBlockState {
  /** groupId from the FallingBlockGroup (stable across reloads of same room). */
  groupId: number;
  /** State machine enum value. */
  state: FallingBlockState;
  /** Ticks elapsed in the current state. */
  stateTimerTicks: number;
  /** Current vertical fall offset from rest position (world units). */
  offsetYWorld: number;
  /** Current downward fall velocity (world units/s). */
  velocityYWorld: number;
  /** Horizontal shake offset for the warning-shake animation (world units). */
  shakeOffsetXWorld: number;
  /** 1 once the group has reached terminal fall velocity. */
  hasReachedTopSpeedFlag: 0 | 1;
  /** Countdown ticks until crumble removes the group (crumbling variant). */
  crumbleTimerTicks: number;
}

/**
 * Full Verlet position snapshot for all ropes in a room.
 * Allows ropes to restore their settled shape on revisit instead of
 * re-running the pre-simulation settle pass from scratch.
 */
export interface FrozenRopeSnapshot {
  ropeCount: number;
  /** Verlet current positions — flat layout [r0s0, r0s1, …, r1s0, …]. */
  posX: Float32Array;
  posY: Float32Array;
  /** Verlet previous positions (same layout) — needed for velocity integration. */
  prevX: Float32Array;
  prevY: Float32Array;
}

/** Active-flag snapshot for all breakable blocks in a room. */
export interface FrozenBreakableBlockState {
  count: number;
  /** 1 = still active (solid), 0 = broken.  Index-parallel with room.breakableBlocks. */
  activeFlags: Uint8Array;
}

/** Active-flag and hits-remaining snapshot for all crumble blocks in a room. */
export interface FrozenCrumbleBlockState {
  count: number;
  /** 1 = still active, 0 = destroyed. */
  activeFlags: Uint8Array;
  /** Hits remaining until destruction (2 = intact, 1 = cracked, 0 = gone). */
  hitsRemaining: Uint8Array;
}

/** Grasshopper positions and velocities snapshot. */
export interface FrozenGrasshopperSnapshot {
  count: number;
  xWorld: Float32Array;
  yWorld: Float32Array;
  velXWorld: Float32Array;
  velYWorld: Float32Array;
  hopTimerTicks: Float32Array;
  isAliveFlag: Uint8Array;
}

/**
 * Background fluid particle snapshot.
 * Stores position, velocity, disturbance, and age for every Fluid-kind
 * particle with ownerEntityId === −1 at freeze time.
 */
export interface FrozenFluidSnapshot {
  count: number;
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  disturbanceFactor: Float32Array;
  ageTicks: Float32Array;
}

/**
 * Full Phase-2 simulation state snapshot for one resident room.
 * All fields are null when the room has never been frozen or the
 * corresponding feature is absent from the room.
 */
export interface FrozenSimState {
  /** Non-idle-stable falling block states keyed by groupId. */
  fallingBlocks: FrozenFallingBlockState[];
  /** Rope Verlet positions, or null if the room has no ropes. */
  ropes: FrozenRopeSnapshot | null;
  /** Breakable block active flags, or null if room has none. */
  breakableBlocks: FrozenBreakableBlockState | null;
  /** Crumble block state, or null if room has none. */
  crumbleBlocks: FrozenCrumbleBlockState | null;
  /** Grasshopper snapshot, or null if room has none. */
  grasshoppers: FrozenGrasshopperSnapshot | null;
  /** Background fluid particle snapshot, or null if no fluid was present. */
  fluidParticles: FrozenFluidSnapshot | null;
}

// ── Instance & diagnostics types ─────────────────────────────────────────────

/**
 * Lifecycle of a resident room instance.
 *
 * - `'active'`    — This is the currently playing room.
 * - `'frozen'`    — Fully built WorldState stored; not ticking.
 * - `'loading'`   — Reserved for future async background-build tracking;
 *                   not currently set by any code path (idle builds complete
 *                   synchronously in one frame and jump directly to 'frozen').
 * - `'evictable'` — Candidate for eviction; no valuable state stored.
 */
export type ResidentLifecycle = 'active' | 'frozen' | 'loading' | 'evictable';

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
  /**
   * Phase-2 simulation state snapshot taken on last freeze.
   * null = room has never been frozen or has no dynamic simulation state.
   */
  frozenSimState: FrozenSimState | null;

  // ── True per-room WorldState (BUILD 416+) ──────────────────────────────

  /**
   * Fully-built WorldState for this room, built by buildResidentWorldState().
   * null = not yet built (will fall back to snapshot-restore or legacy load).
   *
   * While this room is active, `world` is the same object as the gameScreen
   * module-level `world` variable.  While frozen, it holds the room's
   * simulation state (enemies, hazards, ropes, particles, etc.) exactly as
   * the player left it.  Frozen worlds do NOT tick.
   */
  world: WorldState | null;

  /**
   * true when `world` is fully built and safe to activate without calling
   * loadRoom().  Set by setResidentWorld() and cleared by
   * invalidateResidentWorld().
   */
  runtimeReady: boolean;
}

/** Diagnostic snapshot for the debug overlay. */
export interface ResidentRoomDiagnostics {
  activeRoomId: string | null;
  residentCount: number;
  frozenCount: number;
  /** Number of residents with runtimeReady=true (true WorldState hot-swap capable). */
  residentWorldCount: number;
  /** Radius-1 neighbours of the active room that are runtimeReady. */
  radius1ReadyCount: number;
  /** Radius-2 neighbours of the active room that are runtimeReady. */
  radius2ReadyCount: number;
  /**
   * Transition mode labels (BUILD 416):
   *  - `residentWorldHot`: true hot-swap — loadRoom was NOT called.
   *  - `residentRestore`:  snapshot-restore — loadRoom ran, snapshots patched back.
   *  - `legacyLoad`:       full async/destructive load (cold entry).
   *  - `entryWarm`:        render cache not yet ready; entry-warm overlay shown.
   *  - `none`:             no transition recorded yet.
   *
   * @deprecated `residentHot` is preserved as an alias for `residentRestore`
   * during the transition period.  Do not use `residentHot` for new code.
   */
  lastTransitionMode: 'residentWorldHot' | 'residentRestore' | 'residentHot' | 'residentFallback' | 'legacyLoad' | 'entryWarm' | 'none';
  lastResidentMissReason: string;
  lastActivationMs: number;
  /** true if the most recent transition skipped loadRoom entirely. */
  loadRoomSkippedOnLastTransition: boolean;
  /** Number of rooms in the background build queue. */
  residentBuildQueueLength: number;
  evictionsTotal: number;
  // ── Player transfer diagnostics (BUILD 416) ──────────────────────────────
  /** Number of non-transient player-owned particles captured in the last hot-swap. */
  lastPlayerParticlesCaptured: number;
  /** Number of captured particles successfully restored in the target world. */
  lastPlayerParticlesRestored: number;
  /** Number of particles skipped during restore (particle buffer full). */
  lastPlayerParticlesSkipped:  number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of rooms kept resident simultaneously.
 * Active room + up to (MAX_RESIDENTS - 1) frozen neighbours.
 * Increased from 8 to 16 in BUILD 415 to accommodate radius-2 pre-registration
 * (active room + up to ~4 radius-1 + up to ~12 radius-2 neighbours).
 * LRU eviction by lastTouchedFrame when exceeded, with shells (never activated)
 * evicted before rooms carrying frozen state.
 */
const MAX_RESIDENTS = 16;

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
  private _loadRoomSkippedOnLastTransition = false;
  /** Externally managed queue length — updated by gameScreen via setResidentBuildQueueLength(). */
  private _residentBuildQueueLength = 0;
  /** radius-1/2 ready counts set by gameScreen after each transition. */
  private _radius1ReadyCount = 0;
  private _radius2ReadyCount = 0;
  // ── Player transfer diagnostics (BUILD 416) ──────────────────────────────
  private _lastPlayerParticlesCaptured = 0;
  private _lastPlayerParticlesRestored = 0;
  private _lastPlayerParticlesSkipped  = 0;

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
      frozenSimState:       null,
      world:                null,
      runtimeReady:         false,
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

    if (import.meta.env.DEV) {
      // On the true hot-swap path the player cluster must be removed from the
      // outgoing world before freezeRoom() is called.  Flag any violation so
      // duplicate-player bugs are surfaced immediately.
      for (let ci = 0; ci < world.clusters.length; ci++) {
        if (world.clusters[ci].isPlayerFlag === 1) {
          console.error(
            `[resident] freezeRoom(${roomId}): player cluster found at index ${ci} — ` +
            'player was not removed before freeze; duplicate-player bug likely.',
          );
          break;
        }
      }
    }

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

  // ── Phase-2: freeze / restore simulation state ────────────────────────────

  /**
   * Snapshot the room's dynamic simulation state into the named resident.
   * Call this alongside freezeRoom(), BEFORE loadRoom() destroys the state.
   *
   * Captures:
   *   - Falling block state machines (only non-idle-stable groups).
   *   - Rope Verlet positions (all segments for all ropes).
   *   - Breakable block active flags.
   *   - Crumble block active flags and hits-remaining.
   *   - Grasshopper positions and velocities.
   *   - Background fluid particle positions, velocities, and disturbance.
   *
   * @param world   Live WorldState to snapshot.
   * @param roomId  Id of the room being frozen.
   */
  freezeSimState(world: WorldState, roomId: string): void {
    const resident = this._residents.get(roomId);
    if (resident === undefined) return;

    // ── Falling blocks ────────────────────────────────────────────────────
    const fallingBlocks: FrozenFallingBlockState[] = [];
    for (const g of world.fallingBlockGroups) {
      if (g.state === FB_STATE_IDLE_STABLE) continue; // default — no need to store
      fallingBlocks.push({
        groupId:              g.groupId,
        state:                g.state,
        stateTimerTicks:      g.stateTimerTicks,
        offsetYWorld:         g.offsetYWorld,
        velocityYWorld:       g.velocityYWorld,
        shakeOffsetXWorld:    g.shakeOffsetXWorld,
        hasReachedTopSpeedFlag: g.hasReachedTopSpeedFlag,
        crumbleTimerTicks:    g.crumbleTimerTicks,
      });
    }

    // ── Ropes ─────────────────────────────────────────────────────────────
    let ropes: FrozenRopeSnapshot | null = null;
    if (world.ropeCount > 0) {
      const totalSlots = world.ropeCount * MAX_ROPE_SEGMENTS;
      // Slice directly for independent copies — avoids creating intermediate shared-buffer views.
      ropes = {
        ropeCount: world.ropeCount,
        posX:  world.ropeSegPosXWorld.slice(0, totalSlots),
        posY:  world.ropeSegPosYWorld.slice(0, totalSlots),
        prevX: world.ropeSegPrevXWorld.slice(0, totalSlots),
        prevY: world.ropeSegPrevYWorld.slice(0, totalSlots),
      };
    }

    // ── Breakable blocks ──────────────────────────────────────────────────
    let breakableBlocks: FrozenBreakableBlockState | null = null;
    if (world.breakableBlockCount > 0) {
      breakableBlocks = {
        count: world.breakableBlockCount,
        activeFlags: world.isBreakableBlockActiveFlag.slice(0, world.breakableBlockCount),
      };
    }

    // ── Crumble blocks ────────────────────────────────────────────────────
    let crumbleBlocks: FrozenCrumbleBlockState | null = null;
    if (world.crumbleBlockCount > 0) {
      crumbleBlocks = {
        count: world.crumbleBlockCount,
        activeFlags:    world.isCrumbleBlockActiveFlag.slice(0, world.crumbleBlockCount),
        hitsRemaining:  world.crumbleBlockHitsRemaining.slice(0, world.crumbleBlockCount),
      };
    }

    // ── Grasshoppers ──────────────────────────────────────────────────────
    let grasshoppers: FrozenGrasshopperSnapshot | null = null;
    if (world.grasshopperCount > 0) {
      const n = world.grasshopperCount;
      grasshoppers = {
        count:         n,
        xWorld:        world.grasshopperXWorld.slice(0, n),
        yWorld:        world.grasshopperYWorld.slice(0, n),
        velXWorld:     world.grasshopperVelXWorld.slice(0, n),
        velYWorld:     world.grasshopperVelYWorld.slice(0, n),
        hopTimerTicks: world.grasshopperHopTimerTicks.slice(0, n),
        isAliveFlag:   world.isGrasshopperAliveFlag.slice(0, n),
      };
    }

    // ── Background fluid particles ────────────────────────────────────────
    // Scan the particle buffer for Fluid-kind particles owned by no entity.
    // These are always spawned by spawnBackgroundFluidParticles with ownerEntityId = -1.
    let fluidParticles: FrozenFluidSnapshot | null = null;
    {
      // Pre-count to allocate exact arrays.
      let fluidCount = 0;
      for (let pi = 0; pi < world.particleCount; pi++) {
        if (world.kindBuffer[pi] === ParticleKind.Fluid && world.ownerEntityId[pi] === -1) {
          fluidCount++;
        }
      }
      if (fluidCount > 0) {
        const posX  = new Float32Array(fluidCount);
        const posY  = new Float32Array(fluidCount);
        const velX  = new Float32Array(fluidCount);
        const velY  = new Float32Array(fluidCount);
        const dist  = new Float32Array(fluidCount);
        const age   = new Float32Array(fluidCount);
        let fi = 0;
        for (let pi = 0; pi < world.particleCount; pi++) {
          if (world.kindBuffer[pi] === ParticleKind.Fluid && world.ownerEntityId[pi] === -1) {
            posX[fi]  = world.positionXWorld[pi];
            posY[fi]  = world.positionYWorld[pi];
            velX[fi]  = world.velocityXWorld[pi];
            velY[fi]  = world.velocityYWorld[pi];
            dist[fi]  = world.disturbanceFactor[pi];
            age[fi]   = world.ageTicks[pi];
            fi++;
          }
        }
        fluidParticles = { count: fluidCount, posX, posY, velX, velY, disturbanceFactor: dist, ageTicks: age };
      }
    }

    resident.frozenSimState = {
      fallingBlocks,
      ropes,
      breakableBlocks,
      crumbleBlocks,
      grasshoppers,
      fluidParticles,
    };
  }

  /**
   * Returns the frozen Phase-2 simulation state for roomId, or null if the
   * room has never been frozen (first visit — fresh state from loadRoom is used).
   */
  getFrozenSimState(roomId: string): FrozenSimState | null {
    return this._residents.get(roomId)?.frozenSimState ?? null;
  }

  /**
   * Restore frozen simulation state into world AFTER loadRoom() has completed.
   *
   * Call order within gameScreen.ts (instant-path):
   *   1. freezeRoom()        + freezeSimState()  — before loadRoom
   *   2. loadRoom()
   *   3. restoreFrozenEnemies()                  — after loadRoom
   *   4. restoreSimState()                       — after loadRoom
   *
   * Each category is restored independently so a partial failure does not
   * prevent the others from being applied.
   *
   * @param world       Live WorldState after loadRoom.
   * @param frozenState Snapshot from getFrozenSimState().
   */
  restoreSimState(world: WorldState, frozenState: FrozenSimState): void {
    // ── Falling blocks ────────────────────────────────────────────────────
    if (frozenState.fallingBlocks.length > 0) {
      // Build groupId → frozen state lookup.
      const byGroupId = new Map<number, FrozenFallingBlockState>();
      for (const fb of frozenState.fallingBlocks) {
        byGroupId.set(fb.groupId, fb);
      }
      for (const g of world.fallingBlockGroups) {
        const fb = byGroupId.get(g.groupId);
        if (fb === undefined) continue;
        // Restore dynamic state.
        g.state                  = fb.state;
        g.stateTimerTicks        = fb.stateTimerTicks;
        g.offsetYWorld           = fb.offsetYWorld;
        g.velocityYWorld         = fb.velocityYWorld;
        g.shakeOffsetXWorld      = fb.shakeOffsetXWorld;
        g.hasReachedTopSpeedFlag = fb.hasReachedTopSpeedFlag;
        g.crumbleTimerTicks      = fb.crumbleTimerTicks;
        // Sync the wall slot to match the restored position.
        const wi = g.wallIndex;
        if (wi >= 0 && wi < world.wallCount) {
          if (g.state === FB_STATE_REMOVED) {
            world.wallWWorld[wi] = 0;
            world.wallHWorld[wi] = 0;
          } else {
            world.wallXWorld[wi] = getFBGroupLeftWorld(g);
            world.wallYWorld[wi] = getFBGroupTopWorld(g);
            world.wallWWorld[wi] = g.wWorld;
            world.wallHWorld[wi] = g.hWorld;
          }
        }
      }
    }

    // ── Ropes ─────────────────────────────────────────────────────────────
    // Guard on both ropeCount and snapshot length so a recompile that changes
    // MAX_ROPE_SEGMENTS won't silently restore with a mismatched layout.
    if (
      frozenState.ropes !== null &&
      world.ropeCount === frozenState.ropes.ropeCount &&
      frozenState.ropes.posX.length === world.ropeCount * MAX_ROPE_SEGMENTS
    ) {
      const { posX, posY, prevX, prevY } = frozenState.ropes;
      const totalSlots = posX.length;
      world.ropeSegPosXWorld.set(posX.subarray(0, totalSlots));
      world.ropeSegPosYWorld.set(posY.subarray(0, totalSlots));
      world.ropeSegPrevXWorld.set(prevX.subarray(0, totalSlots));
      world.ropeSegPrevYWorld.set(prevY.subarray(0, totalSlots));
    }

    // ── Breakable blocks ──────────────────────────────────────────────────
    if (
      frozenState.breakableBlocks !== null &&
      world.breakableBlockCount === frozenState.breakableBlocks.count
    ) {
      const { count, activeFlags } = frozenState.breakableBlocks;
      for (let i = 0; i < count; i++) {
        if (activeFlags[i] === 0) {
          world.isBreakableBlockActiveFlag[i] = 0;
          // Deactivate the corresponding wall slot (mirrors hazards.ts break logic).
          const wi = world.breakableBlockWallIndex[i];
          if (wi >= 0 && wi < world.wallCount) {
            world.wallWWorld[wi] = 0;
            world.wallHWorld[wi] = 0;
          }
        }
        // Flag = 1 is the loadRoom default; no action needed for intact blocks.
      }
    }

    // ── Crumble blocks ────────────────────────────────────────────────────
    if (
      frozenState.crumbleBlocks !== null &&
      world.crumbleBlockCount === frozenState.crumbleBlocks.count
    ) {
      const { count, activeFlags, hitsRemaining } = frozenState.crumbleBlocks;
      for (let i = 0; i < count; i++) {
        if (activeFlags[i] === 0) {
          world.isCrumbleBlockActiveFlag[i] = 0;
          const wi = world.crumbleBlockWallIndex[i];
          if (wi >= 0 && wi < world.wallCount) {
            world.wallWWorld[wi] = 0;
            world.wallHWorld[wi] = 0;
          }
        } else {
          // Restore reduced hit count for cracked-but-intact blocks.
          world.crumbleBlockHitsRemaining[i] = hitsRemaining[i];
        }
      }
    }

    // ── Grasshoppers ──────────────────────────────────────────────────────
    if (
      frozenState.grasshoppers !== null &&
      world.grasshopperCount === frozenState.grasshoppers.count
    ) {
      const gh = frozenState.grasshoppers;
      const n = gh.count;
      world.grasshopperXWorld.set(gh.xWorld.subarray(0, n));
      world.grasshopperYWorld.set(gh.yWorld.subarray(0, n));
      world.grasshopperVelXWorld.set(gh.velXWorld.subarray(0, n));
      world.grasshopperVelYWorld.set(gh.velYWorld.subarray(0, n));
      world.grasshopperHopTimerTicks.set(gh.hopTimerTicks.subarray(0, n));
      world.isGrasshopperAliveFlag.set(gh.isAliveFlag.subarray(0, n));
    }

    // ── Background fluid particles ────────────────────────────────────────
    // Match freshly-spawned Fluid particles to the frozen snapshot by scan order.
    // Spawn order is deterministic: Phase D calls spawnBackgroundFluidParticles()
    // unconditionally after Phase B (player) and Phase C (enemies).  Enemies
    // are spawned in room.enemies index order with a fixed per-enemy particle
    // count, so the Fluid-particle block always starts at the same buffer offset
    // for a given room definition.  A count mismatch (frozen ≠ live) indicates
    // the room definition changed and we skip restoration to avoid mis-mapping.
    if (frozenState.fluidParticles !== null) {
      const fp = frozenState.fluidParticles;
      // Count live fluid particles first to validate before overwriting any data.
      let liveFluidCount = 0;
      for (let pi = 0; pi < world.particleCount; pi++) {
        if (world.kindBuffer[pi] === ParticleKind.Fluid && world.ownerEntityId[pi] === -1) {
          liveFluidCount++;
        }
      }
      if (liveFluidCount === fp.count) {
        let fi = 0;
        for (let pi = 0; pi < world.particleCount && fi < fp.count; pi++) {
          if (world.kindBuffer[pi] !== ParticleKind.Fluid || world.ownerEntityId[pi] !== -1) {
            continue;
          }
          world.positionXWorld[pi]    = fp.posX[fi];
          world.positionYWorld[pi]    = fp.posY[fi];
          world.velocityXWorld[pi]    = fp.velX[fi];
          world.velocityYWorld[pi]    = fp.velY[fi];
          world.disturbanceFactor[pi] = fp.disturbanceFactor[fi];
          world.ageTicks[pi]          = fp.ageTicks[fi];
          fi++;
        }
      }
    }
  }

  /**
   * Record the outcome of the most recent transition for the debug overlay.
   * @param mode            Transition mode label.
   * @param missReason      Why a resident world was not available (if applicable).
   * @param activationMs    Wall-clock ms spent on the activation.
   * @param loadRoomSkipped Whether loadRoom was skipped entirely (true resident hot-swap).
   */
  recordTransitionMode(
    mode: ResidentRoomDiagnostics['lastTransitionMode'],
    missReason = '',
    activationMs = 0,
    loadRoomSkipped = false,
  ): void {
    this._lastTransitionMode                = mode;
    this._lastResidentMissReason            = missReason;
    this._lastActivationMs                  = activationMs;
    this._loadRoomSkippedOnLastTransition   = loadRoomSkipped;
  }

  /** Update the background build queue length shown in the debug overlay. */
  setResidentBuildQueueLength(length: number): void {
    this._residentBuildQueueLength = length;
  }

  /** Update radius readiness counts shown in the debug overlay. */
  setRadiusReadyCounts(radius1: number, radius2: number): void {
    this._radius1ReadyCount = radius1;
    this._radius2ReadyCount = radius2;
  }

  // ── Player transfer diagnostics (BUILD 416) ──────────────────────────────

  /**
   * Record the outcome of a player particle transfer following a hot-swap.
   * Called by gameScreen after applyResidentRoomActivation().
   *
   * @param captured  Non-transient player particles captured from the outgoing world.
   * @param restored  Particles successfully written into the target world.
   * @param skipped   Particles that could not be written (buffer full).
   */
  recordPlayerTransfer(captured: number, restored: number, skipped: number): void {
    this._lastPlayerParticlesCaptured = captured;
    this._lastPlayerParticlesRestored = restored;
    this._lastPlayerParticlesSkipped  = skipped;
    if (import.meta.env.DEV) {
      console.log(
        `[resident] player transfer: captured=${captured} restored=${restored} skipped=${skipped}`,
      );
    }
  }

  /**
   * DEV-only: scan all resident worlds and log invariant violations.
   *
   * Invariants checked:
   *   - Active world has exactly one player cluster.
   *   - Frozen worlds have zero player clusters.
   *   - No frozen world contains live non-transient particles owned by
   *     any resident's departed player entity (entityId=1 in current codebase).
   *   - No two worlds contain a player with the same entity id.
   */
  scanOwnershipInvariant(): void {
    if (!import.meta.env.DEV) return;

    const playerEntityIdsFound: Array<{ roomId: string; entityId: number }> = [];

    for (const r of this._residents.values()) {
      if (r.world === null) continue;
      const w = r.world;

      // Count player clusters.
      let playerCount = 0;
      for (let ci = 0; ci < w.clusters.length; ci++) {
        if (w.clusters[ci].isPlayerFlag === 1) {
          playerCount++;
          playerEntityIdsFound.push({ roomId: r.roomId, entityId: w.clusters[ci].entityId });
        }
      }

      if (r.lifecycle === 'active' && playerCount !== 1) {
        console.error(
          `[resident] scanOwnershipInvariant: active room "${r.roomId}" has ${playerCount} player(s) ` +
          '(expected exactly 1).',
        );
      }
      if (r.lifecycle !== 'active' && playerCount !== 0) {
        console.error(
          `[resident] scanOwnershipInvariant: frozen room "${r.roomId}" has ${playerCount} player(s) ` +
          '(expected 0).',
        );
      }

      // Check for live non-transient particles owned by entityId=1 in frozen worlds.
      // (entityId=1 is the player in this codebase; frozen worlds should have no live
      // player-owned particles after detachPlayerFromResidentWorld().)
      if (r.lifecycle !== 'active') {
        for (let pi = 0; pi < w.particleCount; pi++) {
          if (
            w.ownerEntityId[pi] === 1 &&
            w.isAliveFlag[pi] === 1 &&
            w.isTransientFlag[pi] === 0
          ) {
            console.error(
              `[resident] scanOwnershipInvariant: frozen room "${r.roomId}" has live ` +
              `non-transient particle at slot ${pi} owned by entityId=1 (player). ` +
              'Expected no live player-owned particles in frozen worlds.',
            );
            break; // one error per room is enough
          }
        }
      }
    }

    // Check for duplicate player entity ids across worlds (O(n) via Set).
    const seenEntityIds = new Map<number, string>(); // entityId → first-seen roomId
    for (const { roomId, entityId } of playerEntityIdsFound) {
      const firstRoom = seenEntityIds.get(entityId);
      if (firstRoom !== undefined) {
        console.error(
          `[resident] scanOwnershipInvariant: duplicate player entityId=${entityId} ` +
          `found in rooms "${firstRoom}" and "${roomId}".`,
        );
      } else {
        seenEntityIds.set(entityId, roomId);
      }
    }
  }



  /**
   * Store a fully-built WorldState on the named resident and mark it as
   * runtimeReady.  Called:
   *   - After the initial campaign load (start room's world is the live world).
   *   - After buildResidentWorldState() finishes for a neighbour room.
   *   - After activateResidentRoom() freezes the outgoing room's world.
   *
   * @param roomId       Room identifier.
   * @param w            Fully-built WorldState for this room.
   * @param isActive     If true, mark lifecycle 'active' (caller is the live world).
   *                     If false, mark lifecycle 'frozen' (background-built resident).
   */
  setResidentWorld(roomId: string, w: WorldState, isActive: boolean): void {
    let resident = this._residents.get(roomId);
    if (resident === undefined) return; // Must ensureResident() first.
    resident.world        = w;
    resident.runtimeReady = true;
    resident.lifecycle    = isActive ? 'active' : 'frozen';
    if (isActive) {
      resident.hasEverBeenActivated = true;
      resident.lastActiveFrame      = this._currentFrame;
      if (import.meta.env.DEV) {
        // After activation exactly one player cluster must be present.
        let playerCount = 0;
        for (let ci = 0; ci < w.clusters.length; ci++) {
          if (w.clusters[ci].isPlayerFlag === 1) playerCount++;
        }
        if (playerCount !== 1) {
          console.error(
            `[resident] setResidentWorld(${roomId}, active): expected 1 player cluster, ` +
            `found ${playerCount} — duplicate or missing player bug.`,
          );
        }
      }
    }
    resident.lastTouchedFrame = this._currentFrame;
  }

  /**
   * Mark a resident's WorldState as invalid (e.g. because loadRoom is about
   * to destructively reset the active world for a legacy cold load).
   * Clears `world` and `runtimeReady` so the resident knows it needs to be
   * rebuilt in the background.  Frozen enemy/sim snapshots are NOT cleared —
   * the legacy snapshot-restore path can still use them.
   */
  invalidateResidentWorld(roomId: string): void {
    const resident = this._residents.get(roomId);
    if (resident === undefined) return;
    resident.world        = null;
    resident.runtimeReady = false;
  }

  getDiagnostics(): ResidentRoomDiagnostics {
    let frozenCount = 0;
    let residentWorldCount = 0;
    for (const r of this._residents.values()) {
      if (r.lifecycle !== 'active') frozenCount++;
      if (r.runtimeReady && r.world !== null) residentWorldCount++;
    }
    return {
      activeRoomId:                       this._activeRoomId,
      residentCount:                      this._residents.size,
      frozenCount,
      residentWorldCount,
      radius1ReadyCount:                  this._radius1ReadyCount,
      radius2ReadyCount:                  this._radius2ReadyCount,
      lastTransitionMode:                 this._lastTransitionMode,
      lastResidentMissReason:             this._lastResidentMissReason,
      lastActivationMs:                   this._lastActivationMs,
      loadRoomSkippedOnLastTransition:    this._loadRoomSkippedOnLastTransition,
      residentBuildQueueLength:           this._residentBuildQueueLength,
      evictionsTotal:                     this._evictionsTotal,
      lastPlayerParticlesCaptured:        this._lastPlayerParticlesCaptured,
      lastPlayerParticlesRestored:        this._lastPlayerParticlesRestored,
      lastPlayerParticlesSkipped:         this._lastPlayerParticlesSkipped,
    };
  }

  // ── Eviction ───────────────────────────────────────────────────────────────

  /**
   * Evict stale residents to stay within MAX_RESIDENTS.
   * Keeps the active room and the (MAX_RESIDENTS − 1) most recently touched
   * frozen rooms.  Rooms that have never been activated (pre-registered shells
   * with no frozen state) are evicted before rooms carrying frozen enemy or
   * sim-state snapshots.  Call after every room transition.
   */
  evictDistant(currentRoomId: string): void {
    if (this._residents.size <= MAX_RESIDENTS) return;
    const candidates = [...this._residents.values()]
      .filter(r => r.roomId !== currentRoomId && r.lifecycle !== 'active')
      .sort((a, b) => {
        // Evict shells (never activated — no frozen state to lose) before rooms
        // carrying frozen state.  Within each tier, prefer rooms with runtimeReady
        // worlds (more expensive to rebuild) over snapshot-only rooms.
        // Within each sub-tier, evict oldest-first.
        const aActivatedPriority = a.hasEverBeenActivated ? 1 : 0;
        const bActivatedPriority = b.hasEverBeenActivated ? 1 : 0;
        if (aActivatedPriority !== bActivatedPriority) return aActivatedPriority - bActivatedPriority;
        // Prefer to keep runtimeReady worlds (cost more to rebuild).
        const aWorldPriority = a.runtimeReady ? 1 : 0;
        const bWorldPriority = b.runtimeReady ? 1 : 0;
        if (aWorldPriority !== bWorldPriority) return aWorldPriority - bWorldPriority;
        return a.lastTouchedFrame - b.lastTouchedFrame;
      });
    const toEvict = this._residents.size - MAX_RESIDENTS;
    for (let i = 0; i < toEvict && i < candidates.length; i++) {
      const evicted = candidates[i];
      // Null out the WorldState reference so GC can reclaim the memory.
      evicted.world = null;
      this._residents.delete(evicted.roomId);
      this._evictionsTotal++;
    }
  }
}
