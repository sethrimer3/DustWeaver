/**
 * customBlockProperties.ts — Engine-owned registry of safe, predefined
 * properties for custom blocks (Phase 2A).
 *
 * A custom block's `properties` object selects an ENGINE-DEFINED behavior by
 * enum id.  It never carries executable code, callbacks, arbitrary physics
 * numbers, or references to internal class/module names.  JSON never names
 * an internal class directly — only the serialized preset id (e.g. "oneWay")
 * which this registry maps to concrete engine behavior.
 *
 * Presets implemented in Phase 2A:
 *   - Collision:     solid | oneWay | nonSolid
 *   - Friction:      default | slippery
 *   - Breakability:  indestructible | fragile
 *
 * Presets implemented in Phase 2C:
 *   - Material response: stone | wood | metal (break sound + particle feedback)
 *
 * Presets implemented in Phase 2D:
 *   - Contact damage: none | low | high (player-damage feedback on solid contact)
 *
 * Presets implemented in Phase 2E:
 *   - Break resistance: weak | standard | reinforced (fragile-block momentum threshold)
 *
 * Presets implemented in Phase 2F:
 *   - Wind response: passThrough | dampen | block (pixel-material wind transmission)
 *
 * See CustomBlockSpriteSystem.md → "Future Predefined Properties" for
 * deferred categories (liquids, triggers).
 */

import type { CustomBlockValidationError } from './customBlocks';

// ── Preset enums ──────────────────────────────────────────────────────────────

export type CollisionPreset = 'solid' | 'oneWay' | 'nonSolid';
export type FrictionPreset = 'default' | 'slippery';
export type BreakabilityPreset = 'indestructible' | 'fragile';
export type MaterialResponsePreset = 'stone' | 'wood' | 'metal';
export type ContactDamagePreset = 'none' | 'low' | 'high';
export type BreakResistancePreset = 'weak' | 'standard' | 'reinforced';
/**
 * Phase 2F: how much a solid custom block attenuates PIXEL-MATERIAL wind
 * transmission (sand/water/sandstone wind, via PixelMaterialSystem.applyWindForce).
 * Named distinctly (not "WindResponsePreset") because DustWeaver already has an
 * UNRELATED per-pixel-material "wind response" concept
 * (getMaterialWindResponse in pixelMaterialTypes.ts — how reactive a material
 * itself is to wind). This property controls only the TRANSMISSION term (how
 * much force reaches a material through this block), never the material's own
 * response multiplier — see CustomBlockSpriteSystem.md for the full formula.
 */
export type CustomBlockWindResponsePreset = 'passThrough' | 'dampen' | 'block';

export const COLLISION_PRESET_IDS: readonly CollisionPreset[] = ['solid', 'oneWay', 'nonSolid'];
export const FRICTION_PRESET_IDS: readonly FrictionPreset[] = ['default', 'slippery'];
export const BREAKABILITY_PRESET_IDS: readonly BreakabilityPreset[] = ['indestructible', 'fragile'];
export const MATERIAL_RESPONSE_PRESET_IDS: readonly MaterialResponsePreset[] = ['stone', 'wood', 'metal'];
export const CONTACT_DAMAGE_PRESET_IDS: readonly ContactDamagePreset[] = ['none', 'low', 'high'];
export const BREAK_RESISTANCE_PRESET_IDS: readonly BreakResistancePreset[] = ['weak', 'standard', 'reinforced'];
export const CUSTOM_BLOCK_WIND_RESPONSE_PRESET_IDS: readonly CustomBlockWindResponsePreset[] = ['passThrough', 'dampen', 'block'];

export function isCollisionPreset(v: unknown): v is CollisionPreset {
  return typeof v === 'string' && (COLLISION_PRESET_IDS as readonly string[]).includes(v);
}
export function isFrictionPreset(v: unknown): v is FrictionPreset {
  return typeof v === 'string' && (FRICTION_PRESET_IDS as readonly string[]).includes(v);
}
export function isBreakabilityPreset(v: unknown): v is BreakabilityPreset {
  return typeof v === 'string' && (BREAKABILITY_PRESET_IDS as readonly string[]).includes(v);
}
export function isMaterialResponsePreset(v: unknown): v is MaterialResponsePreset {
  return typeof v === 'string' && (MATERIAL_RESPONSE_PRESET_IDS as readonly string[]).includes(v);
}
export function isContactDamagePreset(v: unknown): v is ContactDamagePreset {
  return typeof v === 'string' && (CONTACT_DAMAGE_PRESET_IDS as readonly string[]).includes(v);
}
export function isBreakResistancePreset(v: unknown): v is BreakResistancePreset {
  return typeof v === 'string' && (BREAK_RESISTANCE_PRESET_IDS as readonly string[]).includes(v);
}
export function isCustomBlockWindResponsePreset(v: unknown): v is CustomBlockWindResponsePreset {
  return typeof v === 'string' && (CUSTOM_BLOCK_WIND_RESPONSE_PRESET_IDS as readonly string[]).includes(v);
}

// ── Validated property bundle ─────────────────────────────────────────────────

/** The fully-validated, runtime-safe property bundle for one custom block. */
export interface CustomBlockProperties {
  readonly collision: CollisionPreset;
  readonly friction: FrictionPreset;
  readonly breakability: BreakabilityPreset;
  /**
   * Phase 2C: selects the engine-owned break sound + particle profile used
   * when a fragile placement using this block is destroyed. Also selectable
   * on indestructible blocks so it is already resolved for future impact
   * feedback, but no break effect fires unless the placement is actually
   * fragile and destroyed (see resolveMaterialResponseBreakProfile usage in
   * src/sim/hazards.ts).
   */
  readonly materialResponse: MaterialResponsePreset;
  /**
   * Phase 2D: selects the engine-owned contact-damage tier applied to the
   * player when they collide with this block's solid surface. 'none' means
   * the block never damages the player (matches all pre-Phase-2D behavior).
   * Requires `collision: 'solid'` — see `contactDamageRequiresSolid` below.
   */
  readonly contactDamage: ContactDamagePreset;
  /**
   * Phase 2E: selects the engine-owned momentum threshold a fragile
   * placement using this block requires to break. Meaningful only when
   * `breakability: 'fragile'` and `collision: 'solid'` — retained (but
   * inert at runtime) on indestructible/non-solid blocks so switching a
   * block back to fragile restores the creator's chosen tier. 'standard'
   * is byte-identical to the pre-Phase-2E global threshold.
   */
  readonly breakResistance: BreakResistancePreset;
  /**
   * Phase 2F: selects how much this solid block attenuates pixel-material
   * wind transmission (sand/water/sandstone). 'passThrough' (the default)
   * is a complete no-op — matches all pre-Phase-2F behavior exactly.
   * Meaningful only when `collision: 'solid'` — see
   * `windResponseRequiresSolid` below.
   */
  readonly windResponse: CustomBlockWindResponsePreset;
}

/**
 * Defaults equivalent to Phase-1 behavior (always solid, no friction/breakability),
 * with 'stone' as the safe Phase 2C material-response default, 'none' as the
 * safe Phase 2D contact-damage default, 'standard' as the safe Phase 2E
 * break-resistance default (preserves the original global threshold exactly),
 * and 'passThrough' as the safe Phase 2F wind-response default (a complete
 * no-op on the existing wind system).
 */
export const DEFAULT_CUSTOM_BLOCK_PROPERTIES: CustomBlockProperties = {
  collision: 'solid',
  friction: 'default',
  breakability: 'indestructible',
  materialResponse: 'stone',
  contactDamage: 'none',
  breakResistance: 'standard',
  windResponse: 'passThrough',
};

// ── Registry metadata (drives both validation and editor UI) ────────────────

export interface PresetMeta<T extends string> {
  readonly id: T;
  readonly label: string;
  /** Short explanation shown in the editor UI. */
  readonly description: string;
}

export const COLLISION_PRESET_REGISTRY: Readonly<Record<CollisionPreset, PresetMeta<CollisionPreset>>> = {
  solid: {
    id: 'solid',
    label: 'Solid',
    description: 'Blocks the player across the full footprint.',
  },
  oneWay: {
    id: 'oneWay',
    label: 'One-way',
    description: 'Can be passed from below and stood on from above.',
  },
  nonSolid: {
    id: 'nonSolid',
    label: 'Non-solid',
    description: 'Visual only and does not block the player.',
  },
};

export const FRICTION_PRESET_REGISTRY: Readonly<Record<FrictionPreset, PresetMeta<FrictionPreset>>> = {
  default: {
    id: 'default',
    label: 'Default friction',
    description: 'Normal movement behavior.',
  },
  slippery: {
    id: 'slippery',
    label: 'Slippery',
    description: 'Reduced horizontal traction using the existing ice surface behavior.',
  },
};

export const BREAKABILITY_PRESET_REGISTRY: Readonly<Record<BreakabilityPreset, PresetMeta<BreakabilityPreset>>> = {
  indestructible: {
    id: 'indestructible',
    label: 'Indestructible',
    description: 'Cannot be broken through ordinary gameplay.',
  },
  fragile: {
    id: 'fragile',
    label: 'Fragile',
    description: 'Uses the existing breakable-block behavior: breaks when the player hits it with enough momentum.',
  },
};

export const MATERIAL_RESPONSE_PRESET_REGISTRY: Readonly<Record<MaterialResponsePreset, PresetMeta<MaterialResponsePreset>>> = {
  stone: {
    id: 'stone',
    label: 'Stone',
    description: 'Heavy stone-like break sound and rocky debris.',
  },
  wood: {
    id: 'wood',
    label: 'Wood',
    description: 'Lighter wooden crack and splinter-like debris.',
  },
  metal: {
    id: 'metal',
    label: 'Metal',
    description: 'Metallic impact and spark-like debris.',
  },
};

export const CONTACT_DAMAGE_PRESET_REGISTRY: Readonly<Record<ContactDamagePreset, PresetMeta<ContactDamagePreset>>> = {
  none: {
    id: 'none',
    label: 'None',
    description: 'Does not damage the player.',
  },
  low: {
    id: 'low',
    label: 'Low',
    description: "Applies the engine's lower contact-damage preset.",
  },
  high: {
    id: 'high',
    label: 'High',
    description: "Applies the engine's stronger contact-damage preset.",
  },
};

export const BREAK_RESISTANCE_PRESET_REGISTRY: Readonly<Record<BreakResistancePreset, PresetMeta<BreakResistancePreset>>> = {
  weak: {
    id: 'weak',
    label: 'Weak',
    description: 'Breaks from lighter impacts.',
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Uses the existing break threshold.',
  },
  reinforced: {
    id: 'reinforced',
    label: 'Reinforced',
    description: 'Requires a substantially stronger impact.',
  },
};

export const CUSTOM_BLOCK_WIND_RESPONSE_PRESET_REGISTRY: Readonly<Record<CustomBlockWindResponsePreset, PresetMeta<CustomBlockWindResponsePreset>>> = {
  passThrough: {
    id: 'passThrough',
    label: 'Pass-through',
    description: 'Wind reaches pixel materials normally.',
  },
  dampen: {
    id: 'dampen',
    label: 'Dampen',
    description: 'Reduces wind reaching pixel materials behind this block.',
  },
  block: {
    id: 'block',
    label: 'Windbreak',
    description: 'Blocks wind reaching pixel materials behind this block.',
  },
};

// ── Numeric packing (WorldState typed arrays never store strings) ───────────

/** Packs a MaterialResponsePreset into a compact index for Uint8Array storage. */
export function materialResponseToIndex(material: MaterialResponsePreset): number {
  switch (material) {
    case 'stone': return 0;
    case 'wood': return 1;
    case 'metal': return 2;
  }
}

/** Unpacks a Uint8Array index back into a MaterialResponsePreset. Unknown indices default to 'stone'. */
export function indexToMaterialResponse(index: number): MaterialResponsePreset {
  switch (index) {
    case 1: return 'wood';
    case 2: return 'metal';
    default: return 'stone';
  }
}

/**
 * Packs a damaging ContactDamagePreset ('low'|'high') into a compact index
 * for Uint8Array storage. 'none' is never stored — blocks with no contact
 * damage simply have no entry in the runtime contact-damage arrays at all
 * (see isEligibleForContactDamage), so there is no index for 'none'.
 */
export function contactDamageTierToIndex(tier: 'low' | 'high'): number {
  return tier === 'high' ? 1 : 0;
}

/** Unpacks a Uint8Array index back into the damaging tier. Unknown indices default to 'low'. */
export function indexToContactDamageTier(index: number): 'low' | 'high' {
  return index === 1 ? 'high' : 'low';
}

/** Packs a BreakResistancePreset into a compact index for Uint8Array storage. */
export function breakResistanceToIndex(resistance: BreakResistancePreset): number {
  switch (resistance) {
    case 'weak': return 0;
    case 'standard': return 1;
    case 'reinforced': return 2;
  }
}

/** Unpacks a Uint8Array index back into a BreakResistancePreset. Unknown indices default to 'standard'. */
export function indexToBreakResistance(index: number): BreakResistancePreset {
  switch (index) {
    case 0: return 'weak';
    case 2: return 'reinforced';
    default: return 'standard';
  }
}

/**
 * Packs an active CustomBlockWindResponsePreset ('dampen'|'block') into a
 * compact index for Uint8Array storage. 'passThrough' is never stored — a
 * block with pass-through wind response has no entry in the runtime wind-
 * transmission mask at all (see isEligibleForWindTransmission), mirroring the
 * contactDamage 'none'-is-never-stored convention above.
 */
export function windResponseTierToIndex(tier: 'dampen' | 'block'): number {
  return tier === 'block' ? 1 : 0;
}

/** Unpacks a Uint8Array index back into the active wind-response tier. Unknown indices default to 'dampen'. */
export function indexToWindResponseTier(index: number): 'dampen' | 'block' {
  return index === 1 ? 'block' : 'dampen';
}

// ── Compatibility rules ───────────────────────────────────────────────────────

export interface CustomBlockCompatibilityIssue {
  /** Which combination rule was violated. */
  rule: 'nonSolidNoFriction' | 'fragileRequiresSolid' | 'fragileRequiresSupportedFootprint' | 'contactDamageRequiresSolid' | 'windResponseRequiresSolid';
  message: string;
}

/**
 * Checks cross-property compatibility rules. Does NOT mutate or silently
 * "fix" anything — callers decide whether to block a save (editor) or fall
 * back to a safe default (loading untrusted/legacy data).
 */
export function checkCustomBlockPropertyCompatibility(
  properties: CustomBlockProperties,
  tileWidth: 1 | 2,
  tileHeight: 1 | 2,
): CustomBlockCompatibilityIssue[] {
  const issues: CustomBlockCompatibilityIssue[] = [];

  if (properties.collision === 'nonSolid' && properties.friction !== 'default') {
    issues.push({
      rule: 'nonSolidNoFriction',
      message: 'Non-solid blocks do not collide with the player, so friction has no effect. Set friction to Default.',
    });
  }

  if (properties.breakability === 'fragile' && properties.collision !== 'solid') {
    issues.push({
      rule: 'fragileRequiresSolid',
      message: 'Fragile blocks require Solid collision (the existing breakable-block pathway replaces a solid wall).',
    });
  }

  // Phase 2B: 1x1 and 2x2 are both supported footprints for fragile blocks
  // (2x2 uses the logical-placement grouping in isEligibleForBreakablePathway
  // / the group-destroy loop in src/sim/hazards.ts to break all 4 cells
  // atomically). Any OTHER footprint (should not occur today — tileWidth and
  // tileHeight are only ever 1 or 2 — but this keeps the rule future-proof)
  // is rejected rather than silently guessed at.
  const isSupportedFragileFootprint =
    (tileWidth === 1 && tileHeight === 1) || (tileWidth === 2 && tileHeight === 2);
  if (properties.breakability === 'fragile' && !isSupportedFragileFootprint) {
    issues.push({
      rule: 'fragileRequiresSupportedFootprint',
      message: 'Fragile is only available for 1×1 or 2×2 blocks — this footprint is not supported by the ' +
        'breakable-block pathway.',
    });
  }

  // Phase 2D: contact damage requires solid collision — a one-way or
  // non-solid block has no continuously-blocking surface for the player to
  // be damaged by, and this phase deliberately stays on the existing solid-
  // contact pathway rather than adding a separate trigger-volume system.
  if (properties.contactDamage !== 'none' && properties.collision !== 'solid') {
    issues.push({
      rule: 'contactDamageRequiresSolid',
      message: 'Contact damage requires Solid collision — one-way and non-solid blocks have no blocking ' +
        'surface for the player to be damaged by. Set Contact damage to None.',
    });
  }

  // Phase 2F: wind transmission requires solid collision — a one-way or
  // non-solid block has no continuous native-pixel footprint for the wind
  // ray-trace to treat as an occluder, and this phase deliberately reuses the
  // existing solid-wall footprint rather than adding a separate volume shape.
  if (properties.windResponse !== 'passThrough' && properties.collision !== 'solid') {
    issues.push({
      rule: 'windResponseRequiresSolid',
      message: 'Wind response requires Solid collision — one-way and non-solid blocks have no footprint for ' +
        'the wind transmission mask. Set Wind response to Pass-through.',
    });
  }

  return issues;
}

/** Returns true if `properties` is internally consistent for the given footprint. */
export function isCompatibleCustomBlockProperties(
  properties: CustomBlockProperties,
  tileWidth: 1 | 2,
  tileHeight: 1 | 2,
): boolean {
  return checkCustomBlockPropertyCompatibility(properties, tileWidth, tileHeight).length === 0;
}

// ── Validation (safe fallback, never crashes) ─────────────────────────────────

export interface CustomBlockPropertyValidationResult {
  properties: CustomBlockProperties;
  /** Structured diagnostics for any value that was rejected and replaced with a fallback. */
  errors: CustomBlockValidationError[];
  fallbackUsed: boolean;
}

/**
 * Validates a raw `properties` object (as found in schemaVersion-2 JSON) and
 * returns a fully-resolved, safe CustomBlockProperties bundle. Unknown keys,
 * unsupported enum values, or incompatible combinations never throw — each
 * offending field falls back to its engine default and is reported.
 */
export function validateAndResolveCustomBlockProperties(
  raw: unknown,
  tileWidth: 1 | 2,
  tileHeight: 1 | 2,
  context?: { blockId?: string; filePath?: string },
): CustomBlockPropertyValidationResult {
  const ctx = context ?? {};
  const errors: CustomBlockValidationError[] = [];
  let fallbackUsed = false;

  function pushError(field: string, expected: string, received: string): void {
    errors.push({ field, expected, received, ...ctx });
    fallbackUsed = true;
  }

  let collision: CollisionPreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.collision;
  let friction: FrictionPreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.friction;
  let breakability: BreakabilityPreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.breakability;
  let materialResponse: MaterialResponsePreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.materialResponse;
  let contactDamage: ContactDamagePreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.contactDamage;
  let breakResistance: BreakResistancePreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.breakResistance;
  let windResponse: CustomBlockWindResponsePreset = DEFAULT_CUSTOM_BLOCK_PROPERTIES.windResponse;

  if (raw === undefined || raw === null) {
    // No properties object at all (e.g. schemaVersion 1, or a schemaVersion 2
    // block saved before Phase 2C/2D/2E/2F) — pure defaults, not an error.
    return { properties: { collision, friction, breakability, materialResponse, contactDamage, breakResistance, windResponse }, errors, fallbackUsed: false };
  }

  if (typeof raw !== 'object') {
    pushError('properties', 'object', String(typeof raw));
    return { properties: { collision, friction, breakability, materialResponse, contactDamage, breakResistance, windResponse }, errors, fallbackUsed };
  }

  const r = raw as Record<string, unknown>;

  if ('collision' in r) {
    if (isCollisionPreset(r['collision'])) {
      collision = r['collision'];
    } else {
      pushError('properties.collision', COLLISION_PRESET_IDS.join(' | '), String(r['collision']));
    }
  }

  if ('friction' in r) {
    if (isFrictionPreset(r['friction'])) {
      friction = r['friction'];
    } else {
      pushError('properties.friction', FRICTION_PRESET_IDS.join(' | '), String(r['friction']));
    }
  }

  if ('breakability' in r) {
    if (isBreakabilityPreset(r['breakability'])) {
      breakability = r['breakability'];
    } else {
      pushError('properties.breakability', BREAKABILITY_PRESET_IDS.join(' | '), String(r['breakability']));
    }
  }

  // materialResponse is optional even on schemaVersion-2 blocks saved before
  // Phase 2C — absence is not an error, it just resolves to the 'stone' default
  // already assigned above.
  if ('materialResponse' in r) {
    if (isMaterialResponsePreset(r['materialResponse'])) {
      materialResponse = r['materialResponse'];
    } else {
      pushError('properties.materialResponse', MATERIAL_RESPONSE_PRESET_IDS.join(' | '), String(r['materialResponse']));
    }
  }

  // contactDamage is optional even on schemaVersion-2 blocks saved before
  // Phase 2D — absence is not an error, it just resolves to the 'none' default
  // already assigned above.
  if ('contactDamage' in r) {
    if (isContactDamagePreset(r['contactDamage'])) {
      contactDamage = r['contactDamage'];
    } else {
      pushError('properties.contactDamage', CONTACT_DAMAGE_PRESET_IDS.join(' | '), String(r['contactDamage']));
    }
  }

  // breakResistance is optional even on schemaVersion-2 blocks saved before
  // Phase 2E — absence is not an error, it just resolves to the 'standard'
  // default already assigned above (byte-identical to the pre-Phase-2E
  // global threshold).
  if ('breakResistance' in r) {
    if (isBreakResistancePreset(r['breakResistance'])) {
      breakResistance = r['breakResistance'];
    } else {
      pushError('properties.breakResistance', BREAK_RESISTANCE_PRESET_IDS.join(' | '), String(r['breakResistance']));
    }
  }

  // windResponse is optional even on schemaVersion-2 blocks saved before
  // Phase 2F — absence is not an error, it just resolves to the 'passThrough'
  // default already assigned above (a complete no-op on the existing wind
  // system).
  if ('windResponse' in r) {
    if (isCustomBlockWindResponsePreset(r['windResponse'])) {
      windResponse = r['windResponse'];
    } else {
      pushError('properties.windResponse', CUSTOM_BLOCK_WIND_RESPONSE_PRESET_IDS.join(' | '), String(r['windResponse']));
    }
  }

  // Reject unknown extra keys (no arbitrary additional values / no object injection).
  const knownKeys = new Set(['collision', 'friction', 'breakability', 'materialResponse', 'contactDamage', 'breakResistance', 'windResponse']);
  for (const key of Object.keys(r)) {
    if (!knownKeys.has(key)) {
      pushError(`properties.${key}`, '(not a supported property key)', JSON.stringify(r[key]));
    }
  }

  let properties: CustomBlockProperties = { collision, friction, breakability, materialResponse, contactDamage, breakResistance, windResponse };

  // Compatibility fallback: at LOAD time we never reject the block outright —
  // an incompatible combination falls back to a safe default and is reported.
  const compatIssues = checkCustomBlockPropertyCompatibility(properties, tileWidth, tileHeight);
  if (compatIssues.length > 0) {
    for (const issue of compatIssues) {
      pushError(`properties.compatibility.${issue.rule}`, 'compatible combination', issue.message);
    }
    // Safe fallback: force breakability off if fragile was incompatible; force
    // friction to default if nonSolid was combined with slippery; force
    // contactDamage off if it was combined with non-solid collision.
    if (properties.breakability === 'fragile' &&
        (properties.collision !== 'solid' ||
         !((tileWidth === 1 && tileHeight === 1) || (tileWidth === 2 && tileHeight === 2)))) {
      properties = { ...properties, breakability: 'indestructible' };
    }
    if (properties.collision === 'nonSolid' && properties.friction !== 'default') {
      properties = { ...properties, friction: 'default' };
    }
    if (properties.contactDamage !== 'none' && properties.collision !== 'solid') {
      properties = { ...properties, contactDamage: 'none' };
    }
    if (properties.windResponse !== 'passThrough' && properties.collision !== 'solid') {
      properties = { ...properties, windResponse: 'passThrough' };
    }
  }

  return { properties, errors, fallbackUsed };
}

// ── Runtime behavior mapping (selects existing engine pathways) ──────────────

/**
 * Wall-flag mapping for the collision + friction presets, expressed purely in
 * terms of the EXISTING RoomWallDef fields (isPlatformFlag, platformEdge,
 * blockTheme). No new collision or friction code is introduced — this
 * function only selects which existing pathway a wall should use.
 */
export interface ResolvedWallBehavior {
  /** Whether a wall should be generated at all (false for nonSolid). */
  generateWall: boolean;
  isPlatformFlag: 0 | 1;
  platformEdge: 0 | 1 | 2 | 3;
  /** 'ice' reuses the existing low-friction surface; 'blackRock' is normal. */
  blockTheme: 'blackRock' | 'ice';
}

export function resolveWallBehavior(properties: CustomBlockProperties): ResolvedWallBehavior {
  return {
    generateWall: properties.collision !== 'nonSolid',
    isPlatformFlag: properties.collision === 'oneWay' ? 1 : 0,
    platformEdge: 0, // top-only one-way platform — matches existing authored one-way walls.
    blockTheme: properties.friction === 'slippery' ? 'ice' : 'blackRock',
  };
}

/**
 * Returns true if this block/footprint combination should be registered with
 * the existing breakable-block pathway (RoomDef.breakableBlocks). 1×1 and
 * (as of Phase 2B) 2×2 fragile blocks with solid collision are eligible — see
 * `fragileRequiresSupportedFootprint` in the compatibility rules. A 2×2
 * placement is registered as 4 separate breakable-block cells sharing one
 * logical group id (see `editorRoomDataToRoomDef` in editorRoomBuilder.ts and
 * the group-destroy loop in `src/sim/hazards.ts`), NOT as a new data shape.
 */
export function isEligibleForBreakablePathway(
  properties: CustomBlockProperties,
  tileWidth: 1 | 2,
  tileHeight: 1 | 2,
): boolean {
  return properties.breakability === 'fragile' &&
    properties.collision === 'solid' &&
    ((tileWidth === 1 && tileHeight === 1) || (tileWidth === 2 && tileHeight === 2));
}

/**
 * Returns true if this block should be registered with the Phase 2D contact-
 * damage pathway (RoomDef.contactDamageBlocks). Independent of breakability —
 * both fragile and indestructible solid blocks may damage the player on
 * contact. Requires `collision: 'solid'` (see `contactDamageRequiresSolid` in
 * the compatibility rules) — one-way and non-solid blocks are never eligible
 * regardless of footprint.
 */
export function isEligibleForContactDamage(properties: CustomBlockProperties): boolean {
  return properties.contactDamage !== 'none' && properties.collision === 'solid';
}

/**
 * Returns true if this block should be registered with the Phase 2F wind-
 * transmission mask (customBlockWindMask). Independent of breakability and
 * contactDamage — a fragile, damaging, or reinforced solid block may also be
 * a windbreak. Requires `collision: 'solid'` (see `windResponseRequiresSolid`
 * in the compatibility rules) — one-way and non-solid blocks are never
 * eligible. 'passThrough' blocks are never eligible either: they have no
 * runtime effect, so they are simply absent from the mask (see
 * windResponseTierToIndex — 'passThrough' has no packed index).
 */
export function isEligibleForWindTransmission(properties: CustomBlockProperties): boolean {
  return properties.windResponse !== 'passThrough' && properties.collision === 'solid';
}
