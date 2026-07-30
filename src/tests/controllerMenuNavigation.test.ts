import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getHeldControllerMenuActions,
  type ControllerMenuGamepadSnapshot,
} from '../ui/controllerMenuNavigation';

function pad(
  pressed: readonly number[] = [],
  axes: readonly number[] = [0, 0],
): ControllerMenuGamepadSnapshot {
  return {
    axes,
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
  };
}

test('left stick maps to four menu navigation directions beyond the dead zone', () => {
  assert.deepEqual([...getHeldControllerMenuActions(pad([], [0, -0.8]))], ['up']);
  assert.deepEqual([...getHeldControllerMenuActions(pad([], [0, 0.8]))], ['down']);
  assert.deepEqual([...getHeldControllerMenuActions(pad([], [-0.8, 0]))], ['left']);
  assert.deepEqual([...getHeldControllerMenuActions(pad([], [0.8, 0]))], ['right']);
  assert.deepEqual([...getHeldControllerMenuActions(pad([], [0.4, -0.4]))], []);
});

test('D-pad maps to menu directions', () => {
  assert.deepEqual(
    [...getHeldControllerMenuActions(pad([12, 15]))],
    ['up', 'right'],
  );
});

test('A/Cross activates and B/Circle goes back', () => {
  assert.deepEqual(
    [...getHeldControllerMenuActions(pad([0, 1]))],
    ['activate', 'back'],
  );
});
