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
export const CW_MOVE_DRAG = 0.94;
export const CW_PREFERRED_DISTANCE = 86;
export const CW_TOO_CLOSE_DISTANCE = 54;
export const CW_ROOM_MARGIN = 18;
export const CW_CONTACT_DAMAGE = 1;
export const CW_CONTACT_IFRAMES = 36;

export const CW_INITIAL_COOLDOWN_TICKS = 80;
export const CW_RECOVER_TICKS = 44;

export const MAX_CW_FIRE_DUST = 700;
export const MAX_CW_SMOKE = 420;
export const MAX_CW_PROJECTILES = 18;

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
