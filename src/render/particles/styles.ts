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
  { colorHex: '#7799aa', radiusPx: 4 }, // Physical  — steel blue-grey
  { colorHex: '#ff5500', radiusPx: 4 }, // Fire      — hot orange
  { colorHex: '#88ddff', radiusPx: 4 }, // Ice       — cool light blue
  { colorHex: '#ffff44', radiusPx: 4 }, // Lightning — electric yellow
  { colorHex: '#44ff44', radiusPx: 4 }, // Poison    — acid green
  { colorHex: '#cc44ff', radiusPx: 4 }, // Arcane    — violet
  { colorHex: '#88ffee', radiusPx: 4 }, // Wind      — pale cyan
  { colorHex: '#ffeeaa', radiusPx: 4 }, // Holy      — warm gold
  { colorHex: '#6633cc', radiusPx: 4 }, // Shadow    — deep purple
  { colorHex: '#aabbcc', radiusPx: 4 }, // Metal     — silver
  { colorHex: '#88662a', radiusPx: 4 }, // Earth     — warm brown
  { colorHex: '#44cc44', radiusPx: 4 }, // Nature    — vivid green
  { colorHex: '#aaeeff', radiusPx: 4 }, // Crystal   — icy bright blue
  { colorHex: '#220033', radiusPx: 5 }, // Void      — near-black purple (slightly larger)
  { colorHex: '#88ccff', radiusPx: 6 }, // Fluid     — pale aqua-blue (larger soft glow)
  { colorHex: '#2299ee', radiusPx: 4 }, // Water     — deep flowing blue
];

const FALLBACK_STYLE: ParticleStyle = STYLES[0];

export function getParticleStyle(kind: number): ParticleStyle {
  return STYLES[kind] ?? FALLBACK_STYLE;
}
