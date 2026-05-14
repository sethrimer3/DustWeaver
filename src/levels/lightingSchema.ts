/**
 * lightingSchema.ts — Lighting system type definitions and serialisation helpers.
 *
 * `LightDef` is the verbose runtime representation of a scene light.
 * `SavedSceneLight` is the compact on-disk form used in RoomJsonDef /
 * SavedRoomV2 — all coordinates are in world units (not block units).
 */

// ── Light type and blend mode ─────────────────────────────────────────────────

/** Visual style of the light. */
export type LightType = 'softGlow' | 'spotlight' | 'floodlight' | 'backlight';

/** How the light composites onto the scene. */
export type LightBlendMode = 'add' | 'screen' | 'multiply' | 'normal';

// ── Verbose runtime definition ────────────────────────────────────────────────

/** Fully-hydrated, runtime representation of a scene light. */
export interface LightDef {
  /** Horizontal position in world units. */
  xWorld: number;
  /** Vertical position in world units. */
  yWorld: number;
  /** Visual style of the light. */
  kind: LightType;
  /** Light influence radius in world units. */
  radiusWorld: number;
  /** Red channel 0–255. */
  colorR: number;
  /** Green channel 0–255. */
  colorG: number;
  /** Blue channel 0–255. */
  colorB: number;
  /** Overall brightness multiplier 0–100. */
  intensityPct: number;
  /** Canvas blend mode for compositing. */
  blendMode: LightBlendMode;
  /** Whether this light casts visibility-polygon shadows. */
  castsShadowsFlag: 0 | 1;
  /** Spotlight: half-angle of the cone in radians. Only used for 'spotlight'. */
  coneAngleRad?: number;
  /** Spotlight: direction the cone points, in radians. Only used for 'spotlight'. */
  rotationRad?: number;
  /** Softness of the shadow penumbra (0 = hard, 1 = very soft). */
  shadowSoftness?: number;
  /** Whether the light pulses (animated). */
  isPulsingFlag?: 0 | 1;
  /** Pulse speed in Hz. */
  pulseSpeedHz?: number;
  /** Pulse amplitude as a fraction of intensityPct (0–1). */
  pulseAmplitude?: number;
}

// ── Compact saved form ────────────────────────────────────────────────────────

/**
 * Compact on-disk form.  Only mandatory fields are always present; optional
 * fields are omitted when they match their defaults.
 */
export interface SavedSceneLight {
  /** xWorld */
  x: number;
  /** yWorld */
  y: number;
  /** LightType */
  k: LightType;
  /** radiusWorld */
  r: number;
  /** colorR */
  cr: number;
  /** colorG */
  cg: number;
  /** colorB */
  cb: number;
  /** intensityPct */
  i: number;
  /** blendMode */
  bm: LightBlendMode;
  /** castsShadowsFlag */
  sh: 0 | 1;
  /** coneAngleRad (spotlight only) */
  ca?: number;
  /** rotationRad (spotlight only) */
  ro?: number;
  /** shadowSoftness */
  ss?: number;
  /** isPulsingFlag */
  pu?: 0 | 1;
  /** pulseSpeedHz */
  ps?: number;
  /** pulseAmplitude */
  pa?: number;
}

// ── Serialisation helpers ─────────────────────────────────────────────────────

/** Convert a verbose `LightDef` to the compact `SavedSceneLight` form. */
export function lightDefToSaved(d: LightDef): SavedSceneLight {
  const out: SavedSceneLight = {
    x: d.xWorld,
    y: d.yWorld,
    k: d.kind,
    r: d.radiusWorld,
    cr: d.colorR,
    cg: d.colorG,
    cb: d.colorB,
    i: d.intensityPct,
    bm: d.blendMode,
    sh: d.castsShadowsFlag,
  };
  if (d.coneAngleRad !== undefined)  out.ca = d.coneAngleRad;
  if (d.rotationRad !== undefined)   out.ro = d.rotationRad;
  if (d.shadowSoftness !== undefined) out.ss = d.shadowSoftness;
  if (d.isPulsingFlag)               out.pu = d.isPulsingFlag;
  if (d.pulseSpeedHz !== undefined)  out.ps = d.pulseSpeedHz;
  if (d.pulseAmplitude !== undefined) out.pa = d.pulseAmplitude;
  return out;
}

/** Expand a `SavedSceneLight` back into a verbose `LightDef`. */
export function savedToLightDef(s: SavedSceneLight): LightDef {
  const d: LightDef = {
    xWorld: s.x,
    yWorld: s.y,
    kind: s.k,
    radiusWorld: s.r,
    colorR: s.cr,
    colorG: s.cg,
    colorB: s.cb,
    intensityPct: s.i,
    blendMode: s.bm,
    castsShadowsFlag: s.sh,
  };
  if (s.ca !== undefined) d.coneAngleRad = s.ca;
  if (s.ro !== undefined) d.rotationRad = s.ro;
  if (s.ss !== undefined) d.shadowSoftness = s.ss;
  if (s.pu !== undefined) d.isPulsingFlag = s.pu;
  if (s.ps !== undefined) d.pulseSpeedHz = s.ps;
  if (s.pa !== undefined) d.pulseAmplitude = s.pa;
  return d;
}

// ── Validator ─────────────────────────────────────────────────────────────────

const VALID_KINDS: ReadonlySet<string> = new Set<LightType>(['softGlow', 'spotlight', 'floodlight', 'backlight']);
const VALID_BLEND_MODES: ReadonlySet<string> = new Set<LightBlendMode>(['add', 'screen', 'multiply', 'normal']);

export function isValidSavedSceneLight(v: unknown): v is SavedSceneLight {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.x  === 'number' &&
    typeof s.y  === 'number' &&
    typeof s.k  === 'string' && VALID_KINDS.has(s.k) &&
    typeof s.r  === 'number' &&
    typeof s.cr === 'number' &&
    typeof s.cg === 'number' &&
    typeof s.cb === 'number' &&
    typeof s.i  === 'number' &&
    typeof s.bm === 'string' && VALID_BLEND_MODES.has(s.bm) &&
    (s.sh === 0 || s.sh === 1)
  );
}
