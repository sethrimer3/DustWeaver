const NAV_AXIS_THRESHOLD = 0.55;
const NAV_REPEAT_DELAY_MS = 360;
const NAV_REPEAT_INTERVAL_MS = 120;

export type ControllerMenuAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate'
  | 'back';

export interface ControllerMenuGamepadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

function isPressed(gamepad: ControllerMenuGamepadSnapshot, index: number): boolean {
  const button = gamepad.buttons[index];
  return button !== undefined && (button.pressed || button.value > 0.5);
}

/** Converts a standard-layout gamepad sample into held menu actions. */
export function getHeldControllerMenuActions(
  gamepad: ControllerMenuGamepadSnapshot,
): ReadonlySet<ControllerMenuAction> {
  const actions = new Set<ControllerMenuAction>();
  const horizontal = gamepad.axes[0] ?? 0;
  const vertical = gamepad.axes[1] ?? 0;
  if (vertical < -NAV_AXIS_THRESHOLD || isPressed(gamepad, 12)) actions.add('up');
  if (vertical > NAV_AXIS_THRESHOLD || isPressed(gamepad, 13)) actions.add('down');
  if (horizontal < -NAV_AXIS_THRESHOLD || isPressed(gamepad, 14)) actions.add('left');
  if (horizontal > NAV_AXIS_THRESHOLD || isPressed(gamepad, 15)) actions.add('right');
  if (isPressed(gamepad, 0)) actions.add('activate');
  if (isPressed(gamepad, 1)) actions.add('back');
  return actions;
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity) > 0
    && rect.width > 0
    && rect.height > 0;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), '
    + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(candidates).filter(isVisible);
}

function focusElement(element: HTMLElement): void {
  document.querySelectorAll('.dw-controller-focused').forEach(
    focused => focused.classList.remove('dw-controller-focused'),
  );
  element.classList.add('dw-controller-focused');
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function findDirectionalTarget(
  current: HTMLElement,
  candidates: readonly HTMLElement[],
  direction: 'up' | 'down' | 'left' | 'right',
): HTMLElement | null {
  const currentRect = current.getBoundingClientRect();
  const currentX = currentRect.left + currentRect.width * 0.5;
  const currentY = currentRect.top + currentRect.height * 0.5;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.5;
    const dx = x - currentX;
    const dy = y - currentY;
    const primary = direction === 'up' ? -dy
      : direction === 'down' ? dy
      : direction === 'left' ? -dx
      : dx;
    if (primary <= 1) continue;
    const secondary = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = primary + secondary * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function adjustFocusedControl(element: HTMLElement, direction: -1 | 1): boolean {
  if (element instanceof HTMLInputElement && element.type === 'range') {
    const step = element.step === 'any' ? 1 : Number(element.step || 1);
    const min = Number(element.min || 0);
    const max = Number(element.max || 100);
    element.value = String(Math.min(max, Math.max(min, Number(element.value) + step * direction)));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLSelectElement) {
    const nextIndex = Math.min(
      element.options.length - 1,
      Math.max(0, element.selectedIndex + direction),
    );
    if (nextIndex !== element.selectedIndex) {
      element.selectedIndex = nextIndex;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  return false;
}

function activateBackControl(root: HTMLElement): void {
  const explicitBack = getFocusableElements(root).find(
    element => element.dataset.controllerBack === 'true',
  );
  if (explicitBack !== undefined) {
    explicitBack.click();
    return;
  }
  const fallback = getFocusableElements(root).find(element => {
    const text = element.textContent?.trim().toLowerCase() ?? '';
    return text === 'back' || text === 'cancel' || text === 'atrás' || text === 'cancelar';
  });
  fallback?.click();
}

/**
 * Adds standard controller navigation to a DOM menu tree.
 * D-pad/left stick navigate, A activates, and B invokes the current Back control.
 */
export function createControllerMenuNavigation(
  root: HTMLElement,
  onInitialInput: () => void,
): () => void {
  const style = document.createElement('style');
  style.textContent = `
    #main-menu .dw-controller-focused {
      outline: 3px solid #f2cc69 !important;
      outline-offset: 3px;
      box-shadow: 0 0 18px rgba(212, 168, 75, 0.75) !important;
    }
  `;
  document.head.appendChild(style);

  let rafId = 0;
  let previousActions = new Set<ControllerMenuAction>();
  const repeatStartedAt = new Map<ControllerMenuAction, number>();
  const lastRepeatedAt = new Map<ControllerMenuAction, number>();

  function runAction(action: ControllerMenuAction): void {
    onInitialInput();
    const candidates = getFocusableElements(root);
    if (candidates.length === 0) return;
    let current = document.activeElement instanceof HTMLElement
      && candidates.includes(document.activeElement)
      ? document.activeElement
      : null;
    if (current === null) {
      focusElement(candidates[0]);
      current = candidates[0];
      if (action !== 'activate' && action !== 'back') return;
    }

    if (action === 'activate') {
      current.click();
      return;
    }
    if (action === 'back') {
      activateBackControl(root);
      return;
    }
    if ((action === 'left' || action === 'right')
      && adjustFocusedControl(current, action === 'left' ? -1 : 1)) {
      return;
    }
    const target = findDirectionalTarget(current, candidates, action);
    if (target !== null) focusElement(target);
  }

  function frame(timestampMs: number): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const gamepad = Array.from(pads).find(pad => pad?.connected) ?? null;
    const held = gamepad === null
      ? new Set<ControllerMenuAction>()
      : new Set(getHeldControllerMenuActions(gamepad));

    for (const action of held) {
      const isNewPress = !previousActions.has(action);
      if (isNewPress) {
        runAction(action);
        repeatStartedAt.set(action, timestampMs);
        lastRepeatedAt.set(action, timestampMs);
      } else if (action !== 'activate' && action !== 'back') {
        const startedAt = repeatStartedAt.get(action) ?? timestampMs;
        const repeatedAt = lastRepeatedAt.get(action) ?? timestampMs;
        if (timestampMs - startedAt >= NAV_REPEAT_DELAY_MS
          && timestampMs - repeatedAt >= NAV_REPEAT_INTERVAL_MS) {
          runAction(action);
          lastRepeatedAt.set(action, timestampMs);
        }
      }
    }
    previousActions = held;
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(rafId);
    style.remove();
    document.querySelectorAll('.dw-controller-focused').forEach(
      focused => focused.classList.remove('dw-controller-focused'),
    );
  };
}
