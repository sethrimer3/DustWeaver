import type { EditorController } from '../editor/editorController';
import { createDebugPanel, type DebugPanel } from '../ui/debugPanel';
import type { RoomDef } from '../levels/roomDef';

interface CreateGameEditorDebugControlsParams {
  uiRoot: HTMLElement;
  editorController: EditorController;
  getCurrentRoom: () => RoomDef;
}

export interface GameEditorDebugControls {
  ensureEditorButton: () => void;
  removeEditorButton: () => void;
  handleEditorClosed: () => void;
  destroy: () => void;
}

export function createGameEditorDebugControls(
  params: CreateGameEditorDebugControlsParams,
): GameEditorDebugControls {
  const { uiRoot, editorController, getCurrentRoom } = params;

  let editorToggleBtn: HTMLButtonElement | null = null;
  let debugPanel: DebugPanel | null = null;

  function ensureEditorButton(): void {
    if (editorToggleBtn !== null) return;
    editorToggleBtn = document.createElement('button');
    editorToggleBtn.style.cssText = `
      position: absolute; top: 38px; right: 16px;
      background: rgba(0,0,0,0.6); border: 2px solid #00c864; color: #00c864;
      padding: 6px 14px; font-size: 0.85rem; font-family: 'Cinzel', serif;
      cursor: pointer; border-radius: 6px; z-index: 800;
    `;
    editorToggleBtn.textContent = 'World Editor';
    editorToggleBtn.addEventListener('click', () => {
      editorController.toggle(getCurrentRoom());
      if (editorToggleBtn === null) return;
      editorToggleBtn.textContent = editorController.state.isActive ? 'Exit Editor' : 'World Editor';
      editorToggleBtn.style.borderColor = editorController.state.isActive ? '#ff6644' : '#00c864';
      editorToggleBtn.style.color = editorController.state.isActive ? '#ff6644' : '#00c864';
    });
    uiRoot.appendChild(editorToggleBtn);
    if (debugPanel === null) {
      debugPanel = createDebugPanel(uiRoot);
    }
  }

  function removeEditorButton(): void {
    if (editorToggleBtn !== null && editorToggleBtn.parentElement) {
      editorToggleBtn.parentElement.removeChild(editorToggleBtn);
      editorToggleBtn = null;
    }
    if (debugPanel !== null) {
      debugPanel.destroy();
      debugPanel = null;
    }
  }

  function handleEditorClosed(): void {
    if (editorToggleBtn === null) return;
    editorToggleBtn.textContent = 'World Editor';
    editorToggleBtn.style.borderColor = '#00c864';
    editorToggleBtn.style.color = '#00c864';
  }

  function destroy(): void {
    removeEditorButton();
  }

  return {
    ensureEditorButton,
    removeEditorButton,
    handleEditorClosed,
    destroy,
  };
}
