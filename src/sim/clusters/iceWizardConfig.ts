import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';

export const ICE_WIZARD_BOSS_NAME = 'Ice Wizard';

export const ICE_WIZARD_FOOTPRINT_TILES = 4;
export const ICE_WIZARD_SIZE_WORLD = ICE_WIZARD_FOOTPRINT_TILES * BLOCK_SIZE_MEDIUM;
export const ICE_WIZARD_HALF_W = ICE_WIZARD_SIZE_WORLD * 0.5;
export const ICE_WIZARD_HALF_H = ICE_WIZARD_SIZE_WORLD * 0.5;
export const ICE_WIZARD_HP = 72;
export const ICE_WIZARD_CONTACT_DAMAGE = 2;

export const ICE_WIZARD_STATE_IDLE = 0;
export const ICE_WIZARD_STATE_TELEGRAPH_SLAM = 1;
export const ICE_WIZARD_STATE_SLAM_DOWN = 2;
export const ICE_WIZARD_STATE_RECOVERY = 3;
export const ICE_WIZARD_STATE_SUMMON_TELEGRAPH = 4;
export const ICE_WIZARD_STATE_SUMMON_RELEASE = 5;
export const ICE_WIZARD_STATE_SUMMON_RECOVERY = 6;

export const ICE_WIZARD_IDLE_TICKS = 90;
export const ICE_WIZARD_TELEGRAPH_TICKS = 42;
export const ICE_WIZARD_SLAM_SPEED_WORLD_PER_TICK = 7;
export const ICE_WIZARD_RECOVERY_TICKS = 48;
export const ICE_WIZARD_PLAYER_TRIGGER_RANGE_WORLD = 176;

export const ICE_WIZARD_SUMMON_TELEGRAPH_TICKS = 30;
export const ICE_WIZARD_SUMMON_RELEASE_TICKS = 1;
export const ICE_WIZARD_SUMMON_RECOVERY_TICKS = 36;
export const ICE_WIZARD_SUMMON_RADIUS_TILES = 4;
export const ICE_WIZARD_SUMMON_SEARCH_RADIUS_TILES = 3;
export const ICE_WIZARD_SUMMONED_ICE_BUBBLE_HP = 4;
export const ICE_WIZARD_SUMMONED_ICE_BUBBLE_PARTICLES = 6;

export interface IceWizardSummonThreshold {
  ratio: number;
  bubbleCount: number;
  mask: number;
}

export const ICE_WIZARD_SUMMON_THRESHOLDS: readonly IceWizardSummonThreshold[] = [
  { ratio: 0.75, bubbleCount: 2, mask: 1 << 0 },
  { ratio: 0.50, bubbleCount: 3, mask: 1 << 1 },
  { ratio: 0.25, bubbleCount: 4, mask: 1 << 2 },
];

export const ICE_SPIKE_SPACING_WORLD = BLOCK_SIZE_MEDIUM;
export const ICE_SPIKE_WAVE_MAX_RANGE_TILES = 12;
export const ICE_SPIKE_WAVE_PROPAGATION_DELAY_TICKS = 4;
export const ICE_SPIKE_TELEGRAPH_TICKS = 10;
export const ICE_SPIKE_RISE_TICKS = 8;
export const ICE_SPIKE_ACTIVE_TICKS = 20;
export const ICE_SPIKE_FADE_TICKS = 14;
export const ICE_SPIKE_DAMAGE = 2;
export const ICE_SPIKE_IFRAMES = 36;
export const ICE_SPIKE_WIDTH_WORLD = 7;
export const ICE_SPIKE_HEIGHT_WORLD = 18;
export const MAX_ICE_SPIKES = 48;

export const ICE_SPIKE_TOTAL_TICKS =
  ICE_SPIKE_TELEGRAPH_TICKS +
  ICE_SPIKE_RISE_TICKS +
  ICE_SPIKE_ACTIVE_TICKS +
  ICE_SPIKE_FADE_TICKS;
