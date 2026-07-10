import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE_CATEGORIES,
  PALETTE_CATEGORY_LABELS,
  PALETTE_ITEMS,
  type PaletteCategory,
} from '../editor/editorPaletteItems';

const movedDustItemIds = [
  'dust_pile_small',
  'dust_pile_medium',
  'dust_pile_large',
  'dust_pile',
  'sand_1x1',
  'sand_2x2',
  'water_1x1',
] as const;

function getPaletteItem(id: string) {
  const item = PALETTE_ITEMS.find(entry => entry.id === id);
  assert.ok(item, `Expected palette item "${id}" to exist.`);
  return item;
}

test('dust is a valid palette category with a visible label', () => {
  const validCategory: PaletteCategory = 'dust';
  assert.equal(validCategory, 'dust');
  assert.ok(PALETTE_CATEGORIES.includes(validCategory));
  assert.equal(PALETTE_CATEGORY_LABELS.dust, 'Dust');
});

test('free-placed dust piles and pixel materials belong to dust', () => {
  for (const id of movedDustItemIds) {
    assert.equal(getPaletteItem(id).category, 'dust', `${id} should be in Dust.`);
  }
});

test('pixel-material palette item ids and material ids are unchanged', () => {
  assert.deepEqual(
    movedDustItemIds
      .map(id => getPaletteItem(id))
      .filter(item => item.isPixelMaterialItem === 1)
      .map(item => ({
        id: item.id,
        isPixelMaterialItem: item.isPixelMaterialItem,
        pixelMaterialId: item.pixelMaterialId,
      })),
    [
      { id: 'sand_1x1', isPixelMaterialItem: 1, pixelMaterialId: 1 },
      { id: 'sand_2x2', isPixelMaterialItem: 1, pixelMaterialId: 2 },
      { id: 'water_1x1', isPixelMaterialItem: 1, pixelMaterialId: 3 },
    ],
  );
});

test('moved dust entries no longer appear under Environment', () => {
  const environmentIds = PALETTE_ITEMS
    .filter(item => item.category === 'environment')
    .map(item => item.id);

  for (const id of movedDustItemIds) {
    assert.equal(environmentIds.includes(id), false, `${id} should not be in Environment.`);
  }
});

test('function-specific dust tools keep their existing categories', () => {
  assert.equal(getPaletteItem('dust_container').category, 'collectables');
  assert.equal(getPaletteItem('dust_container_piece').category, 'collectables');
  assert.equal(getPaletteItem('dust_swarm').category, 'collectables');
  assert.equal(getPaletteItem('dust_boost_jar').category, 'objects');
  assert.equal(getPaletteItem('guide_dust_path').category, 'guidePaths');
});
