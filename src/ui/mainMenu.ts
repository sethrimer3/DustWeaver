import { DecorativeParticleBackground } from '../render/decorativeParticles';

export interface MainMenuCallbacks {
  onPlay: () => void;
}

export function showMainMenu(root: HTMLElement, callbacks: MainMenuCallbacks): () => void {
  const bg = new DecorativeParticleBackground('menu');
  bg.resize(window.innerWidth, window.innerHeight);

  function onResize(): void {
    bg.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  const el = document.createElement('div');
  el.id = 'main-menu';
  el.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #fff; font-family: monospace;
  `;
  el.innerHTML = `
    <h1 style="font-size:3.5rem; color:#00cfff; text-shadow: 0 0 30px #00cfff, 0 0 60px rgba(0,207,255,0.4); margin-bottom: 0.5rem; letter-spacing: 0.06em;">
      DustWeaver
    </h1>
    <p style="color:#88aacc; margin-bottom: 3rem; font-size: 1rem; letter-spacing: 0.1em; opacity: 0.85;">
      A particle physics RPG
    </p>
    <button id="btn-play" style="
      background: transparent; border: 2px solid #00cfff; color: #00cfff;
      padding: 1rem 3.5rem; font-size: 1.25rem; font-family: monospace;
      cursor: pointer; transition: all 0.2s; border-radius: 4px;
      letter-spacing: 0.12em;
      box-shadow: 0 0 16px rgba(0,207,255,0.3);
    ">PLAY</button>
    <p style="position:absolute; bottom:1rem; color:rgba(255,255,255,0.2); font-size:0.7rem;">
      Particle Physics &amp; Euclidean Fluid Dynamics
    </p>
  `;

  root.appendChild(bg.canvas);
  root.appendChild(el);
  bg.start();

  const btn = el.querySelector('#btn-play') as HTMLButtonElement;
  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#00cfff';
    btn.style.color = '#000';
    btn.style.boxShadow = '0 0 28px rgba(0,207,255,0.7)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'transparent';
    btn.style.color = '#00cfff';
    btn.style.boxShadow = '0 0 16px rgba(0,207,255,0.3)';
  });
  btn.addEventListener('click', callbacks.onPlay);

  return () => {
    bg.stop();
    window.removeEventListener('resize', onResize);
    if (bg.canvas.parentElement !== null) bg.canvas.parentElement.removeChild(bg.canvas);
    if (el.parentElement !== null) el.parentElement.removeChild(el);
  };
}
