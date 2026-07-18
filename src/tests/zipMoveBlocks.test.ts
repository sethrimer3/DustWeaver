import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { resizeBlockRect } from '../editor/editorRectResize';
import { tickZipMoveBlocks, tryActivateZipMoveBlock } from '../sim/zipMoveBlocks/zipMoveBlockSim';
import {
  ZIP_MOVE_BLOCK_TOP_SPEED_WORLD_PER_SEC,
  directionForZipSide,
  type ZipMoveBlockRuntime,
} from '../sim/zipMoveBlocks/zipMoveBlockTypes';

function block(variant: 'toward' | 'away' = 'toward'): ZipMoveBlockRuntime {
  return { uid: 1, variant, xWorld: 10, yWorld: 10, wWorld: 24, hWorld: 24,
    velocityXWorld: 0, velocityYWorld: 0, state: 'dormant', activationSide: null,
    activeAmount: 0, wallIndex: 0, zipImpactLatched: false };
}

test('zip move direction mapping covers all toward and away sides', () => {
  assert.deepEqual(directionForZipSide('toward', 'top'), { x: 0, y: -1 });
  assert.deepEqual(directionForZipSide('toward', 'right'), { x: 1, y: 0 });
  assert.deepEqual(directionForZipSide('toward', 'bottom'), { x: 0, y: 1 });
  assert.deepEqual(directionForZipSide('toward', 'left'), { x: -1, y: 0 });
  assert.deepEqual(directionForZipSide('away', 'top'), { x: 0, y: 1 });
  assert.deepEqual(directionForZipSide('away', 'right'), { x: -1, y: 0 });
  assert.deepEqual(directionForZipSide('away', 'bottom'), { x: 0, y: -1 });
  assert.deepEqual(directionForZipSide('away', 'left'), { x: 1, y: 0 });
});
test('activation locks side and ignores redirection while moving', () => {
  const b = block();
  assert.equal(tryActivateZipMoveBlock(b, 'right'), true);
  assert.equal(b.activationSide, 'right');
  assert.equal(tryActivateZipMoveBlock(b, 'top'), false);
  assert.equal(b.activationSide, 'right');
});

test('rectangle resize enforces the zip block 3x3 minimum', () => {
  assert.deepEqual(resizeBlockRect({ xBlock: 5, yBlock: 5, wBlock: 6, hBlock: 6 }, 'topLeft', 10, 10, 30, 30, 3, 3),
    { xBlock: 8, yBlock: 8, wBlock: 3, hBlock: 3 });
});

test('block accelerates, caps speed, remains active, and stops flush', () => {
  const world = createWorldState(1000 / 60, 1);
  const b = block();
  world.zipMoveBlocks = [b];
  world.wallCount = 2;
  world.wallXWorld[0] = b.xWorld; world.wallYWorld[0] = b.yWorld; world.wallWWorld[0] = b.wWorld; world.wallHWorld[0] = b.hWorld;
  world.wallXWorld[1] = 50; world.wallYWorld[1] = 0; world.wallWWorld[1] = 3; world.wallHWorld[1] = 100;
  tryActivateZipMoveBlock(b, 'right');
  let maxSpeed = 0;
  for (let i = 0; i < 120 && b.state !== 'dormant'; i++) {
    tickZipMoveBlocks(world, 1000 / 60);
    maxSpeed = Math.max(maxSpeed, Math.abs(b.velocityXWorld));
  }
  assert.ok(maxSpeed <= ZIP_MOVE_BLOCK_TOP_SPEED_WORLD_PER_SEC + 0.001);
  assert.equal(b.xWorld + b.wWorld, 50);
  assert.equal(b.state, 'dormant');
  assert.equal(b.velocityXWorld, 0);
  assert.ok(b.activeAmount > 0);
  assert.equal(tryActivateZipMoveBlock(b, 'left'), true);
});

test('sandstone in the swept footprint converts to sand without stopping the block', () => {
  const world = createWorldState(1000 / 60, 1);
  const b = block();
  world.zipMoveBlocks = [b];
  world.wallCount = 1;
  world.wallXWorld[0] = b.xWorld; world.wallYWorld[0] = b.yWorld; world.wallWWorld[0] = b.wWorld; world.wallHWorld[0] = b.hWorld;
  world.pixelMaterialSystem.place(35, 20, 4);
  tryActivateZipMoveBlock(b, 'right');
  tickZipMoveBlocks(world, 1000 / 60);
  assert.equal(world.pixelMaterialSystem.getMaterialAt(35, 20), 1);
  assert.notEqual(b.state, 'dormant');
});
