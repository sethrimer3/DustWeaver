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

import { EditorTool, type EditorState } from './editorState';
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
  gates: 'objects',
  collectables: 'objects',
  environment: 'foreground',
  dust: 'powder',
  liquids: 'liquids',
  timeStop: 'fields',
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
 * The layer that the current palette/tool selection targets. This drives the
 * active-layer highlight in the layers panel, and gates placement.
 *
 * Special-cased: ordinary block placement (`blocks` category) can target
 * either Terrain or Background depending on the "Background" placement
 * modifier — the one existing "tile family that spans multiple layers".
 */
export function getActiveLayerId(state: EditorState): LayerId {
  const item = state.selectedPaletteItem;
  if (state.activeTool === EditorTool.Place && item !== null) {
    const override = PALETTE_ITEM_LAYER_OVERRIDES[item.id];
    if (override !== undefined) return override;
    if (item.category === 'blocks' && state.pendingBlockPlacementModifier === 'background') {
      return 'background';
    }
    return CATEGORY_DEFAULT_LAYER[item.category];
  }
  return CATEGORY_DEFAULT_LAYER[state.activeCategory] ?? 'terrain';
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

/**
 * Called whenever the active tool/category/palette item changes. If the
 * layer the new selection targets is currently invisible, reveals it (joining
 * the solo set if one is active, or simply un-hiding it otherwise) so the
 * designer can immediately place into it — per "hidden active layer"
 * auto-reveal UX rather than a silent no-op or requiring a manual toggle.
 */
export function ensureActiveLayerVisible(state: EditorState): void {
  const id = getActiveLayerId(state);
  const layer = state.layers[id];
  if (isAnyLayerSoloed(state)) {
    if (!layer.solo) layer.solo = true;
  } else if (!layer.visible) {
    layer.visible = true;
  }
}

/** Whether the active layer (current tool/palette target) is locked — placement should be blocked. */
export function isActiveLayerLocked(state: EditorState): boolean {
  return isLayerLocked(state, getActiveLayerId(state));
}
