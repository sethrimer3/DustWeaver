/**
 * Centralized Mote-Type Configuration — the single authoritative source for
 * how each *equippable player* mote type looks and how its projectiles behave.
 *
 * Rationale (see task section 1): mote visuals (body / glow / trail / particle
 * colours) were previously derived ad-hoc from scattered per-kind colour tables
 * keyed off the physical particle `kind`. This module consolidates the visual
 * identity of the player-facing mote roster into one place and pairs it with an
 * extensible per-type *behaviour* block (projectile range / speed / homing /
 * piercing) so future mote types can define custom projectile behaviour without
 * touching rendering or weave code.
 *
 * Gold Dust (ParticleKind.Golden) is the default type and the behavioural
 * baseline for the Bow Weave's arrow (task sections 6–9):
 *   • outbound speed        = 250 px/s (constant, independent of load duration)
 *   • max outbound travel   = 250 px
 *   • straight while outbound, homing/piercing off
 *
 * Sim-layer rules respected:
 *   • No DOM / browser APIs, no rendering imports — safe to import from both
 *     the simulation and the renderer.
 *   • Pure data + pure accessors; no per-tick allocation.
 *
 * The RGB float triples exposed here are the source of truth that the WebGL /
 * Canvas trail + body renderers read through `render/particles/styles.ts` for
 * the equippable player kinds, keeping "mote body / glow / trail / particle"
 * colours synchronized with the selected mote type by construction.
 */

import { ParticleKind } from '../particles/kinds';

/** RGB colour triple with channels in the 0..1 range. */
export interface MoteRgb {
  r: number;
  g: number;
  b: number;
}

/** Visual identity for one mote type. Body / glow / trail / particle share the hue. */
export interface MoteTypeVisual {
  /** Core body fill colour. */
  body: MoteRgb;
  /** Additive glow / bloom colour (usually a brighter tint of the body). */
  glow: MoteRgb;
  /** Motion-trail colour. Kept equal to the body hue so trails follow the type. */
  trail: MoteRgb;
  /** Type-specific effect-particle colour (sparks/embers spawned by the mote). */
  particle: MoteRgb;
}

/**
 * Projectile behaviour for one mote type. Gold Dust supplies the defaults; other
 * types override individual fields as their custom behaviour is authored.
 */
export interface MoteTypeProjectile {
  /** Constant outbound speed in pixels/second. Never scales with load duration. */
  outboundSpeedPxPerSec: number;
  /** Maximum outbound travel distance in pixels before the curve-home transition. */
  maxTravelPx: number;
  /** Whether the outbound projectile homes toward enemies. Gold Dust: false. */
  homing: boolean;
  /** Whether the projectile pierces through enemies rather than stopping. Gold Dust: false. */
  piercing: boolean;
}

export interface MoteTypeConfig {
  kind: ParticleKind;
  /** Human-readable name for tooltips / debug output. */
  name: string;
  visual: MoteTypeVisual;
  projectile: MoteTypeProjectile;
}

/** Gold Dust projectile baseline — see task sections 7–9. */
export const GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC = 250;
export const GOLD_DUST_MAX_TRAVEL_PX = 250;

const GOLD_DUST_PROJECTILE: MoteTypeProjectile = {
  outboundSpeedPxPerSec: GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC,
  maxTravelPx: GOLD_DUST_MAX_TRAVEL_PX,
  homing: false,
  piercing: false,
};

function rgb(r: number, g: number, b: number): MoteRgb {
  return { r, g, b };
}

/**
 * Authoritative config for every equippable player mote type. Colours match the
 * long-standing per-kind palette (render/particles/styles.ts) so this
 * consolidation is visually identical to the previous scattered tables; the
 * `styles.ts` colour arrays are kept in sync with these values by the
 * accompanying regression test.
 */
const MOTE_TYPE_CONFIGS: Partial<Record<ParticleKind, MoteTypeConfig>> = {
  [ParticleKind.Golden]: {
    kind: ParticleKind.Golden,
    name: 'Gold Dust',
    visual: {
      body: rgb(1.0, 0.84, 0.0),
      glow: rgb(1.0, 0.9, 0.35),
      trail: rgb(1.0, 0.84, 0.0),
      particle: rgb(1.0, 0.84, 0.0),
    },
    projectile: { ...GOLD_DUST_PROJECTILE },
  },
  [ParticleKind.Ice]: {
    kind: ParticleKind.Ice,
    name: 'Ice Dust',
    visual: {
      body: rgb(0.53, 0.87, 1.0),
      glow: rgb(0.72, 0.94, 1.0),
      trail: rgb(0.53, 0.87, 1.0),
      particle: rgb(0.53, 0.87, 1.0),
    },
    // Inherits Gold Dust projectile behaviour until Ice-specific behaviour is authored.
    projectile: { ...GOLD_DUST_PROJECTILE },
  },
  [ParticleKind.Nature]: {
    kind: ParticleKind.Nature,
    name: 'Nature Dust',
    visual: {
      body: rgb(0.27, 0.8, 0.27),
      glow: rgb(0.45, 0.95, 0.45),
      trail: rgb(0.27, 0.8, 0.27),
      particle: rgb(0.27, 0.8, 0.27),
    },
    projectile: { ...GOLD_DUST_PROJECTILE },
  },
  [ParticleKind.Void]: {
    kind: ParticleKind.Void,
    name: 'Void Dust',
    visual: {
      body: rgb(0.13, 0.0, 0.2),
      glow: rgb(0.4, 0.13, 0.55),
      trail: rgb(0.13, 0.0, 0.2),
      particle: rgb(0.13, 0.0, 0.2),
    },
    projectile: { ...GOLD_DUST_PROJECTILE },
  },
  [ParticleKind.Light]: {
    kind: ParticleKind.Light,
    name: 'Light Dust',
    visual: {
      body: rgb(1.0, 0.99, 0.88),
      glow: rgb(1.0, 1.0, 0.95),
      trail: rgb(1.0, 0.99, 0.88),
      particle: rgb(1.0, 0.99, 0.88),
    },
    projectile: { ...GOLD_DUST_PROJECTILE },
  },
};

/** The default mote type. Gold Dust retains the legacy gold aesthetic. */
export const DEFAULT_MOTE_TYPE: ParticleKind = ParticleKind.Golden;

/**
 * Returns the authoritative config for a mote type. Falls back to the default
 * (Gold Dust) for any kind without an explicit entry — including internal /
 * environmental particle kinds — so callers never get undefined.
 */
export function getMoteTypeConfig(kind: ParticleKind | number): MoteTypeConfig {
  return MOTE_TYPE_CONFIGS[kind as ParticleKind] ?? (MOTE_TYPE_CONFIGS[DEFAULT_MOTE_TYPE] as MoteTypeConfig);
}

/** Convenience: the visual block for a mote type (body/glow/trail/particle colours). */
export function getMoteTypeVisual(kind: ParticleKind | number): MoteTypeVisual {
  return getMoteTypeConfig(kind).visual;
}

/** Convenience: the projectile behaviour for a mote type (Gold Dust defaults otherwise). */
export function getMoteTypeProjectile(kind: ParticleKind | number): MoteTypeProjectile {
  return getMoteTypeConfig(kind).projectile;
}

/** True when an explicit (non-fallback) config exists for this kind. */
export function hasMoteTypeConfig(kind: ParticleKind | number): boolean {
  return MOTE_TYPE_CONFIGS[kind as ParticleKind] !== undefined;
}
