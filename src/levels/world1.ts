/**
 * World 1 level definitions — 7 levels total.
 *
 * Themes progress:
 *   L1–L2 — Physical (stone dungeon, grounded enemies)
 *   L3–L4 — Water    (flooded cavern, flowing enemies)
 *   L5–L6 — Ice      (frozen keep, crystalline enemies)
 *   L7    — Boss     (mix of all three: World 1 guardian)
 *
 * Positions and sizes are fractions of screen dimensions (0–1).
 */

import { ParticleKind } from '../sim/particles/kinds';
import { LevelDef } from './levelDef';

export const WORLD1_LEVELS: LevelDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Level 1 — Physical, open arena, single enemy
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 1,
    name: 'Stone Crossing',
    theme: 'physical',
    enemies: [
      {
        xFraction: 0.72,
        yFraction: 0.50,
        kinds: [ParticleKind.Physical],
        particleCount: 18,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Two short pillars flanking the centre
      { xFraction: 0.42, yFraction: 0.20, wFraction: 0.04, hFraction: 0.18 },
      { xFraction: 0.42, yFraction: 0.62, wFraction: 0.04, hFraction: 0.18 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 2 — Physical, corridor layout, two enemies
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 2,
    name: 'Broken Ramparts',
    theme: 'physical',
    enemies: [
      {
        xFraction: 0.65,
        yFraction: 0.30,
        kinds: [ParticleKind.Physical],
        particleCount: 18,
        isBossFlag: 0,
      },
      {
        xFraction: 0.65,
        yFraction: 0.70,
        kinds: [ParticleKind.Physical],
        particleCount: 14,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Horizontal barrier splitting the arena
      { xFraction: 0.20, yFraction: 0.47, wFraction: 0.28, hFraction: 0.06 },
      // Right side column
      { xFraction: 0.55, yFraction: 0.55, wFraction: 0.05, hFraction: 0.22 },
      // Left side block
      { xFraction: 0.05, yFraction: 0.20, wFraction: 0.05, hFraction: 0.30 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 3 — Water, open cavern, single flowing enemy
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 3,
    name: 'Sunken Hollow',
    theme: 'water',
    enemies: [
      {
        xFraction: 0.70,
        yFraction: 0.50,
        kinds: [ParticleKind.Water],
        particleCount: 20,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Island rocks in the water
      { xFraction: 0.38, yFraction: 0.15, wFraction: 0.08, hFraction: 0.12 },
      { xFraction: 0.38, yFraction: 0.73, wFraction: 0.08, hFraction: 0.12 },
      { xFraction: 0.52, yFraction: 0.42, wFraction: 0.05, hFraction: 0.16 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 4 — Water, flooded corridor, two enemies
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 4,
    name: 'Tide Channels',
    theme: 'water',
    enemies: [
      {
        xFraction: 0.60,
        yFraction: 0.25,
        kinds: [ParticleKind.Water],
        particleCount: 20,
        isBossFlag: 0,
      },
      {
        xFraction: 0.75,
        yFraction: 0.65,
        kinds: [ParticleKind.Water, ParticleKind.Physical],
        particleCount: 20,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Vertical channel walls
      { xFraction: 0.35, yFraction: 0.05, wFraction: 0.05, hFraction: 0.38 },
      { xFraction: 0.35, yFraction: 0.57, wFraction: 0.05, hFraction: 0.38 },
      // Central boulder
      { xFraction: 0.55, yFraction: 0.43, wFraction: 0.07, hFraction: 0.14 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 5 — Ice, frozen keep, single crystalline enemy
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 5,
    name: 'Glacial Vault',
    theme: 'ice',
    enemies: [
      {
        xFraction: 0.68,
        yFraction: 0.50,
        kinds: [ParticleKind.Ice],
        particleCount: 22,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Symmetrical ice column maze
      { xFraction: 0.30, yFraction: 0.10, wFraction: 0.05, hFraction: 0.30 },
      { xFraction: 0.30, yFraction: 0.60, wFraction: 0.05, hFraction: 0.30 },
      { xFraction: 0.50, yFraction: 0.25, wFraction: 0.05, hFraction: 0.22 },
      { xFraction: 0.50, yFraction: 0.53, wFraction: 0.05, hFraction: 0.22 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 6 — Ice, complex frozen battleground, two enemies
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 6,
    name: 'Frost Labyrinth',
    theme: 'ice',
    enemies: [
      {
        xFraction: 0.62,
        yFraction: 0.25,
        kinds: [ParticleKind.Ice],
        particleCount: 22,
        isBossFlag: 0,
      },
      {
        xFraction: 0.78,
        yFraction: 0.72,
        kinds: [ParticleKind.Ice, ParticleKind.Water],
        particleCount: 22,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Upper corridor
      { xFraction: 0.28, yFraction: 0.08, wFraction: 0.22, hFraction: 0.05 },
      // Lower corridor
      { xFraction: 0.28, yFraction: 0.87, wFraction: 0.22, hFraction: 0.05 },
      // Left ice wall segments
      { xFraction: 0.10, yFraction: 0.30, wFraction: 0.05, hFraction: 0.40 },
      // Right divider
      { xFraction: 0.56, yFraction: 0.15, wFraction: 0.05, hFraction: 0.28 },
      { xFraction: 0.56, yFraction: 0.57, wFraction: 0.05, hFraction: 0.28 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 7 — BOSS: World 1 Guardian — Tide Warden
  // Mixed Physical / Water / Ice — more particles, boss flag set
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 7,
    name: 'Tide Warden (BOSS)',
    theme: 'boss',
    enemies: [
      {
        xFraction: 0.68,
        yFraction: 0.50,
        kinds: [ParticleKind.Physical, ParticleKind.Water, ParticleKind.Ice],
        particleCount: 40,
        isBossFlag: 1,
      },
    ],
    walls: [
      // Arena ring — four corner pillars
      { xFraction: 0.32, yFraction: 0.15, wFraction: 0.06, hFraction: 0.10 },
      { xFraction: 0.62, yFraction: 0.15, wFraction: 0.06, hFraction: 0.10 },
      { xFraction: 0.32, yFraction: 0.75, wFraction: 0.06, hFraction: 0.10 },
      { xFraction: 0.62, yFraction: 0.75, wFraction: 0.06, hFraction: 0.10 },
      // Side wall stubs
      { xFraction: 0.15, yFraction: 0.40, wFraction: 0.05, hFraction: 0.20 },
      { xFraction: 0.80, yFraction: 0.40, wFraction: 0.05, hFraction: 0.20 },
    ],
  },
];
