export interface MainMenuCallbacks {
  onPlay: () => void;
}

export function showMainMenu(root: HTMLElement, callbacks: MainMenuCallbacks): () => void {
  const el = document.createElement('div');
  el.id = 'main-menu';
  el.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.85); color: #fff; font-family: monospace;
  `;
  el.innerHTML = `
    <h1 style="font-size:3rem; color:#00cfff; text-shadow: 0 0 20px #00cfff; margin-bottom: 2rem;">DustWeaver</h1>
    <p style="color:#aaa; margin-bottom: 3rem; font-size: 1rem;">A particle physics RPG</p>
    <button id="btn-play" style="
      background: transparent; border: 2px solid #00cfff; color: #00cfff;
      padding: 1rem 3rem; font-size: 1.2rem; font-family: monospace;
      cursor: pointer; transition: all 0.2s;
    ">PLAY</button>
  `;

  root.appendChild(el);

  const btn = el.querySelector('#btn-play') as HTMLButtonElement;
  btn.addEventListener('mouseenter', () => { btn.style.background = '#00cfff'; btn.style.color = '#000'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#00cfff'; });
  btn.addEventListener('click', callbacks.onPlay);

  return () => {
    root.removeChild(el);
  };
}
