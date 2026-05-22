/**
 * mainMenuSaveSlots.ts — Save-slot selection screen for the main menu.
 *
 * BUILD 287: Extracted from mainMenu.ts to reduce its line count.
 * Renders the three save-slot buttons with play-time / last-played info
 * and the per-slot delete confirmation overlay.
 */

import {
  SAVE_SLOT_COUNT,
  loadSaveSlot,
  createNewSaveSlot,
  saveSaveSlot,
  deleteSaveSlot,
  formatPlayTimeMs,
  formatLastPlayed,
  type SaveSlotData,
} from '../progression/saveSlots';

export interface SaveSlotsCallbacks {
  onPlay: (slotIndex: number, saveData: SaveSlotData) => void;
}

/**
 * Shows an Assist Mode opt-in dialog overlaid on the given container.
 * Calls `onConfirm(enableAssist)` when the player makes a choice.
 * Assist Mode cannot be disabled after save creation — the dialog makes this clear.
 */
function showAssistModeDialog(container: HTMLElement, onConfirm: (enableAssist: boolean) => void): void {
  const overlayEl = document.createElement('div');
  overlayEl.style.cssText = `
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.75); z-index: 5;
  `;

  const panelEl = document.createElement('div');
  panelEl.style.cssText = `
    min-width: 360px; max-width: 440px; background: rgba(0,0,0,0.88);
    border: 1px solid rgba(212,168,75,0.55); border-radius: 3px;
    padding: 1.3rem 1.4rem 1.1rem; text-align: center;
  `;

  const titleEl = document.createElement('div');
  titleEl.textContent = 'Assist Mode';
  titleEl.style.cssText = `
    color: #80c8f8; font-size: 1.1rem; letter-spacing: 0.1em;
    text-transform: uppercase; margin-bottom: 0.7rem;
  `;
  panelEl.appendChild(titleEl);

  const descEl = document.createElement('div');
  descEl.textContent =
    'Assist Mode allows unlimited air grapples — you can grapple repeatedly without '
    + 'touching the ground first. This cannot be turned off for this save.';
  descEl.style.cssText = `
    color: rgba(212,168,75,0.8); font-size: 0.82rem; line-height: 1.5;
    letter-spacing: 0.04em; margin-bottom: 0.95rem;
  `;
  panelEl.appendChild(descEl);

  const noteEl = document.createElement('div');
  noteEl.textContent = 'Saves with Assist Mode enabled are labelled "Assist".';
  noteEl.style.cssText = `
    color: rgba(255,255,255,0.4); font-size: 0.75rem; letter-spacing: 0.04em;
    margin-bottom: 1.1rem;
  `;
  panelEl.appendChild(noteEl);

  const actionsEl = document.createElement('div');
  actionsEl.style.cssText = 'display: flex; gap: 0.8rem; justify-content: center;';
  panelEl.appendChild(actionsEl);

  const normalBtn = document.createElement('button');
  normalBtn.textContent = 'Normal Mode';
  normalBtn.style.cssText = `
    background: transparent; border: 1px solid rgba(212,168,75,0.45);
    color: #d4a84b; padding: 0.5rem 1.1rem; font-size: 0.85rem;
    font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.07em;
    border-radius: 2px;
  `;
  normalBtn.addEventListener('mouseenter', () => {
    normalBtn.style.background = 'rgba(212,168,75,0.1)';
    normalBtn.style.borderColor = 'rgba(212,168,75,0.8)';
  });
  normalBtn.addEventListener('mouseleave', () => {
    normalBtn.style.background = 'transparent';
    normalBtn.style.borderColor = 'rgba(212,168,75,0.45)';
  });
  normalBtn.addEventListener('click', () => {
    overlayEl.remove();
    onConfirm(false);
  });
  actionsEl.appendChild(normalBtn);

  const assistBtn = document.createElement('button');
  assistBtn.textContent = 'Enable Assist Mode';
  assistBtn.style.cssText = `
    background: rgba(30,80,140,0.35); border: 1px solid rgba(80,160,220,0.65);
    color: #80c8f8; padding: 0.5rem 1.1rem; font-size: 0.85rem;
    font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.07em;
    border-radius: 2px;
  `;
  assistBtn.addEventListener('mouseenter', () => {
    assistBtn.style.background = 'rgba(30,80,140,0.55)';
    assistBtn.style.borderColor = 'rgba(80,160,220,0.9)';
  });
  assistBtn.addEventListener('mouseleave', () => {
    assistBtn.style.background = 'rgba(30,80,140,0.35)';
    assistBtn.style.borderColor = 'rgba(80,160,220,0.65)';
  });
  assistBtn.addEventListener('click', () => {
    overlayEl.remove();
    onConfirm(true);
  });
  actionsEl.appendChild(normalBtn);

  const assistBtn = document.createElement('button');
  assistBtn.textContent = 'Enable Assist Mode';
  assistBtn.style.cssText = `
    background: rgba(30,80,140,0.35); border: 1px solid rgba(80,160,220,0.65);
    color: #80c8f8; padding: 0.5rem 1.1rem; font-size: 0.85rem;
    font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.07em;
    border-radius: 2px;
  `;
  assistBtn.addEventListener('mouseenter', () => {
    assistBtn.style.background = 'rgba(30,80,140,0.55)';
    assistBtn.style.borderColor = 'rgba(80,160,220,0.9)';
  });
  assistBtn.addEventListener('mouseleave', () => {
    assistBtn.style.background = 'rgba(30,80,140,0.35)';
    assistBtn.style.borderColor = 'rgba(80,160,220,0.65)';
  });
  assistBtn.addEventListener('click', () => {
    overlayEl.remove();
    onConfirm(true);
  });
  actionsEl.appendChild(assistBtn);

  // Cancel button: closes the dialog without creating a save.
  const cancelBtn2 = document.createElement('button');
  cancelBtn2.textContent = 'Cancel';
  cancelBtn2.style.cssText = `
    background: transparent; border: 1px solid rgba(212,168,75,0.25);
    color: rgba(212,168,75,0.55); padding: 0.5rem 1.1rem; font-size: 0.85rem;
    font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.07em;
    border-radius: 2px;
  `;
  cancelBtn2.addEventListener('mouseenter', () => {
    cancelBtn2.style.borderColor = 'rgba(212,168,75,0.6)';
    cancelBtn2.style.color = '#d4a84b';
  });
  cancelBtn2.addEventListener('mouseleave', () => {
    cancelBtn2.style.borderColor = 'rgba(212,168,75,0.25)';
    cancelBtn2.style.color = 'rgba(212,168,75,0.55)';
  });
  cancelBtn2.addEventListener('click', () => { overlayEl.remove(); });
  actionsEl.appendChild(cancelBtn2);

  // Prevent clicks inside the panel from propagating to the overlay.
  panelEl.addEventListener('click', (e) => e.stopPropagation());
  // Clicking outside the panel does nothing (no accidental dismissal).
  overlayEl.appendChild(panelEl);
  container.appendChild(overlayEl);
}

export function buildSaveSlotUI(
  container: HTMLDivElement,
  callbacks: SaveSlotsCallbacks,
  onBack: () => void,
): void {
  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = 'Select Save Slot';
  heading.style.cssText = `
    color: #d4a84b; font-size: 1.8rem; margin-bottom: 0.6rem;
    text-shadow: 0 0 20px rgba(212,168,75,0.3);
    letter-spacing: 0.06em; font-weight: 400;
  `;
  container.appendChild(heading);

  function showDeleteConfirmation(slotIndex: number): void {
    const confirmOverlayEl = document.createElement('div');
    confirmOverlayEl.style.cssText = `
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7); z-index: 4;
    `;

    const panelEl = document.createElement('div');
    panelEl.style.cssText = `
      min-width: 340px; background: rgba(0,0,0,0.85); border: 1px solid rgba(212,168,75,0.55);
      border-radius: 3px; padding: 1.1rem 1.2rem 1rem; text-align: center;
    `;

    const promptEl = document.createElement('div');
    promptEl.textContent = 'DELETE Save File?';
    promptEl.style.cssText = `
      color: #d4a84b; font-size: 1rem; letter-spacing: 0.08em; margin-bottom: 0.9rem;
      text-transform: uppercase;
    `;
    panelEl.appendChild(promptEl);

    const actionsEl = document.createElement('div');
    actionsEl.style.cssText = 'display: flex; gap: 0.7rem; justify-content: center;';
    panelEl.appendChild(actionsEl);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background: transparent; border: 1px solid rgba(212,168,75,0.35);
      color: rgba(212,168,75,0.7); padding: 0.45rem 1rem; font-size: 0.85rem;
      font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.06em;
    `;
    cancelBtn.addEventListener('click', () => {
      if (confirmOverlayEl.parentElement !== null) {
        confirmOverlayEl.parentElement.removeChild(confirmOverlayEl);
      }
    });
    actionsEl.appendChild(cancelBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'DELETE';
    deleteBtn.style.cssText = `
      background: rgba(115,0,0,0.35); border: 1px solid rgba(225,88,88,0.65);
      color: #ffb3b3; padding: 0.45rem 1rem; font-size: 0.85rem;
      font-family: 'Cinzel', serif; cursor: pointer; letter-spacing: 0.06em;
    `;
    actionsEl.appendChild(deleteBtn);

    let hasConfirmedDeletion = false;
    deleteBtn.addEventListener('click', () => {
      if (!hasConfirmedDeletion) {
        hasConfirmedDeletion = true;
        promptEl.textContent = 'Are you sure?';
        deleteBtn.textContent = 'DELETE!';
        return;
      }
      deleteSaveSlot(slotIndex);
      buildSaveSlotUI(container, callbacks, onBack);
    });

    panelEl.addEventListener('click', (e) => e.stopPropagation());
    confirmOverlayEl.addEventListener('click', () => {
      if (confirmOverlayEl.parentElement !== null) {
        confirmOverlayEl.parentElement.removeChild(confirmOverlayEl);
      }
    });

    confirmOverlayEl.appendChild(panelEl);
    container.appendChild(confirmOverlayEl);
  }

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const slotData = loadSaveSlot(i);
    const hasData = slotData !== null;

    const slotRowEl = document.createElement('div');
    slotRowEl.style.cssText = `
      display: flex; align-items: stretch; gap: 0.45rem; width: 100%;
      justify-content: center;
    `;

    const slotBtn = document.createElement('button');
    slotBtn.style.cssText = `
      background: rgba(0,0,0,0.5); border: 1px solid rgba(212,168,75,0.3);
      color: #d4a84b; padding: 1.2rem 2rem;
      font-family: 'Cinzel', serif; font-weight: 400; cursor: pointer; transition: all 0.25s;
      border-radius: 3px; min-width: 300px; text-align: center;
    `;

    if (hasData) {
      const assistBadge = slotData.assistMode
        ? `<span style="
            display: inline-block; margin-left: 0.5rem;
            background: rgba(80,160,220,0.22); border: 1px solid rgba(80,160,220,0.6);
            color: #80c8f8; font-size: 0.65rem; letter-spacing: 0.08em;
            padding: 0.1em 0.4em; border-radius: 2px; vertical-align: middle;
            text-transform: uppercase;
          ">Assist</span>`
        : '';
      slotBtn.innerHTML = `
        <div style="font-size: 1.1rem; letter-spacing: 0.1em; margin-bottom: 0.4rem; font-weight: 400;">
          Save Slot ${i + 1}${assistBadge}
        </div>
        <div style="font-size: 0.8rem; color: rgba(212,168,75,0.65); letter-spacing: 0.05em;">
          Play Time: ${formatPlayTimeMs(slotData.playTimeMs)}
        </div>
        <div style="font-size: 0.8rem; color: rgba(212,168,75,0.5); letter-spacing: 0.05em; margin-top: 0.15rem;">
          Last Played: ${formatLastPlayed(slotData.lastPlayedIso)}
        </div>
      `;
    } else {
      slotBtn.innerHTML = `
        <div style="font-size: 1.1rem; letter-spacing: 0.1em; margin-bottom: 0.4rem; font-weight: 400;">
          Save Slot ${i + 1}
        </div>
        <div style="font-size: 0.8rem; color: rgba(212,168,75,0.4); letter-spacing: 0.05em;">
          — Empty —
        </div>
      `;
    }

    slotBtn.addEventListener('mouseenter', () => {
      slotBtn.style.background = 'rgba(212,168,75,0.1)';
      slotBtn.style.borderColor = 'rgba(212,168,75,0.7)';
    });
    slotBtn.addEventListener('mouseleave', () => {
      slotBtn.style.background = 'rgba(0,0,0,0.5)';
      slotBtn.style.borderColor = 'rgba(212,168,75,0.3)';
    });

    const slotIndex = i;
    slotBtn.addEventListener('click', () => {
      if (slotData !== null) {
        // Existing save — play immediately.
        callbacks.onPlay(slotIndex, slotData);
        return;
      }
      // New save — show Assist Mode opt-in dialog before creating.
      showAssistModeDialog(container, (enableAssist) => {
        const data = createNewSaveSlot(enableAssist);
        saveSaveSlot(slotIndex, data);
        callbacks.onPlay(slotIndex, data);
      });
    });

    slotRowEl.appendChild(slotBtn);

    const deleteSlotBtn = document.createElement('button');
    deleteSlotBtn.textContent = 'x';
    deleteSlotBtn.title = `Delete Save Slot ${slotIndex + 1}`;
    deleteSlotBtn.style.cssText = `
      width: 44px; min-width: 44px; border-radius: 3px; border: 1px solid rgba(225,88,88,0.6);
      background: rgba(90,0,0,0.42); color: #ffb3b3; cursor: pointer;
      font-family: 'Cinzel', serif; font-size: 1rem; text-transform: uppercase;
    `;
    deleteSlotBtn.addEventListener('mouseenter', () => {
      deleteSlotBtn.style.background = 'rgba(130,0,0,0.5)';
      deleteSlotBtn.style.borderColor = 'rgba(255,130,130,0.85)';
    });
    deleteSlotBtn.addEventListener('mouseleave', () => {
      deleteSlotBtn.style.background = 'rgba(90,0,0,0.42)';
      deleteSlotBtn.style.borderColor = 'rgba(225,88,88,0.6)';
    });
    deleteSlotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteConfirmation(slotIndex);
    });

    slotRowEl.appendChild(deleteSlotBtn);
    container.appendChild(slotRowEl);
  }

  // Back button
  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back';
  backBtn.style.cssText = `
    background: transparent; border: 1px solid rgba(212,168,75,0.25);
    color: rgba(212,168,75,0.6); padding: 0.6rem 2.5rem; font-size: 0.9rem;
    font-family: 'Cinzel', serif; cursor: pointer; transition: all 0.25s;
    border-radius: 2px; letter-spacing: 0.1em; margin-top: 0.5rem;
  `;
  backBtn.addEventListener('mouseenter', () => {
    backBtn.style.borderColor = 'rgba(212,168,75,0.6)';
    backBtn.style.color = '#d4a84b';
  });
  backBtn.addEventListener('mouseleave', () => {
    backBtn.style.borderColor = 'rgba(212,168,75,0.25)';
    backBtn.style.color = 'rgba(212,168,75,0.6)';
  });
  backBtn.addEventListener('click', onBack);
  container.appendChild(backBtn);
}
