import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEntryFadeState,
  armEntryFade,
  cancelEntryFade,
  isEntryFadeActive,
  tickEntryFade,
  ENTRY_FADE_TO_BLACK_MS,
  ENTRY_FADE_BLACK_HOLD_MS,
  ENTRY_FADE_TO_LIGHT_MS,
} from '../screens/gameEntryFadeController';

describe('gameEntryFadeController', () => {
  it('is idle and inactive before arming', () => {
    const state = createEntryFadeState();
    assert.equal(isEntryFadeActive(state), false);
    const result = tickEntryFade(state, 16);
    assert.equal(result.blocksGameplay, false);
    assert.equal(result.overlayAlpha, 0);
    assert.equal(result.didJustResumeGameplay, false);
  });

  it('starts fading to black on the first tick after arming', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    assert.equal(isEntryFadeActive(state), true);
    const result = tickEntryFade(state, 0);
    assert.equal(state.phase, 'fading-to-black');
    assert.equal(result.overlayAlpha, 0);
    assert.equal(result.blocksGameplay, true);
  });

  it('does not begin timing until tickEntryFade is called (arm is inert on its own)', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    assert.equal(state.phase, 'pending');
    assert.equal(state.elapsedMs, 0);
  });

  it('reaches full black exactly at 1.5s and blocks gameplay throughout fade-to-black', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    tickEntryFade(state, 0); // enter fading-to-black
    const mid = tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS / 2);
    assert.ok(Math.abs(mid.overlayAlpha - 0.5) < 1e-9);
    assert.equal(mid.blocksGameplay, true);

    const atEnd = tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS / 2);
    assert.equal(state.phase, 'black-hold');
    assert.equal(atEnd.overlayAlpha, 1);
    assert.equal(atEnd.blocksGameplay, true);
    assert.equal(atEnd.didJustResumeGameplay, false);
  });

  it('holds fully black for exactly 1.0s then blocks gameplay throughout the hold', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    tickEntryFade(state, 0);
    tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS);
    assert.equal(state.phase, 'black-hold');

    const midHold = tickEntryFade(state, ENTRY_FADE_BLACK_HOLD_MS / 2);
    assert.equal(midHold.overlayAlpha, 1);
    assert.equal(midHold.blocksGameplay, true);
    assert.equal(state.phase, 'black-hold');
  });

  it('transitions to fading-to-light exactly once the hold elapses, unblocking gameplay that same frame', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    tickEntryFade(state, 0);
    tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS);
    const result = tickEntryFade(state, ENTRY_FADE_BLACK_HOLD_MS);
    assert.equal(state.phase, 'fading-to-light');
    assert.equal(result.didJustResumeGameplay, true);
    assert.equal(result.blocksGameplay, false);
    assert.equal(result.overlayAlpha, 1);
  });

  it('fades from black back to clear over exactly 1.5s and then goes idle with alpha 0', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    tickEntryFade(state, 0);
    tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS);
    tickEntryFade(state, ENTRY_FADE_BLACK_HOLD_MS);
    assert.equal(state.phase, 'fading-to-light');

    const mid = tickEntryFade(state, ENTRY_FADE_TO_LIGHT_MS / 2);
    assert.ok(Math.abs(mid.overlayAlpha - 0.5) < 1e-9);
    assert.equal(mid.blocksGameplay, false);

    const done = tickEntryFade(state, ENTRY_FADE_TO_LIGHT_MS / 2);
    assert.equal(state.phase, 'idle');
    assert.equal(done.overlayAlpha, 0);
    assert.equal(done.blocksGameplay, false);
    assert.equal(isEntryFadeActive(state), false);
    // Sequence completes cleanly — no lingering overlay state.
    assert.equal(state.elapsedMs, 0);
  });

  it('is frame-rate independent: many small steps equal one large step at the same total elapsed time', () => {
    const totalMs = ENTRY_FADE_TO_BLACK_MS + ENTRY_FADE_BLACK_HOLD_MS + ENTRY_FADE_TO_LIGHT_MS / 2;

    const coarse = createEntryFadeState();
    armEntryFade(coarse);
    tickEntryFade(coarse, 0);
    const coarseResult = tickEntryFade(coarse, totalMs);

    const fine = createEntryFadeState();
    armEntryFade(fine);
    tickEntryFade(fine, 0);
    let fineResult = tickEntryFade(fine, 0);
    const stepMs = 16.6;
    let consumed = 0;
    while (consumed < totalMs) {
      const step = Math.min(stepMs, totalMs - consumed);
      fineResult = tickEntryFade(fine, step);
      consumed += step;
    }

    assert.equal(coarse.phase, fine.phase);
    assert.ok(Math.abs(coarse.elapsedMs - fine.elapsedMs) < 1e-6);
    assert.ok(Math.abs(coarseResult.overlayAlpha - fineResult.overlayAlpha) < 1e-6);
  });

  it('handles a single huge frame delta crossing all three phases deterministically', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    const hugeElapsed = ENTRY_FADE_TO_BLACK_MS + ENTRY_FADE_BLACK_HOLD_MS + ENTRY_FADE_TO_LIGHT_MS + 1;
    // First call transitions pending -> fading-to-black with 0 elapsed this call.
    tickEntryFade(state, 0);
    const result = tickEntryFade(state, hugeElapsed);
    assert.equal(state.phase, 'idle');
    assert.equal(result.blocksGameplay, false);
    assert.equal(result.overlayAlpha, 0);
    // didJustResumeGameplay still fires exactly once even though the same
    // call also finished fading-to-light and went idle.
    assert.equal(result.didJustResumeGameplay, true);
  });

  it('cancelEntryFade immediately clears an in-progress sequence', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    tickEntryFade(state, 0);
    tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS / 3);
    assert.equal(isEntryFadeActive(state), true);
    cancelEntryFade(state);
    assert.equal(isEntryFadeActive(state), false);
    assert.equal(state.phase, 'idle');
    const result = tickEntryFade(state, 16);
    assert.equal(result.overlayAlpha, 0);
    assert.equal(result.blocksGameplay, false);
  });

  it('re-arming after completion restarts the full sequence from fading-to-black', () => {
    const state = createEntryFadeState();
    armEntryFade(state);
    tickEntryFade(state, 0);
    tickEntryFade(state, ENTRY_FADE_TO_BLACK_MS);
    tickEntryFade(state, ENTRY_FADE_BLACK_HOLD_MS);
    tickEntryFade(state, ENTRY_FADE_TO_LIGHT_MS);
    assert.equal(state.phase, 'idle');

    armEntryFade(state);
    const result = tickEntryFade(state, 0);
    assert.equal(state.phase, 'fading-to-black');
    assert.equal(result.overlayAlpha, 0);
    assert.equal(result.blocksGameplay, true);
  });
});
