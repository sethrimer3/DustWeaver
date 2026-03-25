import { PlayerProgress } from '../progression/playerProgress';
import { WORLD1_LEVELS } from '../levels/world1';
import { WORLD2_LEVELS } from '../levels/world2';
import { LevelDef } from '../levels/levelDef';
import { DecorativeParticleBackground } from '../render/decorativeParticles';

export interface WorldMapCallbacks {
  onStartLevel: (progress: PlayerProgress, level: LevelDef) => void;
}

const THEME_COLORS: Record<string, { border: string; text: string; glow: string }> = {
  physical: { border: '#aabbcc', text: '#aabbcc', glow: 'rgba(170,187,204,0.25)' },
  water:    { border: '#33aaff', text: '#33aaff', glow: 'rgba(51,170,255,0.25)'  },
  ice:      { border: '#aaeeff', text: '#aaeeff', glow: 'rgba(170,238,255,0.30)' },
  fire:     { border: '#ff6622', text: '#ff6622', glow: 'rgba(255,102,34,0.30)'  },
  lava:     { border: '#ff3300', text: '#ff3300', glow: 'rgba(255,51,0,0.35)'    },
  stone:    { border: '#aaaacc', text: '#aaaacc', glow: 'rgba(170,170,204,0.25)' },
  metal:    { border: '#99bbdd', text: '#99bbdd', glow: 'rgba(153,187,221,0.25)' },
  boss:     { border: '#ff4444', text: '#ff4444', glow: 'rgba(255,68,68,0.35)'   },
};

/** Builds a grid of level buttons for the given world. */
function buildWorldGrid(
  levels: LevelDef[],
  unlockedCount: number,
  progress: PlayerProgress,
  msgEl: HTMLElement,
  callbacks: WorldMapCallbacks,
): HTMLElement {
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 1rem;
    justify-content: center; max-width: 720px;
  `;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const isUnlocked = i < unlockedCount;
    const tc = THEME_COLORS[lvl.theme] ?? THEME_COLORS['physical'];
    const isBoss = lvl.theme === 'boss';

    const btn = document.createElement('button');
    btn.disabled = !isUnlocked;
    btn.style.cssText = `
      background: rgba(0,0,0,0.55); border: 2px solid ${isUnlocked ? tc.border : '#333'};
      color: ${isUnlocked ? tc.text : '#444'}; padding: 0.8rem 1.4rem;
      font-size: ${isBoss ? '1rem' : '0.9rem'}; font-family: monospace;
      cursor: ${isUnlocked ? 'pointer' : 'default'}; border-radius: 6px;
      min-width: 160px; text-align: left; transition: all 0.18s;
      box-shadow: ${isUnlocked ? `0 0 12px ${tc.glow}` : 'none'};
    `;

    btn.innerHTML = `
      <div style="font-size:0.7rem; opacity:0.65; margin-bottom:0.2rem;">
        W${lvl.worldNumber}-L${lvl.levelNumber}${isBoss ? ' ★ BOSS' : ''}
      </div>
      <div>${isUnlocked ? lvl.name : '???'}</div>
      <div style="font-size:0.65rem; opacity:0.55; margin-top:0.3rem; text-transform:uppercase;">
        ${isUnlocked ? lvl.theme : '— locked —'}
      </div>
    `;

    if (isUnlocked) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(0,0,0,0.75)';
        btn.style.boxShadow = `0 0 22px ${tc.glow}`;
        msgEl.textContent = lvl.name + (isBoss ? ' — Boss Battle!' : '');
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(0,0,0,0.55)';
        btn.style.boxShadow = `0 0 12px ${tc.glow}`;
        msgEl.textContent = '';
      });
      btn.addEventListener('click', () => {
        callbacks.onStartLevel(progress, lvl);
      });
    }

    grid.appendChild(btn);
  }

  return grid;
}

export function showWorldMap(
  root: HTMLElement,
  progress: PlayerProgress,
  callbacks: WorldMapCallbacks,
): () => void {
  const bg = new DecorativeParticleBackground('worldmap');
  bg.resize(window.innerWidth, window.innerHeight);

  function onResize(): void {
    bg.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  const el = document.createElement('div');
  el.id = 'world-map';
  el.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    padding-top: 1.5rem; padding-bottom: 2rem;
    color: #fff; font-family: monospace;
    overflow-y: auto;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'text-align: center; margin-bottom: 1rem; z-index: 1;';
  header.innerHTML = `
    <h2 style="font-size:2rem; color:#00cfff; text-shadow:0 0 18px #00cfff; margin:0 0 0.25rem;">
      World Map
    </h2>
    <p style="color:#88aacc; font-size:0.85rem; margin:0;">
      Player Level ${progress.level} &nbsp;|&nbsp; ${progress.dustSlots} dust slots
    </p>
  `;
  el.appendChild(header);

  const msgEl = document.createElement('p');
  msgEl.style.cssText = 'margin: 0.5rem 0; color: #aaa; height: 1.5rem; font-size: 0.9rem; z-index: 1;';
  el.appendChild(msgEl);

  // ── World 1 ──────────────────────────────────────────────────────────────
  const w1Header = document.createElement('div');
  w1Header.style.cssText = 'text-align:center; margin-bottom:0.6rem; z-index:1;';
  w1Header.innerHTML = `
    <h3 style="font-size:1.2rem; color:#33aaff; text-shadow:0 0 10px #33aaff; margin:0;">
      World 1 — The Tideworn Keep
    </h3>
  `;
  el.appendChild(w1Header);

  const w1Grid = buildWorldGrid(WORLD1_LEVELS, progress.world1UnlockedCount, progress, msgEl, callbacks);
  w1Grid.style.zIndex = '1';
  el.appendChild(w1Grid);

  // ── World 2 ──────────────────────────────────────────────────────────────
  const w2Header = document.createElement('div');
  w2Header.style.cssText = 'text-align:center; margin: 1.4rem 0 0.6rem; z-index:1;';
  const w2Unlocked = (progress.world2UnlockedCount ?? 0) > 0;
  w2Header.innerHTML = `
    <h3 style="font-size:1.2rem; color:${w2Unlocked ? '#ff6622' : '#555'}; text-shadow:${w2Unlocked ? '0 0 10px #ff6622' : 'none'}; margin:0;">
      World 2 — The Volcanic Depths${w2Unlocked ? '' : ' <span style="font-size:0.8rem; color:#555;">(Complete World 1 to unlock)</span>'}
    </h3>
  `;
  el.appendChild(w2Header);

  const w2Grid = buildWorldGrid(WORLD2_LEVELS, progress.world2UnlockedCount ?? 0, progress, msgEl, callbacks);
  w2Grid.style.zIndex = '1';
  el.appendChild(w2Grid);

  const hint = document.createElement('p');
  hint.style.cssText = `
    margin-top: 1.2rem; color: rgba(255,255,255,0.25);
    font-size: 0.75rem; z-index: 1;
  `;
  hint.textContent = 'Complete levels to unlock new ones';
  el.appendChild(hint);

  root.appendChild(bg.canvas);
  root.appendChild(el);
  bg.start();

  return () => {
    bg.stop();
    window.removeEventListener('resize', onResize);
    if (bg.canvas.parentElement !== null) bg.canvas.parentElement.removeChild(bg.canvas);
    if (el.parentElement !== null) el.parentElement.removeChild(el);
  };
}
