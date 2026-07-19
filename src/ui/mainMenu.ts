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

import type { SaveSlotData } from '../progression/saveSlots';
import { BUILD_NUMBER } from '../build-info';
import { buildSettingsUI } from './mainMenuSettings';
import type { CampaignSource } from '../levels/campaignSource';
import type { EditableCampaignSession } from '../editor/editableCampaignSession';
import { buildCustomCampaignsUI } from './mainMenuCustomCampaigns';
import { buildSaveSlotUI } from './mainMenuSaveSlots';
import { MENU_ANIMATION_ASSETS } from './animatedAssetPaths';
import { createMenuAnimatedBackground } from './menuAnimatedBackground';
import { createMusicManager } from '../audio/musicManager';
import { getMusicVolume } from './renderSettings';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Vite base URL so public assets resolve correctly. */
const BASE = import.meta.env.BASE_URL;
const DISCORD_INVITE_URL = 'https://discord.gg/dSwR3Fj7du';

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
// ─── Public entry point ──────────────────────────────────────────────────────

export function showMainMenu(root: HTMLElement, callbacks: MainMenuCallbacks): () => void {
  // ── State ────────────────────────────────────────────────────────────────
  let isDestroyed = false;

  // ── Preload frames ───────────────────────────────────────────────────────
  const animatedBackground = createMenuAnimatedBackground({
    normalUrl: MENU_ANIMATION_ASSETS.normalUrl,
    blurredUrl: MENU_ANIMATION_ASSETS.blurredUrl,
    zIndex: 0,
  });

  // ── Background canvas ────────────────────────────────────────────────────
  // ── Music ────────────────────────────────────────────────────────────────
  const music = createMusicManager(BASE);
  music.setVolume(getMusicVolume());
  music.notifyRoomEntered('titleMenu');

  /** Try to play music; browsers may block autoplay until interaction. */
  function tryPlayMusic(): void {
    if (!isDestroyed) music.notifyRoomEntered('titleMenu');
  }

  // ── UI container ─────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.id = 'main-menu';
  container.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    overflow-y: auto; box-sizing: border-box; padding: clamp(0.5rem, 2vh, 1.5rem) 1rem;
    color: #fff; font-family: 'Cinzel', serif; z-index: 1;
  `;

  // ── Title element (fades in) ─────────────────────────────────────────────
  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    text-align: center; opacity: 0; margin-block: auto;
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
    gap: 1.2rem; opacity: 0; transition: opacity 0.6s ease-in; margin-block: auto;
  `;
  container.appendChild(menuEl);

  // ── Save-slot container (hidden initially) ───────────────────────────────
  const saveSlotsEl = document.createElement('div');
  saveSlotsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: clamp(0.4rem, 1.6vh, 1rem); opacity: 0; transition: opacity 0.5s ease-in;
    margin-block: auto; width: min(420px, 100%);
  `;
  container.appendChild(saveSlotsEl);

  const settingsEl = document.createElement('div');
  settingsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center;
    gap: 0.8rem; opacity: 0; transition: opacity 0.5s ease-in; margin-block: auto;
  `;
  container.appendChild(settingsEl);

  const customCampaignsEl = document.createElement('div');
  customCampaignsEl.style.cssText = `
    display: none; flex-direction: column; align-items: center; margin-block: auto;
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

  const discordBtn = document.createElement('button');
  discordBtn.type = 'button';
  discordBtn.textContent = 'Discord';
  discordBtn.setAttribute('aria-label', 'Join the DustWeaver Discord server');
  discordBtn.style.cssText = `
    display: none; position: absolute; right: 1rem; bottom: 1rem;
    background: rgba(88,101,242,0.82); border: 1px solid rgba(255,255,255,0.28);
    color: #fff; padding: 0.65rem 1rem; font: 600 0.85rem 'Cinzel', serif;
    letter-spacing: 0.08em; border-radius: 4px; cursor: pointer;
    text-transform: uppercase; transition: background 0.2s, transform 0.2s;
  `;
  discordBtn.addEventListener('mouseenter', () => {
    discordBtn.style.background = 'rgba(88,101,242,1)';
    discordBtn.style.transform = 'translateY(-2px)';
  });
  discordBtn.addEventListener('mouseleave', () => {
    discordBtn.style.background = 'rgba(88,101,242,0.82)';
    discordBtn.style.transform = 'none';
  });
  discordBtn.addEventListener('click', () => {
    const openExternal = window.dustweaverElectron?.openExternal;
    if (openExternal !== undefined) {
      void openExternal(DISCORD_INVITE_URL);
      return;
    }
    window.open(DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer');
  });
  container.appendChild(discordBtn);

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

    animatedBackground.showBlurred();

    // Try playing music on interaction
    tryPlayMusic();

    // Hide title, show menu
    titleEl.style.opacity = '0';
    titleEl.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => {
      titleEl.style.display = 'none';
      menuEl.style.display = 'flex';
      discordBtn.style.display = 'block';
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
      buildSaveSlotUI(saveSlotsEl, callbacks, showMenuFromSlots);
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
      buildSettingsUI(settingsEl, showMenuFromSettings, (v) => music.setVolume(v));
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
      void buildCustomCampaignsUI(customCampaignsEl, callbacks, showMenuFromCustomCampaigns);
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

  // ── Animation loop ───────────────────────────────────────────────────────
  // ── Mount & start ────────────────────────────────────────────────────────
  root.appendChild(animatedBackground.element);
  root.appendChild(container);

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

  // ── Cleanup ──────────────────────────────────────────────────────────────
  return () => {
    isDestroyed = true;
    music.dispose();
    window.removeEventListener('keydown', onAnyKey);
    container.removeEventListener('click', onAnyClick);
    animatedBackground.destroy();
    if (container.parentElement !== null) container.parentElement.removeChild(container);
  };
}
