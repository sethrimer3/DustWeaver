import { PLAYER_HALF_HEIGHT_WORLD, PLAYER_HALF_WIDTH_WORLD } from '../../levels/roomDef';

export const CW_HP = 48;
export const CW_HALF_W = PLAYER_HALF_WIDTH_WORLD;
export const CW_HALF_H = PLAYER_HALF_HEIGHT_WORLD;

export const CW_STATE_IDLE = 0;
export const CW_STATE_TIDAL_WAVE = 1;
export const CW_STATE_FIRE_PILLARS = 2;
export const CW_STATE_METEORS = 3;
export const CW_STATE_FIRE_BALLS = 4;
export const CW_STATE_RECOVER = 5;

export const CW_MOVE_MAX_SPEED = 2.4;
export const CW_MOVE_ACCEL = 0.095;
export const CW_MOVE_DAMPING = 0.94;
export const CW_ATTACK_MOVE_SCALE = 0.72;
export const CW_PREFERRED_DISTANCE = 86;
export const CW_TOO_CLOSE_DISTANCE = 54;
export const CW_WALL_AVOID_DISTANCE = 26;
export const CW_IDLE_DRIFT_STRENGTH_X = 0.35;
export const CW_IDLE_DRIFT_STRENGTH_Y = 0.42;
export const CW_ROOM_MARGIN = 18;
export const CW_CONTACT_DAMAGE = 1;
export const CW_CONTACT_IFRAMES = 36;

export const CW_INITIAL_COOLDOWN_TICKS = 80;
export const CW_RECOVER_TICKS = 44;
export const CW_BETWEEN_ATTACK_COOLDOWN_TICKS = 42;

export const CW_TIDAL_WAVE_TELEGRAPH_TICKS = 22;
export const CW_TIDAL_WAVE_DURATION_TICKS = 94;
export const CW_TIDAL_WAVE_EMIT_INTERVAL_TICKS = 5;
export const CW_TIDAL_WAVE_PARTICLES_PER_EMIT = 14;
export const CW_TIDAL_WAVE_SPACING_WORLD = 3.2;
export const CW_TIDAL_WAVE_SPEED_MIN = 0.65;
export const CW_TIDAL_WAVE_SPEED_VARIANCE = 0.45;
export const CW_TIDAL_WAVE_LIFETIME_MIN_TICKS = 40;
export const CW_TIDAL_WAVE_LIFETIME_VARIANCE_TICKS = 28;

export const CW_PILLAR_TELEGRAPH_TICKS = 28;
export const CW_PILLAR_DURATION_TICKS = 92;
export const CW_PILLAR_COUNT = 6;
export const CW_PILLAR_SPACING_WORLD = 18;
export const CW_PILLAR_EMIT_INTERVAL_TICKS = 8;
export const CW_PILLAR_PARTICLES_PER_BURST = 28;
export const CW_PILLAR_HALF_WIDTH_WORLD = 5;

export const CW_METEOR_TELEGRAPH_TICKS = 28;
export const CW_METEOR_DURATION_TICKS = 104;
export const CW_METEOR_INTERVAL_TICKS = 26;
export const CW_METEOR_SPEED_WORLD = 2.25;

export const CW_FIREBALL_TELEGRAPH_TICKS = 18;
export const CW_FIREBALL_DURATION_TICKS = 88;
export const CW_FIREBALL_INTERVAL_TICKS = 16;
export const CW_FIREBALL_SPEED_WORLD = 2.75;

export const MAX_CW_FIRE_DUST = 700;
export const MAX_CW_SMOKE = 420;
export const MAX_CW_PROJECTILES = 18;
export const MAX_CW_TELEGRAPHS = 20;

export const CW_TELEGRAPH_KIND_PILLAR = 1;
export const CW_TELEGRAPH_KIND_METEOR = 2;
export const CW_TELEGRAPH_KIND_CHARGE = 3;

export const CW_FIRE_DUST_SIZE_WORLD = 2;
export const CW_SMOKE_SIZE_WORLD = 1;

export const CW_FIRE_DUST_DAMAGE = 1;
export const CW_FIRE_DUST_HIT_RADIUS = 3.2;
export const CW_FIRE_DUST_IFRAMES = 20;

export const CW_PROJECTILE_TYPE_METEOR = 1;
export const CW_PROJECTILE_TYPE_FIREBALL = 2;

export const CW_METEOR_SIZE_WORLD = 14;
export const CW_METEOR_DAMAGE = 2;
export const CW_FIREBALL_SIZE_WORLD = 8;
export const CW_FIREBALL_DAMAGE = 1;
export const CW_PROJECTILE_IFRAMES = 32;
