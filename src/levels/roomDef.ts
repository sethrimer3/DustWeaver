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
import type { BlockTheme, BlockSoundHardness } from './blockTheme';
import type {
  RoomSpikeDef,
  RoomSpringboardDef,
  RoomZoneDef,
  RoomBreakableBlockDef,
  RoomCrumbleBlockDef,
  RoomBouncePadDef,
  RoomKineticBlockDef,
  RoomGrappleCarryBlockDef,
  RoomPhantasmalTileDef,
  RoomRopeDef,
  RoomDustBoostJarDef,
  RoomFireflyJarDef,
  RoomLambdaAnchorDef,
  RoomDustSwarmDef,
  RoomDustPileDef,
  RoomDecorationDef,
  RoomFallingBlockDef,
  RoomBackgroundBlockDef,
  RoomGrasshopperAreaDef,
  RoomFireflyAreaDef,
  RoomDialogueTriggerDef,
  RoomGuideDustPathDef,
} from './roomElementDefs';

// ── Block theme and background types ─────────────────────────────────────────
// All block-theme types, constants, and utility functions live in blockTheme.ts.
// Re-exported here so existing callers don't need to update their import paths.
export {
  type BlockTheme,
  type BlockThemeId,
  type BlockSoundHardness,
  BLOCK_SOUND_HARDNESS_SOFT,
  BLOCK_SOUND_HARDNESS_NORMAL,
  BLOCK_SOUND_HARDNESS_HARD,
  blockThemeToSoundHardness,
  blockSoundHardnessToIndex,
  blockSoundHardnessIndexToName,
  blockThemeToId,
  blockThemeIdToTheme,
  blockThemeRefToTheme,
  normalizeBlockThemeId,
  blockThemeToIndex,
  indexToBlockTheme,
  WALL_THEME_DEFAULT_INDEX,
} from './blockTheme';

/**
 * Background visual identifier for a room.
 * Controls the parallax background image (or effect) shown behind the level.
 */
export type BackgroundId = string;

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
  /** Number of atmospheric dust motes hovering near this source (0 = none). */
  readonly dustMoteCount?: number;
  /** Radius (blocks) within which dust motes spawn; defaults to radiusBlocks. */
  readonly dustMoteSpreadBlocks?: number;
}

/**
 * A pixel-art sunbeam authored in the editor.
 *
 * The beam originates at (`xBlock`, `yBlock`) and travels in `angleRad` direction,
 * forming a tapered rectangle.  Rendered behind walls so shafts appear to pierce
 * through openings.
 */
export interface RoomSunbeamDef {
  readonly xBlock: number;
  readonly yBlock: number;
  /** Angle (radians) the beam travels — 0 = right, π/2 = down. */
  readonly angleRad: number;
  /** Width of the beam base in blocks. */
  readonly widthBlocks: number;
  /** Length of the beam shaft in blocks. */
  readonly lengthBlocks: number;
  readonly colorR: number;
  readonly colorG: number;
  readonly colorB: number;
  /** Intensity as 0–100 percent (controls peak alpha). */
  readonly intensityPct: number;
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
  /** 1 if this enemy is the Radiant Web boss — floating sphere that fires splitting beam attacks. */
  isRadiantWebFlag?: 0 | 1;
  /** 1 if this enemy is the Crimson Wizard boss. */
  isCrimsonWizardFlag?: 0 | 1;
  /** 1 if this enemy is The Herald boss — void wizard, fires Void Sphere projectiles. */
  isHeraldFlag?: 0 | 1;
  /** 1 if this enemy is the Ice Wizard boss. */
  isIceWizardFlag?: 0 | 1;
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
  /**
   * 1 if this enemy is a Web Spider — fires white web lines to terrain anchors,
   * swings toward the player via rope physics, detaches, and repeats.
   */
  isWebSpiderFlag?: 0 | 1;
  /** 1 if this enemy is a Big Wallback Snake — large, slow, thick wall-climber. */
  isWallSnakeFlag?: 0 | 1;
  /** 1 if this enemy is a Needle Snake — thin, fast, erratic wall-climber. */
  isNeedleSnakeFlag?: 0 | 1;
  /**
   * 1 if this enemy is a Dust Constellation Sentinel — a cluster of glowing
   * dust motes that attacks by freezing into patterns and firing chained beams.
   */
  isDustConstellationFlag?: 0 | 1;
  /** 1 for the large Dust Constellation Sentinel variant (more motes, higher HP). */
  isDustConstellationLargeFlag?: 0 | 1;
  /**
   * 1 if this enemy is an Orbital Dust Core — a floating enemy made of orbiting
   * dust mote rings around a vulnerable core.
   */
  isOrbitalDustCoreFlag?: 0 | 1;
  /** 1 for the large Orbital Dust Core variant (4 rings, more motes, higher HP). */
  isOrbitalDustCoreLargeFlag?: 0 | 1;
  /**
   * 1 if this enemy is a Dust Block Mimic — a false block that cracks open into
   * a hostile swarm of living dust.
   */
  isDustBlockMimicFlag?: 0 | 1;
  /** 1 for the large Dust Block Mimic variant (2×2 block, more motes, higher HP). */
  isDustBlockMimicLargeFlag?: 0 | 1;
  /** 1 if this enemy is a Dust Weaver Architect. */
  isDustWeaverArchitectFlag?: 0 | 1;
  /** 1 for the large Dust Weaver Architect variant (more motes, higher HP, larger patterns). */
  isDustWeaverArchitectLargeFlag?: 0 | 1;
  /** 1 for a Void Singularity enemy. */
  isVoidSingularityFlag?: 0 | 1;
  /** 1 when this Void Singularity is part of the paired black hole / white hole variant. */
  isVoidSingularityPairFlag?: 0 | 1;
  /** 1 if this enemy is a Dust Leech. */
  isDustLeechFlag?: 0 | 1;
  /** 1 if this enemy is a grid-aligned block enemy. */
  isGridBlockEnemyFlag?: 0 | 1;
  /** 0 = 1×1, 1 = 2×2. */
  gridBlockSizeIndex?: 0 | 1;
  /** 0 = slow, 1 = medium, 2 = fast. */
  gridBlockSpeedIndex?: 0 | 1 | 2;
  /** 1 if this enemy is a grid-aligned segmented snake. */
  isGridSnakeEnemyFlag?: 0 | 1;
  /** Number of body segments following the snake head. */
  gridSnakeLength?: number;
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
 * A trigger strip connecting this room to an adjacent room.
 *
 * Boundary walls are complete solid rectangles with no openings.
 * Transitions are invisible trigger strips placed inside the boundary.
 * The trigger fires when the player enters the strip past its near
 * (inner) edge, before the boundary wall stops movement.
 */
export interface RoomTransitionDef {
  /** Direction the player walks to leave through this transition. */
  direction: TransitionDirection;
  /** ID of the room this transition leads to. */
  targetRoomId: string;
  /**
   * X block coordinate of the top-left corner of the trigger zone.
   * For left/right: x-start of the gradient zone.
   * For up/down: x-start of the trigger strip.
   * Populated by editorRoomBuilder at conversion time.
   */
  xBlock: number;
  /**
   * Y block coordinate of the top-left corner of the trigger zone.
   * For left/right: y-start of the trigger strip.
   * For up/down: y-start of the gradient zone.
   * Populated by editorRoomBuilder at conversion time.
   */
  yBlock: number;
  /**
   * @deprecated Legacy field: for left/right = y-start of trigger strip;
   * for up/down = x-start of trigger strip. Superseded by xBlock/yBlock.
   */
  positionBlock: number;
  /**
   * Span (length) of the trigger strip in blocks.
   * For left/right transitions this is the vertical span (height in blocks).
   * For up/down transitions this is the horizontal span (width in blocks).
   */
  openingSizeBlocks: number;
  /**
   * Block coordinate where the player spawns in the target room.
   * [xBlock, yBlock]
   */
  targetSpawnBlock: readonly [number, number];
  /** Color used for the tunnel fade gradient. Defaults to black if unset. */
  fadeColor?: string;
  /**
   * @deprecated Legacy field: left edge (L/R) or top edge (U/D) of the gradient
   * zone. Superseded by xBlock/yBlock.
   */
  depthBlock?: number;
  /**
   * When true, this transition is a secret door: the fade gradient begins
   * invisible and only activates when the player is very close.
   */
  isSecretDoor?: boolean;
  /**
   * Depth of the fade gradient zone in the facing direction, in blocks (default: 3).
   */
  gradientWidthBlocks?: number;
  /**
   * When true, this transition uses the legacy teleport-style room load instead of
   * the seamless adjacent-room crossing camera behaviour.  Entering it immediately
   * loads the target room without smooth camera crossing or staged-room rendering.
   * Default is false (seamless crossing).
   */
  longTransition?: boolean;
}

// ── Room element definitions (hazards, collectibles, decorations, dialogue) ───
// All element interfaces from this point through RoomDialogueTriggerDef have
// been extracted to roomElementDefs.ts. Re-exported here so existing callers
// don't need to update their import paths.
export type {
  SpikeDirection,
  SpikeSize,
  RoomSpikeDef,
  RoomSpringboardDef,
  RoomZoneDef,
  RoomBreakableBlockDef,
  CrumbleVariant,
  RoomCrumbleBlockDef,
  RoomBouncePadDef,
  RoomKineticBlockDef,
  RoomGrappleCarryBlockDef,
  RoomPhantasmalTileDef,
  RopeDestructibility,
  RoomRopeDef,
  RoomDustBoostJarDef,
  RoomFireflyJarDef,
  RoomLambdaAnchorDef,
  RoomDustSwarmDef,
  RoomDustPileDef,
  DecorationKind,
  RoomDecorationDef,
  FallingBlockVariant,
  RoomFallingBlockDef,
  RoomBackgroundBlockDef,
  RoomGrasshopperAreaDef,
  RoomFireflyAreaDef,
  RoomDialogueEntryDef,
  RoomConversationDef,
  RoomDialogueTriggerDef,
  RoomGuideDustPathPointDef,
  RoomGuideDustPathDef,
} from './roomElementDefs';
export {
  DEFAULT_ROPE_SEGMENT_COUNT,
  MIN_ROPE_LENGTH_BLOCKS,
  ROPE_THICKNESS_HALF_WORLD,
} from './roomElementDefs';

/**
 * Intensity of the block seam blending overlay system.
 * 'off' = no overlay (default, preserves existing visuals exactly).
 * 'subtle' = conservative organic accents.
 * 'organic' = visibly natural seam transitions.
 * 'heavy' = pronounced — good for overgrown or corrupted rooms.
 */
export type BlockSeamBlending = 'off' | 'subtle' | 'organic' | 'heavy';

/**
 * Visual style for the black void outside room bounds.
 *
 * Controls how the hard rectangular black cutoff at room edges is softened
 * when the player viewport extends beyond the room boundary.
 *
 * - `'off'`          — default behaviour: pure black hard edge.
 * - `'noisyEdge'`    — deterministic pixel-art noise bites into the room edge by
 *                      0–5 virtual pixels for an organic cave-darkness look.
 * - `'exteriorFill'` — a dark cave-wall continuation fills a short strip outside
 *                      the room, then the noisy edge mask is applied on top.
 *
 * All options are purely visual — no collision or room data is altered.
 * The effect is deterministic, anchored to room/world coordinates, and stable
 * during camera movement.
 */
export type VoidEdgeStyle = 'off' | 'noisyEdge' | 'exteriorFill';

/** Rendering style for room-level god-ray/sunray environment effect. */
export type SunraysStyle = 'hard' | 'soft';

/**
 * Room-level "sunrays" environment effect: procedural god-ray shafts entering
 * from the top of the screen at a designer-configured angle. Distinct from
 * {@link RoomSunbeamDef}, which are individually hand-placed light shafts —
 * this is a single global toggle that generates a deterministic ray field.
 */
export interface RoomSunraysDef {
  /** Whether the effect is drawn for this room. Defaults to false. */
  enabled: boolean;
  /** 'hard' = crisp pixel-art shafts. 'soft' = layered, blurred, screen-composited beams. */
  style: SunraysStyle;
  /** Where rays originate. Currently only the top edge of the viewport is supported. */
  source: 'top';
  /** Direction rays travel after entering, in degrees. 90 = straight down, <90 = down-right, >90 = down-left. */
  angleDeg: number;
  /** Overall brightness multiplier, 0–1. Defaults to 0.5 when unset. */
  intensity?: number;
  /** Number of ray shafts to generate. Defaults to 6 when unset. */
  rayCount?: number;
  /** Subtle sway/pulse animation. Defaults to true when unset. */
  animationEnabled?: boolean;
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
  /** Default player SFX material hardness for walls in this room. */
  soundHardness?: BlockSoundHardness;
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
   * Blends the directional-light model between broad ambient (0) and a strict
   * spotlight (1). Range 0–1; defaults to 0.65 when unset.
   */
  directionalBias?: number;
  /**
   * How much non-sky-connected (interior) air neighbours contribute to tile
   * brightness. Range 0–1; defaults to 0.45 when unset.
   */
  sideExposureStrength?: number;
  /**
   * Minimum brightness fraction for any solid tile that borders open air.
   * Prevents walls adjacent to air from going completely black.
   * Range 0–1; defaults to 0.18 when unset.
   */
  minimumWallLight?: number;
  /**
   * Gamma-like exponent applied to the raw exposure value before computing
   * the darkness alpha. Higher values make the falloff steeper.
   * Range 0.5–3; defaults to 1.4 when unset.
   */
  falloffPower?: number;
  /**
   * How strongly the solid-tile directional light bleeds as a warm-tinted glow
   * onto the air/background layer.
   * 0.0 (default) = no spill — prevents cloudy-blob artefacts.
   * Increase gently (e.g. 0.04–0.08) for a subtle warm atmosphere.
   */
  backgroundLightSpill?: number;
  /**
   * Softness radius for the per-tile darkness overlay on solid tiles.
   * 0.0 (default) = crisp pixel-art; 1.0 = maximum softening.
   * Kept as a stored setting; the renderer currently accepts the value but
   * tiles remain pixel-crisp until a blur pass is added.
   */
  solidLightSoftness?: number;
  /**
   * Optional block seam blending overlay.
   * When set, the renderer draws procedural transition stamps at tile seams
   * between adjacent tiles of different block themes.
   * Defaults to 'off' — existing rooms are visually unchanged.
   */
  blockSeamBlending?: BlockSeamBlending;
  /**
   * Visual style for the black void outside room bounds.
   * Defaults to 'off' — existing rooms are visually unchanged.
   * See {@link VoidEdgeStyle} for details.
   */
  voidEdgeStyle?: VoidEdgeStyle;
  /**
   * Tiles that block ambient-light propagation. Gameplay treats them as empty
   * air; only the ambient-lighting solver sees them as opaque. Used to carve
   * out authored "hidden dark pockets" that only light up when a physical path
   * to the outside opens.
   */
  ambientLightBlockers?: readonly RoomAmbientLightBlockerDef[];
  /** Designer-placed local light sources (see {@link RoomLightSourceDef}). */
  lightSources?: readonly RoomLightSourceDef[];
  /** Designer-placed sunbeams (see {@link RoomSunbeamDef}). */
  sunbeams?: readonly RoomSunbeamDef[];
  /** Room-level procedural sunrays/god-rays effect (see {@link RoomSunraysDef}). */
  sunrays?: RoomSunraysDef;
  /** Designer-placed scene lights (visibility-polygon shadow system). */
  sceneLights?: readonly import('./lightingSchema').LightDef[];
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
  /**
   * Collectible dust container piece positions (block units).
   * Pieces accumulate; when enough are collected they grant a full container.
   */
  dustContainerPieces?: readonly { xBlock: number; yBlock: number }[];
  /**
   * Dust type swarms — collectible sandstorm clusters of a specific dust kind.
   * Each swarm appears as a small animated swirl of coloured particles; the player
   * collects it by walking nearby and pressing F, receiving `dustCount` particles.
   */
  dustSwarms?: readonly RoomDustSwarmDef[];
  /** Lambda Anchors — golden λ-glyph poles acting as temporary recall points. */
  lambdaAnchors?: readonly RoomLambdaAnchorDef[];

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
  /** Bounce pad blocks that reflect the player's velocity on contact. */
  bouncePads?: readonly RoomBouncePadDef[];
  kineticBlocks?: readonly RoomKineticBlockDef[];
  /** Movable 1x1 grapple-carry physics blocks. */
  grappleCarryBlocks?: readonly RoomGrappleCarryBlockDef[];
  /** 1x1 ghost tiles that block grapple-carry blocks but not the player or grapple raycasts. */
  phantasmalTiles?: readonly RoomPhantasmalTileDef[];
  /** Ropes hanging between anchor points in the room. */
  ropes?: readonly RoomRopeDef[];
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
  /** Falling block tiles — grouped into rigid falling units at load time. */
  fallingBlocks?: readonly RoomFallingBlockDef[];
  /** Visual-only background blocks — no collision, drawn behind foreground walls. */
  backgroundBlocks?: readonly RoomBackgroundBlockDef[];
  /** Dialogue trigger zones — start a conversation when the player enters. */
  dialogueTriggers?: readonly RoomDialogueTriggerDef[];
  /** Golden dust guide paths — Catmull-Rom splines with organic mote particles. */
  guideDustPaths?: readonly RoomGuideDustPathDef[];
  /**
   * Pre-baked runtime wall template hydrated from JSON during room load.
   * When present and valid (source hash matches), Phase D of room loading skips
   * the expensive `buildRoomWallTemplate()` merge pass and applies this directly.
   * Absent for older rooms that have not been re-exported since BUILD 420.
   */
  bakedWallTemplate?: RoomWallTemplate;
  /**
   * Background music for this room.
   * '_continue' = keep playing the previous room's song (default / undefined).
   * '_silence'  = stop music when entering this room.
   * Any other value = switch to the named song when entering this room.
   * When undefined, treated as '_continue'.
   */
  songId?: RoomSongId;
}

// ── RoomWallTemplate ──────────────────────────────────────────────────────────

/**
 * Immutable snapshot of the merged wall geometry for a single room.
 * Produced by `buildRoomWallTemplate()` and consumed by `applyRoomWallTemplate()`.
 * Arrays are sized to `wallCount` (the actual post-merge count), not MAX_WALLS,
 * so cached templates are memory-efficient even for large rooms.
 *
 * Defined here (in roomDef.ts) so that RoomDef.bakedWallTemplate can reference
 * it without creating a circular dependency with gameRoomWalls.ts.
 * Re-exported from gameRoomWalls.ts for backward compatibility.
 */
export interface RoomWallTemplate {
  readonly wallCount: number;
  readonly xWorld: Float32Array;
  readonly yWorld: Float32Array;
  readonly wWorld: Float32Array;
  readonly hWorld: Float32Array;
  readonly isPlatformFlag: Uint8Array;
  readonly platformEdge: Uint8Array;
  readonly themeIndex: Uint8Array;
  readonly soundHardnessIndex: Uint8Array;
  readonly isInvisibleFlag: Uint8Array;
  readonly rampOrientationIndex: Uint8Array;
  readonly isPillarHalfWidthFlag: Uint8Array;
  /** 1 for walls whose theme is 'ice' — used for ice-surface physics and grapple rejection. */
  readonly isIceFlag: Uint8Array;
  /** 1 for walls whose theme is 'ultraIceBlock' — velocity lock and grapple recharge suppression. */
  readonly isUltraIceFlag: Uint8Array;
}
