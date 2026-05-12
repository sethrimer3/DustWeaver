/**
 * mainMenuCustomCampaigns.ts — Custom Campaigns screen for the main menu.
 *
 * BUILD 287: Extracted from mainMenu.ts to reduce its line count.
 * Renders the campaign list panel, import button, and the "Create New Campaign" dialog.
 */

import { listAllCampaignSources, saveBrowserImportedCampaign, deleteBrowserImportedCampaign } from '../levels/campaignSource';
import type { CampaignSource } from '../levels/campaignSource';
import { parsePackedCampaignFromJson } from '../levels/packedCampaignLoader';
import type { EditableCampaignSession } from '../editor/editableCampaignSession';
import { createNewCampaignSession, sanitizeCampaignId, createSessionFromPackedCampaign } from '../editor/editableCampaignSession';

export interface CustomCampaignCallbacks {
  onPlayCustomCampaign?: (source: CampaignSource) => void;
  onEditCustomCampaign?: (source: CampaignSource, session: EditableCampaignSession) => void;
  onCreateNewCampaign?: (session: EditableCampaignSession) => void;
}

// ─── Campaign list screen ─────────────────────────────────────────────────────

export async function buildCustomCampaignsUI(
  container: HTMLDivElement,
  callbacks: CustomCampaignCallbacks,
  onBack: () => void,
): Promise<void> {
  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = 'Custom Campaigns';
  heading.style.cssText = `
    color: #d4a84b; font-size: 1.8rem; margin-bottom: 0.3rem;
    text-shadow: 0 0 20px rgba(212,168,75,0.3);
    letter-spacing: 0.06em; font-weight: 400;
  `;
  container.appendChild(heading);

  // ── Create New Campaign button ────────────────────────────────────────────
  const createNewBtn = document.createElement('button');
  createNewBtn.textContent = '✦ Create New Campaign';
  createNewBtn.style.cssText = `
    background: rgba(30,80,40,0.5); border: 1.5px solid #44cc66;
    color: #44ee77; padding: 0.65rem 2rem; font-size: 0.95rem;
    font-family: 'Cinzel', serif; cursor: pointer; border-radius: 2px;
    letter-spacing: 0.07em; margin-bottom: 0.8rem; transition: all 0.2s;
  `;
  createNewBtn.addEventListener('mouseenter', () => {
    createNewBtn.style.background = 'rgba(30,100,50,0.7)';
    createNewBtn.style.borderColor = '#66ff88';
  });
  createNewBtn.addEventListener('mouseleave', () => {
    createNewBtn.style.background = 'rgba(30,80,40,0.5)';
    createNewBtn.style.borderColor = '#44cc66';
  });
  createNewBtn.addEventListener('click', () => showCreateNewCampaignDialog(container, callbacks));
  container.appendChild(createNewBtn);

  // ── Import Campaign JSON button ──────────────────────────────────────────
  const importBtn = document.createElement('button');
  importBtn.textContent = '📥 Import Campaign JSON';
  importBtn.style.cssText = `
    background: rgba(20,60,120,0.5); border: 1px solid #3388cc;
    color: #66aaff; padding: 0.55rem 1.5rem; font-size: 0.88rem;
    font-family: 'Cinzel', serif; cursor: pointer; border-radius: 2px;
    letter-spacing: 0.06em; margin-bottom: 1rem; transition: all 0.2s;
  `;
  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.dwcampaign.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const { campaign, errors } = parsePackedCampaignFromJson(text);
        if (campaign === null) {
          alert(`Invalid campaign file:\n${errors.join('\n')}`);
          return;
        }
        saveBrowserImportedCampaign(campaign);
        // Refresh the campaign list.
        void buildCustomCampaignsUI(container, callbacks, onBack);
      };
      reader.readAsText(file);
    });
    input.click();
  });
  container.appendChild(importBtn);

  // ── Campaign list ────────────────────────────────────────────────────────
  const loadingEl = document.createElement('div');
  loadingEl.textContent = 'Loading campaigns…';
  loadingEl.style.cssText = `color: rgba(212,168,75,0.7); font-size: 0.9rem; margin-bottom: 0.5rem;`;
  container.appendChild(loadingEl);

  let sources: CampaignSource[];
  try {
    sources = await listAllCampaignSources();
  } catch {
    sources = [];
  }
  container.removeChild(loadingEl);

  if (sources.length === 0) {
    const empty = document.createElement('div');
    empty.innerHTML = `
      No custom campaigns found.<br>
      <span style="font-size:0.8rem; opacity:0.7;">
        Add <code>.dwcampaign.json</code> files to <code>ASSETS/CAMPAIGNS/CUSTOM/</code>
        or import a campaign file above.
      </span>
    `;
    empty.style.cssText = `
      color: rgba(212,168,75,0.75); padding: 1rem 1.2rem; line-height: 1.6;
      border: 1px dashed rgba(212,168,75,0.4); width: min(680px, 90vw); text-align: center;
    `;
    container.appendChild(empty);
  } else {
    const listPanel = document.createElement('div');
    listPanel.style.cssText = `
      display: grid; grid-template-columns: 220px 1fr; gap: 0.8rem;
      width: 100%; background: rgba(0,0,0,0.48); border: 1px solid rgba(212,168,75,0.3);
      padding: 0.9rem;
    `;

    const listEl = document.createElement('div');
    listEl.style.cssText = 'display: flex; flex-direction: column; gap: 0.4rem; overflow-y: auto; max-height: 400px;';
    const detailEl = document.createElement('div');
    detailEl.style.cssText = `
      border: 1px solid rgba(212,168,75,0.25); background: rgba(0,0,0,0.35);
      padding: 0.8rem; min-height: 280px;
    `;

    function sourceBadge(kind: string): string {
      switch (kind) {
        case 'bundled-folder-campaign':  return '<span style="background:rgba(80,60,0,0.5);border:1px solid #aa8800;color:#ddaa33;padding:1px 6px;font-size:0.72rem;border-radius:2px;">Built-in folder</span>';
        case 'bundled-packed-campaign':  return '<span style="background:rgba(20,60,20,0.5);border:1px solid #33aa44;color:#55cc66;padding:1px 6px;font-size:0.72rem;border-radius:2px;">Packed campaign</span>';
        case 'imported-browser-campaign': return '<span style="background:rgba(20,40,100,0.5);border:1px solid #4477cc;color:#66aaff;padding:1px 6px;font-size:0.72rem;border-radius:2px;">Imported</span>';
        default: return '';
      }
    }

    function renderDetail(source: CampaignSource): void {
      const badge = sourceBadge(source.sourceKind);
      const imageSrc = source.initialRoomImagePath ?? null;

      const canPlay = source.loadPackedCampaign !== undefined || source.loadFolderCampaign !== undefined;
      const canEdit = source.loadPackedCampaign !== undefined;
      const canExport = source.loadPackedCampaign !== undefined;
      const canDelete = source.sourceKind === 'imported-browser-campaign';

      detailEl.innerHTML = `
        <div style="font-size:1.25rem;color:#d4a84b;margin-bottom:0.15rem;">${source.title}</div>
        <div style="font-size:0.85rem;color:rgba(212,168,75,0.7);margin-bottom:0.4rem;">By ${source.creator || 'Unknown'} &nbsp; ${badge}</div>
        ${imageSrc !== null
          ? `<img src="${imageSrc}" alt="${source.title} initial room" style="display:block;width:100%;max-height:160px;object-fit:cover;border:1px solid rgba(212,168,75,0.3);margin-bottom:0.6rem;"/>`
          : ''}
        <div style="font-size:0.82rem;line-height:1.4;color:rgba(240,220,176,0.88);margin-bottom:0.8rem;">${source.description || ''}</div>
        <div id="detail-actions" style="display:flex;gap:0.5rem;flex-wrap:wrap;"></div>
      `;

      const actionsDiv = detailEl.querySelector<HTMLDivElement>('#detail-actions')!;

      if (canPlay) {
        const playBtn = document.createElement('button');
        playBtn.textContent = '▶ Play';
        playBtn.style.cssText = `background:rgba(30,80,30,0.5);border:1px solid #44cc44;color:#66ee66;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        playBtn.addEventListener('click', () => {
          callbacks.onPlayCustomCampaign?.(source);
        });
        actionsDiv.appendChild(playBtn);
      }

      if (canEdit) {
        const editBtn = document.createElement('button');
        editBtn.textContent = '🛠 Edit';
        editBtn.style.cssText = `background:rgba(40,50,20,0.5);border:1px solid #aacc44;color:#ccee55;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        editBtn.addEventListener('click', async () => {
          editBtn.disabled = true;
          editBtn.textContent = 'Loading…';
          try {
            const campaign = await source.loadPackedCampaign!();
            const session = createSessionFromPackedCampaign(campaign, 'packed-repo');
            callbacks.onEditCustomCampaign?.(source, session);
          } catch (e) {
            alert(`Failed to load campaign for editing: ${e instanceof Error ? e.message : String(e)}`);
            editBtn.disabled = false;
            editBtn.textContent = '🛠 Edit';
          }
        });
        actionsDiv.appendChild(editBtn);
      }

      if (canExport) {
        const exportBtn = document.createElement('button');
        exportBtn.textContent = '📤 Export JSON';
        exportBtn.style.cssText = `background:rgba(20,40,80,0.5);border:1px solid #3366cc;color:#6699ff;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        exportBtn.addEventListener('click', async () => {
          exportBtn.disabled = true;
          exportBtn.textContent = 'Exporting…';
          try {
            const campaign = await source.loadPackedCampaign!();
            const text = JSON.stringify(campaign, null, 2);
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${campaign.campaign.id}.dwcampaign.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 0);
          } catch (e) {
            alert(`Failed to export campaign: ${e instanceof Error ? e.message : String(e)}`);
          }
          exportBtn.disabled = false;
          exportBtn.textContent = '📤 Export JSON';
        });
        actionsDiv.appendChild(exportBtn);
      }

      if (canDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑 Delete';
        deleteBtn.style.cssText = `background:rgba(80,20,20,0.5);border:1px solid #cc4444;color:#ff8888;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        deleteBtn.addEventListener('click', () => {
          if (confirm(`Delete imported campaign "${source.title}"?`)) {
            deleteBrowserImportedCampaign(source.id);
            void buildCustomCampaignsUI(container, callbacks, onBack);
          }
        });
        actionsDiv.appendChild(deleteBtn);
      }
    }

    for (const source of sources) {
      const btn = document.createElement('button');
      btn.textContent = source.title;
      btn.style.cssText = `
        width: 100%; text-align: left; background: rgba(0,0,0,0.45);
        border: 1px solid rgba(212,168,75,0.28); color: #d4a84b;
        padding: 0.6rem 0.7rem; font-family: 'Cinzel', serif; cursor: pointer;
        font-size: 0.88rem;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.borderColor = 'rgba(212,168,75,0.75)';
        btn.style.background = 'rgba(212,168,75,0.1)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = 'rgba(212,168,75,0.28)';
        btn.style.background = 'rgba(0,0,0,0.45)';
      });
      const capturedSource = source;
      btn.addEventListener('click', () => renderDetail(capturedSource));
      listEl.appendChild(btn);
    }

    listPanel.appendChild(listEl);
    listPanel.appendChild(detailEl);
    container.appendChild(listPanel);
    if (sources.length > 0) renderDetail(sources[0]);
  }

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

// ─── Create New Campaign dialog ───────────────────────────────────────────────

function showCreateNewCampaignDialog(
  container: HTMLDivElement,
  callbacks: CustomCampaignCallbacks,
): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.8); z-index: 10;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: rgba(8,10,20,0.97); border: 1px solid rgba(212,168,75,0.5);
    padding: 1.4rem 1.8rem; min-width: 360px; max-width: 480px; width: 90vw;
    display: flex; flex-direction: column; gap: 0.7rem;
    font-family: 'Cinzel', serif;
  `;

  const dlgTitle = document.createElement('div');
  dlgTitle.textContent = 'Create New Campaign';
  dlgTitle.style.cssText = 'color: #d4a84b; font-size: 1.3rem; margin-bottom: 0.3rem; font-weight: 400;';
  panel.appendChild(dlgTitle);

  function field(label: string, id: string, value: string, hint?: string): HTMLInputElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:0.15rem;';
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:0.78rem;color:rgba(212,168,75,0.8);';
    const inp = document.createElement('input');
    inp.id = id;
    inp.type = 'text';
    inp.value = value;
    inp.style.cssText = `
      background: rgba(0,0,0,0.5); border: 1px solid rgba(212,168,75,0.35);
      color: #f0e0b0; padding: 0.35rem 0.6rem; font-family: monospace; font-size: 0.88rem;
      outline: none; width: 100%; box-sizing: border-box;
    `;
    if (hint) {
      const hintEl = document.createElement('div');
      hintEl.textContent = hint;
      hintEl.style.cssText = 'font-size:0.72rem;color:rgba(212,168,75,0.5);';
      row.appendChild(lbl); row.appendChild(inp); row.appendChild(hintEl);
    } else {
      row.appendChild(lbl); row.appendChild(inp);
    }
    panel.appendChild(row);
    return inp;
  }

  function numField(label: string, id: string, value: number, min: number, max: number): HTMLInputElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:0.15rem;';
    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:0.78rem;color:rgba(212,168,75,0.8);';
    const inp = document.createElement('input');
    inp.id = id;
    inp.type = 'number';
    inp.value = String(value);
    inp.min = String(min);
    inp.max = String(max);
    inp.style.cssText = `
      background: rgba(0,0,0,0.5); border: 1px solid rgba(212,168,75,0.35);
      color: #f0e0b0; padding: 0.35rem 0.6rem; font-family: monospace; font-size: 0.88rem;
      outline: none; width: 100%; box-sizing: border-box;
    `;
    row.appendChild(lbl); row.appendChild(inp);
    panel.appendChild(row);
    return inp;
  }

  const idInp = field('Campaign ID', 'new-id', 'my_campaign', 'lowercase letters, numbers, _ and - only');
  const titleInp = field('Campaign Title', 'new-title', 'My Campaign');
  const creatorInp = field('Creator', 'new-creator', '');
  const descInp = field('Description', 'new-desc', '');
  const initRoomIdInp = field('Initial Room ID', 'new-init-room', 'start');
  const worldNameInp = field('World Name', 'new-world-name', 'World 1');
  const widthInp = numField('Initial Room Width (blocks)', 'new-width', 40, 8, 256);
  const heightInp = numField('Initial Room Height (blocks)', 'new-height', 30, 8, 256);

  // Auto-sanitize campaign ID while typing.
  idInp.addEventListener('input', () => {
    const raw = idInp.value;
    const sanitized = sanitizeCampaignId(raw);
    if (raw !== sanitized) {
      const pos = idInp.selectionStart ?? 0;
      idInp.value = sanitized;
      idInp.setSelectionRange(pos, pos);
    }
  });
  // Auto-sanitize room ID while typing (same safe charset).
  initRoomIdInp.addEventListener('input', () => {
    const raw = initRoomIdInp.value;
    const sanitized = sanitizeCampaignId(raw);
    if (raw !== sanitized) {
      const pos = initRoomIdInp.selectionStart ?? 0;
      initRoomIdInp.value = sanitized;
      initRoomIdInp.setSelectionRange(pos, pos);
    }
  });

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:0.6rem;margin-top:0.3rem;justify-content:flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    background:transparent;border:1px solid rgba(212,168,75,0.3);color:rgba(212,168,75,0.6);
    padding:0.45rem 1.1rem;font-family:'Cinzel',serif;font-size:0.85rem;cursor:pointer;
  `;
  cancelBtn.addEventListener('click', () => {
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Create & Open Editor';
  confirmBtn.style.cssText = `
    background:rgba(30,80,40,0.6);border:1px solid #44cc66;color:#66ee88;
    padding:0.45rem 1.4rem;font-family:'Cinzel',serif;font-size:0.85rem;cursor:pointer;
  `;
  confirmBtn.addEventListener('click', () => {
    const rawId = idInp.value.trim();
    const rawRoomId = initRoomIdInp.value.trim();
    const params = {
      id: sanitizeCampaignId(rawId || 'my_campaign'),
      title: titleInp.value.trim() || 'My Campaign',
      creator: creatorInp.value.trim(),
      description: descInp.value.trim(),
      initialRoomId: sanitizeCampaignId(rawRoomId || 'start'),
      initialRoomWidthBlocks: Math.max(8, parseInt(widthInp.value, 10) || 40),
      initialRoomHeightBlocks: Math.max(8, parseInt(heightInp.value, 10) || 30),
      worldName: worldNameInp.value.trim() || 'World 1',
    };
    const session = createNewCampaignSession(params);
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
    callbacks.onCreateNewCampaign?.(session);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  panel.appendChild(btnRow);
  overlay.appendChild(panel);
  container.appendChild(overlay);
}
