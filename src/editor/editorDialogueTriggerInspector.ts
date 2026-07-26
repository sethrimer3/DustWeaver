/**
 * editorDialogueTriggerInspector.ts — Inspector panel for dialogue triggers.
 *
 * Builds the per-entry UI (text, portrait, side, reorder/remove buttons) for a
 * dialogue trigger selected in the world editor.
 *
 * Extracted from editorInspector.ts (BUILD 311) to keep each file focused on a
 * single concern.
 */

import type { EditorState, EditorUICallbacks } from './editorState';
import { makeBtn } from './editorUIHelpers';
import { ACCENT_GOLD, PANEL_BORDER, BTN_BG, TEXT_COLOR } from './editorStyles';
import { MAX_DIALOGUE_ENTRIES } from '../dialogue/dialogueTypes';
import { DIALOGUE_PORTRAIT_OPTIONS } from '../dialogue/dialoguePortraits';

// ── Local style constants ─────────────────────────────────────────────────────

const INPUT_STYLE = `
  width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
  color: ${TEXT_COLOR}; padding: 3px 5px; font-size: 11px; font-family: monospace;
  border-radius: 2px; box-sizing: border-box;
`;
const TEXTAREA_STYLE = `
  width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
  color: ${TEXT_COLOR}; padding: 3px 5px; font-size: 11px; font-family: monospace;
  border-radius: 2px; box-sizing: border-box; resize: vertical; min-height: 48px;
`;
const LABEL_STYLE = `font-size: 10px; color: rgba(241,231,203,0.55); margin-bottom: 2px;`;
const ENTRY_CARD_STYLE = `
  border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
  padding: 5px 6px; margin-bottom: 5px; background: rgba(0,0,0,0.25);
`;
const SMALL_BTN_STYLE = `
  background: ${BTN_BG}; border: 1px solid ${PANEL_BORDER}; color: ${TEXT_COLOR};
  font-size: 10px; cursor: pointer; border-radius: 2px; padding: 1px 5px;
`;

// ── Inspector ─────────────────────────────────────────────────────────────────

/**
 * Populates `div` with the dialogue trigger inspector UI for the trigger
 * identified by `uid` in the current editor room.
 */
export function buildDialogueTriggerInspector(
  div: HTMLDivElement,
  uid: number,
  state: EditorState,
  callbacks: EditorUICallbacks | null,
): void {
  const room = state.roomData;
  if (!room) return;
  const triggers = room.dialogueTriggers ?? [];
  const trigger = triggers.find(t => t.uid === uid);
  if (!trigger) return;

  // ── Position / Size ──────────────────────────────────────────────────────
  const posSection = document.createElement('div');
  posSection.style.cssText = `margin-bottom: 6px;`;
  const posTitle = document.createElement('div');
  posTitle.textContent = 'Position & Size (blocks)';
  posTitle.style.cssText = `font-size: 10px; color: ${ACCENT_GOLD}; margin-bottom: 4px; font-weight: bold;`;
  posSection.appendChild(posTitle);

  const posRow = document.createElement('div');
  posRow.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 3px;`;
  for (const [label, prop, val] of [
    ['x', 'dialogueTrigger.xBlock', trigger.xBlock],
    ['y', 'dialogueTrigger.yBlock', trigger.yBlock],
    ['w', 'dialogueTrigger.wBlock', trigger.wBlock],
    ['h', 'dialogueTrigger.hBlock', trigger.hBlock],
  ] as const) {
    const wrap = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = LABEL_STYLE;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(val);
    inp.min = '1';
    inp.style.cssText = INPUT_STYLE;
    inp.addEventListener('change', () => {
      const v = parseInt(inp.value);
      if (!isNaN(v) && v >= 1) callbacks?.onPropertyChange(prop, v);
    });
    inp.addEventListener('click', e => e.stopPropagation());
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    posRow.appendChild(wrap);
  }
  posSection.appendChild(posRow);
  div.appendChild(posSection);

  // ── Conversation title ───────────────────────────────────────────────────
  const titleSection = document.createElement('div');
  titleSection.style.cssText = `margin-bottom: 6px;`;
  const titleLbl = document.createElement('div');
  titleLbl.textContent = 'Speaker Name (optional)';
  titleLbl.style.cssText = LABEL_STYLE;
  const titleInp = document.createElement('input');
  titleInp.type = 'text';
  titleInp.value = trigger.conversationTitle ?? '';
  titleInp.placeholder = 'e.g. Elder Vasha';
  titleInp.style.cssText = INPUT_STYLE;
  titleInp.addEventListener('change', () =>
    callbacks?.onPropertyChange('dialogueTrigger.title', titleInp.value));
  titleInp.addEventListener('click', e => e.stopPropagation());
  titleSection.appendChild(titleLbl);
  titleSection.appendChild(titleInp);
  div.appendChild(titleSection);

  // ── Entry count header ───────────────────────────────────────────────────
  const entriesHeader = document.createElement('div');
  entriesHeader.style.cssText = `display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;`;
  const entriesTitle = document.createElement('div');
  entriesTitle.textContent = `Entries (${trigger.entries.length} / ${MAX_DIALOGUE_ENTRIES})`;
  entriesTitle.style.cssText = `font-size: 11px; color: ${ACCENT_GOLD}; font-weight: bold;`;
  entriesHeader.appendChild(entriesTitle);

  const addBtn = makeBtn('+ Add', () => {
    callbacks?.onPropertyChange('dialogueTrigger.entry.add', 0);
  });
  addBtn.style.cssText += `font-size: 10px; padding: 2px 6px;`;
  addBtn.disabled = trigger.entries.length >= MAX_DIALOGUE_ENTRIES;
  entriesHeader.appendChild(addBtn);
  div.appendChild(entriesHeader);

  // ── Entry list ───────────────────────────────────────────────────────────
  const portraitOptions = DIALOGUE_PORTRAIT_OPTIONS.map(({ id, label }) => ({ label, value: id }));
  const sideOptions = [
    { label: 'Left', value: 'left' },
    { label: 'Right', value: 'right' },
  ];

  for (let i = 0; i < trigger.entries.length; i++) {
    const entry = trigger.entries[i];
    const card = document.createElement('div');
    card.style.cssText = ENTRY_CARD_STYLE;

    // Entry index label + reorder/remove buttons
    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = `display: flex; align-items: center; gap: 3px; margin-bottom: 4px;`;

    const indexLbl = document.createElement('span');
    indexLbl.textContent = `#${i + 1}`;
    indexLbl.style.cssText = `font-size: 10px; color: rgba(150,220,255,0.7); flex: 1;`;
    cardHeader.appendChild(indexLbl);

    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.style.cssText = SMALL_BTN_STYLE;
    upBtn.disabled = i === 0;
    upBtn.addEventListener('click', e => {
      e.stopPropagation();
      callbacks?.onPropertyChange('dialogueTrigger.entry.moveUp', i);
    });
    cardHeader.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.style.cssText = SMALL_BTN_STYLE;
    downBtn.disabled = i === trigger.entries.length - 1;
    downBtn.addEventListener('click', e => {
      e.stopPropagation();
      callbacks?.onPropertyChange('dialogueTrigger.entry.moveDown', i);
    });
    cardHeader.appendChild(downBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = SMALL_BTN_STYLE + `border-color: #ff6644; color: #ff6644;`;
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      callbacks?.onPropertyChange('dialogueTrigger.entry.remove', i);
    });
    cardHeader.appendChild(removeBtn);
    card.appendChild(cardHeader);

    // Portrait + side row
    const portraitRow = document.createElement('div');
    portraitRow.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 3px;`;

    const portraitWrap = document.createElement('div');
    const portraitLbl = document.createElement('div');
    portraitLbl.textContent = 'Portrait';
    portraitLbl.style.cssText = LABEL_STYLE;
    const portraitSel = document.createElement('select');
    portraitSel.style.cssText = `${INPUT_STYLE} padding: 2px 4px;`;
    for (const opt of portraitOptions) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === entry.portraitId) o.selected = true;
      portraitSel.appendChild(o);
    }
    portraitSel.addEventListener('change', e => {
      e.stopPropagation();
      callbacks?.onPropertyChange(`dialogueTrigger.entry.portraitId.${i}`, portraitSel.value);
    });
    portraitSel.addEventListener('click', e => e.stopPropagation());
    portraitWrap.appendChild(portraitLbl);
    portraitWrap.appendChild(portraitSel);
    portraitRow.appendChild(portraitWrap);

    const sideWrap = document.createElement('div');
    const sideLbl = document.createElement('div');
    sideLbl.textContent = 'Side';
    sideLbl.style.cssText = LABEL_STYLE;
    const sideSel = document.createElement('select');
    sideSel.style.cssText = `${INPUT_STYLE} padding: 2px 4px;`;
    for (const opt of sideOptions) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === entry.portraitSide) o.selected = true;
      sideSel.appendChild(o);
    }
    sideSel.addEventListener('change', e => {
      e.stopPropagation();
      callbacks?.onPropertyChange(`dialogueTrigger.entry.portraitSide.${i}`, sideSel.value);
    });
    sideSel.addEventListener('click', e => e.stopPropagation());
    sideWrap.appendChild(sideLbl);
    sideWrap.appendChild(sideSel);
    portraitRow.appendChild(sideWrap);
    card.appendChild(portraitRow);

    // Text area
    const textLbl = document.createElement('div');
    textLbl.textContent = 'Text';
    textLbl.style.cssText = LABEL_STYLE;
    const textArea = document.createElement('textarea');
    textArea.value = entry.text;
    textArea.style.cssText = TEXTAREA_STYLE;
    textArea.addEventListener('change', e => {
      e.stopPropagation();
      callbacks?.onPropertyChange(`dialogueTrigger.entry.text.${i}`, textArea.value);
    });
    textArea.addEventListener('click', e => e.stopPropagation());
    card.appendChild(textLbl);
    card.appendChild(textArea);

    div.appendChild(card);
  }

  if (trigger.entries.length === 0) {
    const emptyNote = document.createElement('div');
    emptyNote.textContent = 'No entries yet. Click "+ Add" to begin.';
    emptyNote.style.cssText = `font-size: 10px; color: rgba(241,231,203,0.4); text-align: center; padding: 8px 0;`;
    div.appendChild(emptyNote);
  }
}
