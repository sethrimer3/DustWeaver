import { ParticleKind } from '../sim/particles/kinds';
import { LevelDef, LevelTheme } from './levelDef';
import { createBoxPracticeLayout, decodeTileLayout } from './tileLayout';

function buildWorld1Level(
  levelNumber: number,
  name: string,
  theme: LevelTheme,
  enemies: LevelDef['enemies'],
): LevelDef {
  const exitTarget = levelNumber === 7 ? 'menu' : 'next';
  const layout = decodeTileLayout(createBoxPracticeLayout(levelNumber, exitTarget));
  return {
    worldNumber: 1,
    levelNumber,
    name,
    theme,
    enemies,
    walls: layout.walls,
    entryDoor: layout.entryDoor,
    exitDoor: layout.exitDoor,
  };
}

export const WORLD1_LEVELS: LevelDef[] = [
  buildWorld1Level(1, 'Stone Crossing', 'physical', [
    { xFraction: 0.72, yFraction: 0.50, kinds: [ParticleKind.Physical], particleCount: 18, isBossFlag: 0 },
  ]),
  buildWorld1Level(2, 'Broken Ramparts', 'physical', [
    { xFraction: 0.55, yFraction: 0.50, kinds: [ParticleKind.Physical], particleCount: 18, isBossFlag: 0 },
    { xFraction: 0.82, yFraction: 0.50, kinds: [ParticleKind.Physical], particleCount: 14, isBossFlag: 0 },
  ]),
  buildWorld1Level(3, 'Sunken Hollow', 'water', [
    { xFraction: 0.70, yFraction: 0.50, kinds: [ParticleKind.Water], particleCount: 20, isBossFlag: 0 },
  ]),
  buildWorld1Level(4, 'Tide Channels', 'water', [
    { xFraction: 0.45, yFraction: 0.50, kinds: [ParticleKind.Water], particleCount: 20, isBossFlag: 0 },
    { xFraction: 0.78, yFraction: 0.50, kinds: [ParticleKind.Water, ParticleKind.Physical], particleCount: 20, isBossFlag: 0 },
  ]),
  buildWorld1Level(5, 'Glacial Vault', 'ice', [
    { xFraction: 0.68, yFraction: 0.50, kinds: [ParticleKind.Ice], particleCount: 22, isBossFlag: 0 },
  ]),
  buildWorld1Level(6, 'Frost Labyrinth', 'ice', [
    { xFraction: 0.50, yFraction: 0.50, kinds: [ParticleKind.Ice], particleCount: 22, isBossFlag: 0 },
    { xFraction: 0.80, yFraction: 0.50, kinds: [ParticleKind.Ice, ParticleKind.Water], particleCount: 22, isBossFlag: 0 },
  ]),
  buildWorld1Level(7, 'Tide Warden (BOSS)', 'boss', [
    {
      xFraction: 0.55,
      yFraction: 0.50,
      kinds: [ParticleKind.Physical, ParticleKind.Water, ParticleKind.Ice],
      particleCount: 40,
      isBossFlag: 1,
    },
  ]),
];
