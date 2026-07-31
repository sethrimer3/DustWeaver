import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isAnimatedSpritePortrait,
  sampleSpritePortraitOrb,
  SPRITE_PORTRAIT_ORBS,
} from '../render/ui/spritePortraitAnimation';

describe('Sprite dialogue portrait animation', () => {
  test('only selects the Sprite portrait id, case-insensitively', () => {
    assert.equal(isAnimatedSpritePortrait('Sprite'), true);
    assert.equal(isAnimatedSpritePortrait('sprite'), true);
    assert.equal(isAnimatedSpritePortrait('Crimson Wizard'), false);
  });

  test('each orb returns to its starting position after its own period', () => {
    for (const orb of SPRITE_PORTRAIT_ORBS) {
      const start = sampleSpritePortraitOrb(orb, 0);
      const end = sampleSpritePortraitOrb(orb, orb.periodMs);
      assert.ok(Math.abs(start.y - end.y) < 1e-9);
      assert.ok(Math.abs(start.intensity - end.intensity) < 1e-9);
    }
  });

  test('orbs use varied cadences and hover amplitudes', () => {
    assert.ok(new Set(SPRITE_PORTRAIT_ORBS.map(orb => orb.periodMs)).size >= 8);
    assert.ok(new Set(SPRITE_PORTRAIT_ORBS.map(orb => orb.hoverAmplitude)).size >= 6);
  });

  test('orb motion stays within its configured vertical range', () => {
    for (const orb of SPRITE_PORTRAIT_ORBS) {
      for (let step = 0; step <= 20; step++) {
        const frame = sampleSpritePortraitOrb(orb, orb.periodMs * step / 20);
        assert.ok(frame.y >= orb.y - orb.hoverAmplitude - 1e-9);
        assert.ok(frame.y <= orb.y + orb.hoverAmplitude + 1e-9);
        assert.ok(frame.intensity >= 0.64 && frame.intensity <= 1);
      }
    }
  });
});
