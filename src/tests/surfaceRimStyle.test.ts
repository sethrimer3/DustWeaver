import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SURFACE_RIM_STYLE,
  normalizeSurfaceRimStyle,
  normalizeSurfaceRimColor,
  isDefaultSurfaceRimStyle,
  surfaceRimStylesEqual,
  hashSurfaceRimStyle,
  encodeSurfaceRimStyle,
  decodeSurfaceRimStyle,
} from '../render/walls/surfaceRimStyle';

test('normalizeSurfaceRimStyle: undefined/null input returns the default style', () => {
  assert.deepEqual(normalizeSurfaceRimStyle(undefined), DEFAULT_SURFACE_RIM_STYLE);
  assert.deepEqual(normalizeSurfaceRimStyle(null), DEFAULT_SURFACE_RIM_STYLE);
});

test('normalizeSurfaceRimStyle: invalid mode/falloff fall back to defaults instead of throwing', () => {
  const s = normalizeSurfaceRimStyle({ mode: 'bogus' as never, falloff: 'bogus' as never });
  assert.equal(s.mode, DEFAULT_SURFACE_RIM_STYLE.mode);
  assert.equal(s.falloff, DEFAULT_SURFACE_RIM_STYLE.falloff);
});

test('normalizeSurfaceRimStyle: clamps width/opacity/interiorDarkness to valid ranges', () => {
  const s = normalizeSurfaceRimStyle({ mode: 'solid', widthPx: 9999, opacity: 5, interiorDarkness: -3 });
  assert.ok(s.widthPx <= 32 && s.widthPx >= 1);
  assert.equal(s.opacity, 1);
  assert.equal(s.interiorDarkness, 0);
});

test('normalizeSurfaceRimColor: strips leading #, lowercases, rejects malformed hex', () => {
  assert.equal(normalizeSurfaceRimColor('#FF7A18'), 'ff7a18');
  assert.equal(normalizeSurfaceRimColor('ff7a18'), 'ff7a18');
  assert.equal(normalizeSurfaceRimColor('not-a-color'), DEFAULT_SURFACE_RIM_STYLE.color);
  assert.equal(normalizeSurfaceRimColor(undefined), DEFAULT_SURFACE_RIM_STYLE.color);
});

test('isDefaultSurfaceRimStyle / surfaceRimStylesEqual', () => {
  assert.ok(isDefaultSurfaceRimStyle(DEFAULT_SURFACE_RIM_STYLE));
  assert.ok(isDefaultSurfaceRimStyle(normalizeSurfaceRimStyle({ mode: 'default' })));
  assert.ok(!isDefaultSurfaceRimStyle(normalizeSurfaceRimStyle({ mode: 'solid' })));
  const a = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 4, opacity: 0.5 });
  const b = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 4, opacity: 0.5 });
  assert.ok(surfaceRimStylesEqual(a, b));
  assert.ok(!surfaceRimStylesEqual(a, normalizeSurfaceRimStyle({ mode: 'solid', color: '00ff00', widthPx: 4, opacity: 0.5 })));
  // 'none' styles are equal regardless of other fields (they don't matter).
  const none1 = normalizeSurfaceRimStyle({ mode: 'none', color: 'ff0000' });
  const none2 = normalizeSurfaceRimStyle({ mode: 'none', color: '00ff00' });
  assert.ok(surfaceRimStylesEqual(none1, none2));
});

test('hashSurfaceRimStyle: deterministic, distinguishes distinct styles, ignores irrelevant fields for none', () => {
  const a = normalizeSurfaceRimStyle({ mode: 'gradient', color: 'ff7a18', widthPx: 3, opacity: 0.4, falloff: 'smooth' });
  const b = normalizeSurfaceRimStyle({ mode: 'gradient', color: 'ff7a18', widthPx: 3, opacity: 0.4, falloff: 'smooth' });
  const c = normalizeSurfaceRimStyle({ mode: 'gradient', color: 'ff7a18', widthPx: 5, opacity: 0.4, falloff: 'smooth' });
  assert.equal(hashSurfaceRimStyle(a), hashSurfaceRimStyle(b));
  assert.notEqual(hashSurfaceRimStyle(a), hashSurfaceRimStyle(c));
  const none1 = normalizeSurfaceRimStyle({ mode: 'none', color: 'ff0000' });
  const none2 = normalizeSurfaceRimStyle({ mode: 'none', color: '00ff00' });
  assert.equal(hashSurfaceRimStyle(none1), hashSurfaceRimStyle(none2));
});

test('encode/decode round-trip for every non-default mode', () => {
  const styles = [
    normalizeSurfaceRimStyle({ mode: 'none' }),
    normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff7a18', widthPx: 3, opacity: 0.5 }),
    normalizeSurfaceRimStyle({ mode: 'gradient', color: '63d9ff', widthPx: 8, opacity: 0.6, falloff: 'exponential' }),
    normalizeSurfaceRimStyle({ mode: 'inverted', color: 'd24cff', widthPx: 5, opacity: 0.7, falloff: 'smooth', interiorDarkness: 0.9 }),
  ];
  for (const style of styles) {
    const encoded = encodeSurfaceRimStyle(style);
    const decoded = decodeSurfaceRimStyle(encoded);
    assert.ok(surfaceRimStylesEqual(style, decoded), `round-trip mismatch for mode ${style.mode}`);
  }
});

test('encodeSurfaceRimStyle throws for default styles (must never be interned)', () => {
  assert.throws(() => encodeSurfaceRimStyle(DEFAULT_SURFACE_RIM_STYLE));
});

test('decodeSurfaceRimStyle: malformed/unknown entries fall back to default rather than throwing', () => {
  assert.deepEqual(decodeSurfaceRimStyle(undefined), DEFAULT_SURFACE_RIM_STYLE);
  assert.deepEqual(decodeSurfaceRimStyle([]), DEFAULT_SURFACE_RIM_STYLE);
  assert.deepEqual(decodeSurfaceRimStyle(['z']), DEFAULT_SURFACE_RIM_STYLE);
  assert.deepEqual(decodeSurfaceRimStyle('not-an-array'), DEFAULT_SURFACE_RIM_STYLE);
});
