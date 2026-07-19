export interface SlideReveal {
  element: HTMLDivElement;
  content: HTMLDivElement;
  setExpanded: (expanded: boolean) => void;
}

/**
 * Wraps conditional menu controls in a height-safe slide transition.
 * CSS grid can animate between zero and the content's natural height, so
 * nested sections and responsive controls do not need measured pixel values.
 */
export function createSlideReveal(initiallyExpanded: boolean): SlideReveal {
  const element = document.createElement('div');
  const content = document.createElement('div');

  element.style.cssText = `
    display: grid;
    grid-template-rows: ${initiallyExpanded ? '1fr' : '0fr'};
    opacity: ${initiallyExpanded ? '1' : '0'};
    transition: grid-template-rows 220ms ease, opacity 180ms ease;
  `;
  content.style.cssText = `
    min-height: 0;
    overflow: hidden;
    transform: translateY(${initiallyExpanded ? '0' : '-8px'});
    transition: transform 220ms ease;
  `;
  element.appendChild(content);

  const setExpanded = (expanded: boolean): void => {
    element.style.gridTemplateRows = expanded ? '1fr' : '0fr';
    element.style.opacity = expanded ? '1' : '0';
    element.style.pointerEvents = expanded ? 'auto' : 'none';
    element.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    content.style.transform = expanded ? 'translateY(0)' : 'translateY(-8px)';
  };

  setExpanded(initiallyExpanded);
  return { element, content, setExpanded };
}
