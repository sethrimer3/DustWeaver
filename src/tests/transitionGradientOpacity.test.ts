/**
 * Regression tests for custom room-transition gradient color/opacity.
 *
 * Covers: JSON/compact-schema round trips, legacy-default behavior (no
 * opacity field == fully opaque), clamping of malformed/out-of-range values,
 * editor property-change validation, and exact canvas gradient-stop alpha
 * values produced by drawTunnelDarkness for every transition direction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';
import type { RoomJsonDef, RoomJsonTransition } from '../editor/roomJsonSchema';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';
import { clampGradientOpacity, drawTunnelDarkness } from '../screens/gameRoomHelpers';
import { applyPropertyToElement } from '../editor/editorPropertyChange';
import type { EditorRoomData, EditorTransition, SelectedElement } from '../editor/editorElementTypes';

function makeMinimalRoomJson(overrides: Partial<RoomJsonDef> = {}): RoomJsonDef {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 12,
    playerSpawnBlock: [1, 1],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    skillTombs: [],
    ...overrides,
  };
}

function makeTransition(overrides: Partial<RoomJsonTransition> = {}): RoomJsonTransition {
  return {
    direction: 'right',
    positionBlock: 4,
    openingSizeBlocks: 6,
    targetRoomId: 'other_room',
    targetSpawnBlock: [3, 3],
    xBlock: 5,
    yBlock: 5,
    ...overrides,
  };
}

// ── clampGradientOpacity ────────────────────────────────────────────────────

test('clampGradientOpacity defaults to 1 (opaque) when unset', () => {
  assert.equal(clampGradientOpacity(undefined), 1);
});

test('clampGradientOpacity clamps out-of-range and non-finite values', () => {
  assert.equal(clampGradientOpacity(-0.5), 0);
  assert.equal(clampGradientOpacity(1.5), 1);
  assert.equal(clampGradientOpacity(NaN), 1);
  assert.equal(clampGradientOpacity(0.42), 0.42);
});

// ── JSON -> RoomDef ──────────────────────────────────────────────────────────

test('legacy transition with no gradientOpacity hydrates to fully opaque behavior', () => {
  const json = makeMinimalRoomJson({ transitions: [makeTransition()] });
  const room = roomJsonDefToRoomDef(json);
  assert.equal(room.transitions[0].gradientOpacity, undefined);
  assert.equal(clampGradientOpacity(room.transitions[0].gradientOpacity), 1);
});

test('explicit gradientOpacity flows through JSON -> RoomDef', () => {
  const json = makeMinimalRoomJson({ transitions: [makeTransition({ gradientOpacity: 0.3, fadeColor: '#336699' })] });
  const room = roomJsonDefToRoomDef(json);
  assert.equal(room.transitions[0].gradientOpacity, 0.3);
  assert.equal(room.transitions[0].fadeColor, '#336699');
});

// ── Compact schema (dehydrate/hydrate) round trip ───────────────────────────

function roomJsonForCompact(transitions: RoomJsonTransition[]) {
  return makeMinimalRoomJson({ transitions });
}

test('compact schema omits gradientOpacity when equal to default (1)', () => {
  const json = roomJsonForCompact([makeTransition({ fadeColor: '#112233', gradientOpacity: 1 })]);
  const saved = dehydrateRoom(json);
  assert.equal(saved.transitions?.[0].fadeOpacity, undefined);
});

test('compact schema round-trips a non-default gradientOpacity', () => {
  const json = roomJsonForCompact([makeTransition({ fadeColor: '#112233', gradientOpacity: 0.6 })]);
  const saved = dehydrateRoom(json);
  assert.equal(saved.transitions?.[0].fadeOpacity, 0.6);

  const rehydrated = hydrateV2Room(saved);
  assert.equal(rehydrated.transitions[0].gradientOpacity, 0.6);
  assert.equal(rehydrated.transitions[0].fadeColor, '#112233');
});

test('compact schema round-trips a legacy transition (no opacity field) as fully opaque', () => {
  const json = roomJsonForCompact([makeTransition({ fadeColor: '#112233' })]);
  const saved = dehydrateRoom(json);
  assert.equal(saved.transitions?.[0].fadeOpacity, undefined);

  const rehydrated = hydrateV2Room(saved);
  assert.equal(rehydrated.transitions[0].gradientOpacity, undefined);
  assert.equal(clampGradientOpacity(rehydrated.transitions[0].gradientOpacity), 1);
});

// ── Editor property-change validation/normalization ─────────────────────────

function makeEditorRoomData(transition: EditorTransition): EditorRoomData {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 12,
    playerSpawnBlock: [1, 1],
    interiorWalls: [],
    enemies: [],
    transitions: [transition],
    saveTombs: [],
  } as unknown as EditorRoomData;
}

function makeEditorTransition(overrides: Partial<EditorTransition> = {}): EditorTransition {
  return {
    uid: 1,
    direction: 'right',
    xBlock: 5,
    yBlock: 5,
    openingSizeBlocks: 6,
    targetRoomId: 'other_room',
    targetSpawnBlock: [0, 0],
    positionBlock: 5,
    ...overrides,
  } as EditorTransition;
}

test('editor property change clamps gradientOpacity into 0..1', () => {
  const trans = makeEditorTransition();
  const roomData = makeEditorRoomData(trans);
  const el: SelectedElement = { type: 'transition', uid: 1 };

  applyPropertyToElement(roomData, el, 'transition.gradientOpacity', 1.7);
  assert.equal(roomData.transitions[0].gradientOpacity, 1);

  applyPropertyToElement(roomData, el, 'transition.gradientOpacity', -0.2);
  assert.equal(roomData.transitions[0].gradientOpacity, 0);

  applyPropertyToElement(roomData, el, 'transition.gradientOpacity', 0.5);
  assert.equal(roomData.transitions[0].gradientOpacity, 0.5);
});

test('editor property change falls back to black for malformed custom fadeColor', () => {
  const trans = makeEditorTransition();
  const roomData = makeEditorRoomData(trans);
  const el: SelectedElement = { type: 'transition', uid: 1 };

  applyPropertyToElement(roomData, el, 'transition.fadeColor', 'not-a-color');
  assert.equal(roomData.transitions[0].fadeColor, '#000000');

  applyPropertyToElement(roomData, el, 'transition.fadeColor', '#AABBCC');
  assert.equal(roomData.transitions[0].fadeColor, '#AABBCC');
});

// ── Canvas gradient-stop alpha values ────────────────────────────────────────

class FakeGradient {
  stops: { offset: number; color: string }[] = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

class FakeCtx {
  gradients: FakeGradient[] = [];
  fillStyle: unknown = null;
  save(): void {}
  restore(): void {}
  createLinearGradient(): FakeGradient {
    const g = new FakeGradient();
    this.gradients.push(g);
    return g;
  }
  fillRect(): void {}
}

function roomWithTransition(t: Partial<RoomJsonTransition> & { direction: 'left' | 'right' | 'up' | 'down' }) {
  return {
    widthBlocks: 20,
    transitions: [{
      direction: t.direction,
      xBlock: t.xBlock ?? 5,
      yBlock: t.yBlock ?? 5,
      openingSizeBlocks: t.openingSizeBlocks ?? 4,
      gradientWidthBlocks: t.gradientWidthBlocks ?? 3,
      fadeColor: t.fadeColor,
      gradientOpacity: t.gradientOpacity,
    }],
  };
}

for (const direction of ['left', 'right', 'up', 'down'] as const) {
  test(`drawTunnelDarkness uses custom color + exact opacity alpha stop for ${direction}`, () => {
    const ctx = new FakeCtx();
    const room = roomWithTransition({ direction, fadeColor: '#FF8000', gradientOpacity: 0.25 });
    drawTunnelDarkness(ctx as unknown as CanvasRenderingContext2D, room, 0, 0, 1);

    assert.equal(ctx.gradients.length, 1);
    const stops = ctx.gradients[0].stops;
    const opaqueStop = stops.find(s => s.color.endsWith(',0.25)'));
    const transparentStop = stops.find(s => s.color.endsWith(',0)'));
    assert.ok(opaqueStop, `expected an alpha-0.25 stop, got: ${JSON.stringify(stops)}`);
    assert.equal(opaqueStop!.color, 'rgba(255,128,0,0.25)');
    assert.ok(transparentStop, `expected an alpha-0 stop, got: ${JSON.stringify(stops)}`);
    assert.equal(transparentStop!.color, 'rgba(255,128,0,0)');
  });

  test(`drawTunnelDarkness defaults to fully opaque black for legacy ${direction} transition`, () => {
    const ctx = new FakeCtx();
    const room = roomWithTransition({ direction });
    drawTunnelDarkness(ctx as unknown as CanvasRenderingContext2D, room, 0, 0, 1);

    const stops = ctx.gradients[0].stops;
    const opaqueStop = stops.find(s => s.color.endsWith(',1)'));
    assert.ok(opaqueStop);
    assert.equal(opaqueStop!.color, 'rgba(0,0,0,1)');
  });
}
