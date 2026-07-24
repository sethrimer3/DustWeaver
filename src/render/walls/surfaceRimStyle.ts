/**
 * surfaceRimStyle.ts — Centralized model for the per-block Surface Rim system.
 *
 * Generalizes the previously hard-coded exposed-edge brighten/multiply
 * presentation (surfaceEdgeOverlay.ts / blockEdgeShading.ts) into a
 * configurable style any placed block can opt into. 'default' preserves the
 * existing production look exactly.
 *
 * This module owns: the runtime type, defaults, validation/normalization,
 * equality, hashing (for cache-signature folding), and the compact codes
 * used by the room-level dedup style table (see roomJsonSerializer.ts).
 */

export type SurfaceRimMode = 'default' | 'none' | 'solid' | 'gradient' | 'inverted';
export type SurfaceRimFalloff = 'hard' | 'linear' | 'smooth' | 'exponential';

export interface SurfaceRimStyle {
  readonly mode: SurfaceRimMode;
  /** Hex color WITHOUT a leading '#', e.g. "ff7a18". */
  readonly color: string;
  readonly widthPx: number;
  readonly opacity: number;
  readonly falloff: SurfaceRimFalloff;
  /** Interior darkness in [0,1] — only meaningful in 'inverted' mode. */
  readonly interiorDarkness: number;
}

/**
 * Sentinel `wallSurfaceRimStyleIndex` value meaning "use the default
 * (original hard-coded) exposed-edge presentation" — mirrors the
 * `wallThemeIndex === 255` "use room default" sentinel convention, but sized
 * for a Uint16Array since the rim style table can exceed 255 entries in a
 * large room with many distinct custom styles.
 */
export const SURFACE_RIM_STYLE_INDEX_DEFAULT = 0xFFFF;

export const SURFACE_RIM_MODES: readonly SurfaceRimMode[] = ['default', 'none', 'solid', 'gradient', 'inverted'];
export const SURFACE_RIM_FALLOFFS: readonly SurfaceRimFalloff[] = ['hard', 'linear', 'smooth', 'exponential'];

export const DEFAULT_SURFACE_RIM_STYLE: SurfaceRimStyle = Object.freeze({
  mode: 'default',
  color: 'ffffff',
  widthPx: 3,
  opacity: 0.3,
  falloff: 'linear',
  interiorDarkness: 0.5,
});

const _MIN_WIDTH_PX = 1;
const _MAX_WIDTH_PX = 32;

const _HEX_COLOR_RE = /^[0-9a-fA-F]{6}$/;

function _clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Normalizes a color string to lowercase 6-digit hex without '#'. Falls back to the default color if invalid. */
export function normalizeSurfaceRimColor(color: string | undefined | null): string {
  if (typeof color !== 'string') return DEFAULT_SURFACE_RIM_STYLE.color;
  const stripped = color.startsWith('#') ? color.slice(1) : color;
  return _HEX_COLOR_RE.test(stripped) ? stripped.toLowerCase() : DEFAULT_SURFACE_RIM_STYLE.color;
}

/**
 * Validates and normalizes a (possibly partial/untrusted) style object into a
 * fully-populated, canonical `SurfaceRimStyle`. Unknown/invalid fields fall
 * back to defaults rather than throwing — used both for editor input and for
 * deserializing older/foreign room JSON.
 */
export function normalizeSurfaceRimStyle(input: Partial<SurfaceRimStyle> | undefined | null): SurfaceRimStyle {
  if (!input) return DEFAULT_SURFACE_RIM_STYLE;
  const mode: SurfaceRimMode = SURFACE_RIM_MODES.includes(input.mode as SurfaceRimMode)
    ? (input.mode as SurfaceRimMode)
    : DEFAULT_SURFACE_RIM_STYLE.mode;
  const falloff: SurfaceRimFalloff = SURFACE_RIM_FALLOFFS.includes(input.falloff as SurfaceRimFalloff)
    ? (input.falloff as SurfaceRimFalloff)
    : DEFAULT_SURFACE_RIM_STYLE.falloff;
  return {
    mode,
    color: normalizeSurfaceRimColor(input.color),
    widthPx: Math.round(_clamp(input.widthPx ?? DEFAULT_SURFACE_RIM_STYLE.widthPx, _MIN_WIDTH_PX, _MAX_WIDTH_PX)),
    opacity: _clamp(input.opacity ?? DEFAULT_SURFACE_RIM_STYLE.opacity, 0, 1),
    falloff,
    interiorDarkness: _clamp(input.interiorDarkness ?? DEFAULT_SURFACE_RIM_STYLE.interiorDarkness, 0, 1),
  };
}

/** True if the style is exactly the default (production-unchanged) style. */
export function isDefaultSurfaceRimStyle(style: SurfaceRimStyle): boolean {
  return surfaceRimStylesEqual(style, DEFAULT_SURFACE_RIM_STYLE);
}

export function surfaceRimStylesEqual(a: SurfaceRimStyle, b: SurfaceRimStyle): boolean {
  if (a === b) return true;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'none') return true; // no other field matters for 'none'
  if (a.color !== b.color) return false;
  if (a.widthPx !== b.widthPx) return false;
  if (a.opacity !== b.opacity) return false;
  if (a.falloff !== b.falloff) return false;
  if (a.mode === 'inverted' && a.interiorDarkness !== b.interiorDarkness) return false;
  return true;
}

/**
 * Cheap 32-bit content hash of a style, suitable for folding into the
 * `blockWallLayoutCache.ts` layout signature so a rim edit invalidates the
 * layout cache without needing to stringify the whole style.
 */
export function hashSurfaceRimStyle(style: SurfaceRimStyle): number {
  let h = 0;
  const mix = (n: number): void => {
    h = Math.imul(h, 1664525) + 1013904223 | 0;
    h ^= n | 0;
  };
  mix(SURFACE_RIM_MODES.indexOf(style.mode));
  if (style.mode === 'none') return h >>> 0;
  mix(parseInt(style.color, 16) | 0);
  mix(style.widthPx);
  mix(Math.round(style.opacity * 1000));
  mix(SURFACE_RIM_FALLOFFS.indexOf(style.falloff));
  if (style.mode === 'inverted') mix(Math.round(style.interiorDarkness * 1000));
  return h >>> 0;
}

// ── Compact serialization codes (see roomJsonSerializer.ts) ────────────────────

const _MODE_CODE: Record<Exclude<SurfaceRimMode, 'default'>, string> = {
  none: 'n',
  solid: 's',
  gradient: 'g',
  inverted: 'i',
};
const _CODE_MODE: Record<string, Exclude<SurfaceRimMode, 'default'>> = {
  n: 'none',
  s: 'solid',
  g: 'gradient',
  i: 'inverted',
};

const _FALLOFF_CODE: Record<SurfaceRimFalloff, number> = { hard: 0, linear: 1, smooth: 2, exponential: 3 };
const _CODE_FALLOFF: readonly SurfaceRimFalloff[] = ['hard', 'linear', 'smooth', 'exponential'];

/**
 * Compact tuple form used in the room-level `rimStyles` dedup table.
 * 'default' styles are never interned (omitted entirely — see serializer).
 * 'none' encodes as just `["n"]`. Others encode mode-specific trailing fields,
 * omitting any that equal the default so common cases stay short.
 */
export type CompactSurfaceRimStyle =
  | readonly [mode: 'n']
  | readonly [mode: 's', color: string, widthPx: number, opacity: number]
  | readonly [mode: 'g', color: string, widthPx: number, opacity: number, falloff: number]
  | readonly [mode: 'i', color: string, widthPx: number, opacity: number, falloff: number, interiorDarkness: number];

export function encodeSurfaceRimStyle(style: SurfaceRimStyle): CompactSurfaceRimStyle {
  if (style.mode === 'default') {
    throw new Error('encodeSurfaceRimStyle: default styles must not be interned');
  }
  if (style.mode === 'none') return ['n'];
  const opacity = Math.round(style.opacity * 1000) / 1000;
  if (style.mode === 'solid') return ['s', style.color, style.widthPx, opacity];
  if (style.mode === 'gradient') return ['g', style.color, style.widthPx, opacity, _FALLOFF_CODE[style.falloff]];
  return ['i', style.color, style.widthPx, opacity, _FALLOFF_CODE[style.falloff],
    Math.round(style.interiorDarkness * 1000) / 1000];
}

export function decodeSurfaceRimStyle(entry: unknown): SurfaceRimStyle {
  if (!Array.isArray(entry) || entry.length === 0) return DEFAULT_SURFACE_RIM_STYLE;
  const [codeRaw, colorRaw, widthRaw, opacityRaw, falloffRaw, interiorRaw] = entry;
  const mode = _CODE_MODE[codeRaw as string];
  if (mode === undefined) return DEFAULT_SURFACE_RIM_STYLE;
  if (mode === 'none') return normalizeSurfaceRimStyle({ mode: 'none' });
  const falloff = typeof falloffRaw === 'number' ? _CODE_FALLOFF[falloffRaw] : undefined;
  return normalizeSurfaceRimStyle({
    mode,
    color: typeof colorRaw === 'string' ? colorRaw : undefined,
    widthPx: typeof widthRaw === 'number' ? widthRaw : undefined,
    opacity: typeof opacityRaw === 'number' ? opacityRaw : undefined,
    falloff,
    interiorDarkness: typeof interiorRaw === 'number' ? interiorRaw : undefined,
  });
}

void _MODE_CODE; // retained for documentation/symmetry with _CODE_MODE

// ── Runtime interning helper ────────────────────────────────────────────────

/**
 * Interns `style` into `table` (appending a new entry only if an equal style
 * isn't already present) and returns its index, or
 * `SURFACE_RIM_STYLE_INDEX_DEFAULT` for an absent/default style. Shared by
 * every wall-loading path that populates `WorldState.wallSurfaceRimStyleIndex`
 * / `wallSurfaceRimStyleTable` (mirrors the per-wall `themeIndex` convention).
 */
export function internSurfaceRimStyle(table: SurfaceRimStyle[], style: SurfaceRimStyle | undefined): number {
  if (style === undefined) return SURFACE_RIM_STYLE_INDEX_DEFAULT;
  const normalized = normalizeSurfaceRimStyle(style);
  if (isDefaultSurfaceRimStyle(normalized)) return SURFACE_RIM_STYLE_INDEX_DEFAULT;
  for (let i = 0; i < table.length; i++) {
    if (surfaceRimStylesEqual(table[i], normalized)) return i;
  }
  table.push(normalized);
  return table.length - 1;
}
