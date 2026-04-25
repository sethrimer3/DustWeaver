/**
 * Utility functions for the editor save-changes flow:
 *   - `deepCloneRoomData` – structured-clone helper for EditorRoomData.
 *   - `showSaveChangesDialog` – modal "Save Changes?" dialog with YES/NO buttons.
 */

import type { EditorRoomData } from './editorState';

/**
 * Deep-clones an EditorRoomData object using structuredClone.
 * Safe because EditorRoomData contains only plain, structured-cloneable values.
 */
export function deepCloneRoomData(data: EditorRoomData): EditorRoomData {
  return structuredClone(data) as EditorRoomData;
}

/**
 * Shows a modal "Save Changes?" dialog with a green YES and a red NO button.
 * The dialog is appended to `root` and removed when the user picks an option.
 *
 * @param root    DOM element to append the dialog to (should be the UI overlay root).
 * @param onYes   Called when the user clicks YES.
 * @param onNo    Called when the user clicks NO.
 */
export function showSaveChangesDialog(root: HTMLElement, onYes: () => void, onNo: () => void): void {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: rgba(10,12,20,0.97); border: 1px solid rgba(0,200,100,0.5);
    border-radius: 8px; padding: 24px 32px; display: flex; flex-direction: column;
    align-items: center; gap: 20px; font-family: 'Cinzel', monospace;
    min-width: 260px; box-shadow: 0 0 30px rgba(0,0,0,0.8);
  `;

  const question = document.createElement('div');
  question.textContent = 'Save Changes?';
  question.style.cssText = `
    font-size: 16px; font-weight: bold; color: #c0ffd0; letter-spacing: 0.05em;
  `;
  panel.appendChild(question);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 16px;';

  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'YES';
  yesBtn.style.cssText = `
    min-width: 90px; padding: 10px 20px; font-size: 14px; font-weight: bold;
    font-family: 'Cinzel', monospace; cursor: pointer; border-radius: 4px;
    background: rgba(0,140,60,0.6); color: #44ff88;
    border: 2px solid #44ff88; transition: background 0.15s;
  `;
  yesBtn.addEventListener('mouseenter', () => { yesBtn.style.background = 'rgba(0,180,80,0.8)'; });
  yesBtn.addEventListener('mouseleave', () => { yesBtn.style.background = 'rgba(0,140,60,0.6)'; });
  yesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    onYes();
  });

  const noBtn = document.createElement('button');
  noBtn.textContent = 'NO';
  noBtn.style.cssText = `
    min-width: 90px; padding: 10px 20px; font-size: 14px; font-weight: bold;
    font-family: 'Cinzel', monospace; cursor: pointer; border-radius: 4px;
    background: rgba(160,30,20,0.6); color: #ff6644;
    border: 2px solid #ff6644; transition: background 0.15s;
  `;
  noBtn.addEventListener('mouseenter', () => { noBtn.style.background = 'rgba(200,40,30,0.8)'; });
  noBtn.addEventListener('mouseleave', () => { noBtn.style.background = 'rgba(160,30,20,0.6)'; });
  noBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    onNo();
  });

  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  panel.appendChild(btnRow);
  backdrop.appendChild(panel);
  root.appendChild(backdrop);
}
