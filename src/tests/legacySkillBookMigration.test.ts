import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLegacySkillBookWeaves } from '../levels/legacySkillBookMigration';

test('undefined input yields an empty array', () => {
  assert.deepEqual(extractLegacySkillBookWeaves(undefined), []);
});

test('empty array input yields an empty array', () => {
  assert.deepEqual(extractLegacySkillBookWeaves([]), []);
});

test('entries with missing or falsy weaveId are excluded', () => {
  const input = [
    { xBlock: 1, yBlock: 1 },
    { xBlock: 2, yBlock: 2, weaveId: undefined },
    { xBlock: 3, yBlock: 3, weaveId: null },
    { xBlock: 4, yBlock: 4, weaveId: '' },
    { xBlock: 5, yBlock: 5, weaveId: 0 },
  ] as unknown as { xBlock: number; yBlock: number }[];
  assert.deepEqual(extractLegacySkillBookWeaves(input), []);
});

test('entries with truthy weaveId are all included', () => {
  const input = [
    { xBlock: 1, yBlock: 1, weaveId: 'dash' },
    { xBlock: 2, yBlock: 2, weaveId: 'grapple' },
  ] as unknown as { xBlock: number; yBlock: number }[];
  assert.deepEqual(extractLegacySkillBookWeaves(input), [
    { xBlock: 1, yBlock: 1, weaveId: 'dash' },
    { xBlock: 2, yBlock: 2, weaveId: 'grapple' },
  ]);
});

test('mixed inclusion preserves original order', () => {
  const input = [
    { xBlock: 1, yBlock: 1, weaveId: 'dash' },
    { xBlock: 2, yBlock: 2 },
    { xBlock: 3, yBlock: 3, weaveId: 'grapple' },
  ] as unknown as { xBlock: number; yBlock: number }[];
  assert.deepEqual(extractLegacySkillBookWeaves(input), [
    { xBlock: 1, yBlock: 1, weaveId: 'dash' },
    { xBlock: 3, yBlock: 3, weaveId: 'grapple' },
  ]);
});

test('does not mutate the input array or its entries', () => {
  const entry = { xBlock: 1, yBlock: 1, weaveId: 'dash' };
  const input = [entry] as unknown as { xBlock: number; yBlock: number }[];
  const snapshot = JSON.parse(JSON.stringify(input));
  extractLegacySkillBookWeaves(input);
  assert.deepEqual(input, snapshot);
});

test('unrelated fields on the source entry are not carried through', () => {
  const input = [
    { xBlock: 1, yBlock: 1, weaveId: 'dash', extraneous: 'nope' },
  ] as unknown as { xBlock: number; yBlock: number }[];
  const result = extractLegacySkillBookWeaves(input);
  assert.deepEqual(result, [{ xBlock: 1, yBlock: 1, weaveId: 'dash' }]);
  assert.equal((result[0] as unknown as Record<string, unknown>)['extraneous'], undefined);
});
