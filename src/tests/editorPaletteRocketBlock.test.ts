import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';

test('rocket blocks are available under Special Blocks with the rocket wall theme', () => {
  const rocketItems = PALETTE_ITEMS
    .filter(item => item.id === 'rocket_block_1x1' || item.id === 'rocket_block_2x2')
    .map(item => ({
      id: item.id,
      category: item.category,
      width: item.defaultWidthBlocks,
      height: item.defaultHeightBlocks,
      theme: item.blockThemeOverride,
    }));

  assert.deepEqual(rocketItems, [
    { id: 'rocket_block_1x1', category: 'specialBlocks', width: 1, height: 1, theme: 'rocketBlock' },
    { id: 'rocket_block_2x2', category: 'specialBlocks', width: 2, height: 2, theme: 'rocketBlock' },
  ]);
});
