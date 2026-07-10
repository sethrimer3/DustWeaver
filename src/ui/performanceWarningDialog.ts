/**
 * performanceWarningDialog.ts — generic non-blocking-to-the-app-but-modal
 * "Continue / Cancel" confirmation dialog, used to show the custom-campaign
 * pre-play performance warning (see levels/roomComplexity.ts,
 * `formatCampaignComplexityWarningMessage`). The player is never prevented
 * from playing — Cancel just returns them to the menu; Continue proceeds.
 *
 * Modeled on editor/editorSaveChangesDialog.ts's showSaveChangesDialog, but
 * with a caller-supplied message (supports multi-line via `\n`) and
 * Continue/Cancel labels instead of a fixed Save-Changes question.
 */

export function showPerformanceWarningDialog(
  root: HTMLElement,
  message: string,
  onContinue: () => void,
  onCancel: () => void,
): void {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.75); z-index: 3000;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: rgba(10,12,20,0.97); border: 1px solid rgba(255,153,68,0.6);
    border-radius: 8px; padding: 24px 32px; display: flex; flex-direction: column;
    align-items: center; gap: 20px; font-family: 'Cinzel', monospace;
    max-width: 480px; box-shadow: 0 0 30px rgba(0,0,0,0.8);
  `;

  const heading = document.createElement('div');
  heading.textContent = '⚠ Performance Warning';
  heading.style.cssText = `
    font-size: 15px; font-weight: bold; color: #ffcc66; letter-spacing: 0.05em;
  `;
  panel.appendChild(heading);

  const body = document.createElement('div');
  body.textContent = message;
  body.style.cssText = `
    font-size: 13px; line-height: 1.5; color: #ddd; white-space: pre-line; text-align: center;
  `;
  panel.appendChild(body);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 16px;';

  const continueBtn = document.createElement('button');
  continueBtn.textContent = 'Continue';
  continueBtn.style.cssText = `
    min-width: 110px; padding: 10px 20px; font-size: 14px; font-weight: bold;
    font-family: 'Cinzel', monospace; cursor: pointer; border-radius: 4px;
    background: rgba(0,140,60,0.6); color: #44ff88;
    border: 2px solid #44ff88; transition: background 0.15s;
  `;
  continueBtn.addEventListener('mouseenter', () => { continueBtn.style.background = 'rgba(0,180,80,0.8)'; });
  continueBtn.addEventListener('mouseleave', () => { continueBtn.style.background = 'rgba(0,140,60,0.6)'; });
  continueBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    onContinue();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    min-width: 110px; padding: 10px 20px; font-size: 14px; font-weight: bold;
    font-family: 'Cinzel', monospace; cursor: pointer; border-radius: 4px;
    background: rgba(160,30,20,0.6); color: #ff6644;
    border: 2px solid #ff6644; transition: background 0.15s;
  `;
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'rgba(200,40,30,0.8)'; });
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'rgba(160,30,20,0.6)'; });
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    onCancel();
  });

  btnRow.appendChild(continueBtn);
  btnRow.appendChild(cancelBtn);
  panel.appendChild(btnRow);
  backdrop.appendChild(panel);
  root.appendChild(backdrop);
}
