import { ParticleKind } from '../sim/particles/kinds';
import { LevelDef } from './levelDef';

function buildWorld2Level(level: Omit<LevelDef, 'worldNumber' | 'entryDoor' | 'exitDoor'>): LevelDef {
  return {
    worldNumber: 2,
    ...level,
    entryDoor: { xFraction: 0.08, yFraction: 0.78, wFraction: 0.06, hFraction: 0.16, target: 'next' },
    exitDoor: {
      xFraction: 0.86,
      yFraction: 0.78,
      wFraction: 0.06,
      hFraction: 0.16,
      target: level.levelNumber === 7 ? 'menu' : 'next',
    },
  };
}

export const WORLD2_LEVELS: LevelDef[] = [
  buildWorld2Level({
    levelNumber: 1,
    name: 'Ember Threshold',
    theme: 'fire',
    enemies: [{ xFraction: 0.70, yFraction: 0.50, kinds: [ParticleKind.Fire], particleCount: 18, isBossFlag: 0 }],
    walls: [
      { xFraction: 0.40, yFraction: 0.15, wFraction: 0.04, hFraction: 0.20 },
      { xFraction: 0.40, yFraction: 0.65, wFraction: 0.04, hFraction: 0.20 },
    ],
  }),
  buildWorld2Level({
    levelNumber: 2,
    name: 'Magma Veins',
    theme: 'lava',
    enemies: [
      { xFraction: 0.62, yFraction: 0.28, kinds: [ParticleKind.Fire], particleCount: 18, isBossFlag: 0 },
      { xFraction: 0.72, yFraction: 0.68, kinds: [ParticleKind.Lava], particleCount: 10, isBossFlag: 0 },
    ],
    walls: [
      { xFraction: 0.32, yFraction: 0.05, wFraction: 0.05, hFraction: 0.35 },
      { xFraction: 0.32, yFraction: 0.60, wFraction: 0.05, hFraction: 0.35 },
      { xFraction: 0.52, yFraction: 0.42, wFraction: 0.07, hFraction: 0.14 },
    ],
  }),
  buildWorld2Level({
    levelNumber: 3,
    name: 'Shattered Halls',
    theme: 'stone',
    enemies: [{ xFraction: 0.68, yFraction: 0.50, kinds: [ParticleKind.Stone], particleCount: 20, isBossFlag: 0 }],
    walls: [
      { xFraction: 0.30, yFraction: 0.10, wFraction: 0.07, hFraction: 0.25 },
      { xFraction: 0.30, yFraction: 0.65, wFraction: 0.07, hFraction: 0.25 },
      { xFraction: 0.50, yFraction: 0.38, wFraction: 0.06, hFraction: 0.18 },
    ],
  }),
  buildWorld2Level({
    levelNumber: 4,
    name: 'Furnace Ruins',
    theme: 'stone',
    enemies: [
      { xFraction: 0.60, yFraction: 0.25, kinds: [ParticleKind.Stone], particleCount: 18, isBossFlag: 0 },
      { xFraction: 0.75, yFraction: 0.72, kinds: [ParticleKind.Stone, ParticleKind.Fire], particleCount: 20, isBossFlag: 0 },
    ],
    walls: [
      { xFraction: 0.28, yFraction: 0.08, wFraction: 0.05, hFraction: 0.32 },
      { xFraction: 0.28, yFraction: 0.60, wFraction: 0.05, hFraction: 0.32 },
      { xFraction: 0.48, yFraction: 0.20, wFraction: 0.05, hFraction: 0.20 },
      { xFraction: 0.48, yFraction: 0.58, wFraction: 0.05, hFraction: 0.20 },
    ],
  }),
  buildWorld2Level({
    levelNumber: 5,
    name: 'Iron Crucible',
    theme: 'metal',
    enemies: [{ xFraction: 0.70, yFraction: 0.50, kinds: [ParticleKind.Metal], particleCount: 20, isBossFlag: 0 }],
    walls: [
      { xFraction: 0.28, yFraction: 0.12, wFraction: 0.05, hFraction: 0.28 },
      { xFraction: 0.28, yFraction: 0.60, wFraction: 0.05, hFraction: 0.28 },
      { xFraction: 0.48, yFraction: 0.28, wFraction: 0.05, hFraction: 0.20 },
      { xFraction: 0.48, yFraction: 0.52, wFraction: 0.05, hFraction: 0.20 },
    ],
  }),
  buildWorld2Level({
    levelNumber: 6,
    name: 'Forge Depths',
    theme: 'metal',
    enemies: [
      { xFraction: 0.62, yFraction: 0.25, kinds: [ParticleKind.Metal], particleCount: 20, isBossFlag: 0 },
      { xFraction: 0.76, yFraction: 0.72, kinds: [ParticleKind.Metal, ParticleKind.Stone], particleCount: 22, isBossFlag: 0 },
    ],
    walls: [
      { xFraction: 0.26, yFraction: 0.08, wFraction: 0.24, hFraction: 0.05 },
      { xFraction: 0.26, yFraction: 0.87, wFraction: 0.24, hFraction: 0.05 },
      { xFraction: 0.50, yFraction: 0.38, wFraction: 0.05, hFraction: 0.24 },
      { xFraction: 0.12, yFraction: 0.32, wFraction: 0.05, hFraction: 0.36 },
    ],
  }),
  buildWorld2Level({
    levelNumber: 7,
    name: 'Infernal Forge Lord (BOSS)',
    theme: 'boss',
    enemies: [{
      xFraction: 0.68,
      yFraction: 0.50,
      kinds: [ParticleKind.Lava, ParticleKind.Stone, ParticleKind.Metal, ParticleKind.Fire],
      particleCount: 44,
      isBossFlag: 1,
    }],
    walls: [
      { xFraction: 0.30, yFraction: 0.12, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.64, yFraction: 0.12, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.30, yFraction: 0.76, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.64, yFraction: 0.76, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.46, yFraction: 0.38, wFraction: 0.08, hFraction: 0.24 },
      { xFraction: 0.14, yFraction: 0.38, wFraction: 0.05, hFraction: 0.24 },
      { xFraction: 0.81, yFraction: 0.38, wFraction: 0.05, hFraction: 0.24 },
    ],
  }),
];
