import { PlayerProgress } from '../progression/playerProgress';
import { WORLD1_LEVELS } from '../levels/world1';
import { LevelDef } from '../levels/levelDef';
import { DecorativeParticleBackground } from '../render/decorativeParticles';

export interface WorldMapCallbacks {
  onStartLevel: (progress: PlayerProgress, level: LevelDef) => void;
}

const THEME_COLORS: Record<string, { border: string; text: string; glow: string }> = {
  physical: { border: '#aabbcc', text: '#aabbcc', glow: 'rgba(170,187,204,0.25)' },
  water:    { border: '#33aaff', text: '#33aaff', glow: 'rgba(51,170,255,0.25)'  },
  ice:      { border: '#aaeeff', text: '#aaeeff', glow: 'rgba(170,238,255,0.30)' },
  boss:     { border: '#ff4444', text: '#ff4444', glow: 'rgba(255,68,68,0.35)'   },
};

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
    padding-top: 2rem;
    color: #fff; font-family: monospace;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'text-align: center; margin-bottom: 1.5rem; z-index: 1;';
  header.innerHTML = `
    <h2 style="font-size:2rem; color:#00cfff; text-shadow:0 0 18px #00cfff; margin:0 0 0.25rem;">
      World 1 — The Tideworn Keep
    </h2>
    <p style="color:#88aacc; font-size:0.85rem; margin:0;">
      Player Level ${progress.level} &nbsp;|&nbsp; ${progress.dustSlots} dust slots
    </p>
  `;
  el.appendChild(header);

  const grid = document.createElement('div');
  grid.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 1.2rem;
    justify-content: center; max-width: 720px; z-index: 1;
  `;
  el.appendChild(grid);

  const msgEl = document.createElement('p');
  msgEl.style.cssText = 'margin-top: 1.5rem; color: #aaa; height: 1.5rem; font-size: 0.9rem; z-index: 1;';
  el.appendChild(msgEl);

  const hint = document.createElement('p');
  hint.style.cssText = `
    position: absolute; bottom: 1rem; color: rgba(255,255,255,0.25);
    font-size: 0.75rem; z-index: 1;
  `;
  hint.textContent = 'Complete levels to unlock new ones';
  el.appendChild(hint);

  for (let i = 0; i < WORLD1_LEVELS.length; i++) {
    const lvl = WORLD1_LEVELS[i];
    const isUnlocked = i < progress.world1UnlockedCount;
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
        W1-L${lvl.levelNumber}${isBoss ? ' ★ BOSS' : ''}
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
