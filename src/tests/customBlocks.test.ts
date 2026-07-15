/**
 * Tests for src/levels/customBlocks.ts — validation, parsing, serialization,
 * ID utilities, color helpers, reconciliation, and path safety.
 */

import { test, describe } from 'node:test';
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
  reconcileCustomBlocks,
  scanCustomBlockUsage,
  countCustomBlockUsage,
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

// ════════════════════════════════════════════════════════════════════════════
// Phase 1B — Hardening tests
// ════════════════════════════════════════════════════════════════════════════

// ── Path safety — Phase 1B additions ─────────────────────────────────────────

describe('isSafeCampaignRelativePath — Phase 1B', () => {
  test('rejects http:// URL', () => {
    assert.ok(!isSafeCampaignRelativePath('http://example.com/x.json'));
  });

  test('rejects https:// URL', () => {
    assert.ok(!isSafeCampaignRelativePath('https://evil.com/x.json'));
  });

  test('rejects file:// URI', () => {
    assert.ok(!isSafeCampaignRelativePath('file:///etc/passwd'));
  });

  test('rejects ftp:// URI', () => {
    assert.ok(!isSafeCampaignRelativePath('ftp://x/y.json'));
  });

  test('rejects UNC double-slash path', () => {
    assert.ok(!isSafeCampaignRelativePath('//server/share/file.json'));
  });

  test('rejects double-backslash UNC path', () => {
    assert.ok(!isSafeCampaignRelativePath('\\\\server\\share'));
  });

  test('rejects null byte in path', () => {
    assert.ok(!isSafeCampaignRelativePath('custom-blocks/\x00evil.json'));
  });

  test('rejects path with control character', () => {
    assert.ok(!isSafeCampaignRelativePath('custom-blocks/\x1fevil.json'));
  });

  test('rejects prefix-confusion path (not ..) that still traverses with symlinks)', () => {
    // A path like "custom-blocks/../../../etc/passwd" contains ".." and must be rejected
    assert.ok(!isSafeCampaignRelativePath('custom-blocks/../../../etc/passwd'));
  });

  test('accepts normal relative subpath', () => {
    assert.ok(isSafeCampaignRelativePath('custom-blocks/my-block.json'));
  });

  test('accepts flat filename', () => {
    assert.ok(isSafeCampaignRelativePath('my-block.json'));
  });
});

// ── ID utilities ──────────────────────────────────────────────────────────────

describe('ID utilities — stable rename semantics', () => {
  test('makeUniqueId returns base if not used', () => {
    assert.equal(makeUniqueId('stone', new Set()), 'stone');
  });

  test('makeUniqueId uses -2 suffix as first collision', () => {
    const id = makeUniqueId('stone', new Set(['stone']));
    assert.equal(id, 'stone-2');
  });

  test('makeUniqueId finds first unused when multiple variants exist', () => {
    const id = makeUniqueId('stone', new Set(['stone', 'stone-2', 'stone-3']));
    assert.equal(id, 'stone-4');
  });

  test('duplicate scenario: new ID is independent from original', () => {
    const originalId = 'cobble';
    const used = new Set([originalId]);
    const newId = makeUniqueId(originalId, used);
    assert.notEqual(newId, originalId);
    assert.ok(!used.has(newId));
  });
});

// ── Rename preserves pixel data and ID ───────────────────────────────────────

describe('rename — serialization round-trip preserves pixels and ID', () => {
  test('renaming only changes the name field, not the id', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixelData = new Uint8ClampedArray(pw * ph * 4).fill(128);
    const original = serializeCustomBlock('cobble', 'Cobblestone', 1, 1, pixelData);
    assert.equal(original.id, 'cobble');
    assert.equal(original.name, 'Cobblestone');

    // Simulate rename: same id, new name
    const renamed = serializeCustomBlock('cobble', 'Rough Cobble', 1, 1, pixelData);
    assert.equal(renamed.id, 'cobble', 'ID must not change on rename');
    assert.equal(renamed.name, 'Rough Cobble');

    // Validate and parse both — pixels must be identical
    const r1 = parseCustomBlockSource(original);
    const r2 = parseCustomBlockSource(renamed);
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) {
      assert.deepEqual(Array.from(r1.def.pixelData), Array.from(r2.def.pixelData));
    }
  });
});

// ── Duplicate creates independent pixel data ──────────────────────────────────

describe('duplicate — pixel data independence', () => {
  test('duplicated pixelData is a distinct buffer', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const original = new Uint8ClampedArray(pw * ph * 4).fill(200);
    const copy = new Uint8ClampedArray(original);
    // Mutate original after copy
    original[0] = 0;
    assert.equal(copy[0], 200, 'copy must not reflect mutations to the original');
  });

  test('duplicate produces different id', () => {
    const originalId = 'lava-rock';
    const existingIds = new Set([originalId]);
    const newId = makeUniqueId(originalId, existingIds);
    assert.notEqual(newId, originalId);
  });
});

// ── Exact RGBA round-trip ─────────────────────────────────────────────────────

describe('exact RGBA round-trip', () => {
  test('all 256 alpha values survive serialize→parse', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixelData = new Uint8ClampedArray(pw * ph * 4);
    // Paint each pixel with its index % 256 in all channels
    for (let i = 0; i < pixelData.length; i++) pixelData[i] = i % 256;

    const src = serializeCustomBlock('rgba-test', 'RGBA Test', 1, 1, pixelData);
    const result = parseCustomBlockSource(src);
    assert.ok(result.ok, 'parse must succeed after serialize');
    if (!result.ok) return;
    assert.deepEqual(Array.from(result.def.pixelData), Array.from(pixelData));
  });

  test('transparent pixel #00000000 survives round-trip', () => {
    const pw = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const ph = CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixelData = new Uint8ClampedArray(pw * ph * 4); // all zeros = fully transparent
    const src = serializeCustomBlock('transparent', 'Transparent', 1, 1, pixelData);
    const result = parseCustomBlockSource(src);
    assert.ok(result.ok);
    if (!result.ok) return;
    for (let i = 3; i < result.def.pixelData.length; i += 4) {
      assert.equal(result.def.pixelData[i], 0, 'alpha must be 0');
    }
  });

  test('2x2 pixel data round-trip is lossless', () => {
    const pw = 2 * CUSTOM_BLOCK_PIXELS_PER_TILE;
    const ph = 2 * CUSTOM_BLOCK_PIXELS_PER_TILE;
    const pixelData = new Uint8ClampedArray(pw * ph * 4);
    for (let i = 0; i < pixelData.length; i++) pixelData[i] = (255 - i) % 256;
    const src = serializeCustomBlock('big', 'Big Block', 2, 2, pixelData);
    const result = parseCustomBlockSource(src);
    assert.ok(result.ok, '2×2 parse must succeed');
    if (!result.ok) return;
    assert.deepEqual(Array.from(result.def.pixelData), Array.from(pixelData));
  });
});

// ── Validation — schema, invalid colors, dimensions ──────────────────────────

describe('validateCustomBlockSource — invalid inputs', () => {
  test('rejects empty id string', () => {
    const errors = validateCustomBlockSource(makeSource({ id: '' }));
    assert.ok(errors.some(e => e.field === 'id'));
  });

  test('rejects id with uppercase', () => {
    const errors = validateCustomBlockSource(makeSource({ id: 'MyBlock' }));
    assert.ok(errors.some(e => e.field === 'id'));
  });

  test('rejects id starting with hyphen', () => {
    const errors = validateCustomBlockSource(makeSource({ id: '-bad' }));
    assert.ok(errors.some(e => e.field === 'id'));
  });

  test('rejects id ending with hyphen', () => {
    const errors = validateCustomBlockSource(makeSource({ id: 'bad-' }));
    assert.ok(errors.some(e => e.field === 'id'));
  });

  test('rejects id with spaces', () => {
    const errors = validateCustomBlockSource(makeSource({ id: 'my block' }));
    assert.ok(errors.some(e => e.field === 'id'));
  });

  test('rejects empty name', () => {
    const errors = validateCustomBlockSource(makeSource({ name: '' }));
    assert.ok(errors.some(e => e.field === 'name'));
  });

  test('rejects whitespace-only name', () => {
    const errors = validateCustomBlockSource(makeSource({ name: '   ' }));
    assert.ok(errors.some(e => e.field === 'name'));
  });

  test('rejects tileWidth 3', () => {
    const errors = validateCustomBlockSource(makeSource({ tileWidth: 3, pixelWidth: 3 * CUSTOM_BLOCK_PIXELS_PER_TILE }));
    assert.ok(errors.some(e => e.field === 'tileWidth'));
  });

  test('rejects non-solid behavior', () => {
    const errors = validateCustomBlockSource(makeSource({ behavior: 'passthrough' }));
    assert.ok(errors.some(e => e.field === 'behavior'));
  });

  test('rejects invalid RGBA hex in pixel', () => {
    const src = makeSource();
    if (Array.isArray(src.pixels) && Array.isArray(src.pixels[0])) {
      (src.pixels[0] as string[])[0] = '#GGGGGGGG';
    }
    const errors = validateCustomBlockSource(src);
    assert.ok(errors.length > 0, 'expected error for bad hex color');
  });

  test('rejects lowercase hex color', () => {
    const src = makeSource();
    if (Array.isArray(src.pixels) && Array.isArray(src.pixels[0])) {
      (src.pixels[0] as string[])[0] = '#ff000000';
    }
    const errors = validateCustomBlockSource(src);
    assert.ok(errors.length > 0, 'expected error for lowercase hex');
  });

  test('rejects pixel column count mismatch', () => {
    const src = makeSource();
    if (Array.isArray(src.pixels) && Array.isArray(src.pixels[0])) {
      (src.pixels[0] as string[]).push('#FF0000FF');
    }
    const errors = validateCustomBlockSource(src);
    assert.ok(errors.length > 0, 'expected error for wrong column count');
  });

  test('rejects unknown schemaVersion', () => {
    const errors = validateCustomBlockSource({ ...makeSource(), schemaVersion: 99 });
    assert.ok(errors.some(e => e.field === 'schemaVersion'));
  });

  test('rejects pixelWidth mismatching tileWidth × tile size', () => {
    const errors = validateCustomBlockSource(makeSource({ pixelWidth: 99 }));
    assert.ok(errors.some(e => e.field === 'pixelWidth'));
  });

  test('rejects non-object data', () => {
    const errors = validateCustomBlockSource('not an object');
    assert.ok(errors.some(e => e.field === 'root'));
  });

  test('rejects null data', () => {
    const errors = validateCustomBlockSource(null);
    assert.ok(errors.some(e => e.field === 'root'));
  });
});

// ── 2x2 validation ────────────────────────────────────────────────────────────

describe('2x2 block validation and parsing', () => {
  test('valid 2x2 source accepts correct pixel dimensions', () => {
    const errors = validateCustomBlockSource(makeSource({ tileWidth: 2, tileHeight: 2 }));
    assert.deepEqual(errors, []);
  });

  test('2x2 with wrong pixelWidth is rejected', () => {
    const src = makeSource({ tileWidth: 2, tileHeight: 2 });
    (src as Record<string, unknown>)['pixelWidth'] = 8; // should be 16
    const errors = validateCustomBlockSource(src);
    assert.ok(errors.some(e => e.field === 'pixelWidth'));
  });

  test('2x2 parse produces correct pixel count', () => {
    const result = parseCustomBlockSource(makeSource({ tileWidth: 2, tileHeight: 2 }));
    assert.ok(result.ok);
    if (!result.ok) return;
    const expectedBytes = 2 * CUSTOM_BLOCK_PIXELS_PER_TILE * 2 * CUSTOM_BLOCK_PIXELS_PER_TILE * 4;
    assert.equal(result.def.pixelData.length, expectedBytes);
  });

  test('2x2 parse sets tileWidth and tileHeight correctly', () => {
    const result = parseCustomBlockSource(makeSource({ tileWidth: 2, tileHeight: 2 }));
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.def.tileWidth, 2);
    assert.equal(result.def.tileHeight, 2);
  });
});

// ── Reconciliation ────────────────────────────────────────────────────────────

describe('reconcileCustomBlocks', () => {
  test('no issues when registry and rooms are empty', () => {
    const issues = reconcileCustomBlocks(new Set(), new Map());
    assert.deepEqual(issues, []);
  });

  test('detects block in registry but not placed (unused)', () => {
    const issues = reconcileCustomBlocks(new Set(['stone']), new Map());
    assert.ok(issues.some(i => i.kind === 'registry_missing_from_room_usage' && i.blockId === 'stone'));
  });

  test('detects room reference to block not in registry (missing)', () => {
    const roomsById = new Map([['room-1', ['custom:ghost-block']]]);
    const issues = reconcileCustomBlocks(new Set(), roomsById);
    assert.ok(issues.some(i => i.kind === 'room_reference_not_in_registry' && i.blockId === 'ghost-block'));
  });

  test('no issue when registry matches room usage exactly', () => {
    const registryIds = new Set(['stone']);
    const roomsById = new Map([['room-1', ['custom:stone']]]);
    const issues = reconcileCustomBlocks(registryIds, roomsById);
    assert.deepEqual(issues, []);
  });

  test('missing reference includes affected rooms list', () => {
    const roomsById = new Map<string, string[]>([
      ['room-1', ['custom:ghost']],
      ['room-2', ['custom:ghost']],
    ]);
    const issues = reconcileCustomBlocks(new Set(), roomsById);
    const issue = issues.find(i => i.blockId === 'ghost');
    assert.ok(issue?.roomIds?.includes('room-1') && issue.roomIds.includes('room-2'));
  });
});

// ── scanCustomBlockUsage ──────────────────────────────────────────────────────

describe('scanCustomBlockUsage', () => {
  test('returns empty map for no rooms', () => {
    const result = scanCustomBlockUsage(new Map());
    assert.equal(result.size, 0);
  });

  test('maps each block to its rooms', () => {
    const rooms = new Map([
      ['room-a', { customBlockPlacements: [[0, 0, 'custom:stone'], [1, 0, 'custom:lava']] as [number, number, string][] }],
      ['room-b', { customBlockPlacements: [[0, 0, 'custom:stone']] as [number, number, string][] }],
    ]);
    const result = scanCustomBlockUsage(rooms);
    assert.deepEqual(result.get('stone')?.sort(), ['room-a', 'room-b']);
    assert.deepEqual(result.get('lava'), ['room-a']);
  });

  test('room with no customBlockPlacements is skipped', () => {
    const rooms = new Map([['room-x', {}]]);
    const result = scanCustomBlockUsage(rooms);
    assert.equal(result.size, 0);
  });
});

// ── countCustomBlockUsage ─────────────────────────────────────────────────────

describe('countCustomBlockUsage', () => {
  test('returns 0 for unused block', () => {
    const rooms = new Map([['r1', { customBlockPlacements: [[0, 0, 'custom:other']] as [number, number, string][] }]]);
    const result = countCustomBlockUsage('stone', rooms);
    assert.equal(result.count, 0);
    assert.deepEqual(result.roomIds, []);
  });

  test('counts rooms not placements (same room many placements = 1)', () => {
    const rooms = new Map([
      ['r1', { customBlockPlacements: [[0, 0, 'custom:stone'], [1, 0, 'custom:stone']] as [number, number, string][] }],
    ]);
    const result = countCustomBlockUsage('stone', rooms);
    assert.equal(result.count, 1);
  });

  test('counts across multiple rooms', () => {
    const rooms = new Map([
      ['r1', { customBlockPlacements: [[0, 0, 'custom:stone']] as [number, number, string][] }],
      ['r2', { customBlockPlacements: [[2, 2, 'custom:stone']] as [number, number, string][] }],
    ]);
    const result = countCustomBlockUsage('stone', rooms);
    assert.equal(result.count, 2);
    assert.ok(result.roomIds.includes('r1') && result.roomIds.includes('r2'));
  });
});

// ── makeBlankPixelData / 2x2 size ─────────────────────────────────────────────

describe('makeBlankPixelData', () => {
  test('1x1 returns correct size', () => {
    const data = makeBlankPixelData(1, 1);
    assert.equal(data.length, CUSTOM_BLOCK_PIXELS_PER_TILE * CUSTOM_BLOCK_PIXELS_PER_TILE * 4);
  });

  test('2x2 returns correct size', () => {
    const data = makeBlankPixelData(2, 2);
    const side = 2 * CUSTOM_BLOCK_PIXELS_PER_TILE;
    assert.equal(data.length, side * side * 4);
  });

  test('all bytes are zero (fully transparent)', () => {
    const data = makeBlankPixelData(2, 2);
    for (const b of data) assert.equal(b, 0);
  });
});

// ── makeMissingTextureData ────────────────────────────────────────────────────

describe('makeMissingTextureData', () => {
  test('returns magenta/black checkerboard with alpha 255', () => {
    const data = makeMissingTextureData(2, 2);
    // Pixel (0,0): checker = (0+0)%2 === 0 → magenta = R=255 G=0 B=255 A=255
    assert.equal(data[0], 255);
    assert.equal(data[1], 0);
    assert.equal(data[2], 255);
    assert.equal(data[3], 255);
    // Pixel (1,0): checker = (1+0)%2 !== 0 → black = R=0 G=0 B=0 A=255
    assert.equal(data[4], 0);
    assert.equal(data[7], 255); // alpha stays 255
  });
});

// ── Missing-block fallback consistency ────────────────────────────────────────

describe('parseCustomBlockSource — context propagated to errors', () => {
  test('context blockId appears in error', () => {
    const errors = validateCustomBlockSource(makeSource({ id: 'BadID' }), { blockId: 'BadID', filePath: 'x.json' });
    assert.ok(errors.length > 0);
    assert.equal(errors[0].blockId, 'BadID');
    assert.equal(errors[0].filePath, 'x.json');
  });
});

// ── Older campaigns without customBlockDefs ───────────────────────────────────

describe('older campaign compatibility', () => {
  test('validateCustomBlockSource on undefined returns root error cleanly', () => {
    const errors = validateCustomBlockSource(undefined);
    assert.ok(errors.some(e => e.field === 'root'), 'must produce root error for undefined');
  });

  test('empty customBlockDefs array is valid (no blocks defined)', () => {
    // No exceptions from scanning an empty array
    const result = scanCustomBlockUsage(new Map([['r1', { customBlockPlacements: [] }]]));
    assert.equal(result.size, 0);
  });
});
