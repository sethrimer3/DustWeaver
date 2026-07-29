/**
 * Guard against newly introduced hard-coded player-facing text.
 *
 * Scope: the screens that have been migrated to the i18n catalogs (listed in
 * `GUARDED_FILES`). Adding a raw English string to one of these files fails this
 * test and points at the offending line.
 *
 * This is intentionally a *scoped* guard rather than a repo-wide one: large
 * surfaces (most of the editor, debug panels) are not migrated yet, and a
 * repo-wide rule would have to be disabled to be green — which teaches nothing.
 * When a screen is migrated, add it here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Files whose player-facing text must always come from the catalogs. */
const GUARDED_FILES: readonly string[] = [
  'src/ui/mainMenu.ts',
  'src/ui/mainMenuSaveSlots.ts',
  'src/ui/mainMenuCustomCampaigns.ts',
  'src/ui/mainMenuSettings.ts',
  'src/ui/mainMenuSettingsLanguage.ts',
  'src/ui/pauseMenu.ts',
  'src/ui/deathScreen.ts',
  'src/ui/characterSelect.ts',
  'src/ui/weaveLoadout.ts',
  'src/ui/worldMap.ts',
  'src/screens/gameLoadingOverlay.ts',
  'src/editor/editorSaveChangesDialog.ts',
];

/**
 * Call sites that render text to the player. A string literal in any of these
 * positions is a missing translation key.
 */
const TEXT_SINK_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'textContent assignment', re: /\.textContent\s*=\s*(['"])(.*?)\1/g },
  { name: 'innerText assignment', re: /\.innerText\s*=\s*(['"])(.*?)\1/g },
  { name: 'title assignment', re: /\.title\s*=\s*(['"])(.*?)\1/g },
  { name: 'aria-label attribute', re: /setAttribute\(\s*['"]aria-label['"]\s*,\s*(['"])(.*?)\1/g },
  { name: 'placeholder attribute', re: /\.placeholder\s*=\s*(['"])(.*?)\1/g },
  { name: 'makeButton label', re: /makeButton\(\s*(['"])(.*?)\1/g },
  { name: 'makeTabButton label', re: /makeTabButton\(\s*(['"])(.*?)\1/g },
  { name: 'makeSlider label', re: /makeSlider\(\s*(['"])(.*?)\1/g },
  { name: 'makeCheckboxRow label', re: /makeCheckboxRow\(\s*(['"])(.*?)\1/g },
  { name: 'makeLabel label', re: /makeLabel\(\s*(['"])(.*?)\1/g },
  { name: 'makeSettingsSlider label', re: /makeSettingsSlider\(\s*(['"])(.*?)\1/g },
  { name: 'makeQualityButton label', re: /makeQualityButton\(\s*(['"])(.*?)\1/g },
  { name: 'makeBtn label', re: /makeBtn\(\s*(['"])(.*?)\1/g },
];

/**
 * Literals that are not player-facing prose and are therefore allowed:
 * empty strings, pure punctuation/symbols/glyph decorations, single characters,
 * and CSS/DOM plumbing values.
 */
function isAllowedLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  // No letters at all → symbol, arrow, chevron, glyph badge, number, etc.
  if (!/\p{L}/u.test(trimmed)) return true;
  // Single letter used as a keycap or glyph marker (e.g. the "F" interact hint).
  if (trimmed.replace(/\P{L}/gu, '').length <= 1) return true;
  return false;
}

/** Strips block and line comments so documentation prose is not flagged. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

test('guarded files exist (keeps the guard from silently passing on a rename)', () => {
  for (const relative of GUARDED_FILES) {
    const absolute = path.join(REPO_ROOT, relative);
    assert.ok(fs.existsSync(absolute), `guarded file is missing: ${relative}`);
  }
});

test('no hard-coded player-facing strings in migrated screens', () => {
  const violations: string[] = [];

  for (const relative of GUARDED_FILES) {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8'));
    const lines = source.split(/\r?\n/);

    for (const { name, re } of TEXT_SINK_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const literal = match[2];
        if (isAllowedLiteral(literal)) continue;
        const lineNumber = source.slice(0, match.index).split('\n').length;
        violations.push(
          `${relative}:${lineNumber} (${name}) hard-coded text ${JSON.stringify(literal)}`
          + ` — use t('...') instead. Line: ${lines[lineNumber - 1]?.trim() ?? ''}`,
        );
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Hard-coded player-facing text found:\n  ${violations.join('\n  ')}`,
  );
});

test('migrated screens actually import the i18n runtime', () => {
  for (const relative of GUARDED_FILES) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
    assert.ok(
      /from '\.\.\/i18n'/.test(source),
      `${relative} is listed as migrated but does not import the i18n runtime`,
    );
  }
});

test('the guard detects a hard-coded string when one is introduced', () => {
  // Self-test: proves the patterns actually fire, so a future refactor cannot
  // quietly turn this guard into a no-op.
  const sample = "el.textContent = 'Play';\nbtn.title = 'Delete Save Slot 1';";
  let hits = 0;
  for (const { re } of TEXT_SINK_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(sample)) !== null) {
      if (!isAllowedLiteral(match[2])) hits++;
    }
  }
  assert.equal(hits, 2, 'the guard patterns must flag obvious hard-coded text');
});

test('symbol-only and empty literals are not falsely flagged', () => {
  for (const allowed of ['', '  ', '▾', '←', '⚔', '?', 'F', '1', '3×3', '(?)', 'x']) {
    assert.ok(isAllowedLiteral(allowed), `should be allowed: ${JSON.stringify(allowed)}`);
  }
  for (const flagged of ['Play', 'Save Slot 1', 'Are you sure?']) {
    assert.ok(!isAllowedLiteral(flagged), `should be flagged: ${flagged}`);
  }
});
