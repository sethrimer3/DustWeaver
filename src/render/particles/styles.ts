import { ParticleKind } from '../../sim/particles/kinds';

export interface ParticleStyle {
  colorHex: string;
  radiusPx: number;
}

const PHYSICAL_STYLE: ParticleStyle = {
  colorHex: '#00cfff',
  radiusPx: 4,
};

export function getParticleStyle(kind: number): ParticleStyle {
  if (kind === ParticleKind.Physical) return PHYSICAL_STYLE;
  return PHYSICAL_STYLE;
}
