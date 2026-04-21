/**
 * Character selection screen — shown when creating a new profile.
 *
 * Displays available characters in square cards arranged horizontally.
 * The selected character is centered with a glowing golden border.
 * Navigate left/right with arrow keys or A/D to cycle through characters.
 * Press Enter or click the selected card to confirm.
 */

const CHARACTER_IDS = ['knight', 'demonFox', 'princess', 'outcast'] as const;

const CHARACTER_LABELS: Record<string, string> = {
  knight: 'Knight',
  demonFox: 'Demon Fox',
  princess: 'Princess',
  outcast: 'Outcast',
};

export interface CharacterSelectCallbacks {
  /** Called when the player confirms their character selection. */
  onConfirm: (characterId: string) => void;
  /** Called when the player cancels and returns to the menu. */
  onCancel: () => void;
}

/**
 * Shows the character selection screen inside the provided UI root.
 * Returns a cleanup function that removes all DOM elements and event listeners.
 */
export function showCharacterSelect(
  uiRoot: HTMLElement,
  callbacks: CharacterSelectCallbacks,
): () => void {
  let selectedIndex = 0;
  let isRunning = true;

  // ── Container ─────────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: radial-gradient(ellipse at center, rgba(30,25,15,0.95) 0%, rgba(10,8,4,0.98) 100%);
    font-family: 'Cinzel', serif; color: #d4a84b;
    z-index: 100;
  `;
  uiRoot.appendChild(container);

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = document.createElement('h1');
  title.textContent = 'Select Character';
  title.style.cssText = `
    color: #d4a84b; font-size: 2.2rem; margin-bottom: 2rem;
    text-shadow: 0 0 30px rgba(212,168,75,0.4);
    letter-spacing: 0.08em; font-weight: 400;
  `;
  container.appendChild(title);

  // ── Card row ──────────────────────────────────────────────────────────────
  const cardRow = document.createElement('div');
  cardRow.style.cssText = `
    display: flex; gap: 2rem; align-items: center; justify-content: center;
    margin-bottom: 2rem;
  `;
  container.appendChild(cardRow);

  // Pre-load character menu sprites for the cards (fall back to standing if no menu sprite)
  const spriteImages: HTMLImageElement[] = CHARACTER_IDS.map((id) => {
    const img = new Image();
    const menuSpriteSrc = `SPRITES/PLAYERS/${id}/${id}_menu_sprite.png`;
    const standingSrc   = `SPRITES/PLAYERS/${id}/${id}_standing.png`;
    // Try the menu sprite first; fall back to standing on error.
    img.src = menuSpriteSrc;
    img.onerror = () => { img.src = standingSrc; };
    return img;
  });

  // ── Build cards ───────────────────────────────────────────────────────────
  const cards: HTMLDivElement[] = [];
  for (let i = 0; i < CHARACTER_IDS.length; i++) {
    const card = document.createElement('div');
    card.style.cssText = `
      width: 140px; height: 140px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5);
      border: 3px solid rgba(212,168,75,0.2);
      border-radius: 6px; cursor: pointer;
      transition: all 0.25s;
      position: relative;
    `;

    // Sprite image element
    const spriteEl = document.createElement('img');
    spriteEl.src = spriteImages[i].src;
    spriteEl.style.cssText = `
      width: 80px; height: 80px;
      object-fit: contain;
      image-rendering: pixelated;
      margin-bottom: 0.5rem;
    `;
    card.appendChild(spriteEl);

    // Character name label
    const label = document.createElement('div');
    label.textContent = CHARACTER_LABELS[CHARACTER_IDS[i]] ?? CHARACTER_IDS[i];
    label.style.cssText = `
      font-size: 0.9rem; color: #d4a84b;
      letter-spacing: 0.08em; font-weight: 400;
      text-align: center;
    `;
    card.appendChild(label);

    const idx = i;
    card.addEventListener('click', () => {
      selectedIndex = idx;
      updateCards();
      confirmSelection();
    });
    card.addEventListener('mouseenter', () => {
      if (idx !== selectedIndex) {
        card.style.borderColor = 'rgba(212,168,75,0.5)';
        card.style.background = 'rgba(212,168,75,0.05)';
      }
    });
    card.addEventListener('mouseleave', () => {
      if (idx !== selectedIndex) {
        card.style.borderColor = 'rgba(212,168,75,0.2)';
        card.style.background = 'rgba(0,0,0,0.5)';
      }
    });

    cards.push(card);
    cardRow.appendChild(card);
  }

  // ── Navigation hint ───────────────────────────────────────────────────────
  const hint = document.createElement('div');
  hint.textContent = '← A/D or Arrow Keys to select · Enter to confirm →';
  hint.style.cssText = `
    font-size: 0.75rem; color: rgba(212,168,75,0.4);
    letter-spacing: 0.06em; margin-bottom: 1.5rem;
  `;
  container.appendChild(hint);

  // ── Confirm button ────────────────────────────────────────────────────────
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Confirm';
  confirmBtn.style.cssText = `
    background: rgba(212,168,75,0.08); border: 1px solid rgba(212,168,75,0.5);
    color: #d4a84b; padding: 0.8rem 3rem; font-size: 1.1rem;
    font-family: 'Cinzel', serif; cursor: pointer; transition: all 0.25s;
    border-radius: 3px; letter-spacing: 0.1em; margin-bottom: 0.8rem;
  `;
  confirmBtn.addEventListener('mouseenter', () => {
    confirmBtn.style.background = 'rgba(212,168,75,0.15)';
    confirmBtn.style.borderColor = 'rgba(212,168,75,0.8)';
  });
  confirmBtn.addEventListener('mouseleave', () => {
    confirmBtn.style.background = 'rgba(212,168,75,0.08)';
    confirmBtn.style.borderColor = 'rgba(212,168,75,0.5)';
  });
  confirmBtn.addEventListener('click', confirmSelection);
  container.appendChild(confirmBtn);

  // ── Back button ───────────────────────────────────────────────────────────
  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back';
  backBtn.style.cssText = `
    background: transparent; border: 1px solid rgba(212,168,75,0.25);
    color: rgba(212,168,75,0.6); padding: 0.6rem 2.5rem; font-size: 0.9rem;
    font-family: 'Cinzel', serif; cursor: pointer; transition: all 0.25s;
    border-radius: 2px; letter-spacing: 0.1em;
  `;
  backBtn.addEventListener('mouseenter', () => {
    backBtn.style.borderColor = 'rgba(212,168,75,0.6)';
    backBtn.style.color = '#d4a84b';
  });
  backBtn.addEventListener('mouseleave', () => {
    backBtn.style.borderColor = 'rgba(212,168,75,0.25)';
    backBtn.style.color = 'rgba(212,168,75,0.6)';
  });
  backBtn.addEventListener('click', () => {
    if (!isRunning) return;
    callbacks.onCancel();
  });
  container.appendChild(backBtn);

  // ── Card update (golden glow on selected) ─────────────────────────────────
  function updateCards(): void {
    for (let i = 0; i < cards.length; i++) {
      if (i === selectedIndex) {
        cards[i].style.borderColor = '#d4a84b';
        cards[i].style.background = 'rgba(212,168,75,0.1)';
        cards[i].style.boxShadow = '0 0 20px rgba(212,168,75,0.4), inset 0 0 15px rgba(212,168,75,0.1)';
      } else {
        cards[i].style.borderColor = 'rgba(212,168,75,0.2)';
        cards[i].style.background = 'rgba(0,0,0,0.5)';
        cards[i].style.boxShadow = 'none';
      }
    }
  }

  function confirmSelection(): void {
    if (!isRunning) return;
    callbacks.onConfirm(CHARACTER_IDS[selectedIndex]);
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent): void {
    if (!isRunning) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      selectedIndex = (selectedIndex - 1 + CHARACTER_IDS.length) % CHARACTER_IDS.length;
      updateCards();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      selectedIndex = (selectedIndex + 1) % CHARACTER_IDS.length;
      updateCards();
    } else if (e.key === 'Enter') {
      confirmSelection();
    } else if (e.key === 'Escape') {
      callbacks.onCancel();
    }
  }

  window.addEventListener('keydown', onKeyDown);
  updateCards();

  // ── Cleanup ───────────────────────────────────────────────────────────────
  return () => {
    isRunning = false;
    window.removeEventListener('keydown', onKeyDown);
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
  };
}
