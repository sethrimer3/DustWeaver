/**
 * kineticBlockTypes.ts — Constants and type definitions for kinetic blocks.
 */

/** Maximum number of kinetic blocks supported per room. */
export const MAX_KINETIC_BLOCKS = 64;

/**
 * Velocity boost applied to the player when touching a kinetic block surface.
 * Applied in the push-out direction regardless of the player's current velocity.
 */
export const KINETIC_BLOCK_BOOST_SPEED_WORLD = 280;

/** Animation phase increment per tick (0-255 wrapping). Controls pulse glow speed. */
export const KINETIC_BLOCK_ANIM_SPEED_PER_TICK = 3;
