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
 * See CustomBlockSpriteSystem.md → "Future Predefined Properties" for
 * deferred categories (hazards, wind, liquids, materials, triggers).
 */

import type { CustomBlockValidationError } from './customBlocks';

// ── Preset enums ──────────────────────────────────────────────────────────────

export type CollisionPreset = 'solid' | 'oneWay' | 'nonSolid';
export type FrictionPreset = 'default' | 'slippery';
export type BreakabilityPreset = 'indestructible' | 'fragile';

export const COLLISION_PRESET_IDS: readonly CollisionPreset[] = ['solid', 'oneWay', 'nonSolid'];
export const FRICTION_PRESET_IDS: readonly FrictionPreset[] = ['default', 'slippery'];
export const BREAKABILITY_PRESET_IDS: readonly BreakabilityPreset[] = ['indestructible', 'fragile'];

export function isCollisionPreset(v: unknown): v is CollisionPreset {
  return typeof v === 'string' && (COLLISION_PRESET_IDS as readonly string[]).includes(v);
}
export function isFrictionPreset(v: unknown): v is FrictionPreset {
  return typeof v === 'string' && (FRICTION_PRESET_IDS as readonly string[]).includes(v);
}
export function isBreakabilityPreset(v: unknown): v is BreakabilityPreset {
  return typeof v === 'string' && (BREAKABILITY_PRESET_IDS as readonly string[]).includes(v);
}

// ── Validated property bundle ─────────────────────────────────────────────────

/** The fully-validated, runtime-safe property bundle for one custom block. */
export interface CustomBlockProperties {
  readonly collision: CollisionPreset;
  readonly friction: FrictionPreset;
  readonly breakability: BreakabilityPreset;
}

/** Defaults equivalent to Phase-1 behavior (always solid, no friction/breakability). */
export const DEFAULT_CUSTOM_BLOCK_PROPERTIES: CustomBlockProperties = {
  collision: 'solid',
  friction: 'default',
  breakability: 'indestructible',
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

// ── Compatibility rules ───────────────────────────────────────────────────────

export interface CustomBlockCompatibilityIssue {
  /** Which combination rule was violated. */
  rule: 'nonSolidNoFriction' | 'fragileRequiresSolid' | 'fragileRequiresSupportedFootprint';
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

  if (raw === undefined || raw === null) {
    // No properties object at all (e.g. schemaVersion 1) — pure defaults, not an error.
    return { properties: { collision, friction, breakability }, errors, fallbackUsed: false };
  }

  if (typeof raw !== 'object') {
    pushError('properties', 'object', String(typeof raw));
    return { properties: { collision, friction, breakability }, errors, fallbackUsed };
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

  // Reject unknown extra keys (no arbitrary additional values / no object injection).
  const knownKeys = new Set(['collision', 'friction', 'breakability']);
  for (const key of Object.keys(r)) {
    if (!knownKeys.has(key)) {
      pushError(`properties.${key}`, '(not a supported property key)', JSON.stringify(r[key]));
    }
  }

  let properties: CustomBlockProperties = { collision, friction, breakability };

  // Compatibility fallback: at LOAD time we never reject the block outright —
  // an incompatible combination falls back to a safe default and is reported.
  const compatIssues = checkCustomBlockPropertyCompatibility(properties, tileWidth, tileHeight);
  if (compatIssues.length > 0) {
    for (const issue of compatIssues) {
      pushError(`properties.compatibility.${issue.rule}`, 'compatible combination', issue.message);
    }
    // Safe fallback: force breakability off if fragile was incompatible; force
    // friction to default if nonSolid was combined with slippery.
    if (properties.breakability === 'fragile' &&
        (properties.collision !== 'solid' ||
         !((tileWidth === 1 && tileHeight === 1) || (tileWidth === 2 && tileHeight === 2)))) {
      properties = { ...properties, breakability: 'indestructible' };
    }
    if (properties.collision === 'nonSolid' && properties.friction !== 'default') {
      properties = { ...properties, friction: 'default' };
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
