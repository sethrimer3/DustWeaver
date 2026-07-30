/**
 * Blocking editor-exit decision shown when campaign work has not been
 * exported. Export is intentionally distinct from the editor's in-memory
 * room-save boundary.
 */

import { t } from '../i18n';

export function showUnexportedChangesDialog(
  root: HTMLElement,
  onDiscard: () => void,
  onExport: () => void,
): () => void {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: absolute; inset: 0; background: rgba(0,0,0,0.78); z-index: 12000;
    display: flex; align-items: center; justify-content: center; pointer-events: auto;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    width: min(520px, calc(100% - 40px)); box-sizing: border-box;
    background: rgba(10,12,20,0.98); border: 2px solid #ff6644;
    border-radius: 8px; padding: 24px 30px; display: flex; flex-direction: column;
    align-items: center; gap: 20px; font-family: 'Cinzel', monospace;
    box-shadow: 0 0 34px rgba(255,60,30,0.2), 0 0 30px rgba(0,0,0,0.85);
  `;

  const warning = document.createElement('div');
  warning.textContent = t('editor.unexportedChanges');
  warning.style.cssText = `
    color: #ff8866; font-size: 17px; font-weight: bold; line-height: 1.45;
    text-align: center; letter-spacing: 0.025em;
  `;
  panel.appendChild(warning);

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display: flex; gap: 16px;';

  const dismiss = (): void => { backdrop.remove(); };
  const makeDecisionButton = (
    text: string,
    color: string,
    background: string,
    action: () => void,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = `
      min-width: 120px; padding: 10px 20px; font: bold 14px 'Cinzel', monospace;
      cursor: pointer; border-radius: 4px; background: ${background};
      color: ${color}; border: 2px solid ${color};
    `;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      dismiss();
      action();
    });
    return button;
  };

  buttonRow.appendChild(makeDecisionButton(
    t('editor.discard'), '#ff6644', 'rgba(160,30,20,0.6)', onDiscard,
  ));
  buttonRow.appendChild(makeDecisionButton(
    t('editor.export'), '#55aaff', 'rgba(30,70,120,0.6)', onExport,
  ));
  panel.appendChild(buttonRow);
  backdrop.appendChild(panel);
  root.appendChild(backdrop);
  return dismiss;
}
