/**
 * Room definition types for the Metroidvania-style interconnected world.
 *
 * All positions and sizes are in **block units**.
 * The game screen converts them to world units at load time.
 *
 * Block size constants (world units):
 *   BLOCK_SIZE_SMALL  =  8  →  8×8 virtual px (32×32 physical @ 4×)
 *
 * Medium and large block tiers are temporarily disabled and aliased to
 * the small block size so all terrain generation runs on an 8×8 tileset.
 *
 * At zoom 1.0 with the 480×270 virtual canvas:
 *   33.75 small blocks fit vertically  (270 ÷ 8 = 33.75)
 *   60    small blocks fit horizontally (480 ÷ 8 = 60)
 *
 * Player hitbox constants (standing):
 *   PLAYER_WIDTH_WORLD       =  7  (full width,  sprite x 6–13)
 *   PLAYER_HEIGHT_WORLD      = 20  (full height, sprite y 4–24)
 *   PLAYER_HALF_WIDTH_WORLD  =  3.5
 *   PLAYER_HALF_HEIGHT_WORLD = 10
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomSongId } from '../audio/musicManager';

// ── Block theme and background types ─────────────────────────────────────────

/**
 * Visual theme for block sprites in a room.
 * Controls which sprite set is used by the block renderer.
 */
export type BlockTheme = 'blackRock' | 'brownRock' | 'dirt';

/**
 * Short stable theme IDs used by compact room JSON. Keep these very short
 * because saved rooms group many block rectangles by theme key.
 */
export type BlockThemeId = 'bk' | 'br' | 'dt';

/** Maps a BlockTheme string to its compact JSON ID. */
export function blockThemeToId(theme: BlockTheme): BlockThemeId {
  switch (theme) {
    case 'blackRock': return 'bk';
    case 'brownRock': return 'br';
    case 'dirt':      return 'dt';
  }
}

/** Maps a compact JSON theme ID back to a BlockTheme string. */
export function blockThemeIdToTheme(themeId: BlockThemeId): BlockTheme {
  switch (themeId) {
    case 'br': return 'brownRock';
    case 'dt': return 'dirt';
    case 'bk': return 'blackRock';
  }
}

/** Parses either the legacy long theme name or compact JSON theme ID. */
export function blockThemeRefToTheme(themeRef: BlockTheme | BlockThemeId | undefined): BlockTheme | undefined {
  switch (themeRef) {
    case 'blackRock':
    case 'brownRock':
    case 'dirt':
      return themeRef;
    case 'bk':
    case 'br':
    case 'dt':
      return blockThemeIdToTheme(themeRef);
    default:
      return undefined;
  }
}

/** Maps a BlockTheme string to a compact numeric index for typed arrays. */
export function blockThemeToIndex(theme: BlockTheme): number {
  switch (theme) {
    case 'blackRock': return 0;
    case 'brownRock': return 1;
    case 'dirt':      return 2;
  }
}

/** Maps a numeric theme index back to a BlockTheme string. */
export function indexToBlockTheme(index: number): BlockTheme {
  switch (index) {
    case 1:  return 'brownRock';
    case 2:  return 'dirt';
    default: return 'blackRock';
  }
}

/** Sentinel value: wall uses room-level default theme. */
export const WALL_THEME_DEFAULT_INDEX = 255;

/**
 * Background visual identifier for a room.
 * Controls the parallax background image (or effect) shown behind the level.
 */
export type BackgroundId =
  | 'brownRock'
  | 'world1'
  | 'world2'
  | 'world3'
  | 'crystallineCracks'
  | 'thero_prologue'
  | 'thero_ch1'
  | 'thero_ch2'
  | 'thero_ch3'
  | 'thero_ch4'
  | 'thero_ch5'
  | 'thero_ch6';

/**
 * Lighting model used when shading block tiles in a room.
 *
 * The unified "Ambient" model propagates skylight from outside the room through
 * empty cells into solid walls, using a configurable {@link AmbientLightDirection}.
 * `ambientLightBlockers` tiles block this propagation (see {@link RoomAmbientLightBlockerDef}),
 * producing dark walkable pockets that only brighten when a connecting path to
 * the outside opens (e.g. after a breakable wall is destroyed).
 *
 * - `'Ambient'`  — unified directional ambient/skylight solver (preferred).
 * - `'DarkRoom'` — ambient darkness; only point lights illuminate (overlay path).
 * - `'FullyLit'` — no ambient darkness shading; everything is bright.
 *
 * **Legacy values (accepted for backward compatibility):**
 * - `'DEFAULT'` — omnidirectional sky access; behaves like `'Ambient'` with
 *                 {@link AmbientLightDirection} = `'omni'`.
 * - `'Above'`   — legacy top-down scan; behaves like `'Ambient'` with
 *                 {@link AmbientLightDirection} = `'down'`.
 */
export type LightingEffect = 'Ambient' | 'DarkRoom' | 'FullyLit' | 'DEFAULT' | 'Above';

/**
 * Direction that ambient/skylight arrives from.
 *
 * The solver seeds "lit air" cells by flood-filling from the edge(s) of the
 * room that face the sky, then propagates through air that moves WITH the
 * direction vector (and its two orthogonal neighbours, for natural diagonal
 * spill). Solid walls adjacent to lit air are then shaded by depth.
 *
 * - `'omni'`       — no directional bias; any room edge counts as sky source
 *                     (compatible with the legacy `'DEFAULT'` mode).
 * - `'down'`       — sunlight from directly above (the legacy `'Above'` mode).
 * - `'down-right'` / `'down-left'` — natural diagonal skylight (recommended default).
 * - `'up'` / `'up-right'` / `'up-left'` — uncommon, but supported for
 *                                         authoring flexibility.
 * - `'left'` / `'right'` — horizontal ambient (rare; for special rooms).
 */
export type AmbientLightDirection =
  | 'omni'
  | 'down'
  | 'down-right'
  | 'down-left'
  | 'up'
  | 'up-right'
  | 'up-left'
  | 'left'
  | 'right';

/**
 * A single tile-coordinate ambient-light blocker.
 *
 * Authored in the editor via the dedicated lighting layer. The tile remains
 * empty for gameplay (not solid, not hazardous) and visually air, but the
 * ambient-lighting solver treats it as opaque to skylight propagation. Solid
 * walls hidden behind a field of blockers stay fully dark until a path to
 * the actual room edge opens up.
 *
 * Blockers do NOT affect {@link RoomLightSourceDef} local lights — those
 * remain purely radius-based for now (see task guidance §2 and §9).
 */
export interface RoomAmbientLightBlockerDef {
  readonly xBlock: number;
  readonly yBlock: number;
  /**
   * When true, this blocker also draws a solid black overlay over the air cell,
   * hiding the room background (procedural effects, parallax) from view.
   * Use this to conceal secret tunnels and off-screen areas.
   * The ambient-light propagation effect is identical to the default (clear) blocker.
   */
  readonly isDark?: boolean;
}

/**
 * A placed local light source authored in the editor.
 *
 * Intended as the designer-facing equivalent of {@link import('../render/effects/darkRoomOverlay').LightSourcePx}.
 * Colour is stored as three 0-255 channels for an intuitive RGB picker; brightness
 * is stored as a 0-100 percent value for a familiar slider. The runtime converts
 * both into overlay parameters when building the darkness mask.
 */
export interface RoomLightSourceDef {
  readonly xBlock: number;
  readonly yBlock: number;
  /** Outer light radius in world/block units. */
  readonly radiusBlocks: number;
  /** Red channel, 0-255. */
  readonly colorR: number;
  /** Green channel, 0-255. */
  readonly colorG: number;
  /** Blue channel, 0-255. */
  readonly colorB: number;
  /** Brightness as a percent in 0-100. 100 = full lamp, 0 = off. */
  readonly brightnessPct: number;
}

/** Small block size in world units (8×8 virtual px, 32×32 physical px @ 4×). */
export const BLOCK_SIZE_SMALL  = 8;

/**
 * Medium block tier is disabled for now; kept as an alias for compatibility.
 * All world generation should treat this as an 8×8 small tile.
 */
export const BLOCK_SIZE_MEDIUM = BLOCK_SIZE_SMALL;

/**
 * Large block tier is disabled for now; kept as an alias for compatibility.
 * All world generation should treat this as an 8×8 small tile.
 */
export const BLOCK_SIZE_LARGE  = BLOCK_SIZE_SMALL;

// ── Player size constants ─────────────────────────────────────────────────────

/** Player full width in world units (sprite x 6–13 = 7 px). */
export const PLAYER_WIDTH_WORLD = 7;

/** Player full height in world units (sprite y 4–24 = 20 px). */
export const PLAYER_HEIGHT_WORLD = 20;

/** Player half-width in world units. */
export const PLAYER_HALF_WIDTH_WORLD = 3.5;

/** Player half-height in world units. */
export const PLAYER_HALF_HEIGHT_WORLD = 10;

/** An enemy cluster placed inside a room. */
export interface RoomEnemyDef {
  /** X position in block units. */
  xBlock: number;
  /** Y position in block units. */
  yBlock: number;
  /** Particle kinds composing this enemy. */
  kinds: ParticleKind[];
  /** Total particle count for this enemy. */
  particleCount: number;
  /** 1 if boss, 0 otherwise. */
  isBossFlag: 0 | 1;
  /**
   * 1 if this enemy is a flying eye — floats in the air, moves in 2D,
   * and is rendered as 4 concentric diamond outlines.
   */
  isFlyingEyeFlag?: 0 | 1;
  /**
   * 1 if this enemy is a rolling ground enemy — rolls toward the player,
   * rendered with a rotating sprite, and forms a crescent shield when blocking.
   */
  isRollingEnemyFlag?: 0 | 1;
  /**
   * Which enemy sprite to use (1–6), corresponding to SPRITES/enemies/universal/enemy (N).png.
   * Only meaningful when isRollingEnemyFlag === 1.
   */
  rollingEnemySpriteIndex?: number;
  /**
   * 1 if this enemy is a rock elemental — hovers near the ground, has
   * inactive/active states, orbits/fires brown-rock dust projectiles.
   */
  isRockElementalFlag?: 0 | 1;
  /**
   * 1 if this enemy is the Radiant Tether boss — floating sphere of light
   * with rotating laser telegraphs and anchored chains.
   */
  isRadiantTetherFlag?: 0 | 1;
  /** 1 if this enemy is a grapple hunter — ground enemy that fires slow grapple hooks at the player. */
  isGrappleHunterFlag?: 0 | 1;
  /** 1 if this enemy is a slime — hops toward the player. */
  isSlimeFlag?: 0 | 1;
  /** 1 if this enemy is a large dust slime — slower hops, orbiting dust, splits on death. */
  isLargeSlimeFlag?: 0 | 1;
  /** 1 if this enemy is a wheel enemy — rolls along surfaces toward the player. */
  isWheelEnemyFlag?: 0 | 1;
  /**
   * 1 if this enemy is a golden beetle — crawls on any surface (floor/wall/ceiling),
   * damages the player on contact, and flies away when agitated.
   */
  isBeetleFlag?: 0 | 1;
  /** 1 if this enemy is a bubble enemy (water or ice floating ring). */
  isBubbleEnemyFlag?: 0 | 1;
  /** 1 if this is an ice bubble variant, 0 (or omitted) for water bubble. */
  isIceBubbleFlag?: 0 | 1;
  /**
   * 1 if this enemy is a square stampede — dashes orthogonally in 2D,
   * leaves a shrinking ghost trail, and has layered HP.
   */
  isSquareStampedeFlag?: 0 | 1;
  /**
   * 1 if this enemy is a golden mimic — a golden silhouette of the player that
   * mirrors player movement (X-axis flipped), deals contact damage, and collapses
   * when half its particles are destroyed.
   */
  isGoldenMimicFlag?: 0 | 1;
  /**
   * 1 for the XY-flipped variant of the golden mimic (both axes mirrored; floats
   * upward when it collapses instead of falling).
   * Only meaningful when isGoldenMimicFlag === 1.
   */
  isGoldenMimicYFlippedFlag?: 0 | 1;
  /**
   * 1 if this enemy is a bee swarm — 10 bees that orbit a spawn area until the
   * player comes close or the swarm takes damage, then charge the player.
   * Each bee is killed by 1 golden mote (1 Physical particle hit).
   */
  isBeeSwarmFlag?: 0 | 1;
}

/** An axis-aligned wall rectangle inside a room (block units). */
export interface RoomWallDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /**
   * 1 if this wall is a one-way platform — the player can pass upward through
   * it but lands on top when falling down.  Platforms have no side collision.
   */
  isPlatformFlag?: 0 | 1;
  /**
   * Which edge of this platform block is the one-way surface.
   * Only meaningful when isPlatformFlag === 1.
   * 0 = top (default), 1 = bottom, 2 = left, 3 = right.
   */
  platformEdge?: 0 | 1 | 2 | 3;
  /** Per-wall block theme override.  When set, this wall renders with the
   *  specified theme instead of the room-level default. */
  blockTheme?: BlockTheme;
  /** 1 if this wall is an invisible collision boundary (not rendered). */
  isInvisibleFlag?: 0 | 1;
  /**
   * Ramp orientation. When set, this wall is a diagonal triangle (ramp) rather
   * than a full rectangle. The four orientations are:
   *   0 = ramp rises going right  ( / shape, hypotenuse from bottom-left to top-right )
   *   1 = ramp rises going left   ( \ shape, hypotenuse from bottom-right to top-left )
   *   2 = ceiling ramp going left ( ⌐ shape, upside-down /, hypotenuse top-left to bottom-right )
   *   3 = ceiling ramp going right( ¬ shape, upside-down \, hypotenuse top-right to bottom-left )
   * Omit (or set to undefined) for a normal rectangular wall.
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /**
   * 1 if this pillar wall is rendered and collides at half-block width (4 px).
   * Only meaningful for walls that are 1×2 blocks and serve as pillars.
   */
  isPillarHalfWidthFlag?: 0 | 1;
}

/** Direction a transition tunnel faces. */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/**
 * A passage connecting this room to an adjacent room.
 *
 * The tunnel is an opening in the room boundary walls.
 * Blocks line the top and bottom (or sides) of the opening to form
 * a corridor that extends a few blocks beyond the room edge.
 */
export interface RoomTransitionDef {
  /** Direction the player walks to leave through this tunnel. */
  direction: TransitionDirection;
  /** ID of the room this tunnel leads to. */
  targetRoomId: string;
  /**
   * For left/right tunnels: Y position (top of tunnel opening, block units).
   * For up/down tunnels: X position (left of tunnel opening, block units).
   */
  positionBlock: number;
  /** Size of the tunnel opening in blocks (height for L/R, width for U/D). */
  openingSizeBlocks: number;
  /**
   * Block coordinate where the player spawns in the target room.
   * [xBlock, yBlock]
   */
  targetSpawnBlock: readonly [number, number];
  /** Color used for the tunnel fade gradient. Defaults to black if unset. */
  fadeColor?: string;
  /**
   * Left edge (for left/right) or top edge (for up/down) of the 6-block-deep
   * transition zone, in block units. When undefined the transition is an edge
   * transition sitting against the room boundary; when defined it is an
   * interior transition that can be placed anywhere inside the room.
   */
  depthBlock?: number;
  /**
   * When true, this transition is a secret door: the fade gradient begins
   * invisible and only activates when the player is very close.
   */
  isSecretDoor?: boolean;
  /**
   * Width of the fade gradient in blocks (default: 3). Larger values create
   * a slower, more gradual fade-to-black effect at the tunnel entrance.
   */
  gradientWidthBlocks?: number;
}

/** Direction a spike faces (the pointy end). */
export type SpikeDirection = 'up' | 'down' | 'left' | 'right';

/** A spike tile placed in the room. */
export interface RoomSpikeDef {
  xBlock: number;
  yBlock: number;
  /** Direction the spike points (the dangerous end). */
  direction: SpikeDirection;
}

/** A springboard tile that bounces the player upward. */
export interface RoomSpringboardDef {
  xBlock: number;
  yBlock: number;
}

/** An axis-aligned rectangular zone (water or lava). */
export interface RoomZoneDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

/** A breakable block that shatters when the player hits it with high momentum. */
export interface RoomBreakableBlockDef {
  xBlock: number;
  yBlock: number;
}

/**
 * Which elemental substance a crumble block is specifically weak to.
 * - `'normal'`    — standard crumble block (no elemental weakness).
 * - `'fire'`      — weak to fire.
 * - `'water'`     — weak to water.
 * - `'void'`      — weak to void energy.
 * - `'ice'`       — weak to ice.
 * - `'lightning'` — weak to lightning.
 * - `'poison'`    — weak to poison.
 * - `'shadow'`    — weak to shadow.
 * - `'nature'`    — weak to nature.
 */
export type CrumbleVariant =
  | 'normal'
  | 'fire'
  | 'water'
  | 'void'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'shadow'
  | 'nature';

/** A crumble block that collapses as soon as the player touches it. */
export interface RoomCrumbleBlockDef {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
  /**
   * Ramp orientation (0-3). Undefined or absent = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** Which elemental type this crumble block is weak to. Defaults to `'normal'`. */
  variant?: CrumbleVariant;
  /** Per-block theme override. When set, overrides the room-level default. */
  blockTheme?: BlockTheme;
}

/** A bounce pad that reflects the player's velocity on contact. */
export interface RoomBouncePadDef {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
  /**
   * Ramp orientation (0-3). Undefined or absent = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /**
   * Speed factor index for the reflected velocity:
   * 0 = 50 % (dim 2×2-pixel glowing core);
   * 1 = 100 % (bright 4×4-pixel glowing core).
   */
  speedFactorIndex?: 0 | 1;
}

/** A jar that grants temporary dust particles when broken. */
export interface RoomDustBoostJarDef {
  xBlock: number;
  yBlock: number;
  /** Particle kind granted by the jar. */
  dustKind: ParticleKind;
  /** Number of temporary dust particles granted. */
  dustCount: number;
}

/** A jar that releases golden fireflies when broken. */
export interface RoomFireflyJarDef {
  xBlock: number;
  yBlock: number;
}

/**
 * A bounce pad block that reflects the player's velocity when they run into it.
 * The player cannot grapple to it, jump off it, or wall-jump off it.
 *
 * speedFactorIndex:
 *   0 = 50 % restitution (dim 2×2-pixel glowing core)
 *   1 = 100 % restitution (bright 4×4-pixel glowing core)
 */
export interface RoomBouncePadDef {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
  /**
   * Ramp orientation (0-3). Undefined = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** 0 = 50 % bounce (dim core), 1 = 100 % bounce (bright core). Default 0. */
  speedFactorIndex?: 0 | 1;
}

/** A pile of gold dust placed on the ground that can be attracted by the Storm Weave. */
export interface RoomDustPileDef {
  xBlock: number;
  yBlock: number;
  /** Number of dust particles in this pile (default: 5). */
  dustCount: number;
  /**
   * Full spread width (block units). The pile spawns with a triangle-distributed
   * random offset in the range ±(spreadBlocks / 2) blocks from the anchor position.
   * Default: 0 (no spread).
   */
  spreadBlocks?: number;
}

// ── Decorations ───────────────────────────────────────────────────────────────

/**
 * Visual kind for an editor-placed decoration.
 * - 'mushroom'  — glowing mushroom, sits on the TOP surface of a floor block.
 * - 'glowGrass' — glowing grass tuft, sits on the TOP surface of a floor block.
 * - 'vine'      — glowing vine, hangs from the BOTTOM surface of a ceiling block.
 */
export type DecorationKind = 'mushroom' | 'glowGrass' | 'vine';

/** An editor-placed decoration anchored to a specific block surface. */
export interface RoomDecorationDef {
  /** Block column of the anchor block. */
  xBlock: number;
  /** Block row of the anchor block. */
  yBlock: number;
  /** Visual kind of decoration. */
  kind: DecorationKind;
}

/** A rectangular area where grasshopper critters spawn randomly. */
export interface RoomGrasshopperAreaDef {
  /** Left edge X (block units). */
  xBlock: number;
  /** Top edge Y (block units). */
  yBlock: number;
  /** Width (block units). */
  wBlock: number;
  /** Height (block units). */
  hBlock: number;
  /** Number of grasshoppers to spawn in this area. */
  count: number;
}

/** A rectangular area where fireflies spawn directly (free-roaming, not from jars). */
export interface RoomFireflyAreaDef {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  count: number;
}

/** Full definition for a single room in the Metroidvania world. */
export interface RoomDef {
  /** Unique identifier for this room. */
  id: string;
  /** Display name shown on screen. */
  name: string;
  /** World number — determines block sprites and background colour. */
  worldNumber: number;
  /** X position on the visual world map (map world units). */
  mapX: number;
  /** Y position on the visual world map (map world units). */
  mapY: number;
  /**
   * Visual theme for block sprites.  When set, overrides the worldNumber-based
   * sprite selection.  Falls back to worldNumber if not set.
   */
  blockTheme?: BlockTheme;
  /**
   * Background visual ID.  When set, overrides the worldNumber-based background
   * image.  Falls back to worldNumber if not set.
   */
  backgroundId?: BackgroundId;
  /**
   * Block lighting model. Falls back to 'Ambient' (omni) when not set.
   * Legacy 'DEFAULT' and 'Above' values are accepted and migrated internally.
   */
  lightingEffect?: LightingEffect;
  /**
   * Direction ambient/skylight arrives from. When omitted the runtime picks a
   * sensible default based on the legacy {@link LightingEffect} value:
   *   - `'DEFAULT'` / `'Ambient'` ⇒ `'omni'`
   *   - `'Above'`                 ⇒ `'down'`
   * The recommended authored default for new rooms is `'down-right'` so light
   * spills in at a natural diagonal rather than straight down.
   */
  ambientLightDirection?: AmbientLightDirection;
  /**
   * Tiles that block ambient-light propagation. Gameplay treats them as empty
   * air; only the ambient-lighting solver sees them as opaque. Used to carve
   * out authored "hidden dark pockets" that only light up when a physical path
   * to the outside opens.
   */
  ambientLightBlockers?: readonly RoomAmbientLightBlockerDef[];
  /** Designer-placed local light sources (see {@link RoomLightSourceDef}). */
  lightSources?: readonly RoomLightSourceDef[];
  /** Room width in blocks. */
  widthBlocks: number;
  /** Room height in blocks. */
  heightBlocks: number;
  /** Wall rectangles (block units, absolute within the room). */
  walls: readonly RoomWallDef[];
  /** Enemies placed in the room. */
  enemies: readonly RoomEnemyDef[];
  /** Default player spawn position (block units). */
  playerSpawnBlock: readonly [number, number];
  /** Transition tunnels connecting to other rooms. */
  transitions: readonly RoomTransitionDef[];
  /** Save tomb positions (block units) — where the player saves their progress. */
  saveTombs: readonly { xBlock: number; yBlock: number }[];
  /** Skill Tomb definitions (block units) — grant dust skills/weaves when interacted with. */
  skillTombs?: readonly { xBlock: number; yBlock: number; weaveId: string }[];
  /**
   * Collectible dust container positions (block units).
   * Each pickup grants +4 dust particles to the player.
   */
  dustContainers?: readonly { xBlock: number; yBlock: number }[];

  // ── Environmental hazards ────────────────────────────────────────────────
  /** Spike tiles that damage the player on contact. */
  spikes?: readonly RoomSpikeDef[];
  /** Springboard tiles that bounce the player upward. */
  springboards?: readonly RoomSpringboardDef[];
  /** Water zones where the player floats (buoyancy). */
  waterZones?: readonly RoomZoneDef[];
  /** Lava zones that damage the player. */
  lavaZones?: readonly RoomZoneDef[];
  /** Breakable blocks that shatter from high-momentum player impact. */
  breakableBlocks?: readonly RoomBreakableBlockDef[];
  /** Crumble blocks that collapse on first player contact. */
  crumbleBlocks?: readonly RoomCrumbleBlockDef[];
  bouncePads?: readonly RoomBouncePadDef[];
  /** Bounce pad blocks that reflect the player's velocity on contact. */
  bouncePads?: readonly RoomBouncePadDef[];
  /** Jars that grant temporary dust particles when broken by the player. */
  dustBoostJars?: readonly RoomDustBoostJarDef[];
  /** Jars that release golden fireflies when broken by the player. */
  fireflyJars?: readonly RoomFireflyJarDef[];
  /** Piles of gold dust placed on the ground (attracted by Storm Weave). */
  dustPiles?: readonly RoomDustPileDef[];
  /** Grasshopper critter spawn zones. */
  grasshopperAreas?: readonly RoomGrasshopperAreaDef[];
  /** Firefly spawn areas (free-roaming fireflies, not jar-based). */
  fireflyAreas?: readonly RoomFireflyAreaDef[];
  /** Editor-placed decorations (glowing mushrooms, grass tufts, vines). */
  decorations?: readonly RoomDecorationDef[];
  /**
   * Background music for this room.
   * '_continue' = keep playing the previous room's song (default / undefined).
   * '_silence'  = stop music when entering this room.
   * Any other value = switch to the named song when entering this room.
   * When undefined, treated as '_continue'.
   */
  songId?: RoomSongId;
}
