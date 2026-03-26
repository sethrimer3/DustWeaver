/**
 * World 1 level definitions — 7 levels total.
 *
 * Platformer layout: every level has a full-width floor at yFraction=0.88 plus
 * elevated platforms.  Enemies are placed with yFraction=0.50 so they fall to
 * the nearest surface below them once gravity activates.
 *
 * Positions and sizes are fractions of screen dimensions (0–1).
 * Platform height (hFraction=0.05) is intentionally taller than the maximum
 * single-tick fall distance so clusters never tunnel through.
 */

import { ParticleKind } from '../sim/particles/kinds';
import { LevelDef } from './levelDef';

export const WORLD1_LEVELS: LevelDef[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Level 1 — Physical, gentle introduction
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
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Two platforms — reachable from floor with one jump
      { xFraction: 0.28, yFraction: 0.63, wFraction: 0.18, hFraction: 0.05 },
      { xFraction: 0.58, yFraction: 0.63, wFraction: 0.18, hFraction: 0.05 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 2 — Physical, staircase ascent
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 2,
    name: 'Broken Ramparts',
    theme: 'physical',
    enemies: [
      {
        xFraction: 0.55,
        yFraction: 0.50,
        kinds: [ParticleKind.Physical],
        particleCount: 18,
        isBossFlag: 0,
      },
      {
        xFraction: 0.82,
        yFraction: 0.50,
        kinds: [ParticleKind.Physical],
        particleCount: 14,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Left-side low platform
      { xFraction: 0.15, yFraction: 0.68, wFraction: 0.20, hFraction: 0.05 },
      // Centre mid platform
      { xFraction: 0.40, yFraction: 0.52, wFraction: 0.20, hFraction: 0.05 },
      // Right high platform
      { xFraction: 0.65, yFraction: 0.36, wFraction: 0.20, hFraction: 0.05 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 3 — Water, cavern with floating rocks
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
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Stepping stones ascending from left to right
      { xFraction: 0.12, yFraction: 0.70, wFraction: 0.14, hFraction: 0.05 },
      { xFraction: 0.35, yFraction: 0.55, wFraction: 0.14, hFraction: 0.05 },
      { xFraction: 0.58, yFraction: 0.40, wFraction: 0.14, hFraction: 0.05 },
      // Wide top ledge
      { xFraction: 0.72, yFraction: 0.56, wFraction: 0.20, hFraction: 0.05 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 4 — Water, flooded multi-tier
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 4,
    name: 'Tide Channels',
    theme: 'water',
    enemies: [
      {
        xFraction: 0.45,
        yFraction: 0.50,
        kinds: [ParticleKind.Water],
        particleCount: 20,
        isBossFlag: 0,
      },
      {
        xFraction: 0.78,
        yFraction: 0.50,
        kinds: [ParticleKind.Water, ParticleKind.Physical],
        particleCount: 20,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Short left pillar platform
      { xFraction: 0.10, yFraction: 0.65, wFraction: 0.15, hFraction: 0.05 },
      // Wide centre platform
      { xFraction: 0.32, yFraction: 0.60, wFraction: 0.22, hFraction: 0.05 },
      // Gap then high right platforms
      { xFraction: 0.62, yFraction: 0.45, wFraction: 0.14, hFraction: 0.05 },
      { xFraction: 0.80, yFraction: 0.62, wFraction: 0.14, hFraction: 0.05 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 5 — Ice, symmetrical frozen vault
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
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Symmetrical ice shelf left
      { xFraction: 0.12, yFraction: 0.63, wFraction: 0.18, hFraction: 0.05 },
      // Centre high platform
      { xFraction: 0.40, yFraction: 0.42, wFraction: 0.20, hFraction: 0.05 },
      // Ice shelf right
      { xFraction: 0.70, yFraction: 0.63, wFraction: 0.18, hFraction: 0.05 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 6 — Ice, complex frozen battleground
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 6,
    name: 'Frost Labyrinth',
    theme: 'ice',
    enemies: [
      {
        xFraction: 0.50,
        yFraction: 0.50,
        kinds: [ParticleKind.Ice],
        particleCount: 22,
        isBossFlag: 0,
      },
      {
        xFraction: 0.80,
        yFraction: 0.50,
        kinds: [ParticleKind.Ice, ParticleKind.Water],
        particleCount: 22,
        isBossFlag: 0,
      },
    ],
    walls: [
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Left low shelf
      { xFraction: 0.08, yFraction: 0.70, wFraction: 0.16, hFraction: 0.05 },
      // Left-centre mid platform
      { xFraction: 0.28, yFraction: 0.55, wFraction: 0.16, hFraction: 0.05 },
      // Centre tall platform — requires two jumps from floor
      { xFraction: 0.44, yFraction: 0.38, wFraction: 0.12, hFraction: 0.05 },
      // Right mid platform
      { xFraction: 0.62, yFraction: 0.55, wFraction: 0.16, hFraction: 0.05 },
      // Right high ledge
      { xFraction: 0.80, yFraction: 0.40, wFraction: 0.15, hFraction: 0.05 },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Level 7 — BOSS: World 1 Guardian — Tide Warden
  // Open arena with two raised corner ledges flanking the boss.
  // ─────────────────────────────────────────────────────────────────────────
  {
    worldNumber: 1,
    levelNumber: 7,
    name: 'Tide Warden (BOSS)',
    theme: 'boss',
    enemies: [
      {
        xFraction: 0.55,
        yFraction: 0.50,
        kinds: [ParticleKind.Physical, ParticleKind.Water, ParticleKind.Ice],
        particleCount: 40,
        isBossFlag: 1,
      },
    ],
    walls: [
      // Full-width floor
      { xFraction: 0.00, yFraction: 0.88, wFraction: 1.00, hFraction: 0.12 },
      // Left raised ledge (player's starting advantage)
      { xFraction: 0.05, yFraction: 0.62, wFraction: 0.18, hFraction: 0.05 },
      // Central platform above boss
      { xFraction: 0.38, yFraction: 0.45, wFraction: 0.24, hFraction: 0.05 },
      // Right raised ledge
      { xFraction: 0.78, yFraction: 0.62, wFraction: 0.18, hFraction: 0.05 },
    ],
  },
];
