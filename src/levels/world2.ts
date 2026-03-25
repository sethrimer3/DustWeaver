/**
 * World 2 level definitions — 7 levels total.
 *
 * Themes progress:
 *   L1–L2 — Fire    (volcanic vents, fire/lava enemies)
 *   L3–L4 — Stone   (collapsed ruins, stone enemies with shatter)
 *   L5–L6 — Metal   (forge chambers, metal enemies that block-reflect)
 *   L7    — Boss    (Infernal Forge Lord — lava + stone + metal + fire)
 *
 * Enemies use the World 2 particle kinds: Fire, Lava, Stone, Metal.
 * Positions and sizes are fractions of screen dimensions (0–1).
 */

import { ParticleKind } from '../sim/particles/kinds';
import { LevelDef } from './levelDef';

export const WORLD2_LEVELS: LevelDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Level 1 — Fire, open volcanic chamber, single fire enemy
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 1,
    name: 'Ember Threshold',
    theme: 'fire',
    enemies: [
      {
        xFraction: 0.70,
        yFraction: 0.50,
        kinds: [ParticleKind.Fire],
        particleCount: 18,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Volcanic vents — narrow pillars
      { xFraction: 0.40, yFraction: 0.15, wFraction: 0.04, hFraction: 0.20 },
      { xFraction: 0.40, yFraction: 0.65, wFraction: 0.04, hFraction: 0.20 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 2 — Fire + Lava, narrow lava-flow corridor
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 2,
    name: 'Magma Veins',
    theme: 'lava',
    enemies: [
      {
        xFraction: 0.62,
        yFraction: 0.28,
        kinds: [ParticleKind.Fire],
        particleCount: 18,
        isBossFlag: 0,
      },
      {
        xFraction: 0.72,
        yFraction: 0.68,
        kinds: [ParticleKind.Lava],
        particleCount: 10,    // Lava enemies have fewer but stronger particles
        isBossFlag: 0,
      },
    ],
    walls: [
      // Lava channel walls
      { xFraction: 0.32, yFraction: 0.05, wFraction: 0.05, hFraction: 0.35 },
      { xFraction: 0.32, yFraction: 0.60, wFraction: 0.05, hFraction: 0.35 },
      // Central lava boulder
      { xFraction: 0.52, yFraction: 0.42, wFraction: 0.07, hFraction: 0.14 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 3 — Stone, collapsed ruins, single tough stone enemy
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 3,
    name: 'Shattered Halls',
    theme: 'stone',
    enemies: [
      {
        xFraction: 0.68,
        yFraction: 0.50,
        kinds: [ParticleKind.Stone],
        particleCount: 20,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Rubble piles — irregular broken columns
      { xFraction: 0.30, yFraction: 0.10, wFraction: 0.07, hFraction: 0.25 },
      { xFraction: 0.30, yFraction: 0.65, wFraction: 0.07, hFraction: 0.25 },
      { xFraction: 0.50, yFraction: 0.38, wFraction: 0.06, hFraction: 0.18 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 4 — Stone + Fire, ruined furnace room, two enemies
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 4,
    name: 'Furnace Ruins',
    theme: 'stone',
    enemies: [
      {
        xFraction: 0.60,
        yFraction: 0.25,
        kinds: [ParticleKind.Stone],
        particleCount: 18,
        isBossFlag: 0,
      },
      {
        xFraction: 0.75,
        yFraction: 0.72,
        kinds: [ParticleKind.Stone, ParticleKind.Fire],
        particleCount: 20,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Furnace walls
      { xFraction: 0.28, yFraction: 0.08, wFraction: 0.05, hFraction: 0.32 },
      { xFraction: 0.28, yFraction: 0.60, wFraction: 0.05, hFraction: 0.32 },
      { xFraction: 0.48, yFraction: 0.20, wFraction: 0.05, hFraction: 0.20 },
      { xFraction: 0.48, yFraction: 0.58, wFraction: 0.05, hFraction: 0.20 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 5 — Metal, forge chamber, single heavily-armored metal enemy
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 5,
    name: 'Iron Crucible',
    theme: 'metal',
    enemies: [
      {
        xFraction: 0.70,
        yFraction: 0.50,
        kinds: [ParticleKind.Metal],
        particleCount: 20,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Iron girder maze
      { xFraction: 0.28, yFraction: 0.12, wFraction: 0.05, hFraction: 0.28 },
      { xFraction: 0.28, yFraction: 0.60, wFraction: 0.05, hFraction: 0.28 },
      { xFraction: 0.48, yFraction: 0.28, wFraction: 0.05, hFraction: 0.20 },
      { xFraction: 0.48, yFraction: 0.52, wFraction: 0.05, hFraction: 0.20 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 6 — Metal + Stone, deep forge complex, two enemies
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 6,
    name: 'Forge Depths',
    theme: 'metal',
    enemies: [
      {
        xFraction: 0.62,
        yFraction: 0.25,
        kinds: [ParticleKind.Metal],
        particleCount: 20,
        isBossFlag: 0,
      },
      {
        xFraction: 0.76,
        yFraction: 0.72,
        kinds: [ParticleKind.Metal, ParticleKind.Stone],
        particleCount: 22,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Upper forge rail
      { xFraction: 0.26, yFraction: 0.08, wFraction: 0.24, hFraction: 0.05 },
      // Lower forge rail
      { xFraction: 0.26, yFraction: 0.87, wFraction: 0.24, hFraction: 0.05 },
      // Central anvil column
      { xFraction: 0.50, yFraction: 0.38, wFraction: 0.05, hFraction: 0.24 },
      // Side shields
      { xFraction: 0.12, yFraction: 0.32, wFraction: 0.05, hFraction: 0.36 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 7 — BOSS: World 2 Guardian — Infernal Forge Lord
  // Mixed Lava / Stone / Metal / Fire — heavily armored boss
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 2,
    levelNumber: 7,
    name: 'Infernal Forge Lord (BOSS)',
    theme: 'boss',
    enemies: [
      {
        xFraction: 0.68,
        yFraction: 0.50,
        kinds: [ParticleKind.Lava, ParticleKind.Stone, ParticleKind.Metal, ParticleKind.Fire],
        particleCount: 44,
        isBossFlag: 1,
      },
    ],
    walls: [
      // Boss arena — elevated forge platform
      { xFraction: 0.30, yFraction: 0.12, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.64, yFraction: 0.12, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.30, yFraction: 0.76, wFraction: 0.06, hFraction: 0.12 },
      { xFraction: 0.64, yFraction: 0.76, wFraction: 0.06, hFraction: 0.12 },
      // Central forge pillar
      { xFraction: 0.46, yFraction: 0.38, wFraction: 0.08, hFraction: 0.24 },
      // Side guard walls
      { xFraction: 0.14, yFraction: 0.38, wFraction: 0.05, hFraction: 0.24 },
      { xFraction: 0.81, yFraction: 0.38, wFraction: 0.05, hFraction: 0.24 },
    ],
  },
];
