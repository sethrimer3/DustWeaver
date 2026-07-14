import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGameRunTimer } from '../screens/gameRunTimer';

describe('createGameRunTimer — initialization', () => {
  it('defaults missing current and checkpoint values to zero', () => {
    const timer = createGameRunTimer();
    assert.equal(timer.getCurrentMs(), 0);
    assert.equal(timer.getCheckpointMs(), 0);
  });

  it('normalizes invalid current values to zero', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(createGameRunTimer(value, 5).getCurrentMs(), 0);
    }
  });

  it('normalizes invalid checkpoint values to zero', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(createGameRunTimer(5, value).getCheckpointMs(), 0);
    }
  });

  it('preserves positive fractional current and checkpoint values independently', () => {
    const timer = createGameRunTimer(12.5, 7.25);
    assert.equal(timer.getCurrentMs(), 12.5);
    assert.equal(timer.getCheckpointMs(), 7.25);
  });

  it('starts waiting even when the restored current value is nonzero', () => {
    assert.equal(createGameRunTimer(100, 50).isWaitingForMovement(), true);
  });
});

describe('GameRunTimer — intent and accumulation', () => {
  it('stays waiting and unchanged without intentional input', () => {
    const timer = createGameRunTimer(10);
    timer.tick(16, true, 0, false, false);
    assert.equal(timer.isWaitingForMovement(), true);
    assert.equal(timer.getCurrentMs(), 10);
  });

  it('horizontal input arms and advances on the same tick', () => {
    const timer = createGameRunTimer(10);
    timer.tick(16, true, -1, false, false);
    assert.equal(timer.isWaitingForMovement(), false);
    assert.equal(timer.getCurrentMs(), 26);
  });

  it('triggered jump arms and advances on the same tick', () => {
    const timer = createGameRunTimer();
    timer.tick(16, true, 0, true, false);
    assert.equal(timer.isWaitingForMovement(), false);
    assert.equal(timer.getCurrentMs(), 16);
  });

  it('held jump arms and advances on the same tick', () => {
    const timer = createGameRunTimer();
    timer.tick(16, true, 0, false, true);
    assert.equal(timer.isWaitingForMovement(), false);
    assert.equal(timer.getCurrentMs(), 16);
  });

  it('zero horizontal input does not count as intent', () => {
    const timer = createGameRunTimer();
    timer.tick(16, true, 0, false, false);
    assert.equal(timer.isWaitingForMovement(), true);
  });

  it('a missing or dead player cannot arm the timer', () => {
    const timer = createGameRunTimer();
    timer.tick(16, false, 1, true, true);
    assert.equal(timer.isWaitingForMovement(), true);
    assert.equal(timer.getCurrentMs(), 0);
  });

  it('a dead player does not advance an already-armed timer', () => {
    const timer = createGameRunTimer();
    timer.tick(16, true, 1, false, false);
    timer.tick(20, false, 0, false, false);
    assert.equal(timer.getCurrentMs(), 16);
  });

  it('an armed live timer advances without continued input', () => {
    const timer = createGameRunTimer();
    timer.tick(16, true, 1, false, false);
    timer.tick(20, true, 0, false, false);
    assert.equal(timer.getCurrentMs(), 36);
  });

  it('accumulation retains the zero lower bound', () => {
    const timer = createGameRunTimer(5);
    timer.tick(-10, true, 1, false, false);
    assert.equal(timer.getCurrentMs(), 0);
  });
});

describe('GameRunTimer — checkpoint and respawn', () => {
  it('checkpoint capture stores and returns the exact current value', () => {
    const timer = createGameRunTimer(12.5, 1);
    assert.equal(timer.captureCheckpoint(), 12.5);
    assert.equal(timer.getCheckpointMs(), 12.5);
  });

  it('later ticking does not mutate the stored checkpoint', () => {
    const timer = createGameRunTimer(10);
    timer.captureCheckpoint();
    timer.tick(5, true, 1, false, false);
    assert.equal(timer.getCheckpointMs(), 10);
    assert.equal(timer.getCurrentMs(), 15);
  });

  it('respawn restores the checkpoint and returns to waiting', () => {
    const timer = createGameRunTimer(20, 7);
    timer.tick(5, true, 1, false, false);
    timer.restoreCheckpoint();
    assert.equal(timer.getCurrentMs(), 7);
    assert.equal(timer.isWaitingForMovement(), true);
  });

  it('post-respawn passive frames do not advance', () => {
    const timer = createGameRunTimer(20, 7);
    timer.restoreCheckpoint();
    timer.tick(16, true, 0, false, false);
    assert.equal(timer.getCurrentMs(), 7);
  });

  it('post-respawn valid intent resumes on that same frame', () => {
    const timer = createGameRunTimer(20, 7);
    timer.restoreCheckpoint();
    timer.tick(16, true, 1, false, false);
    assert.equal(timer.getCurrentMs(), 23);
  });
});

describe('GameRunTimer — ownership', () => {
  it('keeps timer instances independent', () => {
    const first = createGameRunTimer();
    const second = createGameRunTimer(50);
    first.tick(10, true, 1, false, false);
    assert.equal(first.getCurrentMs(), 10);
    assert.equal(second.getCurrentMs(), 50);
    assert.equal(second.isWaitingForMovement(), true);
  });

  it('getters do not mutate state', () => {
    const timer = createGameRunTimer(12, 7);
    const beforeWaiting = timer.isWaitingForMovement();
    assert.equal(timer.getCurrentMs(), 12);
    assert.equal(timer.getCurrentMs(), 12);
    assert.equal(timer.getCheckpointMs(), 7);
    assert.equal(timer.getCheckpointMs(), 7);
    assert.equal(timer.isWaitingForMovement(), beforeWaiting);
  });
});
