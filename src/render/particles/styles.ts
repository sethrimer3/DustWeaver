/**
 * Per-element visual style for the Canvas 2D fallback renderer.
 * The WebGL renderer picks colours directly in the vertex packing step
 * (see webglRenderer.ts + shaders.ts → kindColor()).
 */

export interface ParticleStyle {
  colorHex: string;
  radiusPx: number;
}

// ---- Per-element colour palette (matches ELEMENT_COLORS in webglRenderer) -

const STYLES: ParticleStyle[] = [
  { colorHex: '#7799aa', radiusPx: 2 }, // Physical  — steel blue-grey
  { colorHex: '#ff5500', radiusPx: 2 }, // Fire      — hot orange
  { colorHex: '#88ddff', radiusPx: 2 }, // Ice       — cool light blue
  { colorHex: '#ffff44', radiusPx: 2 }, // Lightning — electric yellow
  { colorHex: '#44ff44', radiusPx: 2 }, // Poison    — acid green
  { colorHex: '#cc44ff', radiusPx: 2 }, // Arcane    — violet
  { colorHex: '#88ffee', radiusPx: 2 }, // Wind      — pale cyan
  { colorHex: '#ffeeaa', radiusPx: 2 }, // Holy      — warm gold
  { colorHex: '#6633cc', radiusPx: 2 }, // Shadow    — deep purple
  { colorHex: '#aabbcc', radiusPx: 2 }, // Metal     — silver
  { colorHex: '#88662a', radiusPx: 2 }, // Earth     — warm brown
  { colorHex: '#44cc44', radiusPx: 2 }, // Nature    — vivid green
  { colorHex: '#aaeeff', radiusPx: 2 }, // Crystal   — icy bright blue
  { colorHex: '#220033', radiusPx: 2 }, // Void      — near-black purple
  { colorHex: '#88ccff', radiusPx: 6 }, // Fluid     — pale aqua-blue (background, keep larger)
  { colorHex: '#2299ee', radiusPx: 2 }, // Water     — deep flowing blue
  { colorHex: '#ff2200', radiusPx: 3 }, // Lava      — molten deep red-orange (slightly larger)
  { colorHex: '#888899', radiusPx: 2 }, // Stone     — cool grey
  { colorHex: '#ffd700', radiusPx: 2 }, // Gold      — bright golden yellow
];

const FALLBACK_STYLE: ParticleStyle = STYLES[0];

export function getParticleStyle(kind: number): ParticleStyle {
  return STYLES[kind] ?? FALLBACK_STYLE;
}
