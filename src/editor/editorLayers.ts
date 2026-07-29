/**
 * Editor layer system — lets the designer show/hide and control edit
 * interaction for categories of authored content, independent of the game's
 * canonical runtime render order.
 *
 * This is an editor-only quality-of-life feature: `EditorLayerState` lives on
 * `EditorState` (not in room JSON), and nothing here changes how a room is
 * dehydrated/hydrated or how the game renders at runtime.
 *
 * A "layer" is a coarse, curated grouping of the much larger set of
 * `SelectedElementType`s (see editorElementTypes.ts) and `PaletteCategory`s
 * (see editorPaletteItems.ts). Every element type and palette item maps to
 * exactly one layer via the tables below, so adding a brand new content type
 * later only requires adding one entry to `ELEMENT_TYPE_LAYER` (and, if it's
 * placeable, one entry to `PALETTE_ITEM_LAYER_OVERRIDES` or
 * `CATEGORY_DEFAULT_LAYER`) rather than touching selection/render call sites.
 */

import { EditorTool, type EditorState, type SelectedElement } from './editorState';
import type { SelectedElementType } from './editorElementTypes';
import type { PaletteCategory, PaletteItem } from './editorPaletteItems';

// ── Layer identity ────────────────────────────────────────────────────────

export type LayerId =
  | 'background'
  | 'terrain'
  | 'foreground'
  | 'dynamicGeometry'
  | 'liquids'
  | 'powder'
  | 'objects'
  | 'hazards'
  | 'enemies'
  | 'fields'
  | 'lighting'
  | 'triggers'
  | 'roomStructure'
  | 'paths'
  | 'editorMetadata'
  | 'debug';

/** Display order for the layers panel — top of the list draws "on top" conceptually. */
export const LAYER_IDS: readonly LayerId[] = [
  'background',
  'terrain',
  'foreground',
  'dynamicGeometry',
  'liquids',
  'powder',
  'objects',
  'hazards',
  'enemies',
  'fields',
  'lighting',
  'triggers',
  'roomStructure',
  'paths',
  'editorMetadata',
  'debug',
];

export const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  background: 'Background',
  terrain: 'Terrain',
  foreground: 'Foreground',
  dynamicGeometry: 'Dynamic Geometry',
  liquids: 'Liquids',
  powder: 'Powder / Dust Motes',
  objects: 'Objects / Interactables',
  hazards: 'Hazards',
  enemies: 'Enemies',
  fields: 'Fields / Zones',
  lighting: 'Lighting / VFX',
  triggers: 'Triggers / Events',
  roomStructure: 'Room / Campaign Structure',
  paths: 'Paths / Guides',
  editorMetadata: 'Editor Metadata',
  debug: 'Debug',
};

// ── Per-layer runtime state ───────────────────────────────────────────────

export interface EditorLayerState {
  visible: boolean;
  locked: boolean;
  /** Solo isolates this layer for visibility purposes (multiple solos allowed). */
  solo: boolean;
  /** When any layer has selectOnly enabled, selection/placement targets only selectOnly layers. */
  selectOnly: boolean;
}

export type EditorLayersState = Record<LayerId, EditorLayerState>;

export function createDefaultEditorLayers(): EditorLayersState {
  const layers = {} as EditorLayersState;
  for (const id of LAYER_IDS) {
    layers[id] = { visible: true, locked: false, solo: false, selectOnly: false };
  }
  return layers;
}

// ── SelectedElementType → layer ──────────────────────────────────────────

const ELEMENT_TYPE_LAYER: Readonly<Record<SelectedElementType, LayerId>> = {
  wall: 'terrain',
  enemy: 'enemies',
  transition: 'roomStructure',
  saveTomb: 'objects',
  skillTomb: 'objects',
  challengeField: 'fields',
  challengeGate: 'fields',
  gate: 'objects',
  challengeTotem: 'objects',
  dustContainer: 'objects',
  dustContainerPiece: 'objects',
  dustBoostJar: 'objects',
  dustSwarm: 'objects',
  lambdaAnchor: 'objects',
  dustPile: 'powder',
  grasshopperArea: 'enemies',
  fireflyArea: 'lighting',
  decoration: 'foreground',
  playerSpawn: 'roomStructure',
  campaignSpawn: 'roomStructure',
  ambientLightBlocker: 'lighting',
  lightSource: 'lighting',
  waterZone: 'liquids',
  lavaZone: 'liquids',
  timeStopField: 'fields',
  crumbleBlock: 'dynamicGeometry',
  spike: 'hazards',
  laser: 'hazards',
  bouncePad: 'dynamicGeometry',
  kineticBlock: 'dynamicGeometry',
  grappleCarryBlock: 'dynamicGeometry',
  zipMoveBlock: 'dynamicGeometry',
  phantasmalTile: 'terrain',
  pixelMaterial: 'powder',
  rope: 'objects',
  sunbeam: 'lighting',
  sceneLight: 'lighting',
  fallingBlock: 'dynamicGeometry',
  dialogueTrigger: 'triggers',
  backgroundBlock: 'background',
  guideDustPath: 'paths',
  customBlock: 'terrain',
  fireflyJar: 'lighting',
  springboard: 'dynamicGeometry',
  breakableBlock: 'dynamicGeometry',
};

export function getLayerForElementType(type: SelectedElementType): LayerId {
  return ELEMENT_TYPE_LAYER[type];
}

// ── PaletteCategory / PaletteItem → layer ────────────────────────────────

const CATEGORY_DEFAULT_LAYER: Readonly<Record<PaletteCategory, LayerId>> = {
  blocks: 'terrain',
  specialBlocks: 'dynamicGeometry',
  enemies: 'enemies',
  triggers: 'roomStructure',
  fields: 'fields',
  gates: 'objects',
  collectables: 'objects',
  environment: 'foreground',
  dust: 'powder',
  liquids: 'liquids',
  objects: 'objects',
  lighting: 'lighting',
  ropes: 'objects',
  guidePaths: 'paths',
  customBlocks: 'terrain',
};

/**
 * Per-item overrides for palette items whose layer differs from their
 * category's default (categories like `blocks`, `specialBlocks`, `triggers`,
 * and `environment` bundle several different layers' worth of content).
 */
const PALETTE_ITEM_LAYER_OVERRIDES: Readonly<Record<string, LayerId>> = {
  spike_1x1: 'hazards',
  spike_2x2: 'hazards',
  laser_emitter: 'hazards',
  phantasmal_block: 'terrain',
  ice_block_1x1: 'terrain',
  ice_block_2x2: 'terrain',
  ultra_ice_block_1x1: 'terrain',
  ultra_ice_block_2x2: 'terrain',
  rocket_block_1x1: 'terrain',
  rocket_block_2x2: 'terrain',
  save_tomb: 'objects',
  dialogue_trigger: 'triggers',
  challenge_field: 'fields',
  grasshopper_area: 'enemies',
  firefly_area: 'lighting',
};

export function getLayerForPaletteItem(item: PaletteItem): LayerId {
  return PALETTE_ITEM_LAYER_OVERRIDES[item.id] ?? CATEGORY_DEFAULT_LAYER[item.category];
}

/**
 * The layer that the current placement action would target, or `null` if the
 * editor is not currently in a state where placement targets any layer.
 *
 * This ONLY returns a layer when `activeTool === EditorTool.Place` AND a
 * palette item is actually selected — it never falls back to `activeCategory`
 * the way the old overloaded "active layer" concept did (that fallback made
 * the layers panel highlight a layer even while using Select/Delete, which
 * misleadingly implied placement was about to happen there). Non-place tools,
 * or Place with no item selected, get `null` — no destination layer, no
 * misleading highlight.
 *
 * Special-cased: ordinary block placement (`blocks` category) can target
 * either Terrain or Background depending on the "Background" placement
 * modifier — the one existing "tile family that spans multiple layers".
 */
export function getPlacementTargetLayer(state: EditorState): LayerId | null {
  if (state.activeTool !== EditorTool.Place) return null;
  const item = state.selectedPaletteItem;
  if (item === null) return null;
  const override = PALETTE_ITEM_LAYER_OVERRIDES[item.id];
  if (override !== undefined) return override;
  if (item.category === 'blocks' && state.pendingBlockPlacementModifier === 'background') {
    return 'background';
  }
  return CATEGORY_DEFAULT_LAYER[item.category];
}

/**
 * The set of layers represented by the current selection — purely
 * informational (drives the layers panel's "contains selection" marker).
 * Never reads or mutates visibility/lock/solo/select-only/selection state.
 */
export function getSelectedElementLayers(state: EditorState): ReadonlySet<LayerId> {
  const layers = new Set<LayerId>();
  for (const el of state.selectedElements) {
    layers.add(getLayerForElementType(el.type));
  }
  return layers;
}

// ── Visibility / lock / solo / select-only queries ───────────────────────

export function isAnyLayerSoloed(state: EditorState): boolean {
  return LAYER_IDS.some(id => state.layers[id].solo);
}

export function isAnySelectOnlyActive(state: EditorState): boolean {
  return LAYER_IDS.some(id => state.layers[id].selectOnly);
}

/** Whether a layer should be drawn in the editor, accounting for solo isolation. */
export function isLayerVisible(state: EditorState, id: LayerId): boolean {
  const layer = state.layers[id];
  if (isAnyLayerSoloed(state)) return layer.solo;
  return layer.visible;
}

export function isLayerLocked(state: EditorState, id: LayerId): boolean {
  return state.layers[id].locked;
}

/** Whether elements on this layer may be selected, moved, deleted, or placed into. */
export function isLayerEditable(state: EditorState, id: LayerId): boolean {
  if (state.layers[id].locked) return false;
  if (!isLayerVisible(state, id)) return false;
  if (isAnySelectOnlyActive(state) && !state.layers[id].selectOnly) return false;
  return true;
}

export function canSelectElementType(state: EditorState, type: SelectedElementType): boolean {
  return isLayerEditable(state, getLayerForElementType(type));
}

// ── Centralized mutation-permission policy ───────────────────────────────
//
// These helpers are the single source of truth for "is this mutation allowed
// right now" — call them from INSIDE the mutation functions themselves
// (placement, deletion, drag-move, resize), not only from mouse-controller
// branches. A controller bug that skips its own gating check must not be able
// to mutate a locked/hidden/select-only-excluded element; the mutation
// function must refuse on its own.

/** Whether an element may currently be placed, moved, resized, or deleted, given its layer. */
export function canMutateElement(state: EditorState, element: Pick<SelectedElement, 'type'>): boolean {
  return isLayerEditable(state, getLayerForElementType(element.type));
}

/** Whether every element in the current selection may currently be mutated. */
export function canMutateSelection(state: EditorState): boolean {
  return state.selectedElements.every(el => canMutateElement(state, el));
}

/** Whether new elements may currently be placed onto the given layer. */
export function canPlaceOnLayer(state: EditorState, layerId: LayerId): boolean {
  return isLayerEditable(state, layerId);
}

// ── Placement block-reason model ─────────────────────────────────────────

export type PlacementBlockReason =
  | 'no-room'
  | 'no-item'
  | 'hidden'
  | 'locked'
  | 'solo-excluded'
  | 'select-only-excluded'
  | 'invalid-location'
  | 'occupied'
  | 'capacity'
  | null;

export interface PlacementStatus {
  targetLayer: LayerId | null;
  allowed: boolean;
  reason: PlacementBlockReason;
}

/**
 * Pure, advisory/UI-only placement-status helper — centralizes "why would
 * placement be blocked right now" for the layers panel, preview styling, and
 * toast feedback. The actual mutation functions (`placeAtCursor`/`placeAt`/
 * `placePixelMaterialAt`) remain the sole authority on whether a placement is
 * actually performed; this never mutates state.
 *
 * `isValidLocation`, if provided, lets a caller fold in a cheap location
 * check (in-bounds, doesn't overlap an existing element, etc.) without this
 * helper duplicating the full placement dispatcher's occupancy/capacity
 * logic — most location-specific reasons (`occupied`, `capacity`) are only
 * distinguished if the caller's predicate reports them; otherwise an invalid
 * location is reported generically as `invalid-location`.
 */
export function getPlacementStatus(
  state: EditorState,
  isValidLocation?: () => boolean | PlacementBlockReason,
): PlacementStatus {
  if (state.roomData === null) return { targetLayer: null, allowed: false, reason: 'no-room' };

  const targetLayer = getPlacementTargetLayer(state);
  if (targetLayer === null) return { targetLayer: null, allowed: false, reason: 'no-item' };

  const layer = state.layers[targetLayer];
  if (!isLayerVisible(state, targetLayer)) {
    return { targetLayer, allowed: false, reason: isAnyLayerSoloed(state) && !layer.solo ? 'solo-excluded' : 'hidden' };
  }
  if (layer.locked) {
    return { targetLayer, allowed: false, reason: 'locked' };
  }
  if (isAnySelectOnlyActive(state) && !layer.selectOnly) {
    return { targetLayer, allowed: false, reason: 'select-only-excluded' };
  }

  if (isValidLocation !== undefined) {
    const result = isValidLocation();
    if (result === false) return { targetLayer, allowed: false, reason: 'invalid-location' };
    if (typeof result === 'string') return { targetLayer, allowed: false, reason: result };
  }

  return { targetLayer, allowed: true, reason: null };
}

/** Human-readable, one-line reason text for toast/tooltip use. */
export function describePlacementBlockReason(reason: PlacementBlockReason, layerId: LayerId | null): string {
  const label = layerId !== null ? LAYER_LABELS[layerId] : 'This layer';
  switch (reason) {
    case 'no-room': return 'No room is loaded.';
    case 'no-item': return 'No placeable item is selected.';
    case 'hidden': return `${label} layer is hidden.`;
    case 'locked': return `${label} layer is locked.`;
    case 'solo-excluded': return `${label} is excluded by Solo mode.`;
    case 'select-only-excluded': return `${label} is outside the current select-only scope.`;
    case 'invalid-location': return 'That location is not valid for placement.';
    case 'occupied': return 'That location is already occupied.';
    case 'capacity': return 'Placement limit reached.';
    case null: return '';
  }
}
