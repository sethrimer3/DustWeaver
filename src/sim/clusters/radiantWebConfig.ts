/**
 * Radiant Web — tunable configuration for the splitting laser boss.
 */

export const RW_RAYCAST_STEP_WORLD = 2.0;
/** Offset applied along branch direction before raycasting to clear the wall surface. */
export const RW_BRANCH_START_OFFSET_WORLD = 3.0;
/** Minimum drift speed toward player during beam fire (world units/tick). */
export const RW_DRIFT_SPEED_MIN_WORLD = 0.3;
/** Additional random component added to drift speed (world units/tick). */
export const RW_DRIFT_SPEED_VARIANCE_WORLD = 0.2;
export const RW_RESET_DURATION_TICKS = 60;
export const RW_MAIN_BEAM_COUNT = 3;
export const RW_MAIN_BEAM_GROW_SPEED_WORLD = 3.5;
export const RW_MAIN_BEAM_ALPHA = 0.25;
export const RW_MAIN_BEAM_WIDTH_PX = 2.5;
export const RW_MAIN_BEAM_MAX_RANGE_WORLD = 350.0;
export const RW_BRANCH_BEAMS_PER_MAIN = 2;
export const RW_BRANCH_BEAM_ANGLE_OFFSET_RAD = Math.PI / 4;
export const RW_BRANCH_BEAM_GROW_SPEED_WORLD = 2.5;
export const RW_BRANCH_BEAM_WIDTH_PX = 1.5;
export const RW_BRANCH_BEAM_MAX_RANGE_WORLD = 200.0;
export const RW_BRANCH_ENERGIZE_DELAY_TICKS = 20;
export const RW_BRANCH_DAMAGE_TICKS = 90;
export const RW_BRANCH_DAMAGE = 1;
export const RW_BRANCH_HITBOX_HALF_WIDTH_WORLD = 3.5;
export const RW_BRANCH_IFRAMES_TICKS = 60;
export const RW_MAIN_BEAM_PUFF_COUNT = 5;
export const RW_MAIN_BEAM_PUFF_LIFETIME_TICKS = 30;
export const RW_MAIN_BEAM_PUFF_ALPHA = 0.6;
export const RW_MAIN_BEAM_PUFF_RADIUS_WORLD = 6.0;
export const RW_BRANCH_ROPE_LIFETIME_TICKS = 180;
export const RW_BRANCH_ROPE_GRAVITY_WORLD = 0.22;
export const RW_BRANCH_ROPE_DRAG = 0.985;
export const RW_BRANCH_ROPE_SEGMENTS = 12;
export const RW_BEAM_JITTER_RAD = Math.PI / 6;
export const RW_BEAM_ANGLE_SPACING_RAD = (Math.PI * 2) / 3;
export const RW_SECONDARY_BEAM_JITTER_RAD = 0.3;
export const RW_BODY_RADIUS_WORLD = 8.0;
export const RW_BODY_HALF_SIZE_WORLD = 6.0;
export const RW_PARTICLE_COUNT = 50;
export const RW_ACTIVATION_RANGE_WORLD = 250.0;
export const RW_DEBUG_ENABLED = false;
