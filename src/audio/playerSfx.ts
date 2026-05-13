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

/** Names of all one-shot player SFX files (no extension). */
const ALL_SFX_NAMES: string[] = [
  'grapple_impact', 'grapple_throw', 'grapple_zip', 'jump',
  'jump_impact_hard', 'jump_impact_medium', 'jump_impact_soft',
  'quickWhoosh', 'step_hard_ground', 'step_normal_ground', 'step_soft_ground',
  'walljump_high', 'walljump_low', 'windWhoosh',
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ── Module-level diagnostics ──────────────────────────────────────────────────
// Warn once per sound to avoid flooding the console on every frame.
const _playWarned  = new Set<string>();
const _loadWarned  = new Set<string>();
let   _lastPlayedName = '';
let   _lastErrorMsg   = '';

function warnPlayFailure(name: string, err: unknown): void {
  if (_playWarned.has(name)) return;
  _playWarned.add(name);
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  _lastErrorMsg = `play ${name}: ${msg}`;
  console.warn(`[PlayerSFX] Failed to play "${name}": ${msg}`);
}

function warnLoadFailure(name: string, url: string, err: unknown): void {
  if (_loadWarned.has(name)) return;
  _loadWarned.add(name);
  const msg = err instanceof Error ? err.message : String(err);
  _lastErrorMsg = `load ${name}: ${msg}`;
  console.warn(`[PlayerSFX] Failed to load/decode "${name}" (${url}): ${msg}`);
}

// ── PlayerSfxManager ─────────────────────────────────────────────────────────

/**
 * Manages player sound effects using the Web Audio API.
 *
 * Buffers are preloaded after the user's first trusted gesture unlocks the
 * AudioContext.  One-shots are played via short-lived AudioBufferSourceNode +
 * GainNode pairs so overlapping footsteps and wall-jumps work correctly.
 * Wind is a looping source on a dedicated GainNode that fades in/out.
 *
 * Diagnostics: load/play failures are logged once per sound name via
 * console.warn so they are visible in DevTools without spamming every frame.
 */
export class PlayerSfxManager {
  private readonly actx: AudioContext;
  /** Master gain node — all sounds route through this. */
  private readonly masterGain: GainNode;
  /** Dedicated gain node for the looping wind effect. */
  private readonly windGain: GainNode;

  /**
   * Decoded audio buffers keyed by sound name.
   * - Absent: not yet requested.
   * - null: load was requested but is still in-flight or failed.
   * - AudioBuffer: successfully decoded and ready to play.
   */
  private readonly buffers = new Map<string, AudioBuffer | null>();

  /** Currently running wind loop source, or null when wind is silent. */
  private windSource: AudioBufferSourceNode | null = null;
  /** Smoothed wind gain level (0–WIND_MAX_VOLUME_SCALE). */
  private windCurrentGain = 0;

  /** True once the AudioContext has been resumed after a user gesture. */
  private isUnlocked = false;

  constructor() {
    this.actx = new AudioContext();
    this.masterGain = this.actx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.actx.destination);
    this.windGain = this.actx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.masterGain);
  }

  /**
   * Resume the AudioContext after a trusted user gesture, then preload all
   * buffers.  Safe to call multiple times — only acts once.
   */
  unlock(): void {
    if (this.isUnlocked) return;
    const resume = (): Promise<void> =>
      this.actx.state === 'suspended' ? this.actx.resume() : Promise.resolve();
    resume()
      .then(() => {
        this.isUnlocked = true;
        this._preloadAll();
      })
      .catch((err: unknown) => {
        console.warn('[PlayerSFX] AudioContext resume failed:', err);
      });
  }

  private _preloadAll(): void {
    for (let i = 0; i < ALL_SFX_NAMES.length; i++) {
      this._loadBuffer(ALL_SFX_NAMES[i]);
    }
  }

  private _loadBuffer(name: string): void {
    if (this.buffers.has(name)) return;
    this.buffers.set(name, null); // Sentinel: loading in progress
    const url = `${PLAYER_SFX_BASE}${name}.ogg`;
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(ab => this.actx.decodeAudioData(ab))
      .then(buffer => {
        this.buffers.set(name, buffer);
      })
      .catch((err: unknown) => {
        warnLoadFailure(name, url, err);
        // Leave null so repeated calls do not retry on every frame.
      });
  }

  /**
   * Play a one-shot player sound effect.  Safe to call before unlock or while
   * a buffer is still loading — the call is silently dropped so callers do not
   * need to guard.
   */
  play(name: PlayerSfxName, volumeScale = 1): void {
    // Lazily request the buffer even before unlock so it is ready sooner.
    if (!this.buffers.has(name)) this._loadBuffer(name);

    if (!this.isUnlocked || this.actx.state !== 'running') return;

    const buffer = this.buffers.get(name);
    if (!buffer) return; // Still loading or failed

    const sfxVol = getSfxVolume();
    // If the player has set SFX volume to 0, skip silently (intentional).
    if (sfxVol <= 0) return;

    const volume = clamp01(sfxVol * SFX_VOLUME_SCALE[name] * volumeScale);
    try {
      const gainNode = this.actx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(this.masterGain);

      const source = this.actx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
      source.start();
      // Disconnect nodes after playback to prevent GC pressure.
      source.onended = () => {
        source.disconnect();
        gainNode.disconnect();
      };
      _lastPlayedName = name;
    } catch (err: unknown) {
      warnPlayFailure(name, err);
    }
  }

  /**
   * Update the looping wind effect volume based on player speed.
   * Called every physics tick (or every frame) — allocation-free.
   */
  updateWind(
    speedWorldPerSec: number,
    audibleSpeedWorldPerSec: number,
    normalSpeedWorldPerSec: number,
    dtSec: number,
  ): void {
    let targetGain = 0;
    if (speedWorldPerSec >= audibleSpeedWorldPerSec) {
      const denom = Math.max(1, normalSpeedWorldPerSec - audibleSpeedWorldPerSec);
      const speedT = clamp01((speedWorldPerSec - audibleSpeedWorldPerSec) / denom);
      targetGain = (0.08 + speedT * 0.92) * WIND_MAX_VOLUME_SCALE;
    }

    const maxDelta = WIND_FADE_PER_SEC * dtSec;
    if (this.windCurrentGain < targetGain) {
      this.windCurrentGain = Math.min(targetGain, this.windCurrentGain + maxDelta);
    } else {
      this.windCurrentGain = Math.max(targetGain, this.windCurrentGain - maxDelta);
    }

    const finalGain = clamp01(this.windCurrentGain * getSfxVolume());
    this.windGain.gain.value = finalGain;

    if (!this.isUnlocked || this.actx.state !== 'running') return;

    const windBuffer = this.buffers.get('windWhoosh') ?? null;
    if (finalGain > 0.001 && windBuffer !== null) {
      if (this.windSource === null) {
        // Start the looping wind source.
        const src = this.actx.createBufferSource();
        src.buffer = windBuffer;
        src.loop = true;
        src.connect(this.windGain);
        src.start();
        this.windSource = src;
      }
    } else if (this.windSource !== null && finalGain <= 0.001) {
      try { this.windSource.stop(); } catch (_) { /* ignore if already ended */ }
      this.windSource.disconnect();
      this.windSource = null;
    }
  }

  /** Stop all audio and reset wind state.  Call when leaving gameplay. */
  stop(): void {
    if (this.windSource !== null) {
      try { this.windSource.stop(); } catch (_) { /* ignore */ }
      this.windSource.disconnect();
      this.windSource = null;
    }
    this.windCurrentGain = 0;
    this.windGain.gain.value = 0;
  }

  /**
   * Returns a snapshot of audio diagnostics for the debug overlay.
   * All fields are allocation-free reads of primitive state.
   */
  getDebugInfo(): {
    isUnlocked: boolean;
    ctxState: AudioContextState;
    bufferCount: number;
    lastPlayedName: string;
    lastErrorMsg: string;
  } {
    let bufferCount = 0;
    for (const buf of this.buffers.values()) {
      if (buf !== null) bufferCount++;
    }
    return {
      isUnlocked: this.isUnlocked,
      ctxState: this.actx.state,
      bufferCount,
      lastPlayedName: _lastPlayedName,
      lastErrorMsg: _lastErrorMsg,
    };
  }
}
