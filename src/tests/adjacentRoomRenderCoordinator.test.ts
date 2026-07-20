/**
 * Coverage for the adjacent-room render coordinator
 * (screens/adjacentRoomRenderCoordinator.ts).
 *
 * Verifies: the effective-off path does no neighbour work and returns the empty
 * state; terrain-source resolution preference (valid resident world → baked
 * template → async fallback); wrong-`builtForRoomId` residents are rejected and
 * counted; not-ready neighbours are requested through the async load path; and
 * the layout is cached (rebuilt only on active-room / setting / invalidate).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RoomDef, RoomTransitionDef, RoomWallTemplate, TransitionDirection } from '../levels/roomDef';
import {
  AdjacentRoomRenderCoordinator,
  type AdjacentRoomCoordinatorPorts,
  type ResidentWorldInfo,
} from '../screens/adjacentRoomRenderCoordinator';

function tx(direction: TransitionDirection, targetRoomId: string, xBlock: number, yBlock: number): RoomTransitionDef {
  return { direction, targetRoomId, xBlock, yBlock, positionBlock: 0, openingSizeBlocks: 4, targetSpawnBlock: [xBlock, yBlock] };
}

function room(id: string, transitions: RoomTransitionDef[], baked = false): RoomDef {
  const def: Partial<RoomDef> = {
    id, name: id, worldNumber: 1, mapX: 0, mapY: 0,
    widthBlocks: 40, heightBlocks: 20,
    walls: [], enemies: [], playerSpawnBlock: [1, 1], transitions, saveTombs: [],
  };
  if (baked) def.bakedWallTemplate = {} as RoomWallTemplate;
  return def as RoomDef;
}

interface Harness {
  ports: AdjacentRoomCoordinatorPorts;
  loadRequests: string[];
  registry: Map<string, RoomDef>;
  residents: Map<string, ResidentWorldInfo>;
  enabled: { value: boolean };
}

function makeHarness(rooms: RoomDef[]): Harness {
  const registry = new Map(rooms.map((r) => [r.id, r]));
  const residents = new Map<string, ResidentWorldInfo>();
  const loadRequests: string[] = [];
  const enabled = { value: true };
  const ports: AdjacentRoomCoordinatorPorts = {
    isEffectiveEnabled: () => enabled.value,
    resolveRoomDef: (id) => registry.get(id) ?? null,
    getResidentWorld: (id) => residents.get(id) ?? null,
    requestNeighborLoad: (id) => loadRequests.push(id),
  };
  return { ports, loadRequests, registry, residents, enabled };
}

test('effective-off returns empty state and does no neighbour work', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const h = makeHarness([A, room('B', [])]);
  h.enabled.value = false;
  let lookups = 0;
  const ports = { ...h.ports, resolveRoomDef: (id: string) => { lookups++; return h.registry.get(id) ?? null; } };
  const coord = new AdjacentRoomRenderCoordinator(ports);
  const state = coord.getRenderState(A);
  assert.equal(state.views.length, 0);
  assert.equal(lookups, 0, 'no neighbour lookups when disabled');
  assert.equal(h.loadRequests.length, 0);
});

test('baked wall template makes a neighbour render-ready via wall-template source', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const B = room('B', [tx('left', 'A', 0, 10)], /* baked */ true);
  const h = makeHarness([A, B]);
  const coord = new AdjacentRoomRenderCoordinator(h.ports);
  const state = coord.getRenderState(A);
  assert.equal(state.views.length, 1);
  assert.equal(state.views[0].terrainSource, 'wall-template');
  assert.equal(state.views[0].ready, true);
  assert.ok(state.connectedTargetRoomIds.has('B'));
  assert.equal(h.loadRequests.length, 0, 'ready neighbour is not re-requested');
});

test('valid resident world is preferred over baked template', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const B = room('B', [tx('left', 'A', 0, 10)], true);
  const h = makeHarness([A, B]);
  h.residents.set('B', { builtForRoomId: 'B', runtimeReady: true });
  const coord = new AdjacentRoomRenderCoordinator(h.ports);
  const state = coord.getRenderState(A);
  assert.equal(state.views[0].terrainSource, 'resident-world');
  assert.equal(state.views[0].ready, true);
});

test('wrong builtForRoomId resident is rejected, counted, and load requested', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const B = room('B', [tx('left', 'A', 0, 10)]); // no baked template
  const h = makeHarness([A, B]);
  h.residents.set('B', { builtForRoomId: 'C', runtimeReady: true }); // mismatched geometry
  const coord = new AdjacentRoomRenderCoordinator(h.ports);
  const state = coord.getRenderState(A);
  assert.equal(state.views[0].terrainSource, 'async-fallback');
  assert.equal(state.views[0].ready, false, 'must never draw another room\'s walls');
  assert.ok(!state.connectedTargetRoomIds.has('B'), 'not counted as a rendered destination');
  assert.equal(coord.getDiagnostics().invalidResidentPairings, 1);
  assert.ok(h.loadRequests.includes('B'), 'pending neighbour is requested');
});

test('not-ready neighbour (no template, no resident) is requested and left pending', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const B = room('B', [tx('left', 'A', 0, 10)]); // no baked, no resident
  const h = makeHarness([A, B]);
  const coord = new AdjacentRoomRenderCoordinator(h.ports);
  const state = coord.getRenderState(A);
  assert.equal(state.views[0].ready, false);
  assert.equal(state.views[0].terrainSource, 'async-fallback');
  assert.ok(h.loadRequests.includes('B'));
});

test('missing target room is requested through the async load path', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const h = makeHarness([A]); // B not in registry
  const coord = new AdjacentRoomRenderCoordinator(h.ports);
  const state = coord.getRenderState(A);
  assert.equal(state.views.length, 0);
  assert.ok(h.loadRequests.includes('B'), 'missing neighbour scheduled for load');
});

test('render state is cached and rebuilt only on active-room / invalidate change', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const B = room('B', [tx('left', 'A', 0, 10)], true);
  const C = room('C', [], true);
  const h = makeHarness([A, B, C]);
  const coord = new AdjacentRoomRenderCoordinator(h.ports);

  const s1 = coord.getRenderState(A);
  const s2 = coord.getRenderState(A);
  assert.equal(s1, s2, 'same object returned without rebuild');
  assert.equal(coord.getDiagnostics().rebuildCount, 1);

  coord.invalidate();
  const s3 = coord.getRenderState(A);
  assert.notEqual(s1, s3, 'invalidate forces a rebuild');
  assert.equal(coord.getDiagnostics().rebuildCount, 2);

  // A different active room rebuilds too.
  coord.getRenderState(C);
  assert.equal(coord.getDiagnostics().rebuildCount, 3);
});

test('toggling the setting off after being on clears to the empty state', () => {
  const A = room('A', [tx('right', 'B', 39, 10)]);
  const B = room('B', [tx('left', 'A', 0, 10)], true);
  const h = makeHarness([A, B]);
  const coord = new AdjacentRoomRenderCoordinator(h.ports);
  assert.equal(coord.getRenderState(A).views.length, 1);
  h.enabled.value = false;
  assert.equal(coord.getRenderState(A).views.length, 0);
  assert.equal(coord.getDiagnostics().enabled, false);
});
