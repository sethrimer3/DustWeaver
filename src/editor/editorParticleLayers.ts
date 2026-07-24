/**
 * ParticleKind → editor LayerId classification.
 *
 * Particles are a flat SoA (see sim/particles/state.ts) with no per-particle
 * layer field, so unlike `ELEMENT_TYPE_LAYER` (editorLayers.ts) — which
 * classifies discrete placed elements — this classifies by `kind`, the one
 * stable per-particle attribute available. This is coarser than element-type
 * classification (all particles of a kind share one layer), which is
 * appropriate given the kind count (20) versus per-particle volume.
 */

import type { LayerId } from './editorLayers';

const PARTICLE_KIND_LAYER: readonly LayerId[] = [
  'powder',  // Golden (0) — player dust mote
  'powder',  // Fire (1)
  'powder',  // Ice (2)
  'powder',  // Lightning (3)
  'powder',  // Poison (4)
  'powder',  // Arcane (5)
  'powder',  // Wind (6)
  'powder',  // Holy (7)
  'powder',  // Shadow (8)
  'powder',  // Metal (9)
  'powder',  // Earth (10)
  'powder',  // Nature (11) — player dust mote
  'powder',  // Crystal (12)
  'powder',  // Void (13) — player dust mote
  'liquids', // Fluid (14) — background disturbance glow, reveals near liquid/impact interaction
  'liquids', // Water (15)
  'liquids', // Lava (16)
  'terrain', // Stone (17) — worn rock fragments
  'dynamicGeometry', // Gold (18) — grappling hook chain sparkles
  'lighting', // Light (19) — boss light chains / collectible Light Dust
];

/** Returns the layer that owns visibility for the given particle kind. */
export function getLayerForParticleKind(kind: number): LayerId {
  return PARTICLE_KIND_LAYER[kind] ?? 'powder';
}
