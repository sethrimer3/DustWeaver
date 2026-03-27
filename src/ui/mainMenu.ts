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
  formatPlayTimeMs,
  formatLastPlayed,
  SaveSlotData,
} from '../progression/saveSlots';

// ─── Constants ───────────────────────────────────────────────────────────────

const FRAME_COUNT = 300;
const ANIMATION_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / ANIMATION_FPS;

/** Vite base URL so public assets resolve correctly. */
const BASE = import.meta.env.BASE_URL;

// ─── Callbacks ───────────────────────────────────────────────────────────────

export interface MainMenuCallbacks {
  onPlay: (slotIndex: number, saveData: SaveSlotData) => void;
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
  const btnSettings = createMenuButton('Settings', () => { /* placeholder */ });
  const btnExit = createMenuButton('Exit', () => {
    window.close();
  });

  menuEl.appendChild(btnPlay);
  menuEl.appendChild(btnSettings);
  menuEl.appendChild(btnExit);

  // ── Transition: title → menu ─────────────────────────────────────────────
  let hasShownMenu = false;

  function transitionToMenu(): void {
    if (hasShownMenu) return;
    hasShownMenu = true;

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

    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
      const slotData = loadSaveSlot(i);
      const hasData = slotData !== null;

      const slotBtn = document.createElement('button');
      slotBtn.style.cssText = `
        background: rgba(0,0,0,0.5); border: 1px solid rgba(212,168,75,0.3);
        color: #d4a84b; padding: 1.2rem 2rem;
        font-family: 'Cinzel', serif; font-weight: 400; cursor: pointer; transition: all 0.25s;
        border-radius: 3px; min-width: 340px; text-align: center;
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

      saveSlotsEl.appendChild(slotBtn);
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
