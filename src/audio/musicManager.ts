/**
 * Global background music manager.
 *
 * Persists across room transitions. Handles:
 *   - Seamless continuation when entering a room set to [Continue Last Song]
 *   - 4-second crossfade when switching between two different songs
 *   - 2-second end-to-start loop crossfade so looping is inaudible
 *   - Clean fade-out/in when transitioning to/from [Silence]
 *   - Master volume that can be updated at any time
 *
 * Usage:
 *   const mgr = createMusicManager(BASE_URL);
 *   mgr.notifyRoomEntered('thoughtfulLevel');
 *   mgr.setVolume(0.7);
 *   mgr.dispose();
 */

/** Special sentinels plus the real song IDs. */
export type RoomSongId =
  | '_continue'
  | '_silence'
  | 'rainWindAtmosphere'
  | 'thoughtfulLevel'
  | 'titleMenu';

/** Human-readable labels for each RoomSongId (used in editor dropdowns). */
export const SONG_DISPLAY_NAMES: Readonly<Record<RoomSongId, string>> = {
  _continue:           '[Continue Last Song]',
  _silence:            '[Silence]',
  rainWindAtmosphere:  'Rain & Wind Atmosphere',
  thoughtfulLevel:     'Thoughtful Level',
  titleMenu:           'Title Menu',
};

/** Ordered list of concrete (non-sentinel) song IDs, for building dropdowns. */
export const AVAILABLE_SONGS: readonly RoomSongId[] = [
  'rainWindAtmosphere',
  'thoughtfulLevel',
  'titleMenu',
];

// ── Internal constants ────────────────────────────────────────────────────────

/** Relative path to each song inside ASSETS/MUSIC/. */
const SONG_FILE: Readonly<Record<string, string>> = {
  rainWindAtmosphere: 'MUSIC/rainWindAtmosphere.mp3',
  thoughtfulLevel:    'MUSIC/thoughtfulLevel.mp3',
  titleMenu:          'MUSIC/titleMenu.mp3',
};

/** Duration of the room-to-room crossfade in milliseconds. */
const CROSSFADE_ROOM_MS = 4000;

/** How far from the end of a song (ms) we begin the loop crossfade. */
const LOOP_FADE_TRIGGER_MS = 2000;

/** Duration of the end-to-start loop crossfade in milliseconds. */
const CROSSFADE_LOOP_MS = 2000;

// ── MusicManager class ────────────────────────────────────────────────────────

export class MusicManager {
  private readonly base: string;

  /** Master output volume (0..1). All audio.volume values are scaled by this. */
  private targetVolume = 0.7;

  /**
   * The resolved song that is currently "active" (playing or fading in).
   * null means silence.
   */
  private activeSongId: string | null = null;

  /**
   * The primary audio element (fully up or fading in during a crossfade).
   * null when silence is active.
   */
  private primaryAudio: HTMLAudioElement | null = null;

  /** Linear gain (0..1) applied on top of targetVolume for primaryAudio. */
  private primaryGain = 1;

  /**
   * Audio element that is currently fading out (during a room crossfade).
   * null when no crossfade is in progress.
   */
  private fadingAudio: HTMLAudioElement | null = null;

  /** Linear gain (0..1) applied on top of targetVolume for fadingAudio. */
  private fadingGain = 0;

  // ── Room crossfade state ─────────────────────────────────────────────────

  private isCrossfading = false;
  private crossfadeStartMs = 0;
  private crossfadeDurationMs = CROSSFADE_ROOM_MS;

  // ── Loop crossfade state ─────────────────────────────────────────────────

  /**
   * When a song is about to end, this holds the fresh audio instance that
   * is fading in to seamlessly loop it.
   */
  private loopNextAudio: HTMLAudioElement | null = null;

  private isLoopCrossfading = false;
  private loopCrossfadeStartMs = 0;

  // ── RAF-based update loop ────────────────────────────────────────────────

  private rafId: number | null = null;
  private isDisposed = false;

  constructor(base: string) {
    this.base = base;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Call whenever the player enters a room.
   * Interprets the songId according to the transition rules and starts/stops
   * music as required.
   */
  notifyRoomEntered(songId: RoomSongId): void {
    if (this.isDisposed) return;

    if (songId === '_continue') {
      // Keep playing whatever is already playing — do nothing.
      return;
    }

    const resolvedSongId: string | null = songId === '_silence' ? null : songId;

    // If the resolved song is already the active song, no action needed.
    if (resolvedSongId === this.activeSongId) return;

    this.beginCrossfade(resolvedSongId);
  }

  /**
   * Update the master volume.  The change takes effect immediately on all
   * currently-active audio elements.
   */
  setVolume(volume: number): void {
    this.targetVolume = volume;
    this.applyVolumes();
  }

  /** Stop all audio and release resources. Safe to call multiple times. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopAudio(this.primaryAudio);
    this.stopAudio(this.fadingAudio);
    this.stopAudio(this.loopNextAudio);
    this.primaryAudio = null;
    this.fadingAudio = null;
    this.loopNextAudio = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Start a crossfade from whatever is currently playing to newSongId (or silence). */
  private beginCrossfade(newSongId: string | null): void {
    // Cancel any in-progress loop crossfade — a room transition takes priority.
    if (this.isLoopCrossfading && this.loopNextAudio) {
      this.stopAudio(this.loopNextAudio);
      this.loopNextAudio = null;
      this.isLoopCrossfading = false;
    }

    // The current primary becomes the outgoing (fading-out) audio.
    // If something was already fading out, stop it immediately.
    this.stopAudio(this.fadingAudio);

    if (this.primaryAudio !== null) {
      this.fadingAudio = this.primaryAudio;
      this.fadingGain = this.primaryGain;
    } else {
      this.fadingAudio = null;
      this.fadingGain = 0;
    }

    // Set up the new primary.
    if (newSongId !== null) {
      const audio = this.createAudio(newSongId);
      this.primaryAudio = audio;
      this.primaryGain = 0;
      audio.volume = 0;
      audio.play().catch(() => { /* autoplay may be blocked */ });
    } else {
      this.primaryAudio = null;
      this.primaryGain = 0;
    }

    this.activeSongId = newSongId;

    // Begin the fade.
    // NOTE: performance.now() is acceptable here because MusicManager lives in
    // the render/audio layer (not the deterministic sim), and crossfade timing
    // only affects the audio experience, not simulation state.
    const hasSomethingToFade = this.fadingAudio !== null || newSongId !== null;
    if (hasSomethingToFade) {
      this.isCrossfading = true;
      this.crossfadeStartMs = performance.now();
      this.crossfadeDurationMs = CROSSFADE_ROOM_MS;
      this.scheduleUpdate();
    }
  }

  /**
   * Called by timeupdate listener when the playing song is within
   * LOOP_FADE_TRIGGER_MS of its end.
   */
  private beginLoopCrossfade(songId: string, outgoing: HTMLAudioElement): void {
    if (this.isLoopCrossfading) return;
    if (this.isCrossfading) return; // room transition takes priority
    if (outgoing !== this.primaryAudio) return;
    if (this.activeSongId !== songId) return;

    this.isLoopCrossfading = true;
    this.loopCrossfadeStartMs = performance.now();

    const nextAudio = this.createAudio(songId);
    this.loopNextAudio = nextAudio;
    nextAudio.volume = 0;
    nextAudio.play().catch(() => {});

    this.scheduleUpdate();
  }

  /** Allocate and configure a new HTMLAudioElement for the given song. */
  private createAudio(songId: string): HTMLAudioElement {
    const url = this.base + (SONG_FILE[songId] ?? '');
    const audio = new Audio(url);
    audio.loop = false; // Looping is managed manually so we can crossfade.
    audio.volume = 0;

    // Monitor progress so we can trigger the loop crossfade before it ends.
    const onTimeUpdate = () => {
      if (audio !== this.primaryAudio) {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        return;
      }
      if (this.activeSongId !== songId) {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        return;
      }
      if (this.isLoopCrossfading || this.isCrossfading) return;

      const remaining = audio.duration - audio.currentTime;
      if (!isNaN(remaining) && isFinite(remaining) && remaining > 0
          && remaining <= LOOP_FADE_TRIGGER_MS / 1000) {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        this.beginLoopCrossfade(songId, audio);
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);

    // Fallback: if the song ends without a loop crossfade having started
    // (e.g., very short file or timeupdate was too infrequent), restart it.
    audio.addEventListener('ended', () => {
      if (audio !== this.primaryAudio) return;
      if (this.activeSongId !== songId) return;
      if (this.isLoopCrossfading) return;
      // Restart immediately without a crossfade as a fallback.
      audio.currentTime = 0;
      audio.play().catch(() => {});
    });

    return audio;
  }

  /** Pause an audio element and clear its src to free memory. */
  private stopAudio(audio: HTMLAudioElement | null): void {
    if (audio === null) return;
    audio.pause();
    audio.src = '';
  }

  /** Apply current gains × targetVolume to all active audio elements. */
  private applyVolumes(): void {
    if (this.primaryAudio !== null) {
      this.primaryAudio.volume = Math.max(0, Math.min(1, this.primaryGain * this.targetVolume));
    }
    if (this.fadingAudio !== null) {
      this.fadingAudio.volume = Math.max(0, Math.min(1, this.fadingGain * this.targetVolume));
    }
    if (this.loopNextAudio !== null && this.isLoopCrossfading) {
      const elapsedMs = performance.now() - this.loopCrossfadeStartMs;
      const t = Math.min(elapsedMs / CROSSFADE_LOOP_MS, 1);
      this.loopNextAudio.volume = Math.max(0, Math.min(1, t * this.primaryGain * this.targetVolume));
    }
  }

  // ── RAF update loop ──────────────────────────────────────────────────────

  private scheduleUpdate(): void {
    if (this.rafId !== null) return; // already scheduled
    this.rafId = requestAnimationFrame((nowMs) => {
      this.rafId = null;
      this.tick(nowMs);
    });
  }

  private tick(nowMs: number): void {
    if (this.isDisposed) return;

    let needsMore = false;

    // ── Room crossfade ──────────────────────────────────────────────────
    if (this.isCrossfading) {
      const elapsed = nowMs - this.crossfadeStartMs;
      const t = Math.min(elapsed / this.crossfadeDurationMs, 1);

      this.primaryGain = t;
      this.fadingGain = 1 - t;

      if (this.primaryAudio !== null) {
        this.primaryAudio.volume = Math.max(0, Math.min(1, this.primaryGain * this.targetVolume));
      }
      if (this.fadingAudio !== null) {
        this.fadingAudio.volume = Math.max(0, Math.min(1, this.fadingGain * this.targetVolume));
      }

      if (t >= 1) {
        this.isCrossfading = false;
        this.primaryGain = 1;
        if (this.fadingAudio !== null) {
          this.stopAudio(this.fadingAudio);
          this.fadingAudio = null;
        }
        if (this.primaryAudio !== null) {
          this.primaryAudio.volume = Math.max(0, Math.min(1, this.targetVolume));
        }
      } else {
        needsMore = true;
      }
    }

    // ── Loop crossfade ──────────────────────────────────────────────────
    if (this.isLoopCrossfading && this.loopNextAudio !== null) {
      const elapsed = nowMs - this.loopCrossfadeStartMs;
      const t = Math.min(elapsed / CROSSFADE_LOOP_MS, 1);

      // During loop crossfade: primaryGain stays at 1 (full, modulated by
      // the room-crossfade if also running), primary fades out (1-t),
      // loopNext fades in (t).  We skip this if a room crossfade is also
      // active (it would conflict with primaryGain).
      if (!this.isCrossfading) {
        if (this.primaryAudio !== null) {
          this.primaryAudio.volume = Math.max(0, Math.min(1, (1 - t) * this.targetVolume));
        }
        this.loopNextAudio.volume = Math.max(0, Math.min(1, t * this.targetVolume));
      }

      if (t >= 1) {
        this.isLoopCrossfading = false;
        this.stopAudio(this.primaryAudio);
        this.primaryAudio = this.loopNextAudio;
        this.loopNextAudio = null;
        this.primaryGain = 1;
        if (this.primaryAudio !== null) {
          this.primaryAudio.volume = Math.max(0, Math.min(1, this.targetVolume));
        }
      } else {
        needsMore = true;
      }
    }

    if (needsMore) {
      this.scheduleUpdate();
    }
  }
}

/** Create and return a new MusicManager bound to the given Vite base URL. */
export function createMusicManager(base: string): MusicManager {
  return new MusicManager(base);
}
