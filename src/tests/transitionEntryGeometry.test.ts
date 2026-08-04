/**
 * transitionEntryGeometry.test.ts — the seamless-transition readiness contract.
 *
 * The property under test: the entry viewport that zone readiness verifies must
 * contain the entry viewport that activation actually renders, for EVERY
 * reachable crossing of a directed transition.  When that failed to hold, a
 * zone reported ready and `canSkipEntryWarm()` still returned false, which is
 * what produced an entry-warm cover on ordinary intra-zone crossings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  enumerateEntrySpawnCandidates,
  computeSweptEntryViewport,
  computeDirectedEntryViewport,
  computeEntryCameraCenterWorld,
  findReturnTransition,
} from '../screens/transitionEntryGeometry';
import { computeSpawnBlockForTransition } from '../screens/gameTransitions';
import { resolveSpawnBlock } from '../screens/gameRoom';

const VP_W = 480, VP_H = 270;

function makeTransition(p: Partial<RoomTransitionDef> & {
  direction: RoomTransitionDef['direction'];
  targetRoomId: string;
}): RoomTransitionDef {
  return {
    direction: p.direction,
    positionBlock: p.positionBlock ?? 10,
    openingSizeBlocks: p.openingSizeBlocks ?? 6,
    targetRoomId: p.targetRoomId,
    targetSpawnBlock: p.targetSpawnBlock ?? [3, 10],
    ...p,
  } as RoomTransitionDef;
}

function makeRoom(
  id: string,
  widthBlocks: number,
  heightBlocks: number,
  transitions: RoomTransitionDef[],
  opts: { walls?: RoomDef['walls']; worldNumber?: number } = {},
): RoomDef {
  return {
    id,
    name: id,
    worldNumber: opts.worldNumber ?? 1,
    widthBlocks,
    heightBlocks,
    walls: opts.walls ?? [],
    enemies: [],
    transitions,
    backgroundBlocks: [],
  } as unknown as RoomDef;
}

/** The offset the renderer uses for a given spawn — the ground truth. */
function activationOffset(
  room: RoomDef, sx: number, sy: number, scale: number,
): { x: number; y: number } {
  const c = computeEntryCameraCenterWorld(room, sx, sy, VP_W, VP_H, scale);
  return { x: VP_W / 2 - c.centerXWorld * scale, y: VP_H / 2 - c.centerYWorld * scale };
}

/** Does the swept rect contain the single viewport at `offset`? */
function sweptContains(
  swept: { offsetXPx: number; offsetYPx: number; vpWPx: number; vpHPx: number },
  offset: { x: number; y: number },
): boolean {
  // World-space span visible through a viewport at `offset` is
  // [-offset, -offset + vp] (in scaled px). Containment is on that span.
  const sMinX = -swept.offsetXPx, sMaxX = -swept.offsetXPx + swept.vpWPx;
  const sMinY = -swept.offsetYPx, sMaxY = -swept.offsetYPx + swept.vpHPx;
  const aMinX = -offset.x, aMaxX = -offset.x + VP_W;
  const aMinY = -offset.y, aMaxY = -offset.y + VP_H;
  // Allow sub-pixel float slack.
  const E = 1e-6;
  return aMinX >= sMinX - E && aMaxX <= sMaxX + E
      && aMinY >= sMinY - E && aMaxY <= sMaxY + E;
}

// ── The core contract ────────────────────────────────────────────────────────

test('swept entry viewport contains the activation viewport for every reachable spawn', () => {
  // A left-facing return transition with a wide opening: the spawn slides
  // along the doorway with the crossing fraction, which is precisely the case
  // the old single-point `targetSpawnBlock` assumption could not represent.
  const target = makeRoom('target', 200, 200, [
    makeTransition({ direction: 'left', targetRoomId: 'source', positionBlock: 40, openingSizeBlocks: 8 }),
  ]);
  const source = makeRoom('source', 200, 200, [
    makeTransition({ direction: 'right', targetRoomId: 'target', positionBlock: 40, openingSizeBlocks: 8 }),
  ]);

  for (const scale of [1, 2]) {
    const swept = computeDirectedEntryViewport(source, 0, target, VP_W, VP_H, scale);
    assert.ok(swept !== null, 'swept viewport computed');

    const candidates = enumerateEntrySpawnCandidates(source, 0, target);
    assert.ok(candidates.length > 1, 'spawn genuinely varies along the opening');

    for (const c of candidates) {
      assert.ok(
        sweptContains(swept, activationOffset(target, c.xBlock, c.yBlock, scale)),
        `scale=${scale} spawn=(${c.xBlock},${c.yBlock}) not contained in swept region`,
      );
    }
  }
});

test('candidate enumeration reproduces the runtime spawn derivation exactly', () => {
  const target = makeRoom('target', 120, 120, [
    makeTransition({ direction: 'down', targetRoomId: 'source', positionBlock: 20, openingSizeBlocks: 5 }),
  ]);
  const source = makeRoom('source', 120, 120, [
    makeTransition({ direction: 'up', targetRoomId: 'target', positionBlock: 20, openingSizeBlocks: 5 }),
  ]);
  const ret = findReturnTransition('source', source.transitions[0], target);
  assert.ok(ret !== undefined, 'return transition found by opposite-direction rule');

  const candidates = enumerateEntrySpawnCandidates(source, 0, target);
  const asKeys = new Set(candidates.map(c => `${c.xBlock},${c.yBlock}`));

  // Every spawn the gameplay path can produce must be in the candidate set.
  for (const frac of [0, 0.1, 0.33, 0.5, 0.67, 0.9, 1]) {
    const raw = computeSpawnBlockForTransition(target, ret, frac);
    const resolved = resolveSpawnBlock(target, raw[0], raw[1]);
    assert.ok(
      asKeys.has(`${resolved[0]},${resolved[1]}`),
      `runtime spawn (${resolved[0]},${resolved[1]}) at fraction ${frac} missing from candidates`,
    );
  }
});

test('all four entry directions produce contained, bounded swept regions', () => {
  const dirs = [
    { out: 'right' as const, back: 'left'  as const },
    { out: 'left'  as const, back: 'right' as const },
    { out: 'up'    as const, back: 'down'  as const },
    { out: 'down'  as const, back: 'up'    as const },
  ];
  for (const { out, back } of dirs) {
    const target = makeRoom('target', 150, 150, [
      makeTransition({ direction: back, targetRoomId: 'source', positionBlock: 30, openingSizeBlocks: 6 }),
    ]);
    const source = makeRoom('source', 150, 150, [
      makeTransition({ direction: out, targetRoomId: 'target', positionBlock: 30, openingSizeBlocks: 6 }),
    ]);
    const swept = computeDirectedEntryViewport(source, 0, target, VP_W, VP_H, 1);
    assert.ok(swept !== null, `${out}: swept computed`);
    for (const c of enumerateEntrySpawnCandidates(source, 0, target)) {
      assert.ok(
        sweptContains(swept, activationOffset(target, c.xBlock, c.yBlock, 1)),
        `${out}: spawn (${c.xBlock},${c.yBlock}) not contained`,
      );
    }
    // Bounded: never more than the viewport plus the doorway span.
    const maxGrowth = 6 * BLOCK_SIZE_MEDIUM + BLOCK_SIZE_MEDIUM;
    assert.ok(swept.vpWPx <= VP_W + maxGrowth, `${out}: width growth bounded`);
    assert.ok(swept.vpHPx <= VP_H + maxGrowth, `${out}: height growth bounded`);
  }
});

test('two alternative transitions into the same room get independent entry regions', () => {
  const target = makeRoom('target', 200, 200, [
    makeTransition({ direction: 'left', targetRoomId: 'source', positionBlock: 10, openingSizeBlocks: 4 }),
    makeTransition({ direction: 'down', targetRoomId: 'source', positionBlock: 150, openingSizeBlocks: 4 }),
  ]);
  const source = makeRoom('source', 200, 200, [
    makeTransition({ direction: 'right', targetRoomId: 'target', positionBlock: 10, openingSizeBlocks: 4 }),
    makeTransition({ direction: 'up', targetRoomId: 'target', positionBlock: 150, openingSizeBlocks: 4 }),
  ]);
  const a = computeDirectedEntryViewport(source, 0, target, VP_W, VP_H, 1);
  const b = computeDirectedEntryViewport(source, 1, target, VP_W, VP_H, 1);
  assert.ok(a !== null && b !== null);
  // Different doorways into the same room must not collapse to one region;
  // treating them as interchangeable is how a backtrack entry ends up uncovered.
  assert.notDeepEqual(
    { x: a.offsetXPx, y: a.offsetYPx },
    { x: b.offsetXPx, y: b.offsetYPx },
    'distinct doorways yield distinct entry regions',
  );
  for (const [idx, swept] of [[0, a], [1, b]] as const) {
    for (const c of enumerateEntrySpawnCandidates(source, idx, target)) {
      assert.ok(
        sweptContains(swept, activationOffset(target, c.xBlock, c.yBlock, 1)),
        `transition ${idx}: spawn (${c.xBlock},${c.yBlock}) not contained`,
      );
    }
  }
});

// ── Camera clamp parity ──────────────────────────────────────────────────────

test('entry camera centre mirrors clampCameraToRoom, including the small-room branch', () => {
  const big = makeRoom('big', 200, 200, []);
  // Spawn hard against the left/top edge: the clamp must push the centre in by
  // half a viewport rather than leaving it centred on the spawn.
  const c1 = computeEntryCameraCenterWorld(big, 0, 0, VP_W, VP_H, 1);
  assert.equal(c1.centerXWorld, VP_W / 2);
  assert.equal(c1.centerYWorld, VP_H / 2);

  // Spawn hard against the right/bottom edge.
  const roomW = 200 * BLOCK_SIZE_MEDIUM, roomH = 200 * BLOCK_SIZE_MEDIUM;
  const c2 = computeEntryCameraCenterWorld(big, 199, 199, VP_W, VP_H, 1);
  assert.equal(c2.centerXWorld, roomW - VP_W / 2);
  assert.equal(c2.centerYWorld, roomH - VP_H / 2);

  // Interior spawn: unclamped, centred on the player.
  const c3 = computeEntryCameraCenterWorld(big, 100, 100, VP_W, VP_H, 1);
  assert.equal(c3.centerXWorld, 100 * BLOCK_SIZE_MEDIUM);
  assert.equal(c3.centerYWorld, 100 * BLOCK_SIZE_MEDIUM);

  // Room narrower than the viewport: centre the ROOM, ignoring the spawn.
  const small = makeRoom('small', 10, 10, []);
  const c4 = computeEntryCameraCenterWorld(small, 9, 0, VP_W, VP_H, 1);
  assert.equal(c4.centerXWorld, (10 * BLOCK_SIZE_MEDIUM) * 0.5);
  assert.equal(c4.centerYWorld, (10 * BLOCK_SIZE_MEDIUM) * 0.5);
});

test('zoom changes the clamp margin and the swept region tracks it', () => {
  const target = makeRoom('target', 200, 200, [
    makeTransition({ direction: 'left', targetRoomId: 'source', positionBlock: 40, openingSizeBlocks: 6 }),
  ]);
  const source = makeRoom('source', 200, 200, [
    makeTransition({ direction: 'right', targetRoomId: 'target', positionBlock: 40, openingSizeBlocks: 6 }),
  ]);
  // At zoom 2 the visible world span halves, so a boundary spawn is clamped
  // less far in. A region computed for zoom 1 would be wrong for zoom 2 — the
  // reason scale is part of the directed-entry identity.
  const s1 = computeDirectedEntryViewport(source, 0, target, VP_W, VP_H, 1)!;
  const s2 = computeDirectedEntryViewport(source, 0, target, VP_W, VP_H, 2)!;
  // The covered WORLD span differs even where the pixel offset coincides (a
  // left-clamped entry pins the visible span to world x=0 at any zoom), so
  // compare in world units — that is what the chunk cache must cover.
  const worldSpan1 = s1.vpWPx / 1;
  const worldSpan2 = s2.vpWPx / 2;
  assert.notEqual(worldSpan1, worldSpan2, 'covered world span depends on zoom');
  for (const c of enumerateEntrySpawnCandidates(source, 0, target)) {
    assert.ok(sweptContains(s2, activationOffset(target, c.xBlock, c.yBlock, 2)));
  }
});

// ── Degenerate / defensive cases ─────────────────────────────────────────────

test('one-way link falls back to the authored spawn hint, matching the runtime', () => {
  // No return transition: `checkRoomTransitions` warns and uses targetSpawnBlock.
  const target = makeRoom('target', 100, 100, []);
  const source = makeRoom('source', 100, 100, [
    makeTransition({ direction: 'right', targetRoomId: 'target', targetSpawnBlock: [5, 20] }),
  ]);
  const candidates = enumerateEntrySpawnCandidates(source, 0, target);
  assert.equal(candidates.length, 1);
  assert.deepEqual(
    [candidates[0].xBlock, candidates[0].yBlock],
    [...resolveSpawnBlock(target, 5, 20)],
  );
});

test('invalid transition index and empty candidate sets are handled, not thrown', () => {
  const target = makeRoom('target', 100, 100, []);
  const source = makeRoom('source', 100, 100, []);
  assert.deepEqual(enumerateEntrySpawnCandidates(source, 0, target), []);
  assert.equal(computeDirectedEntryViewport(source, 0, target, VP_W, VP_H, 1), null);
  assert.equal(computeSweptEntryViewport([], VP_W, VP_H, 1), null);
});

// ── Spawn resolution locality ────────────────────────────────────────────────

test('a blocked doorway spawn resolves to a NEARBY block, not across the room', () => {
  // `findOpenSpawnBlock`'s room-wide top-left scan used to run whenever a
  // doorway spawn landed in geometry, teleporting the player to the far side of
  // the room on an ordinary crossing (measured: 8 of 62 campaign entries moved
  // by up to 194 blocks). It also blew up the swept entry region, since the
  // outlier had to be covered too.
  const wallAt = (x: number, y: number): unknown => ({
    xBlock: x, yBlock: y, wBlock: 1, hBlock: 1,
    isPlatformFlag: 0, isInvisibleFlag: 0, isPillarHalfWidthFlag: 0,
  });
  // Solid 3x3 patch around the intended spawn; open ground just outside it.
  const walls: unknown[] = [];
  for (let x = 39; x <= 41; x++) for (let y = 39; y <= 41; y++) walls.push(wallAt(x, y));
  const room = makeRoom('r', 100, 100, [], { walls: walls as RoomDef['walls'] });

  const [rx, ry] = resolveSpawnBlock(room, 40, 40);
  const distance = Math.max(Math.abs(rx - 40), Math.abs(ry - 40));
  assert.ok(distance > 0, 'the blocked block itself is rejected');
  assert.ok(
    distance <= 4,
    `resolved spawn (${rx},${ry}) is ${distance} blocks away — must stay local to the doorway`,
  );
});

test('an already-open spawn is returned unchanged', () => {
  const room = makeRoom('r', 100, 100, []);
  assert.deepEqual([...resolveSpawnBlock(room, 40, 40)], [40, 40]);
});

test('single candidate yields exactly the single viewport (no gratuitous growth)', () => {
  const room = makeRoom('r', 200, 200, []);
  const swept = computeSweptEntryViewport([{ xBlock: 100, yBlock: 100 }], VP_W, VP_H, 1, room);
  assert.ok(swept !== null);
  assert.equal(swept.vpWPx, VP_W);
  assert.equal(swept.vpHPx, VP_H);
});
