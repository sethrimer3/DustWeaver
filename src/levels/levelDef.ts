/**
 * Level definition types for DustWeaver.
 *
 * Positions and sizes are expressed as fractions of the screen dimensions
 * (0–1) so layouts scale to any resolution.  The game screen converts them
 * to world units at load time.
 */

import { ParticleKind } from '../sim/particles/kinds';

/** Defines a single enemy cluster within a level. */
export interface EnemyDef {
  /** Horizontal position as a fraction of the world width (0 = left, 1 = right). */
  xFraction: number;
  /** Vertical position as a fraction of the world height (0 = top, 1 = bottom). */
  yFraction: number;
  /** Particle kinds composing this enemy. */
  kinds: ParticleKind[];
  /** Total number of particles this enemy starts with. */
  particleCount: number;
  /** When 1, this enemy is a boss — larger, tougher, with more particles. */
  isBossFlag: 0 | 1;
}

/** Defines an axis-aligned wall rectangle in a level. */
export interface WallDef {
  /** Left edge as a fraction of world width. */
  xFraction: number;
  /** Top edge as a fraction of world height. */
  yFraction: number;
  /** Width as a fraction of world width. */
  wFraction: number;
  /** Height as a fraction of world height. */
  hFraction: number;
}

/** Defines a door rectangle and its destination semantics for a level. */
export interface DoorDef {
  xFraction: number;
  yFraction: number;
  wFraction: number;
  hFraction: number;
  /** "next" moves forward in campaign flow, "menu" returns to main menu. */
  target: 'next' | 'menu';
}

/** Visual theme used for background tinting and atmospheric effects. */
export type LevelTheme = 'physical' | 'water' | 'ice' | 'boss' | 'fire' | 'lava' | 'stone' | 'metal';

/** Full definition for a single game level. */
export interface LevelDef {
  worldNumber: number;
  levelNumber: number;
  /** Display name shown on the world map and during gameplay. */
  name: string;
  theme: LevelTheme;
  enemies: EnemyDef[];
  walls: WallDef[];
  /** Player spawn door for the level. */
  entryDoor: DoorDef;
  /** Exit door used to move to next screen / main menu. */
  exitDoor: DoorDef;
}
