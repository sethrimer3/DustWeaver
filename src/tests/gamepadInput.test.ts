import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGamepadInputSnapshot,
  collectCommands,
  createInputState,
  type GamepadInputSnapshot,
} from '../input/handler';
import { CommandKind } from '../input/commands';

function pad(
  pressed: readonly number[] = [],
  axes: readonly number[] = [0, 0, 0, 0],
): GamepadInputSnapshot {
  return {
    axes,
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
  };
}

test('left stick and D-pad drive analog gameplay movement', () => {
  const input = createInputState();
  applyGamepadInputSnapshot(input, pad([], [-0.6, 0, 0, 0]), 800, 450, 100);
  const move = collectCommands(input).find(command => command.kind === CommandKind.MovePlayer);
  assert.ok(move && move.kind === CommandKind.MovePlayer);
  assert.ok(move.dx < -0.4);

  applyGamepadInputSnapshot(input, pad([15]), 800, 450, 116);
  const dpadMove = collectCommands(input).find(command => command.kind === CommandKind.MovePlayer);
  assert.deepEqual(dpadMove, { kind: CommandKind.MovePlayer, dx: 1, dy: 0 });
});

test('jump and pause buttons are edge-triggered', () => {
  const input = createInputState();
  applyGamepadInputSnapshot(input, pad([0, 9]), 800, 450, 100);
  const first = collectCommands(input);
  assert.equal(first.filter(command => command.kind === CommandKind.Jump).length, 1);
  assert.equal(first.filter(command => command.kind === CommandKind.ReturnToMap).length, 1);
  assert.equal(input.isGamepadJumpHeldFlag, true);

  applyGamepadInputSnapshot(input, pad([0, 9]), 800, 450, 116);
  const held = collectCommands(input);
  assert.equal(held.some(command => command.kind === CommandKind.Jump), false);
  assert.equal(held.some(command => command.kind === CommandKind.ReturnToMap), false);
});

test('triggers mirror primary grapple and secondary shield input', () => {
  const input = createInputState();
  applyGamepadInputSnapshot(input, pad([6, 7], [0, 0, 1, 0]), 800, 450, 100);
  const pressed = collectCommands(input);
  assert.equal(pressed.some(command => command.kind === CommandKind.GrappleFire), true);
  assert.equal(pressed.some(command => command.kind === CommandKind.ShieldWeaveHold), true);

  applyGamepadInputSnapshot(input, pad(), 800, 450, 400);
  const released = collectCommands(input);
  assert.equal(released.some(command => command.kind === CommandKind.GrappleRelease), true);
  assert.equal(released.some(command => command.kind === CommandKind.ShieldWeaveEnd), true);
});

test('right stick changes aim direction instantaneously from the player origin', () => {
  const input = createInputState();
  applyGamepadInputSnapshot(input, pad([], [0, 0, 1, 0]), 100, 80, 100, 20, 30);
  assert.deepEqual([input.mouseXPx, input.mouseYPx], [120, 30]);

  // A sudden full reversal snaps to the opposite direction in one sample;
  // elapsed time and the prior cursor position are not involved.
  applyGamepadInputSnapshot(input, pad([], [0, 0, -1, 0]), 100, 80, 101, 20, 30);
  assert.deepEqual([input.mouseXPx, input.mouseYPx], [-80, 30]);
});

test('diagonal right-stick aim preserves its exact angle outside the canvas', () => {
  const input = createInputState();
  applyGamepadInputSnapshot(input, pad([], [0, 0, 1, -1]), 100, 80, 100, 20, 30);
  const dx = input.mouseXPx - 20;
  const dy = input.mouseYPx - 30;
  assert.ok(Math.abs(dx + dy) < 1e-9);
});
