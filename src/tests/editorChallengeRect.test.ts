import test from 'node:test';
import assert from 'node:assert/strict';
import { hitTestRectResizeEdge, resizeBlockRect } from '../editor/editorRectResize';

test('challenge rectangle hit testing and left/top resizing update origin and size', () => {
  const rect = { xBlock: 4, yBlock: 5, wBlock: 4, hBlock: 3 };
  assert.equal(hitTestRectResizeEdge(rect, 4, 6), 'left');
  assert.deepEqual(resizeBlockRect(rect, 'left', 2, 0, 20, 20), { xBlock: 2, yBlock: 5, wBlock: 6, hBlock: 3 });
  assert.deepEqual(resizeBlockRect(rect, 'top', 0, 3, 20, 20), { xBlock: 4, yBlock: 3, wBlock: 4, hBlock: 5 });
});

test('challenge rectangle resize clamps to room bounds and one-block minimum', () => {
  const rect = { xBlock: 4, yBlock: 5, wBlock: 4, hBlock: 3 };
  assert.deepEqual(resizeBlockRect(rect, 'right', 99, 0, 10, 10).wBlock, 6);
  assert.deepEqual(resizeBlockRect(rect, 'bottom', 0, 5, 10, 10).hBlock, 1);
});
