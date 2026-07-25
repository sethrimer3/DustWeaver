import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState, EditorTool } from '../editor/editorState';
import { getActiveEditorDragRect } from '../editor/editorDragDimensionOverlay';

test('selection marquee dimensions include both endpoint blocks', () => {
  const state = createEditorState();
  state.isSelectionBoxActive = true;
  state.selectionBoxStartBlockX = 8;
  state.selectionBoxStartBlockY = 9;
  state.cursorBlockX = 4;
  state.cursorBlockY = 3;

  assert.deepEqual(getActiveEditorDragRect(state), {
    xBlock: 4,
    yBlock: 3,
    wBlock: 5,
    hBlock: 7,
  });
});

test('dimension overlay is inactive outside rectangle gestures', () => {
  const state = createEditorState();
  state.activeTool = EditorTool.Place;
  state.brushMode = 'single';

  assert.equal(getActiveEditorDragRect(state), null);
});
