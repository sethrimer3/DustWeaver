import { PlayerProgress } from '../progression/playerProgress';

export interface WorldMapCallbacks {
  onStartLevel: (progress: PlayerProgress) => void;
}

export function showWorldMap(
  root: HTMLElement,
  progress: PlayerProgress,
  callbacks: WorldMapCallbacks,
): () => void {
  const el = document.createElement('div');
  el.id = 'world-map';
  el.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.85); color: #fff; font-family: monospace;
  `;
  el.innerHTML = `
    <h2 style="font-size: 2rem; color: #00cfff; margin-bottom: 0.5rem;">World Map</h2>
    <p style="color:#888; font-size:0.85rem; margin-bottom:2rem;">
      Level ${progress.level} &nbsp;|&nbsp; ${progress.dustSlots} dust slots available
    </p>
    <div style="display: flex; gap: 2rem;">
      <button id="btn-lobby" style="
        background: transparent; border: 2px solid #888; color: #888;
        padding: 1rem 2rem; font-size: 1rem; font-family: monospace; cursor: pointer;
      ">Lobby</button>
      <button id="btn-w1l1" style="
        background: transparent; border: 2px solid #00cfff; color: #00cfff;
        padding: 1rem 2rem; font-size: 1rem; font-family: monospace; cursor: pointer;
      ">World 1 - Level 1</button>
    </div>
    <p id="map-message" style="margin-top: 2rem; color: #aaa; height: 1.5rem;"></p>
  `;

  root.appendChild(el);

  const btnLobby = el.querySelector('#btn-lobby') as HTMLButtonElement;
  const btnW1L1 = el.querySelector('#btn-w1l1') as HTMLButtonElement;
  const mapMessage = el.querySelector('#map-message') as HTMLParagraphElement;

  btnLobby.addEventListener('click', () => {
    mapMessage.textContent = 'Lobby - Coming Soon';
  });

  btnW1L1.addEventListener('click', () => {
    callbacks.onStartLevel(progress);
  });

  return () => {
    root.removeChild(el);
  };
}
