/**
 * editorPaletteItems.ts — the editor's Place-tool palette.
 *
 * Extracted from editorDropdownData.ts so that the palette contract (which
 * items exist, and what each one places) can be imported by tests and other
 * non-browser code. editorDropdownData.ts pulls in the folder block-theme
 * catalogue, which relies on Vite's `import.meta.glob` and therefore cannot be
 * loaded outside a bundler.
 *
 * editorDropdownData.ts re-exports everything here, so existing imports are
 * unaffected.
 */

import type { BlockTheme } from '../levels/roomDef';

export const PALETTE_CATEGORIES = [
  'blocks',
  'specialBlocks',
  'enemies',
  'triggers',
  'fields',
  'gates',
  'collectables',
  'environment',
  'dust',
  'liquids',
  'objects',
  'lighting',
  'ropes',
  'guidePaths',
  'customBlocks',
] as const;

export type PaletteCategory = typeof PALETTE_CATEGORIES[number];

export const PALETTE_CATEGORY_LABELS: Readonly<Record<PaletteCategory, string>> = {
  blocks: 'Blocks',
  specialBlocks: 'Special Blocks',
  enemies: 'Enemies',
  triggers: 'Triggers',
  fields: 'Fields',
  gates: 'Gates',
  collectables: 'Collectables',
  environment: 'Environment',
  dust: 'Dust',
  liquids: 'Liquids',
  objects: 'Objects',
  lighting: 'Lighting',
  ropes: 'Ropes',
  guidePaths: 'Guide Paths',
  customBlocks: 'Custom Blocks',
};

export interface PaletteItem {
  id: string;
  label: string;
  category: PaletteCategory;
  /** Default width in blocks (for walls). */
  defaultWidthBlocks?: number;
  /** Default height in blocks (for walls). */
  defaultHeightBlocks?: number;
  /** 1 if this palette item places a one-way platform. */
  isPlatformItem?: 1;
  /**
   * 1 if this palette item places a ramp (diagonal triangle).
   * Plain ramps are retired; only the bounce-pad ramp items still set this.
   */
  isRampItem?: 1;
  /** 1 if this palette item places stairs (stepped, mask-defined shape). */
  isStairsItem?: 1;
  /**
   * 1 if this palette item places a smooth ramp: identical stairs-style
   * stepped collision, but rendered as a smooth diagonal triangle.
   */
  isSmoothRampItem?: 1;
  /** 1 if this palette item places a half-width pillar (4 px wide). */
  isPillarHalfWidthItem?: 1;
  /** 1 if this palette item paints ambient-light blocker tiles. */
  isAmbientLightBlockerItem?: 1;
  /** 1 if this palette item paints dark ambient-light blocker tiles (also draws a black background overlay). */
  isDarkAmbientLightBlockerItem?: 1;
  /** 1 if this palette item places a local light source. */
  isLightSourceItem?: 1;
  /** 1 if this palette item places a sunbeam. */
  isSunbeamItem?: 1;
  /** 1 if this palette item places a liquid zone (water or lava). */
  isLiquidZoneItem?: 1;
  /** 1 if this palette item places a TimeStop Field tile (non-solid, connected gameplay volume). */
  isTimeStopFieldItem?: 1;
  /** 1 if this palette item places a crumble block (collapses on first contact). */
  isCrumbleBlockItem?: 1;
  /** 1 if this palette item places a bounce pad (reflects player velocity). */
  isBouncePadItem?: 1;
  /** Speed-factor index for the placed bounce pad: 0=50%, 1=100%. */
  bouncePadSpeedFactorIndex?: 0 | 1;
  /** 1 if this palette item places a kinetic block (fixed-velocity boost on contact). */
  isKineticBlockItem?: 1;
  /** 1 if this palette item places a 1x1 grapple-carry physics block. */
  isGrappleCarryBlockItem?: 1;
  /** Zip-activated moving solid rectangle variant. */
  zipMoveBlockVariant?: 'toward' | 'away';
  /** 1 if this palette item places a phantasmal tile. */
  isPhantasmalTileItem?: 1;
  /** Block theme override used by special block entries such as ice blocks. */
  blockThemeOverride?: BlockTheme;
  /** 1 if this palette item places a collectible dust container (grants +4 max capacity). */
  isDustContainerItem?: 1;
  /** 1 if this palette item places a collectible dust container piece. */
  isDustContainerPieceItem?: 1;
  /** 1 if this palette item places a dust boost jar object (grants temporary dust of a specific kind). */
  isDustBoostJarItem?: 1;
  /** 1 if this palette item places a collectable dust swarm (press F to collect dust particles). */
  isDustSwarmItem?: 1;
  /** 1 if this palette item places a Lambda Anchor (temporary recall point, press F to link/teleport). */
  isLambdaAnchorItem?: 1;
  /** 1 if this palette item places a falling block tile (triggers as a rigid group when disturbed). */
  isFallingBlockItem?: 1;
  /** Which falling block variant this item places. Only meaningful when isFallingBlockItem === 1. */
  fallingBlockVariant?: import('../levels/roomDef').FallingBlockVariant;
  /** 1 if this palette item places a visual-only background block (no collision). */
  isBackgroundBlockItem?: 1;
  /** 1 if this background block also blocks ambient light. Only meaningful when isBackgroundBlockItem === 1. */
  isLightBlockingBackgroundBlockItem?: 1;
  /** 1 if this palette item places a scene light (visibility-polygon shadow system). */
  isSceneLightItem?: 1;
  /** 1 if this palette item places/extends a golden dust guide path. */
  isGuideDustPathItem?: 1;
  /** 1 if this palette item places a spike hazard. */
  isSpikeItem?: 1;
  /** Which spike footprint size this item places. Only meaningful when isSpikeItem === 1. */
  spikeSize?: import('../levels/roomElementDefs').SpikeSize;
  /** 1 if this palette item places a laser emitter hazard. */
  isLaserItem?: 1;
  /**
   * 1 if this palette item paints individual 1x1 pixel-material particles
   * (native-pixel granularity, not block-grid — see docs/pixelMaterials.md).
   */
  isPixelMaterialItem?: 1;
  /** Which material id this pixel-material item places. Only meaningful when isPixelMaterialItem === 1. */
  pixelMaterialId?: number;
  /** 1 if this palette item places a custom block. */
  isCustomBlockItem?: 1;
  /** Namespaced custom block ID ("custom:<id>") placed by this item. */
  customBlockId?: string;
  /** Tile width of the custom block footprint (1 or 2). */
  customBlockTileWidth?: 1 | 2;
  /** Tile height of the custom block footprint (1 or 2). */
  customBlockTileHeight?: 1 | 2;
}


export const PALETTE_ITEMS: readonly PaletteItem[] = [
  // Blocks / terrain
  { id: 'block_1x1', label: '1×1 Block',   category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'block_2x2', label: '2×2 Block',   category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2 },
  { id: 'platform',  label: 'Platform',     category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isPlatformItem: 1 },
  { id: 'stairs_1x1', label: '1×1 Stairs', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isStairsItem: 1 },
  { id: 'stairs_1x2', label: '1×2 Stairs', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isStairsItem: 1 },
  { id: 'stairs_2x2', label: '2×2 Stairs', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isStairsItem: 1 },
  // Smooth ramps: identical stairs collision (`smoothRampOrientation`), but
  // rendered as a smooth diagonal triangle instead of jagged steps. Distinct
  // from the legacy diagonal-physics `bounce_pad_ramp_*` items, which still
  // use `isRampItem`/`rampOrientation`.
  { id: 'ramp_1x1', label: '1×1 Ramp', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isSmoothRampItem: 1 },
  { id: 'ramp_1x2', label: '1×2 Ramp', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isSmoothRampItem: 1 },
  { id: 'ramp_2x2', label: '2×2 Ramp', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isSmoothRampItem: 1 },
  { id: 'pillar_half_width', label: 'Half-width Pillar', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isPillarHalfWidthItem: 1 },
  { id: 'spike_1x1', label: '1×1 Spike',  category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isSpikeItem: 1, spikeSize: '1x1' },
  { id: 'spike_2x2', label: '2×2 Spike',  category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isSpikeItem: 1, spikeSize: '2x2' },
  { id: 'laser_emitter', label: 'Laser Emitter', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isLaserItem: 1 },
  // Enemies
  { id: 'enemy_rolling', label: 'Rolling Enemy', category: 'enemies' },
  { id: 'enemy_flying_eye', label: 'Flying Eye', category: 'enemies' },
  { id: 'enemy_rock_elemental', label: 'Rock Elemental', category: 'enemies' },
  { id: 'enemy_grapple_hunter', label: 'Grapple Hunter', category: 'enemies' },
  { id: 'enemy_slime', label: 'Slime', category: 'enemies' },
  { id: 'enemy_slime_large', label: 'Dust Slime (L)', category: 'enemies' },
  { id: 'enemy_wheel', label: 'Wheel Enemy', category: 'enemies' },
  { id: 'enemy_beetle', label: 'Golden Beetle', category: 'enemies' },
  { id: 'enemy_water_bubble', label: 'Water Bubble', category: 'enemies' },
  { id: 'enemy_ice_bubble',   label: 'Ice Bubble',   category: 'enemies' },
  { id: 'enemy_square_stampede', label: 'Square Stampede', category: 'enemies' },
  { id: 'enemy_slime_snail', label: 'Slime Snail', category: 'enemies' },
  { id: 'enemy_shadow', label: 'Shadow', category: 'enemies' },
  { id: 'enemy_needle_urchin', label: 'Needle Urchin', category: 'enemies' },
  { id: 'enemy_golden_mimic', label: 'Golden Mimic', category: 'enemies' },
  { id: 'enemy_golden_mimic_xy', label: 'Golden Mimic (XY)', category: 'enemies' },
  { id: 'enemy_bee_swarm', label: 'Bee Swarm', category: 'enemies' },
  { id: 'enemy_web_spider', label: 'Web Spider', category: 'enemies' },
  { id: 'enemy_dust_constellation', label: 'Dust Constellation Sentinel', category: 'enemies' },
  { id: 'enemy_dust_constellation_large', label: 'Dust Constellation Sentinel (L)', category: 'enemies' },
  { id: 'enemy_orbital_dust_core', label: 'Orbital Dust Core', category: 'enemies' },
  { id: 'enemy_orbital_dust_core_large', label: 'Orbital Dust Core (L)', category: 'enemies' },
  { id: 'enemy_dust_block_mimic', label: 'Dust Block Mimic', category: 'enemies' },
  { id: 'enemy_dust_block_mimic_large', label: 'Dust Block Mimic (L)', category: 'enemies' },
  { id: 'enemy_dust_weaver_architect', label: 'Dust Weaver Architect', category: 'enemies' },
  { id: 'enemy_dust_weaver_architect_large', label: 'Dust Weaver Architect (L)', category: 'enemies' },
  { id: 'enemy_void_singularity', label: 'Void Singularity', category: 'enemies' },
  { id: 'enemy_void_singularity_pair', label: 'Void Singularity Pair', category: 'enemies' },
  { id: 'enemy_dust_leech', label: 'Dust Leech', category: 'enemies' },
  { id: 'enemy_momentum_turret', label: 'Momentum Turret', category: 'enemies' },
  { id: 'enemy_grid_snake', label: 'Snake', category: 'enemies' },
  { id: 'enemy_grid_block_1x1_slow',   label: 'Block 1×1 (Slow)',   category: 'enemies' },
  { id: 'enemy_grid_block_1x1_medium', label: 'Block 1×1 (Medium)', category: 'enemies' },
  { id: 'enemy_grid_block_1x1_fast',   label: 'Block 1×1 (Fast)',   category: 'enemies' },
  { id: 'enemy_grid_block_2x2_slow',   label: 'Block 2×2 (Slow)',   category: 'enemies' },
  { id: 'enemy_grid_block_2x2_medium', label: 'Block 2×2 (Medium)', category: 'enemies' },
  { id: 'enemy_grid_block_2x2_fast',   label: 'Block 2×2 (Fast)',   category: 'enemies' },
  { id: 'enemy_radiant_tether', label: 'Radiant Tether (Boss)', category: 'enemies' },
  { id: 'enemy_radiant_web', label: 'Radiant Web (Boss)', category: 'enemies' },
  { id: 'enemy_crimson_wizard', label: 'Crimson Wizard (Boss)', category: 'enemies' },
  { id: 'enemy_herald', label: 'The Void Herald (Boss)', category: 'enemies' },
  { id: 'enemy_ice_wizard', label: 'Ice Wizard (Boss)', category: 'enemies' },
  // Triggers (player-facing activators and room logic)
  { id: 'campaign_spawn',  label: 'Campaign Spawn',          category: 'triggers' },
  { id: 'player_spawn',    label: 'Room Spawn (Fallback)',   category: 'triggers' },
  { id: 'room_transition', label: 'Room Transition', category: 'triggers' },
  { id: 'save_tomb',       label: 'Save Tomb',       category: 'triggers' },
  { id: 'dialogue_trigger', label: 'Dialogue Trigger', category: 'triggers' },
  { id: 'challenge_field', label: 'Challenge Field', category: 'fields', defaultWidthBlocks: 4, defaultHeightBlocks: 4 },
  { id: 'enemy_gate', label: 'Enemy Gate', category: 'gates', defaultWidthBlocks: 1, defaultHeightBlocks: 4 },
  { id: 'challenge_gate', label: 'Challenge Gate', category: 'gates', defaultWidthBlocks: 1, defaultHeightBlocks: 4 },
  { id: 'heart_gate', label: 'Heart Gate', category: 'gates', defaultWidthBlocks: 1, defaultHeightBlocks: 4 },
  { id: 'speed_gate', label: 'Speed Gate', category: 'gates', defaultWidthBlocks: 1, defaultHeightBlocks: 4 },
  { id: 'challenge_totem', label: 'Challenge Totem', category: 'objects' },
  // Collectables (items the player can pick up for permanent upgrades)
  { id: 'skill_tomb',            label: 'Skill Tomb',            category: 'collectables' },
  { id: 'dust_container',        label: 'Dust Container',        category: 'collectables', isDustContainerItem: 1 },
  { id: 'dust_container_piece',  label: 'Dust Container Piece',  category: 'collectables', isDustContainerPieceItem: 1 },
  { id: 'dust_swarm',            label: 'Dust Swarm',            category: 'collectables', isDustSwarmItem: 1 },
  // Dust (free-placed dust piles and pixel materials)
  { id: 'dust_pile_small',  label: 'Dust Pile (S)', category: 'dust' },
  { id: 'dust_pile_medium', label: 'Dust Pile (M)', category: 'dust' },
  { id: 'dust_pile_large',  label: 'Dust Pile (L)', category: 'dust' },
  // Legacy alias kept for backward-compat with older room exports
  { id: 'dust_pile', label: 'Dust Pile', category: 'dust' },
  { id: 'sand_1x1', label: 'Sand 1×1', category: 'dust', isPixelMaterialItem: 1, pixelMaterialId: 1 },
  // pixelMaterialId: 2 === MATERIAL_SAND_2X2 (sim/pixelMaterials/pixelMaterialTypes.ts).
  // Kept as a numeric literal (not imported) to avoid pulling sim modules into
  // this already-heavy dropdown-data module for a single constant.
  { id: 'sand_2x2', label: 'Sand 2×2', category: 'dust', isPixelMaterialItem: 1, pixelMaterialId: 2 },
  // pixelMaterialId: 3 === MATERIAL_WATER (sim/pixelMaterials/pixelMaterialTypes.ts).
  { id: 'water_1x1', label: 'Water 1×1', category: 'dust', isPixelMaterialItem: 1, pixelMaterialId: 3 },
  // pixelMaterialId: 4 === MATERIAL_SANDSTONE (sim/pixelMaterials/pixelMaterialTypes.ts).
  // Static brittle material; fractures into sand under high-speed player impact or sustained wind.
  { id: 'sandstone_1x1', label: 'Sandstone 1×1', category: 'dust', isPixelMaterialItem: 1, pixelMaterialId: 4 },
  // Environment (world atmosphere and critters)
  { id: 'grasshopper_area',     label: 'Grasshopper Area', category: 'environment' },
  { id: 'firefly_area',         label: 'Firefly Area',     category: 'environment' },
  { id: 'decoration_mushroom',  label: 'Glow Mushroom',    category: 'environment' },
  { id: 'decoration_glowgrass', label: 'Glow Grass',       category: 'environment' },
  { id: 'decoration_vine',      label: 'Glow Vine',        category: 'environment' },
  // Objects (interactive world objects)
  { id: 'lambda_anchor', label: 'Lambda Anchor', category: 'objects', isLambdaAnchorItem: 1 },
  { id: 'dust_boost_jar', label: 'Dust Jar (Object)', category: 'objects', isDustBoostJarItem: 1 },
  { id: 'firefly_jar', label: 'Firefly Jar', category: 'objects' },
  // ── Lighting layer ─────────────────────────────────────────────────────────
  // Designer-facing authoring for the unified ambient lighting system.
  // See `RoomAmbientLightBlockerDef` / `RoomLightSourceDef` in roomDef.ts.
  { id: 'ambient_light_blocker',      label: 'Ambient Blocker', category: 'lighting', isAmbientLightBlockerItem: 1 },
  { id: 'dark_ambient_light_blocker', label: 'Dark Blocker',    category: 'lighting', isAmbientLightBlockerItem: 1, isDarkAmbientLightBlockerItem: 1 },
  { id: 'light_source',          label: 'Light Source',    category: 'lighting', isLightSourceItem: 1 },
  { id: 'sunbeam',               label: 'Sunbeam',         category: 'lighting', isSunbeamItem: 1 },
  { id: 'scene_light',           label: 'Scene Light',     category: 'lighting', isSceneLightItem: 1 },
  // ── Liquids layer ───────────────────────────────────────────────────────────
  { id: 'water_zone', label: 'Water Zone', category: 'liquids', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isLiquidZoneItem: 1 },
  { id: 'lava_zone',  label: 'Lava Zone',  category: 'liquids', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isLiquidZoneItem: 1 },
  // ── TimeStop Field (experimental) ──────────────────────────────────────────
  // Non-solid, dynamic, translucent field. Adjacent tiles merge into one
  // connected gameplay region — see sim/timeStopField/.
  { id: 'timestop_field', label: 'TimeStop Field', category: 'fields', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isTimeStopFieldItem: 1 },
  // ── Poison Field ─────────────────────────────────────────────────────────────
  // Non-solid, editor-authored rectangle (drag to size, like Challenge Field) —
  // see sim/poisonField/ for the deterministic exposure/damage contract.
  { id: 'poison_field', label: 'Poison Field', category: 'fields', defaultWidthBlocks: 4, defaultHeightBlocks: 4 },
  // ── Bounce pads ─────────────────────────────────────────────────────────────
  // Dim = 50 % restitution (small 2×2-pixel core)
  { id: 'bounce_pad_1x1_dim',       label: 'Bounce 1×1 (50%)',      category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0 },
  { id: 'bounce_pad_2x2_dim',       label: 'Bounce 2×2 (50%)',      category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0 },
  { id: 'bounce_pad_ramp_1x1_dim',  label: 'Bounce Ramp 1×1 (50%)', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0, isRampItem: 1 },
  { id: 'bounce_pad_ramp_1x2_dim',  label: 'Bounce Ramp 1×2 (50%)', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0, isRampItem: 1 },
  { id: 'bounce_pad_ramp_2x2_dim',  label: 'Bounce Ramp 2×2 (50%)', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0, isRampItem: 1 },
  // Bright = 100 % restitution (large 4×4-pixel core)
  { id: 'bounce_pad_1x1_bright',      label: 'Bounce 1×1 (100%)',      category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1 },
  { id: 'bounce_pad_2x2_bright',      label: 'Bounce 2×2 (100%)',      category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1 },
  { id: 'bounce_pad_ramp_1x1_bright', label: 'Bounce Ramp 1×1 (100%)', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1, isRampItem: 1 },
  { id: 'bounce_pad_ramp_1x2_bright', label: 'Bounce Ramp 1×2 (100%)', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1, isRampItem: 1 },
  { id: 'bounce_pad_ramp_2x2_bright', label: 'Bounce Ramp 2×2 (100%)', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1, isRampItem: 1 },
  // ── Kinetic blocks (impart fixed directional velocity boost on contact) ───
  { id: 'kinetic_block_1x1', label: 'Kinetic Block 1×1', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isKineticBlockItem: 1 },
  { id: 'kinetic_block_2x2', label: 'Kinetic Block 2×2', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isKineticBlockItem: 1 },
  { id: 'grapple_carry_block', label: 'Grapple Carry 1x1', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isGrappleCarryBlockItem: 1 },
  { id: 'zip_move_toward', label: 'Zip Block — Toward', category: 'specialBlocks', defaultWidthBlocks: 3, defaultHeightBlocks: 3, zipMoveBlockVariant: 'toward' },
  { id: 'zip_move_away', label: 'Zip Block — Away', category: 'specialBlocks', defaultWidthBlocks: 3, defaultHeightBlocks: 3, zipMoveBlockVariant: 'away' },
  { id: 'phantasmal_block', label: 'Phantasmal Block', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isPhantasmalTileItem: 1 },
  { id: 'springboard', label: 'Springboard', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'breakable_block_1x1', label: 'Breakable Block 1×1', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'breakable_block_2x2', label: 'Breakable Block 2×2', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2 },
  // ── Ice blocks (static wall theme with ice-surface physics) ───────────────
  { id: 'ice_block_1x1', label: 'Ice Block 1×1', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, blockThemeOverride: 'iceBlock' },
  { id: 'ice_block_2x2', label: 'Ice Block 2×2', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, blockThemeOverride: 'iceBlock' },
  // ── Ultra ice blocks (velocity-locking ice with sparkling effect) ─────────
  { id: 'ultra_ice_block_1x1', label: 'Ultra Ice Block 1×1', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, blockThemeOverride: 'ultraIceBlock' },
  { id: 'ultra_ice_block_2x2', label: 'Ultra Ice Block 2×2', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, blockThemeOverride: 'ultraIceBlock' },
  // ── Rocket blocks (grant Movement V2 rocket boost when jumped from) ───────────
  { id: 'rocket_block_1x1', label: 'Rocket Block 1×1', category: 'specialBlocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, blockThemeOverride: 'rocketBlock' },
  { id: 'rocket_block_2x2', label: 'Rocket Block 2×2', category: 'specialBlocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, blockThemeOverride: 'rocketBlock' },
  // Background blocks are no longer standalone palette cards — they are now a
  // "Background" checkbox in the Block Modifier panel (see editorUI.ts) applied
  // to ordinary 1×1/2×2 block placement. isBackgroundBlockItem / a
  // isLightBlockingBackgroundBlockItem live on here still for legacy palette-item
  // shape compatibility, but no PALETTE_ITEMS entry sets them any more.
  { id: 'rope', label: 'Rope', category: 'ropes', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'guide_dust_path', label: 'Guide Dust Path', category: 'guidePaths', isGuideDustPathItem: 1 as const },
];
