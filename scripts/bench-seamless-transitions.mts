/**
 * bench-seamless-transitions.mts — before/after measurement of room-boundary
 * seamlessness, runnable headlessly against any commit.
 *
 *   node --import tsx scripts/bench-seamless-transitions.mts
 *
 * ## Why this exists rather than an in-browser benchmark
 *
 * The RAF-driven console harness (`__dwBenchPingPong`) cannot run in this
 * environment: the Browser pane suspends requestAnimationFrame while hidden, so
 * every frame-paced measurement stalls.  This driver instead runs the REAL
 * `RoomTransitionLoadCoordinator` state machine against the REAL campaign
 * rooms, stepping it exactly the way `gameScreen.ts`'s RAF loop does, and
 * counts the things that decide whether a crossing is perceived as a load:
 * gameplay-blocked frames, overlay frames, entry-warm frames, generator phases,
 * and momentum preservation.
 *
 * ## What is real and what is modelled — read this before trusting a number
 *
 * REAL: the room data (parsed from ASSETS/CAMPAIGNS), the spawn derivation the
 * runtime uses (`computeSpawnBlockForTransition` → `resolveSpawnBlock`), the
 * transition path-selection state machine, the drain/one-phase-per-frame
 * pacing, the build-takeover logic, and every overlay/entry-warm decision the
 * coordinator makes.
 *
 * MODELLED: `canSkipEntryWarm`.  The genuine predicate reads rasterized chunk
 * canvases, which need a real CanvasRenderingContext2D.  Here it is evaluated
 * as "does the region that was pre-warmed for this directed entry contain the
 * viewport activation actually renders?" — the same question the real predicate
 * asks, computed geometrically.  Which pre-warm rule is used is selected by
 * `--warm=legacy|swept` so the harness can measure BOTH the old behaviour
 * (single viewport at the source transition's authored `targetSpawnBlock`,
 * camera unclamped) and the new one (swept union over reachable spawns, camera
 * clamped) from a single checkout.
 *
 * Cross-zone crossings are excluded: they are expected to load.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoomDef } from '../src/levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../src/levels/roomDef';
import type { WorldState } from '../src/sim/world';
import { hydrateV2Room, isSavedRoomV2 } from '../src/levels/roomSchemaHydrator';
import { roomJsonDefToRoomDef } from '../src/levels/roomJsonToRoomDef';
import { computeSpawnBlockForTransition, getOppositeTransitionDirection } from '../src/screens/gameTransitions';
import { resolveSpawnBlock } from '../src/screens/gameRoom';
import { computeEntranceOffset } from '../src/screens/roomPrewarmNeighborhood';
import { RoomTransitionLoadCoordinator } from '../src/screens/roomTransitionLoadCoordinator';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOMS_DIR = process.env.DW_ROOMS_DIR ?? path.resolve(HERE, '../ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS');

const VP_W = 480, VP_H = 270, SCALE = 1;

// Constants mirrored from the shipped modules so the harness can price the
// parts of a crossing that live outside the coordinator (the RAF loop's
// entry-warm branch and the overlay's own show/fade timing).
const PLAYER_JUMP_SPEED_WORLD = 255.0;         // sim/clusters/movementConstants
const UPWARD_TRANSITION_VY_REDUCTION = 0.5;   // roomTransitionLoadCoordinator
const ENTRY_WARM_SOFT_FRAME_CAP = 8;          // entryViewportWarm
const OVERLAY_MIN_SHOW_MS = 200;              // gameLoadingOverlay (legacy path)
const OVERLAY_STANDARD_FADE_MS = 300;         // gameLoadingOverlay (legacy path)
const OVERLAY_ADAPTIVE_FADE_MS = 80;          // gameLoadingOverlay (adaptive path)
const OVERLAY_ENTRY_WARM_FADE_MS = 80;        // gameLoadingOverlay

// ── CLI ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
/** Whether the overlay uses the legacy fixed 200ms+300ms presentation. */
const LEGACY_OVERLAY_MODE = argv.includes('--legacy-overlay');
/** 'legacy' = pre-fix pre-warm rule, 'swept' = post-fix rule. */
const WARM_RULE = argOf('warm', 'swept') as 'legacy' | 'swept';
const LABEL = argOf('label', WARM_RULE);
/** Simulated background-build completeness: fraction of rooms already resident. */
const RESIDENT_FRACTION = Number(argOf('resident', '1'));

// ── Room registry ─────────────────────────────────────────────────────────────

function loadRegistry(): Map<string, RoomDef> {
  const registry = new Map<string, RoomDef>();
  for (const f of fs.readdirSync(ROOMS_DIR)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8'));
    if (!isSavedRoomV2(raw)) continue;
    const def = roomJsonDefToRoomDef(hydrateV2Room(raw));
    registry.set(def.id, def);
  }
  return registry;
}

// ── Geometry: activation vs pre-warm ─────────────────────────────────────────

interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** Camera clamp, mirroring render/camera.ts clampCameraToRoom. */
function clampedCentre(
  room: RoomDef, sxBlock: number, syBlock: number,
): { cx: number; cy: number } {
  const roomW = room.widthBlocks * BLOCK_SIZE_MEDIUM;
  const roomH = room.heightBlocks * BLOCK_SIZE_MEDIUM;
  const halfW = VP_W / (2 * SCALE);
  const halfH = VP_H / (2 * SCALE);
  let cx = sxBlock * BLOCK_SIZE_MEDIUM;
  let cy = syBlock * BLOCK_SIZE_MEDIUM;
  if (roomW <= halfW * 2) cx = roomW * 0.5;
  else cx = Math.min(Math.max(cx, halfW), roomW - halfW);
  if (roomH <= halfH * 2) cy = roomH * 0.5;
  else cy = Math.min(Math.max(cy, halfH), roomH - halfH);
  return { cx, cy };
}

/** The viewport the renderer actually shows after spawning at (sx, sy). */
function activationRect(room: RoomDef, sx: number, sy: number): Rect {
  const { cx, cy } = clampedCentre(room, sx, sy);
  return {
    minX: cx * SCALE - VP_W / 2, maxX: cx * SCALE + VP_W / 2,
    minY: cy * SCALE - VP_H / 2, maxY: cy * SCALE + VP_H / 2,
  };
}

/** Every spawn the runtime can produce for this directed transition. */
function reachableSpawns(
  sourceRoom: RoomDef, ti: number, targetRoom: RoomDef,
): Array<[number, number]> {
  const t = sourceRoom.transitions[ti];
  const opposite = getOppositeTransitionDirection(t.direction);
  const ret = targetRoom.transitions.find(
    tt => tt.targetRoomId === sourceRoom.id && tt.direction === opposite,
  );
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  const push = (xy: readonly [number, number]): void => {
    const r = resolveSpawnBlock(targetRoom, xy[0], xy[1]);
    const k = `${r[0]},${r[1]}`;
    if (!seen.has(k)) { seen.add(k); out.push([r[0], r[1]]); }
  };
  if (ret === undefined) { push(t.targetSpawnBlock); return out; }
  const steps = Math.max(2, (Math.max(1, ret.openingSizeBlocks - 1)) * 2);
  for (let i = 0; i <= steps; i++) push(computeSpawnBlockForTransition(targetRoom, ret, i / steps));
  return out;
}

/** The region the pre-warm pass covers, under whichever rule is selected. */
function warmedRect(sourceRoom: RoomDef, ti: number, targetRoom: RoomDef): Rect {
  if (WARM_RULE === 'legacy') {
    // Pre-fix: one viewport at the SOURCE transition's authored targetSpawnBlock,
    // with the camera centre left unclamped.
    const off = computeEntranceOffset(sourceRoom.transitions[ti], VP_W, VP_H, SCALE);
    return {
      minX: -off.offsetXPx, maxX: -off.offsetXPx + VP_W,
      minY: -off.offsetYPx, maxY: -off.offsetYPx + VP_H,
    };
  }
  // Post-fix: union of the clamped viewport over every reachable spawn.
  const spawns = reachableSpawns(sourceRoom, ti, targetRoom);
  let r: Rect | null = null;
  for (const [sx, sy] of spawns) {
    const a = activationRect(targetRoom, sx, sy);
    r = r === null ? a : {
      minX: Math.min(r.minX, a.minX), maxX: Math.max(r.maxX, a.maxX),
      minY: Math.min(r.minY, a.minY), maxY: Math.max(r.maxY, a.maxY),
    };
  }
  return r ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.minX >= outer.minX - 1e-6 && inner.maxX <= outer.maxX + 1e-6 &&
  inner.minY >= outer.minY - 1e-6 && inner.maxY <= outer.maxY + 1e-6;

// ── Fakes for the non-geometric ports ────────────────────────────────────────

interface FakePlayer {
  isPlayerFlag: number; isAliveFlag: number;
  velocityXWorld: number; velocityYWorld: number;
}
const makePlayer = (): FakePlayer => ({
  isPlayerFlag: 1, isAliveFlag: 1, velocityXWorld: 0, velocityYWorld: 0,
});
const makeWorld = (builtForRoomId: string, player: FakePlayer | null): WorldState =>
  ({ builtForRoomId, clusters: player === null ? [] : [player] }) as unknown as WorldState;

/**
 * Phase counts for the cold-build generator, scaled by room complexity so the
 * fallback-path measurement reflects real room weight rather than a constant.
 * Mirrors residentWorldBuilder's yield structure: 7 phases on a wall-template
 * hit, plus incremental merge slices when it misses.
 */
function phasesForRoom(room: RoomDef): number {
  const base = 7;
  const mergeSlices = room.bakedWallTemplate !== undefined
    ? 0
    : Math.min(8, Math.floor(room.walls.length / 400));
  return base + mergeSlices;
}

// ── One measured crossing ────────────────────────────────────────────────────

interface CrossingResult {
  key: string;
  sourceRoomId: string;
  targetRoomId: string;
  mode: string;
  missReason: string;
  blockedFrames: number;
  overlayShown: string[];
  entryWarmFrames: number;
  overlayMs: number;
  entryWarmStarted: boolean;
  inlineCloseout: boolean;
  generatorPhases: number;
  activationMs: number;
  velocityPreserved: boolean;
  coverageOk: boolean;
}

function measureCrossing(
  registry: Map<string, RoomDef>,
  sourceRoom: RoomDef,
  ti: number,
  targetRoom: RoomDef,
  opts: { residentReady: boolean; inFlightBuild: boolean; zoneReady: boolean },
): CrossingResult {
  const events: string[] = [];
  const t = sourceRoom.transitions[ti];

  // The spawn a real crossing lands on: mid-opening is the common case.
  const spawns = reachableSpawns(sourceRoom, ti, targetRoom);
  const [spawnX, spawnY] = spawns[Math.floor(spawns.length / 2)];

  const coverageOk = contains(
    warmedRect(sourceRoom, ti, targetRoom),
    activationRect(targetRoom, spawnX, spawnY),
  );

  let currentRoom = sourceRoom;
  let world = makeWorld(sourceRoom.id, makePlayer());
  const targetPlayer = makePlayer();
  const residents = new Map<string, { runtimeReady: boolean; world: WorldState | null }>();
  if (opts.residentReady) {
    residents.set(targetRoom.id, { runtimeReady: true, world: makeWorld(targetRoom.id, targetPlayer) });
  }

  const totalPhases = phasesForRoom(targetRoom);
  let phasesRun = 0;
  let handoffTaken = false;
  const makeGen = (startAt: number): Generator<string, WorldState, void> => {
    function* gen(): Generator<string, WorldState, void> {
      for (let i = startAt; i < totalPhases; i++) { phasesRun++; yield `phase${i}`; }
      return makeWorld(targetRoom.id, targetPlayer);
    }
    return gen();
  };
  // An in-flight background build is ~70% done when the player arrives.
  const inFlightGen = opts.inFlightBuild ? makeGen(Math.floor(totalPhases * 0.7)) : null;

  let entryWarmStarted = false;
  let inlineCloseout = false;
  const overlayShown: string[] = [];

  const deps = {
    registry,
    manager: {
      getResident: (id: string) => residents.get(id),
      ensureResident: () => {}, freezeRoom: () => {}, freezeSimState: () => {},
      invalidateResidentWorld: () => {},
      setResidentWorld: (id: string, w: WorldState) => { residents.set(id, { runtimeReady: true, world: w }); },
      setActiveResidentId: () => {}, recordOutgoingRoom: () => {},
      evictDistantZoneAware: () => {}, recordTransitionMode: (m: string) => { events.push(`mode:${m}`); },
      recordPlayerTransfer: () => {}, scanOwnershipInvariant: () => {},
      getFrozenEnemies: () => null, getFrozenSimState: () => null,
      restoreFrozenEnemies: () => 0, restoreSimState: () => {},
    },
    buildScheduler: {
      getActiveBuild: () => (inFlightGen !== null && !handoffTaken
        ? { roomId: targetRoom.id, phase: 'phaseD_walls_lookup' } : null),
      hasQueuedBuild: () => false,
      refreshFromNeighborhood: () => {},
      takeActiveBuildForTransition: (id: string) => {
        if (inFlightGen === null || handoffTaken || id !== targetRoom.id) return null;
        handoffTaken = true;
        events.push('takeover');
        return {
          roomId: id, gen: inFlightGen, capturedVersion: 0,
          currentPhase: 'phaseD_walls_lookup', startedAtMs: 0,
          reason: 'adjacent', priority: 3,
        };
      },
      isBuildVersionCurrent: () => true,
      getRoomVersion: () => 0,
    },
    zoneLoader: {
      startZoneLoad: () => {}, getZoneRoomIds: () => [], tickZoneLoad: () => true,
      getZoneProgress: () => null, buildZoneRoomIdSet: () => new Set<string>(),
      evictInactiveZoneResidents: () => {},
    },
    overlay: {
      showLoadingOverlay: () => { overlayShown.push('loading'); },
      showEntryWarm: () => { overlayShown.push('entryWarm'); },
      showZoneLoad: () => { overlayShown.push('zoneLoad'); },
      updateZoneProgress: () => {},
    },
    profiler: { begin: () => {}, end: () => {}, isVerbose: () => false },
    levelRng: { s0: 1, s1: 2, s2: 3, s3: 4 },
    getCurrentRoom: () => currentRoom,
    getWorld: () => world,
    setWorld: (w: WorldState) => { world = w; },
    getRoomPreparedState: () => (opts.residentReady ? 'prepared' : 'cold'),
    loadRoomSync: () => {},
    createResidentBuildGenerator: () => makeGen(0),
    capturePlayerTransfer: () => ({ healthPoints: 7, ownedParticles: [], isFacingLeftFlag: 0 }),
    detachPlayerFromWorld: () => {},
    defaultPlayerHealth: 10,
    applyResidentActivation: (room: RoomDef) => {
      currentRoom = room;
      return { particlesRestored: 0, particlesSkipped: 0 };
    },
    canSkipEntryWarm: () => coverageOk,
    resetEntryWarm: () => {},
    startEntryWarm: () => { entryWarmStarted = true; },
    completeEntryCoverageNow: () => { inlineCloseout = true; },
    isZoneReady: () => opts.zoneReady,
    getSeamlessDiagnosticContext: () => ({}),
    getRoomPrewarmReadiness: () => ({ wallPresent: coverageOk, bgPresent: coverageOk, bgRequired: false }),
    getLastAdoptionResult: () => ({ wall: { status: 'adopted' }, bg: { status: 'adopted' } }),
    recordTransitionOutcome: (outcome: string, diag: { missReason: string }) => {
      events.push(`outcome:${outcome}:${diag.missReason}`);
    },
    queueZoneEntryViewportTasks: () => {},
    areRoomSpritesReady: () => true,
    isRoomBackgroundDecodeReady: () => true,
    updateRadiusReadyCounts: () => {},
    isDevMode: false,
  };

  const coord = new RoomTransitionLoadCoordinator(deps as never);

  const VX = 4.25, VY = -1.75;
  const t0 = performance.now();
  coord.submitTransition(targetRoom, spawnX, spawnY, VX, VY, t.direction);
  const activationMs = performance.now() - t0;

  // Step the coordinator the way gameScreen.ts's RAF loop does.
  let blockedFrames = 0;
  for (let f = 0; f < 600 && coord.isBlockingGameplay(); f++) {
    blockedFrames++;
    if (coord.isAsyncLoadActive()) coord.advanceAsyncLoad();
    else if (coord.isZoneTransitionActive()) coord.tickZoneTransition();
  }

  const player = (world as unknown as { clusters: FakePlayer[] }).clusters[0];
  // Upward crossings deliberately subtract half a jump speed
  // (UPWARD_TRANSITION_VY_REDUCTION) so the player is not over-boosted into the
  // room above. That is designed behaviour, not lost momentum, so the expected
  // vy differs for 'up'.
  const expectedVY = t.direction === 'up'
    ? VY - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION
    : VY;
  const velocityPreserved =
    player !== undefined &&
    Math.abs(player.velocityXWorld - VX) < 1e-4 &&
    Math.abs(player.velocityYWorld - expectedVY) < 1e-4;

  // Frames the RAF loop spends held in the entry-warm branch. That branch lives
  // in gameScreen.ts, not the coordinator, so it is modelled here from the
  // shipped budget (ENTRY_WARM_MAX_FRAMES soft cap) rather than measured.
  const entryWarmFrames = entryWarmStarted ? ENTRY_WARM_SOFT_FRAME_CAP : 0;
  // Wall-clock a cover is on screen, from gameLoadingOverlay's own constants.
  let overlayMs = 0;
  for (const kind of overlayShown) {
    if (kind === 'entryWarm') overlayMs += OVERLAY_ENTRY_WARM_FADE_MS;
    else if (kind === 'loading') overlayMs += LEGACY_OVERLAY_MODE
      ? OVERLAY_MIN_SHOW_MS + OVERLAY_STANDARD_FADE_MS
      : OVERLAY_ADAPTIVE_FADE_MS;
  }

  const outcome = events.find(e => e.startsWith('outcome:')) ?? 'outcome:?:?';
  const [, outcomeName, missReason] = outcome.split(':');

  return {
    key: `${sourceRoom.id}:${ti}`,
    sourceRoomId: sourceRoom.id,
    targetRoomId: targetRoom.id,
    mode: outcomeName,
    missReason,
    blockedFrames: blockedFrames + entryWarmFrames,
    entryWarmFrames,
    overlayShown,
    overlayMs,
    entryWarmStarted,
    inlineCloseout,
    generatorPhases: phasesRun,
    activationMs,
    velocityPreserved,
    coverageOk,
  };
}

// ── Scenarios ────────────────────────────────────────────────────────────────

function main(): void {
  const registry = loadRegistry();
  const directed: Array<{ src: RoomDef; ti: number; dst: RoomDef }> = [];
  for (const [, src] of registry) {
    for (let ti = 0; ti < src.transitions.length; ti++) {
      const dst = registry.get(src.transitions[ti].targetRoomId);
      if (dst === undefined) continue;
      if ((dst.worldNumber ?? 1) !== (src.worldNumber ?? 1)) continue; // intra-zone only
      directed.push({ src, ti, dst });
    }
  }

  // Cross-zone crossings, measured separately: before neighbour preloading
  // these always deferred behind a zone-load screen; with the target zone
  // preloaded they should take the ordinary hot-swap path.
  const crossZone: Array<{ src: RoomDef; ti: number; dst: RoomDef }> = [];
  for (const [, src] of registry) {
    for (let ti = 0; ti < src.transitions.length; ti++) {
      const dst = registry.get(src.transitions[ti].targetRoomId);
      if (dst === undefined) continue;
      if ((dst.worldNumber ?? 1) === (src.worldNumber ?? 1)) continue;
      crossZone.push({ src, ti, dst });
    }
  }

  const scenarios: Array<{ name: string; opts: Parameters<typeof measureCrossing>[4] }> = [
    { name: '1. first crossing after zone startup',   opts: { residentReady: true,  inFlightBuild: false, zoneReady: true } },
    { name: '2. A->B->A backtracking (return leg)',   opts: { residentReady: true,  inFlightBuild: false, zoneReady: true } },
    { name: '3. rapid same-zone traversal',           opts: { residentReady: true,  inFlightBuild: false, zoneReady: true } },
    { name: '4. target has an in-progress build',     opts: { residentReady: false, inFlightBuild: true,  zoneReady: true } },
    { name: '5. cold miss (zone barrier not passed)', opts: { residentReady: false, inFlightBuild: false, zoneReady: false } },
  ];

  const out: Record<string, unknown> = { label: LABEL, warmRule: WARM_RULE, directedTransitions: directed.length };

  for (const sc of scenarios) {
    const rows = directed.map(d => measureCrossing(registry, d.src, d.ti, d.dst, sc.opts));
    const n = rows.length;
    const sum = (f: (r: CrossingResult) => number): number => rows.reduce((a, r) => a + f(r), 0);
    const max = (f: (r: CrossingResult) => number): number => Math.max(...rows.map(f));
    out[sc.name] = {
      crossings: n,
      coverageOk: `${rows.filter(r => r.coverageOk).length}/${n}`,
      blockedFrames: { total: sum(r => r.blockedFrames), mean: +(sum(r => r.blockedFrames) / n).toFixed(2), max: max(r => r.blockedFrames) },
      overlayFrames: {
        crossingsWithOverlay: rows.filter(r => r.overlayShown.length > 0).length,
        kinds: rows.flatMap(r => r.overlayShown).reduce<Record<string, number>>((a, k) => { a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      },
      entryWarmCrossings: rows.filter(r => r.entryWarmStarted).length,
      entryWarmFrames: { total: sum(r => r.entryWarmFrames), mean: +(sum(r => r.entryWarmFrames) / n).toFixed(2) },
      overlayVisibleMs: { total: sum(r => r.overlayMs), mean: +(sum(r => r.overlayMs) / n).toFixed(1), max: max(r => r.overlayMs) },
      inlineCloseouts:    rows.filter(r => r.inlineCloseout).length,
      generatorPhases: { total: sum(r => r.generatorPhases), mean: +(sum(r => r.generatorPhases) / n).toFixed(2), max: max(r => r.generatorPhases) },
      activationMs: { mean: +(sum(r => r.activationMs) / n).toFixed(3), max: +max(r => r.activationMs).toFixed(3) },
      velocityPreserved: `${rows.filter(r => r.velocityPreserved).length}/${n}`,
      missReasons: rows.reduce<Record<string, number>>((a, r) => { a[r.missReason] = (a[r.missReason] ?? 0) + 1; return a; }, {}),
      seamless: `${rows.filter(r =>
        r.blockedFrames === 0 && r.overlayShown.length === 0 &&
        !r.entryWarmStarted && r.velocityPreserved).length}/${n}`,
    };
  }

  // Scenario 6: cross-zone, target zone NOT prepared (the old behaviour for
  // every zone boundary) vs prepared by the neighbour preloader.
  for (const [label, zoneReady] of [['6a. cross-zone, target NOT preloaded', false], ['6b. cross-zone, target preloaded', true]] as const) {
    const rows = crossZone.map(d => measureCrossing(registry, d.src, d.ti, d.dst, {
      residentReady: zoneReady, inFlightBuild: false, zoneReady,
    }));
    const n = Math.max(1, rows.length);
    const sum = (f: (r: CrossingResult) => number): number => rows.reduce((a, r) => a + f(r), 0);
    out[label] = {
      crossings: rows.length,
      blockedFrames: { total: sum(r => r.blockedFrames), mean: +(sum(r => r.blockedFrames) / n).toFixed(2) },
      crossingsWithOverlay: rows.filter(r => r.overlayShown.length > 0).length,
      overlayKinds: rows.flatMap(r => r.overlayShown).reduce<Record<string, number>>((a, k) => { a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      overlayVisibleMs: { mean: +(sum(r => r.overlayMs) / n).toFixed(1) },
      velocityPreserved: `${rows.filter(r => r.velocityPreserved).length}/${rows.length}`,
      seamless: `${rows.filter(r =>
        r.blockedFrames === 0 && r.overlayShown.length === 0 &&
        !r.entryWarmStarted && r.velocityPreserved).length}/${rows.length}`,
    };
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
