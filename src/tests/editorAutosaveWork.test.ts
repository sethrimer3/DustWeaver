import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string): string =>
  readFileSync(path.join(dirname, relativePath), 'utf8');

test('Autosave Work sits between the editor title and fixed-width action bar', () => {
  const source = read('../editor/editorUI.ts');
  const title = source.indexOf('leftContentGroup.appendChild(title);');
  const autosave = source.indexOf('leftContentGroup.appendChild(autosaveLabel);');
  const actions = source.indexOf('leftContentGroup.appendChild(confirmCancelBar);');
  assert.ok(title >= 0 && autosave > title && actions > autosave);
  assert.ok(source.includes("autosaveLabel.appendChild(document.createTextNode(t('editor.autosaveWork')))"));
});

test('Autosave Work disables Save and changes only the Save & Test label', () => {
  const source = read('../editor/editorUI.ts');
  assert.ok(source.includes("confirmBtn.textContent = enabled ? t('editor.test') : t('editor.saveAndTest')"));
  assert.ok(source.includes('saveBtn.disabled = enabled;'));
  assert.ok(source.includes('flex: 1.35;'), 'the confirm button keeps its original flex width');
  assert.ok(source.includes('flex: 0.85;'), 'the Save button keeps its original flex width');
  assert.ok(source.includes('callbacks?.onAutosaveWorkChange(autosaveCheckbox.checked)'));
});

test('unexported work gates both menu exit and desktop window close', () => {
  const controller = read('../editor/editorController.ts');
  const gameScreen = read('../screens/gameScreen.ts');
  assert.ok(controller.includes("window.addEventListener('beforeunload', handleBeforeUnload)"));
  assert.ok(controller.includes('showUnexportedChangesDialog('));
  assert.ok(controller.includes('if (succeeded) onProceed();'));
  assert.equal((gameScreen.match(/requestReturnToMainMenu\(\);/g) ?? []).length, 2,
    'death and pause menu exits both use the guarded exit path');
});

test('export success alone clears the unexported-work flag', () => {
  const source = read('../editor/editorController.ts');
  const exportBody = source.slice(
    source.indexOf('async function saveAndExportCampaign('),
    source.indexOf('function requestExit('),
  );
  assert.ok(exportBody.includes('if (succeeded)'));
  assert.ok(exportBody.includes('hasUnexportedChanges = false;'));
  assert.ok(!exportBody.includes('hasUnexportedChanges = false;\n    }\n    return false'));
});
