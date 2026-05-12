/**
 * Main menu UI module.
 *
 * Flow:
 *   1. Non-blurred background animation plays on loop; music starts (once).
 *   2. Title "DustWeaver" fades in.
 *   3. Any key / click → switch to blurred animation at the same frame,
 *      show menu options (Play, Settings, Exit).
 *   4. Play → 3 save-slot selection screen.
 */

import {
  SAVE_SLOT_COUNT,
  loadSaveSlot,
  createNewSaveSlot,
  saveSaveSlot,
  deleteSaveSlot,
  formatPlayTimeMs,
  formatLastPlayed,
  SaveSlotData,
} from '../progression/saveSlots';
import { BUILD_NUMBER } from '../build-info';
import { buildSettingsUI } from './mainMenuSettings';
import { listAllCampaignSources, saveBrowserImportedCampaign, deleteBrowserImportedCampaign } from '../levels/campaignSource';
import type { CampaignSource } from '../levels/campaignSource';
import { parsePackedCampaignFromJson } from '../levels/packedCampaignLoader';
import type { EditableCampaignSession } from '../editor/editableCampaignSession';
import { createNewCampaignSession, sanitizeCampaignId, createSessionFromPackedCampaign } from '../editor/editableCampaignSession';

// ─── Constants ───────────────────────────────────────────────────────────────

const FRAME_COUNT = 300;
const ANIMATION_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / ANIMATION_FPS;

/** Vite base URL so public assets resolve correctly. */
const BASE = import.meta.env.BASE_URL;

// ─── Callbacks ───────────────────────────────────────────────────────────────

export interface MainMenuCallbacks {
  onPlay: (slotIndex: number, saveData: SaveSlotData) => void;
  onPlayCustomCampaign?: (source: CampaignSource) => void;
  onEditCustomCampaign?: (source: CampaignSource, session: EditableCampaignSession) => void;
  onCreateNewCampaign?: (session: EditableCampaignSession) => void;
}

// ─── Frame-Sequence Animation Player ─────────────────────────────────────────

/**
 * Preloads all frames for both normal and blurred animation sequences.
 */
function preloadFrames(): { normal: HTMLImageElement[]; blurred: HTMLImageElement[] } {
  const normal: HTMLImageElement[] = new Array(FRAME_COUNT);
  const blurred: HTMLImageElement[] = new Array(FRAME_COUNT);

  for (let i = 0; i < FRAME_COUNT; i++) {
    const idx = String(i).padStart(5, '0');

    const imgN = new Image();
    imgN.src = `${BASE}ANIMATIONS/goldEmbers/goldEmbers_${idx}.webp`;
    normal[i] = imgN;

    const imgB = new Image();
    imgB.src = `${BASE}ANIMATIONS/goldEmbers_blur/goldEmbers_blur_${idx}.webp`;
    blurred[i] = imgB;
  }

  return { normal, blurred };
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function showMainMenu(root: HTMLElement, callbacks: MainMenuCallbacks): () => void {
  // ── State ────────────────────────────────────────────────────────────────
  let isBlurred = false;
  let frameIndex = 0;
  let lastFrameTimeMs = 0;
  let rafHandle = 0;
  let isRunning = false;
  let isDestroyed = false;

  // ── Preload frames ───────────────────────────────────────────────────────
  const { normal, blurred } = preloadFrames();

  // ── Background canvas ────────────────────────────────────────────────────
  const bgCanvas = document.createElement('canvas');
  bgCanvas.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 0;
  `;
  const bgCtx = bgCanvas.getContext('2d')!;

  function resizeBgCanvas(): void {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  resizeBgCanvas();

  // ── Music ────────────────────────────────────────────────────────────────
  const music = new Audio(`${BASE}MUSIC/titleMenu.mp3`);
  music.loop = false;
  music.volume = 0.5;

  /** Try to play music; browsers may block autoplay until interaction. */
  function tryPlayMusic(): void {
    if (music.paused && !isDestroyed) {
      music.play().catch(() => { /* autoplay blocked — will retry on interaction */ });
    }
  }

  // ── UI container ─────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.id = 'main-menu';
  container.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #fff; font-family: 'Cinzel', serif; z-index: 1;
  `;

  // ── Title element (fades in) ─────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    text-align: center; opacity: 0;
    transition: opacity 2s ease-in;
  `;
  titleEl.innerHTML = `
    <h1 style="
      font-size: 4.5rem; color: #d4a84b;
      text-shadow: 0 0 40px rgba(212,168,75,0.5), 0 0 80px rgba(212,168,75,0.25);
      margin-bottom: 0.3rem; letter-spacing: 0.08em; font-weight: 400;
      text-transform: uppercase;
    ">DustWeaver</h1>
    <p style="
      color: rgba(212,168,75,0.55); font-size: 0.95rem; letter-spacing: 0.18em;
      text-transform: uppercase; margin-top: 0; font-weight: 400;
    ">Press any key</p>
  `;
  container.appendChild(titleEl);

  // ── Menu options container (hidden initially) ────────────────────────────
  const menuEl = document.createElement('div');
  menuEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 1.2rem; opacity: 0; transition: opacity 0.6s ease-in;
  `;
  container.appendChild(menuEl);

  // ── Save-slot container (hidden initially) ───────────────────────────────
  const saveSlotsEl = document.createElement('div');
  saveSlotsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 1rem; opacity: 0; transition: opacity 0.5s ease-in;
  `;
  container.appendChild(saveSlotsEl);

  const settingsEl = document.createElement('div');
  settingsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 0.8rem; opacity: 0; transition: opacity 0.5s ease-in;
  `;
  container.appendChild(settingsEl);

  const customCampaignsEl = document.createElement('div');
  customCampaignsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 0.8rem; opacity: 0; transition: opacity 0.5s ease-in; width: min(880px, 92vw);
  `;
  container.appendChild(customCampaignsEl);

  const buildBadgeEl = document.createElement('div');
  buildBadgeEl.textContent = `Build ${BUILD_NUMBER}`;
  buildBadgeEl.style.cssText = `
    position: absolute; top: 1rem; left: 1rem;
    background: rgba(0,0,0,0.45); border: 1px solid rgba(212,168,75,0.35);
    color: rgba(212,168,75,0.9); padding: 0.45rem 0.7rem; font-size: 0.8rem;
    letter-spacing: 0.08em; border-radius: 2px; text-transform: uppercase;
    text-shadow: 0 0 8px rgba(212,168,75,0.25); pointer-events: none;
  `;
  container.appendChild(buildBadgeEl);

  // ── Build menu buttons ───────────────────────────────────────────────────
  function createMenuButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: transparent; border: 1px solid rgba(212,168,75,0.4);
      color: #d4a84b; padding: 0.9rem 4rem; font-size: 1.2rem;
      font-family: 'Cinzel', serif; font-weight: 400; cursor: pointer; transition: all 0.25s;
      border-radius: 2px; letter-spacing: 0.14em; text-transform: uppercase;
      min-width: 280px;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(212,168,75,0.12)';
      btn.style.borderColor = 'rgba(212,168,75,0.8)';
      btn.style.textShadow = '0 0 12px rgba(212,168,75,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.borderColor = 'rgba(212,168,75,0.4)';
      btn.style.textShadow = 'none';
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  const btnPlay = createMenuButton('Play', showSaveSlots);
  const btnSettings = createMenuButton('Settings', showSettings);
  const btnCustomCampaigns = createMenuButton('Custom Campaigns', showCustomCampaigns);
  const btnExit = createMenuButton('Exit', () => {
    window.close();
  });

  menuEl.appendChild(btnPlay);
  menuEl.appendChild(btnCustomCampaigns);
  menuEl.appendChild(btnSettings);
  menuEl.appendChild(btnExit);

  // ── Transition: title → menu ─────────────────────────────────────────────
  let hasShownMenu = false;

  function transitionToMenu(): void {
    if (hasShownMenu) return;
    hasShownMenu = true;

    // Enter fullscreen when the player dismisses the "Press any key" gate.
    // This is invoked from keydown/click handlers, so it satisfies browser
    // user-gesture requirements. Ignore failures (unsupported/blocked).
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }

    // Switch to blurred background at the same frame
    isBlurred = true;

    // Try playing music on interaction
    tryPlayMusic();

    // Hide title, show menu
    titleEl.style.opacity = '0';
    titleEl.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => {
      titleEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 500);
  }

  function onAnyKey(e: KeyboardEvent): void {
    if (hasShownMenu) return;
    e.preventDefault();
    transitionToMenu();
  }

  function onAnyClick(): void {
    if (hasShownMenu) return;
    transitionToMenu();
  }

  // ── Save slots screen ────────────────────────────────────────────────────
  function showSaveSlots(): void {
    menuEl.style.opacity = '0';
    setTimeout(() => {
      menuEl.style.display = 'none';
      buildSaveSlotUI();
      saveSlotsEl.style.display = 'flex';
      requestAnimationFrame(() => {
        saveSlotsEl.style.opacity = '1';
      });
    }, 300);
  }

  function showMenuFromSlots(): void {
    saveSlotsEl.style.opacity = '0';
    setTimeout(() => {
      saveSlotsEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 300);
  }

  function showSettings(): void {
    menuEl.style.opacity = '0';
    setTimeout(() => {
      menuEl.style.display = 'none';
      buildSettingsUI(settingsEl, showMenuFromSettings);
      settingsEl.style.display = 'flex';
      requestAnimationFrame(() => {
        settingsEl.style.opacity = '1';
      });
    }, 300);
  }

  function showMenuFromSettings(): void {
    settingsEl.style.opacity = '0';
    setTimeout(() => {
      settingsEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 300);
  }

  function showCustomCampaigns(): void {
    menuEl.style.opacity = '0';
    setTimeout(() => {
      menuEl.style.display = 'none';
      void buildCustomCampaignsUI();
      customCampaignsEl.style.display = 'flex';
      requestAnimationFrame(() => {
        customCampaignsEl.style.opacity = '1';
      });
    }, 300);
  }

  function showMenuFromCustomCampaigns(): void {
    customCampaignsEl.style.opacity = '0';
    setTimeout(() => {
      customCampaignsEl.style.display = 'none';
      menuEl.style.display = 'flex';
      requestAnimationFrame(() => {
        menuEl.style.opacity = '1';
      });
    }, 300);
  }

  async function buildCustomCampaignsUI(): Promise<void> {
    customCampaignsEl.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Custom Campaigns';
    heading.style.cssText = `
      color: #d4a84b; font-size: 1.8rem; margin-bottom: 0.3rem;
      text-shadow: 0 0 20px rgba(212,168,75,0.3);
      letter-spacing: 0.06em; font-weight: 400;
    `;
    customCampaignsEl.appendChild(heading);

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
    createNewBtn.addEventListener('click', showCreateNewCampaignDialog);
    customCampaignsEl.appendChild(createNewBtn);

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
          void buildCustomCampaignsUI();
        };
        reader.readAsText(file);
      });
      input.click();
    });
    customCampaignsEl.appendChild(importBtn);

    // ── Campaign list ────────────────────────────────────────────────────────
    const loadingEl = document.createElement('div');
    loadingEl.textContent = 'Loading campaigns…';
    loadingEl.style.cssText = `color: rgba(212,168,75,0.7); font-size: 0.9rem; margin-bottom: 0.5rem;`;
    customCampaignsEl.appendChild(loadingEl);

    let sources: CampaignSource[];
    try {
      sources = await listAllCampaignSources();
    } catch {
      sources = [];
    }
    customCampaignsEl.removeChild(loadingEl);

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
      customCampaignsEl.appendChild(empty);
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
              void buildCustomCampaignsUI();
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
      customCampaignsEl.appendChild(listPanel);
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
    backBtn.addEventListener('click', showMenuFromCustomCampaigns);
    customCampaignsEl.appendChild(backBtn);
  }

  // ── Create New Campaign dialog ────────────────────────────────────────────

  function showCreateNewCampaignDialog(): void {
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
    customCampaignsEl.appendChild(overlay);
  }

  function buildSaveSlotUI(): void {
    saveSlotsEl.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Select Save Slot';
    heading.style.cssText = `
      color: #d4a84b; font-size: 1.8rem; margin-bottom: 0.6rem;
      text-shadow: 0 0 20px rgba(212,168,75,0.3);
      letter-spacing: 0.06em; font-weight: 400;
    `;
    saveSlotsEl.appendChild(heading);

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
        buildSaveSlotUI();
      });

      panelEl.addEventListener('click', (e) => e.stopPropagation());
      confirmOverlayEl.addEventListener('click', () => {
        if (confirmOverlayEl.parentElement !== null) {
          confirmOverlayEl.parentElement.removeChild(confirmOverlayEl);
        }
      });

      confirmOverlayEl.appendChild(panelEl);
      saveSlotsEl.appendChild(confirmOverlayEl);
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
        slotBtn.innerHTML = `
          <div style="font-size: 1.1rem; letter-spacing: 0.1em; margin-bottom: 0.4rem; font-weight: 400;">
            Save Slot ${i + 1}
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
        let data = slotData;
        if (data === null) {
          data = createNewSaveSlot();
          saveSaveSlot(slotIndex, data);
        }
        callbacks.onPlay(slotIndex, data);
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
      saveSlotsEl.appendChild(slotRowEl);
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
    backBtn.addEventListener('click', showMenuFromSlots);
    saveSlotsEl.appendChild(backBtn);
  }

  // ── Animation loop ───────────────────────────────────────────────────────
  function drawFrame(timestampMs: number): void {
    if (!isRunning) return;

    if (lastFrameTimeMs === 0) lastFrameTimeMs = timestampMs;

    const elapsedMs = timestampMs - lastFrameTimeMs;
    if (elapsedMs >= FRAME_INTERVAL_MS) {
      const framesToAdvance = Math.floor(elapsedMs / FRAME_INTERVAL_MS);
      frameIndex = (frameIndex + framesToAdvance) % FRAME_COUNT;
      lastFrameTimeMs += framesToAdvance * FRAME_INTERVAL_MS;

      const frames = isBlurred ? blurred : normal;
      const img = frames[frameIndex];
      if (img.complete && img.naturalWidth > 0) {
        const cw = bgCanvas.width;
        const ch = bgCanvas.height;
        bgCtx.clearRect(0, 0, cw, ch);

        // Cover-fill: scale to fill canvas while maintaining aspect ratio
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;
        bgCtx.drawImage(img, dx, dy, dw, dh);
      }
    }

    rafHandle = requestAnimationFrame(drawFrame);
  }

  // ── Mount & start ────────────────────────────────────────────────────────
  root.appendChild(bgCanvas);
  root.appendChild(container);

  isRunning = true;
  rafHandle = requestAnimationFrame(drawFrame);

  // Fade in the title after a brief delay
  setTimeout(() => {
    if (!isDestroyed) {
      titleEl.style.opacity = '1';
    }
  }, 100);

  // Try auto-playing music (will likely need user interaction)
  tryPlayMusic();

  window.addEventListener('keydown', onAnyKey);
  container.addEventListener('click', onAnyClick);
  window.addEventListener('resize', resizeBgCanvas);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  return () => {
    isDestroyed = true;
    isRunning = false;
    if (rafHandle !== 0) {
      cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }
    music.pause();
    music.src = '';
    window.removeEventListener('keydown', onAnyKey);
    container.removeEventListener('click', onAnyClick);
    window.removeEventListener('resize', resizeBgCanvas);
    if (bgCanvas.parentElement !== null) bgCanvas.parentElement.removeChild(bgCanvas);
    if (container.parentElement !== null) container.parentElement.removeChild(container);
  };
}
