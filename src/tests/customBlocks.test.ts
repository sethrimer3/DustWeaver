/**
 * Tests for src/levels/customBlocks.ts — validation, parsing, serialization,
 * ID utilities, and color helpers for the campaign-local custom block system.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCustomBlockSource,
  parseCustomBlockSource,
  serializeCustomBlock,
  toNamespacedId,
  rawIdFromNamespaced,
  isCustomBlockId,
  nameToSlugId,
  makeUniqueId,
  parseRgbaHex,
  toRgbaHex,
  isValidRgbaHex,
  makeMissingTextureData,
  makeBlankPixelData,
  isSafeCampaignRelativePath,
  CUSTOM_BLOCK_PIXELS_PER_TILE,
} from '../levels/customBlocks';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(overrides: Record<string, unknown> = {}) {
  const tw = (overrides['tileWidth'] as number | undefined) ?? 1;
  const th = (overrides['tileHeight'] as number | undefined) ?? 1;
  const pw = tw * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = th * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const pixels: string[][] = Array.from({ length: ph }, () =>
    Array.from({ length: pw }, () => '#FF000088'),
  );
  return {
    schemaVersion: 1,
    id: 'my-block',
    name: 'My Block',
    tileWidth: tw,
    tileHeight: th,
    pixelWidth: pw,
    pixelHeight: ph,
    behavior: 'solid',
    pixels,
    ...overrides,
  };
}

// ── 1. validateCustomBlockSource — valid 1×1 source passes ────────────────────
test('validateCustomBlockSource accepts valid 1×1 source', () => {
  const errors = validateCustomBlockSource(makeSource());
  assert.deepEqual(errors, []);
});

// ── 2. validateCustomBlockSource — valid 2×2 source passes ────────────────────
test('validateCustomBlockSource accepts valid 2×2 source', () => {
  const errors = validateCustomBlockSource(makeSource({ tileWidth: 2, tileHeight: 2 }));
  assert.deepEqual(errors, []);
});

// ── 3. validateCustomBlockSource — missing required fields produce errors ──────
test('validateCustomBlockSource rejects source with wrong schemaVersion', () => {
  const errors = validateCustomBlockSource({ ...makeSource(), schemaVersion: 99 });
  assert.ok(errors.some(e => e.field === 'schemaVersion'), 'expected schemaVersion error');
});

// ── 4. validateCustomBlockSource — invalid id slug ────────────────────────────
test('validateCustomBlockSource rejects id with uppercase letters', () => {
  const errors = validateCustomBlockSource(makeSource({ id: 'MyBlock' }));
  assert.ok(errors.some(e => e.field === 'id'), 'expected id error');
});

// ── 5. validateCustomBlockSource — mismatched pixelWidth produces error ────────
test('validateCustomBlockSource rejects pixelWidth != tileWidth * TILE_SIZE', () => {
  const errors = validateCustomBlockSource(makeSource({ pixelWidth: 99 }));
  assert.ok(errors.some(e => e.field === 'pixelWidth'), 'expected pixelWidth error');
});

// ── 6. parseCustomBlockSource — produces correct CustomBlockDef ───────────────
test('parseCustomBlockSource produces valid CustomBlockDef', () => {
  const result = parseCustomBlockSource(makeSource());
  assert.ok(result.ok, `parse failed: ${result.ok === false ? JSON.stringify(result.errors) : ''}`);
  if (!result.ok) return;
  assert.equal(result.def.id, 'my-block');
  assert.equal(result.def.namespacedId, 'custom:my-block');
  assert.equal(result.def.tileWidth, 1);
  assert.equal(result.def.tileHeight, 1);
  assert.equal(result.def.pixelWidth, CUSTOM_BLOCK_PIXELS_PER_TILE);
  assert.equal(result.def.pixelHeight, CUSTOM_BLOCK_PIXELS_PER_TILE);
  assert.equal(result.def.pixelData.length, result.def.pixelWidth * result.def.pixelHeight * 4);
});

// ── 7. serializeCustomBlock — round-trip through serialize→parse ──────────────
test('serializeCustomBlock → parseCustomBlockSource round-trip is lossless', () => {
  const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
  const pixelData = new Uint8ClampedArray(pw * ph * 4);
  // Paint a recognizable pattern
  for (let i = 0; i < pixelData.length; i++) pixelData[i] = (i % 256);

  const src = serializeCustomBlock('test-block', 'Test Block', 1, 1, pixelData);
  const result = parseCustomBlockSource(src);
  assert.ok(result.ok, 'round-trip parse failed');
  if (!result.ok) return;
  assert.deepEqual(Array.from(result.def.pixelData), Array.from(pixelData));
});

// ── 8. toNamespacedId / rawIdFromNamespaced / isCustomBlockId ─────────────────
test('ID namespace utilities work correctly', () => {
  assert.equal(toNamespacedId('my-block'), 'custom:my-block');
  assert.equal(rawIdFromNamespaced('custom:my-block'), 'my-block');
  assert.ok(isCustomBlockId('custom:my-block'));
  assert.ok(!isCustomBlockId('wall'));
  assert.ok(isCustomBlockId('custom:')); // prefix check only — id after colon is not validated here
});

// ── 9. nameToSlugId and makeUniqueId ─────────────────────────────────────────
test('nameToSlugId produces valid slugs', () => {
  assert.equal(nameToSlugId('My Block'), 'my-block');
  assert.equal(nameToSlugId('  Cool THING!!! '), 'cool-thing');
  // Single character should be valid
  assert.match(nameToSlugId('A'), /^[a-z0-9]$/);
});

test('makeUniqueId avoids collision with existing ids', () => {
  const existing = new Set(['my-block', 'my-block-1', 'my-block-2']);
  const id = makeUniqueId('my-block', existing);
  assert.ok(!existing.has(id), `Expected a new id, got "${id}" which already exists`);
});

// ── 10. parseRgbaHex / toRgbaHex / isValidRgbaHex ────────────────────────────
test('RGBA hex color utilities round-trip correctly', () => {
  const hex = '#FF8040AA';
  assert.ok(isValidRgbaHex(hex));
  const rgba = parseRgbaHex(hex);
  assert.ok(rgba !== null);
  if (rgba === null) return;
  assert.equal(rgba[0], 0xFF);
  assert.equal(rgba[1], 0x80);
  assert.equal(rgba[2], 0x40);
  assert.equal(rgba[3], 0xAA);
  assert.equal(toRgbaHex(0xFF, 0x80, 0x40, 0xAA), hex);
});

test('isValidRgbaHex rejects malformed strings', () => {
  assert.ok(!isValidRgbaHex('#RGB'));
  assert.ok(!isValidRgbaHex('FF0000FF'));
  assert.ok(!isValidRgbaHex('#ff0000ff')); // lowercase
  assert.ok(!isValidRgbaHex(''));
});

// ── 11. makeMissingTextureData and makeBlankPixelData ────────────────────────
test('makeMissingTextureData returns correct-length buffer', () => {
  const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
  const data = makeMissingTextureData(pw, ph);
  assert.equal(data.length, pw * ph * 4);
});

test('makeBlankPixelData returns fully-transparent buffer', () => {
  const data = makeBlankPixelData(1, 1);
  const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
  assert.equal(data.length, pw * ph * 4);
  for (let i = 3; i < data.length; i += 4) {
    assert.equal(data[i], 0, `pixel ${i / 4} alpha should be 0`);
  }
});

// ── 12. isSafeCampaignRelativePath ───────────────────────────────────────────
test('isSafeCampaignRelativePath rejects path traversal', () => {
  assert.ok(!isSafeCampaignRelativePath('../outside/file.json'));
  assert.ok(!isSafeCampaignRelativePath('custom-blocks/../../etc/passwd'));
  assert.ok(!isSafeCampaignRelativePath('/absolute/path'));
});

test('isSafeCampaignRelativePath accepts safe paths', () => {
  assert.ok(isSafeCampaignRelativePath('custom-blocks/my-block.json'));
  assert.ok(isSafeCampaignRelativePath('my-block.json'));
});

// ── 13. validateCustomBlockSource — non-solid behavior rejected ───────────────
test('validateCustomBlockSource rejects non-solid behavior', () => {
  const errors = validateCustomBlockSource(makeSource({ behavior: 'passthrough' }));
  assert.ok(errors.some(e => e.field === 'behavior'), 'expected behavior error');
});

// ── 14. validateCustomBlockSource — wrong pixel count produces error ───────────
test('validateCustomBlockSource rejects pixel row count mismatch', () => {
  const src = makeSource();
  // Remove one row to cause a mismatch
  if (Array.isArray(src.pixels) && src.pixels.length > 0) {
    (src.pixels as string[][]).pop();
  }
  const errors = validateCustomBlockSource(src);
  assert.ok(errors.length > 0, 'expected at least one error for mismatched pixel rows');
});
