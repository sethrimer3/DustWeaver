import { getSfxVolume } from '../ui/renderSettings';

const BASE = import.meta.env.BASE_URL;
const PLAYER_SFX_BASE = `${BASE}ASSETS/sfx/PLAYER/`;
const WIND_FADE_PER_SEC = 2.8;
const WIND_MAX_VOLUME_SCALE = 0.55;

export type PlayerSfxName =
  | 'grapple_impact'
  | 'grapple_throw'
  | 'grapple_zip'
  | 'jump'
  | 'jump_impact_hard'
  | 'jump_impact_medium'
  | 'jump_impact_soft'
  | 'quickWhoosh'
  | 'step_hard_ground'
  | 'step_normal_ground'
  | 'step_soft_ground'
  | 'walljump_high'
  | 'walljump_low';

const SFX_VOLUME_SCALE: Record<PlayerSfxName, number> = {
  grapple_impact: 0.58,
  grapple_throw: 0.46,
  grapple_zip: 0.48,
  jump: 0.42,
  jump_impact_hard: 0.54,
  jump_impact_medium: 0.45,
  jump_impact_soft: 0.36,
  quickWhoosh: 0.28,
  step_hard_ground: 0.16,
  step_normal_ground: 0.13,
  step_soft_ground: 0.11,
  walljump_high: 0.48,
  walljump_low: 0.36,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class PlayerSfxManager {
  private readonly oneShotByName = new Map<PlayerSfxName, HTMLAudioElement[]>();
  private readonly windAudio: HTMLAudioElement;
  private windVolume = 0;

  constructor() {
    this.windAudio = new Audio(`${PLAYER_SFX_BASE}windWhoosh.ogg`);
    this.windAudio.loop = true;
    this.windAudio.volume = 0;
  }

  play(name: PlayerSfxName, volumeScale = 1): void {
    const pool = this.getPool(name);
    let audio: HTMLAudioElement | null = null;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) {
        audio = pool[i];
        break;
      }
    }
    if (audio === null) {
      audio = new Audio(`${PLAYER_SFX_BASE}${name}.ogg`);
      pool.push(audio);
    }
    audio.currentTime = 0;
    audio.volume = clamp01(getSfxVolume() * SFX_VOLUME_SCALE[name] * volumeScale);
    audio.play().catch(() => {});
  }

  updateWind(speedWorldPerSec: number, audibleSpeedWorldPerSec: number, normalSpeedWorldPerSec: number, dtSec: number): void {
    let targetVolume = 0;
    if (speedWorldPerSec >= audibleSpeedWorldPerSec) {
      const denom = Math.max(1, normalSpeedWorldPerSec - audibleSpeedWorldPerSec);
      const speedT = clamp01((speedWorldPerSec - audibleSpeedWorldPerSec) / denom);
      targetVolume = (0.08 + speedT * 0.92) * WIND_MAX_VOLUME_SCALE;
    }

    const maxDelta = WIND_FADE_PER_SEC * dtSec;
    if (this.windVolume < targetVolume) {
      this.windVolume = Math.min(targetVolume, this.windVolume + maxDelta);
    } else {
      this.windVolume = Math.max(targetVolume, this.windVolume - maxDelta);
    }

    this.windAudio.volume = clamp01(this.windVolume * getSfxVolume());
    if (this.windVolume > 0.001) {
      this.windAudio.play().catch(() => {});
    } else {
      this.windAudio.pause();
    }
  }

  stop(): void {
    this.windAudio.pause();
    this.windAudio.currentTime = 0;
    this.windVolume = 0;
    for (const pool of this.oneShotByName.values()) {
      for (let i = 0; i < pool.length; i++) {
        pool[i].pause();
        pool[i].currentTime = 0;
      }
    }
  }

  private getPool(name: PlayerSfxName): HTMLAudioElement[] {
    let pool = this.oneShotByName.get(name);
    if (pool === undefined) {
      pool = [];
      this.oneShotByName.set(name, pool);
    }
    return pool;
  }
}
