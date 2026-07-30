import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import { getDustDefinition } from '../sim/weaves/dustDefinition';

const ASSETS_ROOT = join(__dirname, '..', '..', 'ASSETS');

test('every equippable mote type has a spriteUrl pointing at an existing _DustType.png asset', () => {
  for (const kind of EQUIPPABLE_KINDS) {
    const def = getDustDefinition(kind);
    assert.ok(def.spriteUrl !== undefined && def.spriteUrl.length > 0, `${def.displayName} is missing a spriteUrl`);
    assert.match(def.spriteUrl as string, /_DustType\.png$/, `${def.displayName} spriteUrl should use the _DustType naming convention`);
    const absolutePath = join(ASSETS_ROOT, ...(def.spriteUrl as string).split('/'));
    assert.ok(existsSync(absolutePath), `${def.displayName} spriteUrl does not resolve to a real file: ${absolutePath}`);
  }
});

test('Fire Dust has a registered sprite asset (no longer falls back to a color swatch)', () => {
  const def = getDustDefinition(ParticleKind.FireDust);
  assert.equal(def.spriteUrl, 'SPRITES/DUST/DustTypes/Fire_DustType.png');
});

test('every equippable mote type has the expected single-word wheel shortName', () => {
  const expected: Partial<Record<ParticleKind, string>> = {
    [ParticleKind.Golden]: 'Gold',
    [ParticleKind.Ice]: 'Frost',
    [ParticleKind.Nature]: 'Verdant',
    [ParticleKind.Void]: 'Void',
    [ParticleKind.Light]: 'Luminant',
    [ParticleKind.FireDust]: 'Fire',
  };
  for (const kind of EQUIPPABLE_KINDS) {
    const def = getDustDefinition(kind);
    assert.equal(def.shortName, expected[kind], `unexpected shortName for ${def.displayName}`);
  }
});
