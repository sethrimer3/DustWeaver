/**
 * Deterministic post-load fade sequence for full campaign gameplay entry/
 * re-entry (new game, load save, Return to Last Save, restart) — excluded
 * from ordinary same-session room-to-room transitions, which stay on their
 * existing fast path.
 *
 * Timeline once armed and readiness gates have cleared:
 *   fading-to-black (1500ms) -> black-hold (1000ms) -> fading-to-light (1500ms) -> idle
 *
 * Gameplay (sim ticks, input, transitions, timers) is blocked during
 * fading-to-black and black-hold. It resumes on the exact frame
 * fading-to-light begins, while the black cover continues fading away on
 * top of the resumed gameplay.
 */

export type EntryFadePhase =
  | 'idle'
  | 'pending'
  | 'fading-to-black'
  | 'black-hold'
  | 'fading-to-light';

export const ENTRY_FADE_TO_BLACK_MS = 1500;
export const ENTRY_FADE_BLACK_HOLD_MS = 1000;
export const ENTRY_FADE_TO_LIGHT_MS = 1500;

export interface EntryFadeState {
  phase: EntryFadePhase;
  /** Elapsed time (ms) within the current phase. */
  elapsedMs: number;
}

export function createEntryFadeState(): EntryFadeState {
  return { phase: 'idle', elapsedMs: 0 };
}

/**
 * Arms the sequence. Timing does not begin until `tickEntryFade` is first
 * called — callers should only call `tickEntryFade` once all loading
 * readiness gates have cleared, so the 1.5s fade-out is not silently
 * consumed by remaining load time.
 */
export function armEntryFade(state: EntryFadeState): void {
  state.phase = 'pending';
  state.elapsedMs = 0;
}

/** Cancels any in-progress or pending sequence and clears the overlay. */
export function cancelEntryFade(state: EntryFadeState): void {
  state.phase = 'idle';
  state.elapsedMs = 0;
}

export function isEntryFadeActive(state: EntryFadeState): boolean {
  return state.phase !== 'idle';
}

export interface EntryFadeTickResult {
  /** True while sim ticks, input, transitions, and timers must be blocked. */
  blocksGameplay: boolean;
  /** 0 = fully clear, 1 = fully black. */
  overlayAlpha: number;
  /**
   * True exactly once: on the frame the sequence transitions from
   * black-hold into fading-to-light. Callers must reset their frame-delta
   * accumulator/lastTimestamp on this frame so no elapsed fade/hold time
   * becomes a simulation catch-up tick, and must discard any input
   * buffered while gameplay was blocked.
   */
  didJustResumeGameplay: boolean;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Advances the sequence by `elapsedFrameMs` of real wall-clock time.
 * Frame-rate independent: timing is derived purely from elapsed time, never
 * frame counts. A single call may cross multiple phase boundaries (e.g. a
 * large frame delta) deterministically.
 */
export function tickEntryFade(state: EntryFadeState, elapsedFrameMs: number): EntryFadeTickResult {
  if (state.phase === 'idle') {
    return { blocksGameplay: false, overlayAlpha: 0, didJustResumeGameplay: false };
  }

  if (state.phase === 'pending') {
    state.phase = 'fading-to-black';
    state.elapsedMs = 0;
  }

  let remainingMs = Math.max(0, elapsedFrameMs);
  let didJustResumeGameplay = false;

  while (remainingMs > 0 && state.phase !== 'idle') {
    if (state.phase === 'fading-to-black') {
      const remainingInPhase = ENTRY_FADE_TO_BLACK_MS - state.elapsedMs;
      if (remainingMs < remainingInPhase) {
        state.elapsedMs += remainingMs;
        remainingMs = 0;
      } else {
        remainingMs -= remainingInPhase;
        state.phase = 'black-hold';
        state.elapsedMs = 0;
      }
    } else if (state.phase === 'black-hold') {
      const remainingInPhase = ENTRY_FADE_BLACK_HOLD_MS - state.elapsedMs;
      if (remainingMs < remainingInPhase) {
        state.elapsedMs += remainingMs;
        remainingMs = 0;
      } else {
        remainingMs -= remainingInPhase;
        state.phase = 'fading-to-light';
        state.elapsedMs = 0;
        didJustResumeGameplay = true;
      }
    } else if (state.phase === 'fading-to-light') {
      const remainingInPhase = ENTRY_FADE_TO_LIGHT_MS - state.elapsedMs;
      if (remainingMs < remainingInPhase) {
        state.elapsedMs += remainingMs;
        remainingMs = 0;
      } else {
        remainingMs -= remainingInPhase;
        state.phase = 'idle';
        state.elapsedMs = 0;
      }
    }
  }

  const blocksGameplay = state.phase === 'fading-to-black' || state.phase === 'black-hold';

  let overlayAlpha = 0;
  if (state.phase === 'fading-to-black') {
    overlayAlpha = clamp01(state.elapsedMs / ENTRY_FADE_TO_BLACK_MS);
  } else if (state.phase === 'black-hold') {
    overlayAlpha = 1;
  } else if (state.phase === 'fading-to-light') {
    overlayAlpha = 1 - clamp01(state.elapsedMs / ENTRY_FADE_TO_LIGHT_MS);
  }

  return { blocksGameplay, overlayAlpha, didJustResumeGameplay };
}
