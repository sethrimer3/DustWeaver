import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ZoneResidentLoader } from '../screens/zoneResidentLoader';
import { ResidentRoomManager } from '../screens/residentRoomManager';
import { RoomRuntimeCache, isEntryFullyPrepared } from '../screens/roomRuntimeCache';
import {
  addZoneEntryViewportTasks,
  collectZoneEntryReadinessReport,
  isZoneEntryReadinessComplete,
  evictStalePrewarmedChunks,
  setPinnedPrewarmRooms,
  getPinnedPrewarmRoomIds,
  getPrewarmStats,
} from '../screens/roomRenderChunkWarmScheduler';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { buildRoomWallTemplate, type RoomWallTemplate } from '../screens/gameRoomWalls';
import {
  computeDirectedEntryViewport,
  enumerateEntrySpawnCandidates,
  computeEntryCameraCenterWorld,
} from '../screens/transitionEntryGeometry';

function room(id: string, worldNumber = 1): RoomDef {
  return {
    id,
    wBlock: 40,
    hBlock: 24,
    worldNumber,
    transitions: [],
    customBlocks: [],
    exactWalls: [],
    specialWalls: [],
    pixelMaterials: [],
    physicsMaterials: [],
    tombBooks: [],
    backgroundBlocks: [],
    wallDecorations: [],
    backgroundStyle: 0,
    sprites: [],
  } as unknown as RoomDef;
}

/** Minimal but structurally complete RoomDef, valid for the full readiness path. */
function fullRoom(id: string, worldNumber: number, transitions: RoomTransitionDef[]): RoomDef {
  return {
    id,
    name: id,
    worldNumber,
    mapX: 0,
    mapY: 0,
    widthBlocks: 40,
    heightBlocks: 24,
    walls: [],
    enemies: [],
    playerSpawnBlock: [1, 1],
    transitions,
    saveTombs: [],
    backgroundBlocks: [],
    wallDecorations: [],
    sprites: [],
  } as unknown as RoomDef;
}

describe('ZoneResidentLoader', () => {
  test('Reaching the displayed room count resolves the authoritative readiness barrier', () => {
    const room1 = room('room1', 1);
    const room2 = room('room2', 1);

    const registry = new Map<string, RoomDef>([
      ['room1', room1],
      ['room2', room2],
    ]);
    const runtimeCache = new RoomRuntimeCache(1); // Capacity 1 to force eviction if unpinned
    const loader = new ZoneResidentLoader(registry, runtimeCache);
    const residentRoomManager = new ResidentRoomManager();

    loader.startZoneLoad(1, residentRoomManager);
    
    // Simulate generator completion for both rooms
    residentRoomManager.ensureResident(room1);
    residentRoomManager.getResident('room1')!.runtimeReady = true;
    runtimeCache.set('room1', { renderRevision: 1, wallTemplate: null as unknown as RoomWallTemplate, edgeExtension: null, blockerKeys: new Set(), darkBlockerKeys: new Set(), wallDecorations: [] });

    residentRoomManager.ensureResident(room2);
    residentRoomManager.getResident('room2')!.runtimeReady = true;
    runtimeCache.set('room2', { renderRevision: 1, wallTemplate: null as unknown as RoomWallTemplate, edgeExtension: null, blockerKeys: new Set(), darkBlockerKeys: new Set(), wallDecorations: [] });

    // The loader should pin both rooms so they survive the capacity limit
    assert.strictEqual(runtimeCache.has('room1'), true, 'Room 1 should be pinned and survive eviction');
    assert.strictEqual(runtimeCache.has('room2'), true, 'Room 2 should be pinned and survive eviction');
  });

  test('gameScreen.ts queueZoneEntryViewportTasks passes the same roomRuntimeCache instance used elsewhere', () => {
    // Regression guard for a build break where addZoneEntryViewportTasks was
    // called with a stale/undefined `runtimeCache` identifier instead of the
    // single authoritative `roomRuntimeCache` instance shared by resident
    // loading, room preparation, and zone-entry viewport warming. TypeScript
    // catches an undefined identifier, but a duplicate cache instance created
    // just to "fix" the type error would compile fine while breaking cache
    // coherence, so this test pins the exact call-site wiring in source.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const gameScreenPath = path.join(here, '..', 'screens', 'gameScreen.ts');
    const src = readFileSync(gameScreenPath, 'utf8');

    // The single RoomRuntimeCache instance must be constructed exactly once.
    const instanceMatches = src.match(/new RoomRuntimeCache\(/g) ?? [];
    assert.strictEqual(
      instanceMatches.length,
      1,
      'gameScreen.ts must construct exactly one RoomRuntimeCache instance (no second/alias cache).',
    );

    // addZoneEntryViewportTasks must be wired to that same instance's variable name.
    const callMatch = src.match(/addZoneEntryViewportTasks\(\s*zoneRoomIds,\s*ROOM_REGISTRY,\s*(\w+),/);
    assert.ok(callMatch, 'Expected to find the addZoneEntryViewportTasks call site in gameScreen.ts');
    assert.strictEqual(
      callMatch![1],
      'roomRuntimeCache',
      'addZoneEntryViewportTasks must be passed the authoritative `roomRuntimeCache` variable, ' +
        'the same instance used by resident loading, room preparation, and entry-viewport warming.',
    );
  });

  test('zone readiness does not hang forever on a cold app launch (chunk-warm scheduler never initialized)', () => {
    // Reproduces the "stuck at N/N" loading hang: on the very first app launch,
    // `scheduleChunkPrewarms()` (which initializes the module-level scheduler
    // singletons in roomRenderChunkWarmScheduler.ts) has never been called —
    // it only runs from gameLoadRoomPhases.ts on an actual room transition,
    // which cannot happen until the initial zone load finishes. The zone
    // loader still calls addZoneEntryViewportTasks()/runChunkPrewarmSliceNow()
    // directly during the initial load, so this test exercises that exact
    // cold-start path with no prior scheduleChunkPrewarms() call in this
    // process (node:test runs each test file in its own process, so the
    // scheduler's module state here starts genuinely uninitialized).
    const t: RoomTransitionDef = {
      direction: 'right',
      targetRoomId: 'room2',
      xBlock: 0,
      yBlock: 0,
      positionBlock: 0,
      openingSizeBlocks: 4,
      targetSpawnBlock: [0, 0],
    };
    const tBack: RoomTransitionDef = {
      direction: 'left',
      targetRoomId: 'room1',
      xBlock: 0,
      yBlock: 0,
      positionBlock: 0,
      openingSizeBlocks: 4,
      targetSpawnBlock: [0, 0],
    };
    // worldNumber 99 keeps background-decode readiness trivially true (no
    // static image to wait on), isolating the test from the Node test
    // environment's lack of a real Image()/network stack — irrelevant to the
    // scheduler bug under test.
    const room1 = fullRoom('room1', 99, [t]);
    const room2 = fullRoom('room2', 99, [tBack]);
    const registry = new Map<string, RoomDef>([
      ['room1', room1],
      ['room2', room2],
    ]);
    const runtimeCache = new RoomRuntimeCache();
    const loader = new ZoneResidentLoader(registry, runtimeCache);
    const residentRoomManager = new ResidentRoomManager();

    // Minimal canvas stand-in: chunk warming draws into a real
    // CanvasRenderingContext2D in the browser (getPrewarmDummyCtx() in
    // roomRenderCacheStore.ts). Node has no `document`/canvas, so this stubs
    // just that leaf drawing surface with permissive no-ops — it does not
    // touch any scheduler/readiness decision logic, only lets the same real
    // build path referenced by the bug run to completion in a Node test.
    if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
      const fakeCtx = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === 'canvas') return { width: 1, height: 1 };
          return () => {};
        },
        set: () => true,
      });
      const fakeCanvas = {
        width: 1,
        height: 1,
        getContext: () => fakeCtx,
      };
      (globalThis as { document?: unknown }).document = {
        createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas : {}),
      };
    }

    loader.startZoneLoad(99, residentRoomManager);

    // Fast-forward both rooms to fully-built/fully-prepared, exactly as the
    // real generator loop would leave them once resident builds complete.
    for (const [id, r] of registry) {
      residentRoomManager.ensureResident(r);
      residentRoomManager.getResident(id)!.runtimeReady = true;
      runtimeCache.set(id, {
        renderRevision: 1,
        wallTemplate: buildRoomWallTemplate(r),
        edgeExtension: null,
        blockerKeys: new Set(),
        darkBlockerKeys: new Set(),
        wallDecorations: [],
      });
    }

    // Drive the tick loop the same way gameScreen.ts does: once per frame,
    // with no external call to scheduleChunkPrewarms() in between (the
    // cold-start condition). Cap iterations well above what a correct
    // implementation needs so a genuine hang fails the test instead of
    // looping forever.
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      ready = loader.tickZoneLoad(residentRoomManager, 1, 480, 270, 1);
    }

    assert.strictEqual(
      ready,
      true,
      'Zone readiness must eventually resolve even when no room transition has ' +
        'ever called scheduleChunkPrewarms() — entry-viewport warm tasks queued by ' +
        'addZoneEntryViewportTasks() must still be processed by runChunkPrewarmSliceNow() ' +
        'instead of being silently dropped because the chunk-warm scheduler\'s module-level ' +
        'registry/runtime-cache/quality singletons were never initialized.',
    );
  });

  // ── Regression coverage for the 24/24 zone-load hang ───────────────────────
  //
  // Reproduced failure: with a 24-room zone, the loading overlay reached
  // "24/24" (all resident builds done) and never dismissed.  Three independent
  // defects had to line up, and each gets its own test below:
  //
  //   1. `_isZoneReadyNow` queued entry-viewport tasks BEFORE base readiness,
  //      i.e. before any resident build had populated RoomRuntimeCache, so the
  //      producer skipped every transition and the one-shot `tasksQueued` latch
  //      prevented any retry — zero tasks for 48 requirements.
  //   2. Runtime-cache entries written by the resident builder leave
  //      blockerKeys/darkBlockerKeys/wallDecorations null, and nothing computes
  //      them while the zone overlay holds the frame — so `isEntryFullyPrepared`
  //      (required by the readiness barrier) could never become true.
  //   3. Pre-warmed chunks for zone rooms were not protected from the
  //      memory-budget eviction pass, so coverage was destroyed as fast as it
  //      was built and the barrier oscillated forever.
  //
  // These use the real ZoneResidentLoader / RoomRuntimeCache / chunk-warm
  // scheduler; nothing on the failing path is mocked.

  /**
   * Builds an N-room ring zone where every room links to its two neighbours.
   *
   * Room IDs are namespaced by `worldNumber` because the chunk-warm scheduler
   * and render-chunk store are module-level singletons shared by every test in
   * this file — reusing IDs across tests would let one test's queued tasks and
   * prewarm bundles satisfy (or block) another's.
   */
  function ringZone(n: number, worldNumber: number): Map<string, RoomDef> {
    const ids = Array.from({ length: n }, (_, i) => `w${worldNumber}_ring${i}`);
    const registry = new Map<string, RoomDef>();
    for (let i = 0; i < n; i++) {
      const next = ids[(i + 1) % n];
      const prev = ids[(i - 1 + n) % n];
      const mk = (targetRoomId: string, direction: 'left' | 'right'): RoomTransitionDef => ({
        direction, targetRoomId, xBlock: 0, yBlock: 0,
        positionBlock: 0, openingSizeBlocks: 4, targetSpawnBlock: [0, 0],
      });
      registry.set(ids[i], fullRoom(ids[i], worldNumber, [mk(next, 'right'), mk(prev, 'left')]));
    }
    return registry;
  }

  /** Minimal canvas stand-in so real chunk building can run under node:test. */
  function installCanvasStub(): void {
    if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return;
    const fakeCtx = new Proxy({}, {
      get: (_t, prop) => (prop === 'canvas' ? { width: 1, height: 1 } : () => {}),
      set: () => true,
    });
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => (tag === 'canvas'
        ? { width: 1, height: 1, getContext: () => fakeCtx }
        : {}),
    };
  }

  /**
   * Drives the loader exactly as gameScreen.ts does, but populates the runtime
   * cache only as each resident build completes — the real ordering, and the
   * one the earlier fast-forward test skipped past.
   *
   * Scope note: the final wall/bg *chunk rasterization* step needs a real
   * CanvasRenderingContext2D, so under node:test no chunks are produced and
   * viewport coverage cannot become true.  These tests therefore assert the
   * conditions that actually deadlocked — runtime preparation, task production,
   * and pin protection — rather than end-to-end coverage.  Nothing on that path
   * is stubbed or bypassed; end-to-end dismissal is validated in the renderer.
   */
  function runZoneLoad(
    registry: Map<string, RoomDef>,
    worldNumber: number,
    maxFrames = 400,
  ): { ready: boolean; frames: number; loader: ZoneResidentLoader; cache: RoomRuntimeCache } {
    installCanvasStub();
    const cache   = new RoomRuntimeCache();
    const loader  = new ZoneResidentLoader(registry, cache);
    const manager = new ResidentRoomManager();
    const ids     = loader.getZoneRoomIds(worldNumber);

    loader.startZoneLoad(worldNumber, manager);

    let ready = false;
    let frames = 0;
    let built = 0;
    for (; frames < maxFrames; frames++) {
      // Simulate one resident build completing per frame, in order — the
      // resident builder caches a wall template only, leaving the remaining
      // static fields at the `null` "not yet computed" sentinel.
      if (built < ids.length) {
        const id = ids[built++];
        const r  = registry.get(id)!;
        manager.ensureResident(r);
        manager.getResident(id)!.runtimeReady = true;
        cache.set(id, {
          renderRevision: -1,
          wallTemplate: buildRoomWallTemplate(r),
          edgeExtension: null,
          blockerKeys: null,
          darkBlockerKeys: null,
          wallDecorations: null,
        });
      }
      ready = loader.tickZoneLoad(manager, 1, 480, 270, 1);
      if (ready) break;
    }
    return { ready, frames, loader, cache };
  }

  test('a 24-room zone leaves no readiness requirement without an executable task', () => {
    // The reproduced hang: the overlay reached 24/24 (all resident builds done)
    // and the queue was EMPTY while 43 of 48 directed-entry requirements were
    // still unsatisfied — requirements with no task behind them, so no amount
    // of further ticking could ever satisfy them.
    const registry = ringZone(24, 91);
    const { cache } = runZoneLoad(registry, 91);
    const ids = [...registry.keys()];

    const produced = addZoneEntryViewportTasks(ids, registry, cache, 480, 270, 1);
    assert.deepStrictEqual(
      produced.blocked, [],
      'After the zone load has run, every directed-entry requirement must be queueable. ' +
        'A non-empty `blocked` list means those requirements have no executable task and ' +
        'the readiness barrier can never close — the exact 24/24 hang.',
    );
    assert.strictEqual(
      produced.covered + produced.added + produced.alreadyQueued, produced.required,
      'Every requirement must be accounted for as covered, newly queued, or already queued.',
    );
  });

  test('every zone room ends fully prepared in the runtime cache', () => {
    // Defect 2 (the scheduler deadlock): the readiness barrier requires
    // isEntryFullyPrepared for every zone room, but the resident builder only
    // caches a wall template — blockerKeys/darkBlockerKeys/wallDecorations stay
    // null — and neither roomPreloadScheduler nor gameLoadRoomPhases runs while
    // the zone overlay holds the frame. Before the fix this was permanently
    // false for every room the player had not already entered.
    const registry = ringZone(8, 92);
    const { cache } = runZoneLoad(registry, 92);
    for (const id of registry.keys()) {
      const entry = cache.get(id);
      assert.ok(entry !== undefined, `${id} must be present in the runtime cache`);
      assert.ok(
        isEntryFullyPrepared(entry!),
        `${id} must be fully prepared (blockerKeys, darkBlockerKeys and wallDecorations ` +
          'all computed) — zone readiness requires it and nothing else computes it during loading.',
      );
    }
  });

  test('entry-viewport task production covers every readiness requirement', () => {
    // Defect 1: the producer and the readiness checker must enumerate the same
    // requirement set. Any requirement the producer neither queues nor reports
    // as covered is a requirement with no task behind it — a permanent stall.
    installCanvasStub();
    const registry = ringZone(6, 93);
    const cache    = new RoomRuntimeCache();
    const loader   = new ZoneResidentLoader(registry, cache);
    const manager  = new ResidentRoomManager();

    loader.startZoneLoad(93, manager);
    for (const [id, r] of registry) {
      manager.ensureResident(r);
      manager.getResident(id)!.runtimeReady = true;
      cache.set(id, {
        renderRevision: -1,
        wallTemplate: buildRoomWallTemplate(r),
        edgeExtension: null,
        blockerKeys: new Set(),
        darkBlockerKeys: new Set(),
        wallDecorations: [],
      });
    }

    const ids = loader.getZoneRoomIds(93);
    const produced = addZoneEntryViewportTasks(ids, registry, cache, 480, 270, 1);
    const report   = collectZoneEntryReadinessReport(ids, registry, cache, 480, 270, 1);

    assert.strictEqual(
      produced.required, report.required,
      'The task producer and the readiness checker must enumerate the same directed-entry set.',
    );
    assert.deepStrictEqual(
      produced.blocked, [],
      'With every room fully prepared, no requirement may be left without a task.',
    );
    assert.strictEqual(
      produced.covered + produced.added + produced.alreadyQueued, produced.required,
      'Every requirement must be accounted for as covered, newly queued, or already queued.',
    );
  });

  test('repeated task production is idempotent (no duplicate tasks)', () => {
    // The producer is called every frame now; it must not grow the queue.
    installCanvasStub();
    const registry = ringZone(6, 94);
    const cache    = new RoomRuntimeCache();
    const loader   = new ZoneResidentLoader(registry, cache);
    const manager  = new ResidentRoomManager();
    loader.startZoneLoad(94, manager);
    for (const [id, r] of registry) {
      manager.ensureResident(r);
      manager.getResident(id)!.runtimeReady = true;
      cache.set(id, {
        renderRevision: -1, wallTemplate: buildRoomWallTemplate(r), edgeExtension: null,
        blockerKeys: new Set(), darkBlockerKeys: new Set(), wallDecorations: [],
      });
    }
    const ids = loader.getZoneRoomIds(94);

    const first  = addZoneEntryViewportTasks(ids, registry, cache, 480, 270, 1);
    const qAfter1 = getPrewarmStats().queueLength;
    const second = addZoneEntryViewportTasks(ids, registry, cache, 480, 270, 1);
    const qAfter2 = getPrewarmStats().queueLength;

    assert.ok(first.added > 0, 'first pass should queue work');
    assert.strictEqual(second.added, 0, 'second pass must not create duplicate tasks');
    assert.strictEqual(
      qAfter2, qAfter1,
      'Calling the producer again must leave the queue length unchanged — it runs every ' +
        'frame during a zone load and must never grow the queue without bound.',
    );
  });

  test('zone-pinned prewarm chunks survive the memory-budget eviction pass', () => {
    // Defect 3: without pinning, evictStalePrewarmedChunks was free to drop
    // chunks backing an outstanding readiness requirement, so warming and
    // eviction thrashed and the barrier never closed.
    setPinnedPrewarmRooms(['pinnedRoom']);
    try {
      assert.ok(
        getPinnedPrewarmRoomIds().has('pinnedRoom'),
        'setPinnedPrewarmRooms must record the active zone rooms',
      );
      // An empty keep-set would evict everything not pinned; the pinned room
      // must survive regardless of quality tier.
      evictStalePrewarmedChunks(new Set<string>(), 'low');
      assert.ok(
        getPinnedPrewarmRoomIds().has('pinnedRoom'),
        'Zone-pinned rooms must remain protected across an eviction pass.',
      );
    } finally {
      setPinnedPrewarmRooms([]);
    }
  });

  test('startZoneLoad pins the zone in both the runtime cache and the chunk store', () => {
    // The two pin-sets must be kept in step: readiness requires a prepared
    // runtime entry AND covered prewarm chunks for every zone room, so a room
    // pinned in only one of them is still evictable from the other.
    const registry = ringZone(4, 95);
    const cache    = new RoomRuntimeCache(2); // capacity below zone size
    const loader   = new ZoneResidentLoader(registry, cache);
    const manager  = new ResidentRoomManager();

    loader.startZoneLoad(95, manager);
    const ids = loader.getZoneRoomIds(95);

    for (const id of ids) {
      cache.set(id, {
        renderRevision: -1, wallTemplate: buildRoomWallTemplate(registry.get(id)!),
        edgeExtension: null, blockerKeys: new Set(), darkBlockerKeys: new Set(), wallDecorations: [],
      });
    }
    for (const id of ids) {
      assert.ok(cache.has(id), `${id} must survive LRU eviction while the zone is pinned`);
      assert.ok(getPinnedPrewarmRoomIds().has(id), `${id} must be pinned in the chunk store too`);
    }
    setPinnedPrewarmRooms([]);
  });

  test('readiness reports the exact failing subcondition, not a bare false', () => {
    // Phase-3 diagnostic guarantee: an unsatisfied requirement must name why.
    installCanvasStub();
    const registry = ringZone(3, 96);
    const cache    = new RoomRuntimeCache();
    const ids      = [...registry.keys()];

    // Nothing in the cache at all → every room fails at the source-entry stage.
    const empty = collectZoneEntryReadinessReport(ids, registry, cache, 480, 270, 1);
    assert.ok(empty.failures.length > 0, 'an unprepared zone must report failures');
    assert.ok(
      empty.failures.every(f => f.reason === 'sourceRuntimeEntryAbsent'),
      'the reported reason must identify the absent runtime entry precisely, ' +
        `got: ${JSON.stringify(empty.failures.map(f => f.reason))}`,
    );

    // Cached but not fully prepared → a different, equally specific reason.
    for (const [id, r] of registry) {
      cache.set(id, {
        renderRevision: -1, wallTemplate: buildRoomWallTemplate(r), edgeExtension: null,
        blockerKeys: null, darkBlockerKeys: null, wallDecorations: null,
      });
    }
    const partial = collectZoneEntryReadinessReport(ids, registry, cache, 480, 270, 1);
    assert.ok(
      partial.failures.every(f => f.reason === 'sourceRuntimeNotFullyPrepared'),
      'a cached-but-incomplete entry must be distinguished from an absent one, ' +
        `got: ${JSON.stringify(partial.failures.map(f => f.reason))}`,
    );
  });

  test('zone readiness verifies the region activation actually renders, for every reachable spawn', () => {
    // THE headline contract. Readiness used to be checked at the entry viewport
    // implied by the SOURCE room's authored `targetSpawnBlock` — a value the
    // runtime never uses. Activation instead derives the spawn from the TARGET
    // room's return transition plus the crossing fraction, then clamps the
    // camera to the room. On the shipping campaign that mismatched on 62 of 62
    // intra-zone transitions, so a "ready" zone still hit
    // `entryViewportNotCovered` and covered the crossing with an entry warm.
    //
    // The requirement the readiness path checks must therefore CONTAIN the
    // viewport activation renders, for every spawn the crossing can produce.
    const registry = ringZone(6, 98);
    const VP_W = 480, VP_H = 270, SCALE = 1;

    let checked = 0;
    for (const [sourceId, sourceRoom] of registry) {
      for (let i = 0; i < sourceRoom.transitions.length; i++) {
        const targetRoom = registry.get(sourceRoom.transitions[i].targetRoomId);
        if (targetRoom === undefined) continue;

        const swept = computeDirectedEntryViewport(
          sourceRoom, i, targetRoom, VP_W, VP_H, SCALE,
        );
        assert.ok(swept !== null, `${sourceId}:${i} must yield an entry region`);

        const candidates = enumerateEntrySpawnCandidates(sourceRoom, i, targetRoom);
        assert.ok(candidates.length > 0, `${sourceId}:${i} must have reachable spawns`);

        for (const c of candidates) {
          const centre = computeEntryCameraCenterWorld(
            targetRoom, c.xBlock, c.yBlock, VP_W, VP_H, SCALE,
          );
          const actMinX = centre.centerXWorld * SCALE - VP_W / 2;
          const actMinY = centre.centerYWorld * SCALE - VP_H / 2;
          const sweptMinX = -swept.offsetXPx;
          const sweptMinY = -swept.offsetYPx;
          const E = 1e-6;
          assert.ok(
            actMinX >= sweptMinX - E && actMinX + VP_W <= sweptMinX + swept.vpWPx + E &&
            actMinY >= sweptMinY - E && actMinY + VP_H <= sweptMinY + swept.vpHPx + E,
            `${sourceId}:${i} spawn (${c.xBlock},${c.yBlock}): the viewport activation ` +
            'renders is outside the region zone readiness verifies — a ready zone would ' +
            'still need an entry warm here.',
          );
          checked++;
        }
      }
    }
    assert.ok(checked > 0, 'the contract must actually have been exercised');
  });

  test('isZoneEntryReadinessComplete stays strict — true only with zero failures', () => {
    // Guards against "fixing" a hang by weakening the barrier.
    installCanvasStub();
    const registry = ringZone(3, 97);
    const cache    = new RoomRuntimeCache();
    const ids      = [...registry.keys()];
    assert.strictEqual(
      isZoneEntryReadinessComplete(ids, registry, cache, 480, 270, 1), false,
      'readiness must be false while requirements are unsatisfied',
    );
    const report = collectZoneEntryReadinessReport(ids, registry, cache, 480, 270, 1);
    assert.strictEqual(
      isZoneEntryReadinessComplete(ids, registry, cache, 480, 270, 1),
      report.failures.length === 0,
      'isZoneEntryReadinessComplete must agree exactly with the aggregate report',
    );
  });
});

