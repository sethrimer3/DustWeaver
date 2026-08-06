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
import { applyLocalePresentation, getUiFontFamily, t } from '../i18n';
import { showWorkshopBrowser } from './workshopBrowser';
import { loadCampaignSourceForWorkshopItem } from '../workshop/workshopCampaignLoader';
import type { WorkshopItem } from '../workshop/types';

/** Escapes text before it is spliced into an innerHTML template. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  applyLocalePresentation(container);

  const heading = document.createElement('h2');
  heading.textContent = t('customCampaigns.heading');
  heading.style.cssText = `
    color: #d4a84b; font-size: 1.8rem; margin-bottom: 0.3rem;
    text-shadow: 0 0 20px rgba(212,168,75,0.3);
    letter-spacing: 0.06em; font-weight: 400;
  `;
  container.appendChild(heading);

  // ── Create New Campaign button ────────────────────────────────────────────
  const createNewBtn = document.createElement('button');
  createNewBtn.textContent = t('customCampaigns.createNew');
  createNewBtn.style.cssText = `
    background: rgba(30,80,40,0.5); border: 1.5px solid #44cc66;
    color: #44ee77; padding: 0.65rem 2rem; font-size: 0.95rem;
    font-family: ${getUiFontFamily()}; cursor: pointer; border-radius: 2px;
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

  // ── Browse Workshop button ────────────────────────────────────────────────
  const workshopBtn = document.createElement('button');
  workshopBtn.textContent = t('customCampaigns.browseWorkshop');
  workshopBtn.style.cssText = `
    background: rgba(20,60,120,0.5); border: 1.5px solid #3388cc;
    color: #66aaff; padding: 0.65rem 2rem; font-size: 0.95rem;
    font-family: ${getUiFontFamily()}; cursor: pointer; border-radius: 2px;
    letter-spacing: 0.07em; margin-bottom: 0.8rem; margin-left: 0.6rem; transition: all 0.2s;
  `;
  workshopBtn.addEventListener('click', () => {
    let closeWorkshopBrowser: (() => void) | null = null;
    void showWorkshopBrowser(container, {
      onPlayItem: (item: WorkshopItem) => {
        void handlePlayWorkshopItem(item, callbacks, () => closeWorkshopBrowser?.());
      },
      getPublishableCampaigns: () => publishableCampaigns,
    }, () => {}).then((close) => {
      closeWorkshopBrowser = close;
    });
  });
  container.appendChild(workshopBtn);

  // ── Import Campaign button ───────────────────────────────────────────────
  const importBtn = document.createElement('button');
  importBtn.textContent = t('customCampaigns.import');
  importBtn.style.cssText = `
    background: rgba(20,60,120,0.5); border: 1px solid #3388cc;
    color: #66aaff; padding: 0.55rem 1.5rem; font-size: 0.88rem;
    font-family: ${getUiFontFamily()}; cursor: pointer; border-radius: 2px;
    letter-spacing: 0.06em; margin-bottom: 1rem; transition: all 0.2s;
  `;
  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dwcampaign.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const { campaign, errors } = parsePackedCampaignFromJson(text);
        if (campaign === null) {
          alert(t('customCampaigns.invalidFile', { errors: errors.join('\n') }));
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
  loadingEl.textContent = t('customCampaigns.loading');
  loadingEl.style.cssText = `color: rgba(212,168,75,0.7); font-size: 0.9rem; margin-bottom: 0.5rem;`;
  container.appendChild(loadingEl);

  let sources: CampaignSource[];
  let listError: string | null = null;
  try {
    sources = await listAllCampaignSources();
  } catch (e) {
    sources = [];
    listError = e instanceof Error ? e.message : String(e);
  }
  container.removeChild(loadingEl);

  if (listError !== null) {
    const errorEl = document.createElement('div');
    errorEl.textContent = t('customCampaigns.listFailed', { error: listError });
    errorEl.style.cssText = `
      color: #ff9a9a; font-size: 0.85rem; margin-bottom: 0.6rem;
      max-width: min(680px, 90vw); text-align: center;
    `;
    container.appendChild(errorEl);
  }

  if (sources.length === 0) {
    const empty = document.createElement('div');
    // Only the surrounding prose is translated; the paths inside <code> are
    // literal asset locations that must never be localized.
    empty.innerHTML = `
      ${escapeHtml(t('customCampaigns.emptyTitle'))}<br>
      <span style="font-size:0.8rem; opacity:0.7;">
        ${t('customCampaigns.emptyHint')}
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
        case 'bundled-folder-campaign':  return `<span style="background:rgba(80,60,0,0.5);border:1px solid #aa8800;color:#ddaa33;padding:1px 6px;font-size:0.72rem;border-radius:2px;">${escapeHtml(t('customCampaigns.badgeBundledFolder'))}</span>`;
        case 'bundled-packed-campaign':  return `<span style="background:rgba(20,60,20,0.5);border:1px solid #33aa44;color:#55cc66;padding:1px 6px;font-size:0.72rem;border-radius:2px;">${escapeHtml(t('customCampaigns.badgePacked'))}</span>`;
        case 'imported-browser-campaign': return `<span style="background:rgba(20,40,100,0.5);border:1px solid #4477cc;color:#66aaff;padding:1px 6px;font-size:0.72rem;border-radius:2px;">${escapeHtml(t('customCampaigns.badgeImported'))}</span>`;
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
        <div style="font-size:0.85rem;color:rgba(212,168,75,0.7);margin-bottom:0.4rem;">${escapeHtml(t('customCampaigns.byCreator', { creator: source.creator || t('customCampaigns.unknownCreator') }))} &nbsp; ${badge}</div>
        ${imageSrc !== null
          ? `<img src="${imageSrc}" alt="${escapeHtml(t('customCampaigns.initialRoomAlt'))}" style="display:block;width:100%;max-height:160px;object-fit:cover;border:1px solid rgba(212,168,75,0.3);margin-bottom:0.6rem;"/>`
          : ''}
        <div style="font-size:0.82rem;line-height:1.4;color:rgba(240,220,176,0.88);margin-bottom:0.8rem;">${source.description || ''}</div>
        <div id="detail-actions" style="display:flex;gap:0.5rem;flex-wrap:wrap;"></div>
      `;

      const actionsDiv = detailEl.querySelector<HTMLDivElement>('#detail-actions')!;

      if (canPlay) {
        const playBtn = document.createElement('button');
        playBtn.textContent = t('customCampaigns.play');
        playBtn.style.cssText = `background:rgba(30,80,30,0.5);border:1px solid #44cc44;color:#66ee66;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        playBtn.addEventListener('click', () => {
          callbacks.onPlayCustomCampaign?.(source);
        });
        actionsDiv.appendChild(playBtn);
      }

      if (canEdit) {
        const editBtn = document.createElement('button');
        editBtn.textContent = t('customCampaigns.edit');
        editBtn.style.cssText = `background:rgba(40,50,20,0.5);border:1px solid #aacc44;color:#ccee55;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        editBtn.addEventListener('click', async () => {
          editBtn.disabled = true;
          editBtn.textContent = t('customCampaigns.editLoading');
          try {
            const campaign = await source.loadPackedCampaign!();
            const session = createSessionFromPackedCampaign(campaign, 'packed-repo');
            callbacks.onEditCustomCampaign?.(source, session);
          } catch (e) {
            alert(t('customCampaigns.loadForEditFailed', { error: e instanceof Error ? e.message : String(e) }));
            editBtn.disabled = false;
            editBtn.textContent = t('customCampaigns.edit');
          }
        });
        actionsDiv.appendChild(editBtn);
      }

      if (canExport) {
        const exportBtn = document.createElement('button');
        exportBtn.textContent = t('customCampaigns.export');
        exportBtn.style.cssText = `background:rgba(20,40,80,0.5);border:1px solid #3366cc;color:#6699ff;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        exportBtn.addEventListener('click', async () => {
          exportBtn.disabled = true;
          exportBtn.textContent = t('customCampaigns.exporting');
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
            alert(t('customCampaigns.exportFailed', { error: e instanceof Error ? e.message : String(e) }));
          }
          exportBtn.disabled = false;
          exportBtn.textContent = t('customCampaigns.export');
        });
        actionsDiv.appendChild(exportBtn);
      }

      if (canDelete) {
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = t('customCampaigns.delete');
        deleteBtn.style.cssText = `background:rgba(80,20,20,0.5);border:1px solid #cc4444;color:#ff8888;padding:0.45rem 1.2rem;font-family:'Cinzel',serif;font-size:0.88rem;cursor:pointer;`;
        deleteBtn.addEventListener('click', () => {
          if (confirm(t('customCampaigns.deleteConfirm', { title: source.title }))) {
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
        padding: 0.6rem 0.7rem; font-family: ${getUiFontFamily()}; cursor: pointer;
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
  backBtn.dataset.controllerBack = 'true';
  backBtn.textContent = t('common.back');
  backBtn.style.cssText = `
    background: transparent; border: 1px solid rgba(212,168,75,0.25);
    color: rgba(212,168,75,0.6); padding: 0.6rem 2.5rem; font-size: 0.9rem;
    font-family: ${getUiFontFamily()}; cursor: pointer; transition: all 0.25s;
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

/**
 * Handles the Workshop browser's "Play" button: validates and loads the
 * installed item as a `CampaignSource`, then routes it through the exact
 * same `onPlayCustomCampaign` flow local custom campaigns already use. Any
 * failure (still downloading, missing install path, unreadable/malformed
 * package, or the item having been removed) shows a localized error and
 * leaves the Workshop browser open and usable — it never throws.
 */
async function handlePlayWorkshopItem(
  item: WorkshopItem,
  callbacks: CustomCampaignCallbacks,
  closeWorkshopBrowser: () => void,
): Promise<void> {
  const result = await loadCampaignSourceForWorkshopItem(item);
  if (!result.ok) {
    alert(t('workshop.playFailed', { title: item.title, error: result.message }));
    return;
  }
  closeWorkshopBrowser();
  callbacks.onPlayCustomCampaign?.(result.source);
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
    font-family: ${getUiFontFamily()};
  `;

  const dlgTitle = document.createElement('div');
  dlgTitle.textContent = t('newCampaign.title');
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

  // Field LABELS are translated; the seed VALUES ('my_campaign', 'start', ...)
  // become authored campaign data and stay locale-independent.
  const idInp = field(t('newCampaign.id'), 'new-id', 'my_campaign', t('newCampaign.idHint'));
  const titleInp = field(t('newCampaign.campaignTitle'), 'new-title', 'My Campaign');
  const creatorInp = field(t('newCampaign.creator'), 'new-creator', '');
  const descInp = field(t('newCampaign.description'), 'new-desc', '');
  const initRoomIdInp = field(t('newCampaign.initialRoomId'), 'new-init-room', 'start');
  const worldNameInp = field(t('newCampaign.zoneName'), 'new-world-name', 'Zone 1');
  const widthInp = numField(t('newCampaign.roomWidth'), 'new-width', 40, 8, 256);
  const heightInp = numField(t('newCampaign.roomHeight'), 'new-height', 30, 8, 256);

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
  cancelBtn.textContent = t('common.cancel');
  cancelBtn.style.cssText = `
    background:transparent;border:1px solid rgba(212,168,75,0.3);color:rgba(212,168,75,0.6);
    padding:0.45rem 1.1rem;font-family:'Cinzel',serif;font-size:0.85rem;cursor:pointer;
  `;
  cancelBtn.addEventListener('click', () => {
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = t('newCampaign.create');
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
      worldName: worldNameInp.value.trim() || 'Zone 1',
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
