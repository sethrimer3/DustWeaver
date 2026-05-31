/**
 * Self-contained loading overlay shown while room sprites are loading.
 *
 * Displayed immediately over the game viewport; fades out and removes itself
 * once the readiness check passes and the minimum display time has elapsed.
 *
 * Usage:
 *   const overlay = new GameLoadingOverlay(uiRoot);
 *   overlay.show();                // normal loading overlay ("Loading…")
 *   overlay.show(true);            // initial campaign load — longer, deliberate fade-in
 *   overlay.showEntryWarm();       // instant cache-hit entry warm — textless, instant release
 *   // Each frame:
 *   overlay.tick(() => areRoomSpritesReady(currentRoom));
 */

import { LOADING_ANIMATION_ASSETS, MENU_ANIMATION_ASSETS } from '../ui/animatedAssetPaths';

/** How often (ms) the readiness callback is polled to avoid per-frame DOM reads. */
const CHECK_INTERVAL_MS = 50;

/** Minimum time (ms) the overlay is shown to avoid a flash on fast loads. */
const MIN_SHOW_MS = 200;

/**
 * Fade-out duration (ms) for the standard loading overlay (room sprite cache miss).
 * Short so it does not feel like a loading screen on mid-session room loads.
 */
const FADE_DURATION_STANDARD_MS = 300;

/**
 * Fade-out duration (ms) for the initial campaign load.
 * Longer so the transition from the splash/loading screen to gameplay feels
 * intentional — a cinematic "fade from black" rather than a visual flash.
 */
const FADE_DURATION_CAMPAIGN_START_MS = 700;

/**
 * Fade-out duration (ms) for the instant cache-hit entry warm cover.
 * Kept very short so the transition feel is a brief moment rather than a
 * loading screen.  The overlay has no text.
 */
const FADE_DURATION_ENTRY_WARM_MS = 80;

export class GameLoadingOverlay {
  private el: HTMLDivElement | null = null;
  private minShowUntilMs = 0;
  private lastCheckMs = 0;
  private fadeDurationMs = FADE_DURATION_STANDARD_MS;
  /** Per-show readiness poll interval (ms). 0 = check every tick. */
  private checkIntervalMs = CHECK_INTERVAL_MS;

  constructor(private readonly uiRoot: HTMLElement) {}

  /**
   * Creates and attaches the overlay element to `uiRoot`.
   * @param isCampaignInitialLoad  When true, uses a longer fade-out duration so
   *   the transition from the loading screen to gameplay feels like an intentional
   *   "fade from black" effect at the start of the campaign.
   */
  show(isCampaignInitialLoad = false): void {
    if (this.el !== null) return;
    this.fadeDurationMs = isCampaignInitialLoad
      ? FADE_DURATION_CAMPAIGN_START_MS
      : FADE_DURATION_STANDARD_MS;
    this.checkIntervalMs = CHECK_INTERVAL_MS;
    const div = document.createElement('div');
    div.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:#060503',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:9999',
      "font-family:'Cinzel',serif",
      'font-size:1rem',
      'color:rgba(212,168,75,0.85)',
      'pointer-events:none',
      'overflow:hidden',
      `transition:opacity ${(this.fadeDurationMs / 1000).toFixed(1)}s`,
    ].join(';');
    this.populateAnimatedLoadingOverlay(div);
    this.uiRoot.appendChild(div);
    this.el = div;
    this.minShowUntilMs = performance.now() + MIN_SHOW_MS;
    this.lastCheckMs = 0;
  }

  /**
   * Shows a lightweight textless black cover for instant cache-hit transitions
   * where an entry viewport warm is needed.
   *
   * Differences from `show()`:
   *   - No "Loading…" text — purely a brief black transition cover.
   *   - minShowMs = 0 — released as soon as the readiness check passes.
   *   - checkIntervalMs = 0 — readiness is checked every tick (no 50 ms throttle).
   *   - fadeMs = 80 ms — very short fade so the cover feels like a cut.
   *
   * Typical timeline for a cache-hit transition where no warm work is needed:
   *   frame N   : transition fires → showEntryWarm() → overlay appears (black)
   *   frame N+1 : entryWarm branch → tickEntryWarm() → 'ready'; tickLoadingOverlay()
   *               → all conditions met → fade starts (el → null)
   *   frame N+1 + 80 ms : fade completes → overlay element removed
   *
   * A probe to skip the overlay when no warm is needed was considered but not
   * implemented (it would require exposing skipped-chunk counts from the prewarm
   * functions).  The 1-frame + 80 ms cover is imperceptible for the no-work case
   * and correct for the work-needed case.  Tracked in nextSteps.md.
   */
  showEntryWarm(): void {
    if (this.el !== null) return;
    this.fadeDurationMs = FADE_DURATION_ENTRY_WARM_MS;
    this.checkIntervalMs = 0;
    const div = document.createElement('div');
    div.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:#060503',
      'z-index:9999',
      'pointer-events:none',
      'overflow:hidden',
      `transition:opacity ${(FADE_DURATION_ENTRY_WARM_MS / 1000).toFixed(2)}s`,
    ].join(';');
    this.populateAnimatedLoadingOverlay(div, true);
    this.uiRoot.appendChild(div);
    this.el = div;
    this.minShowUntilMs = performance.now(); // no minimum — release ASAP when ready
    this.lastCheckMs = 0;
  }

  /**
   * Shows the zone-load overlay with a progress label.
   * Used for both the initial campaign zone load and cross-zone transitions.
   *
   * @param worldNumber            Zone number being loaded (shown in text).
   * @param totalRooms             Total rooms in the zone (for initial progress text).
   * @param isCampaignInitialLoad  When true, uses the longer campaign-start fade-out.
   */
  showZoneLoad(worldNumber: number, totalRooms: number, isCampaignInitialLoad = false): void {
    if (this.el !== null) return;
    this.fadeDurationMs = isCampaignInitialLoad
      ? FADE_DURATION_CAMPAIGN_START_MS
      : FADE_DURATION_STANDARD_MS;
    this.checkIntervalMs = CHECK_INTERVAL_MS;
    const div = document.createElement('div');
    div.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:#060503',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:9999',
      "font-family:'Cinzel',serif",
      'font-size:1rem',
      'color:rgba(212,168,75,0.85)',
      'pointer-events:none',
      'overflow:hidden',
      `transition:opacity ${(this.fadeDurationMs / 1000).toFixed(1)}s`,
    ].join(';');
    this.populateAnimatedLoadingOverlay(div, false);

    // Update the existing label element to show zone progress text.
    const zoneLabel = div.querySelector<HTMLDivElement>('div[data-zone-progress]');
    if (zoneLabel !== null) {
      zoneLabel.textContent = `Loading zone ${worldNumber}: 0 / ${totalRooms}`;
    } else {
      // Replace the generic "Loading..." text created by populateAnimatedLoadingOverlay.
      const existingLabel = div.lastElementChild as HTMLElement | null;
      if (existingLabel !== null && existingLabel.tagName === 'DIV') {
        existingLabel.textContent = `Loading zone ${worldNumber}: 0 / ${totalRooms}`;
        existingLabel.setAttribute('data-zone-progress', '1');
      }
    }

    this.uiRoot.appendChild(div);
    this.el = div;
    this.minShowUntilMs = performance.now() + MIN_SHOW_MS;
    this.lastCheckMs = 0;
  }

  /**
   * Updates the zone-load progress text inside an overlay opened by `showZoneLoad()`.
   * No-op if the overlay is not visible.
   *
   * @param worldNumber  Zone number (for label).
   * @param built        Rooms whose residents are built so far.
   * @param total        Total rooms in the zone.
   */
  updateZoneProgress(worldNumber: number, built: number, total: number): void {
    if (this.el === null) return;
    const label = this.el.querySelector<HTMLElement>('[data-zone-progress]');
    if (label !== null) {
      label.textContent = `Loading zone ${worldNumber}: ${built} / ${total}`;
    }
  }

  /**
   * Polls readiness; fades out and removes the overlay once the minimum
   * show time has elapsed and `isReady()` returns true.
   * Call once per frame.
   */
  tick(isReady: () => boolean): void {
    if (this.el === null) return;
    const now = performance.now();
    if (now < this.minShowUntilMs) return;
    if (this.checkIntervalMs > 0 && now - this.lastCheckMs < this.checkIntervalMs) return;
    this.lastCheckMs = now;
    if (!isReady()) return;
    // Sprites ready — fade out and remove the overlay.
    const el = this.el;
    const fadeDuration = this.fadeDurationMs;
    this.el = null;
    el.style.opacity = '0';
    setTimeout(() => {
      if (el.parentElement !== null) el.parentElement.removeChild(el);
    }, fadeDuration);
  }

  /** Immediately removes the overlay without a fade (e.g. on screen teardown). */
  destroy(): void {
    if (this.el?.parentElement) this.el.parentElement.removeChild(this.el);
    this.el = null;
  }

  private populateAnimatedLoadingOverlay(div: HTMLDivElement, isTextless = false): void {
    const backgroundImg = document.createElement('img');
    backgroundImg.decoding = 'async';
    backgroundImg.alt = '';
    backgroundImg.src = LOADING_ANIMATION_ASSETS.backgroundUrl || MENU_ANIMATION_ASSETS.blurredUrl;
    backgroundImg.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'object-fit:cover',
      'pointer-events:none',
      'z-index:0',
    ].join(';');
    div.appendChild(backgroundImg);

    const darkOverlay = document.createElement('div');
    darkOverlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:rgba(0,0,0,0.32)',
      'pointer-events:none',
      'z-index:1',
    ].join(';');
    div.appendChild(darkOverlay);

    const loadingCircleImg = document.createElement('img');
    loadingCircleImg.decoding = 'async';
    loadingCircleImg.alt = '';
    loadingCircleImg.src = LOADING_ANIMATION_ASSETS.circleUrl;
    loadingCircleImg.style.cssText = [
      'position:absolute',
      'right:24px',
      'bottom:24px',
      'width:clamp(56px, 8vw, 112px)',
      'height:auto',
      'pointer-events:none',
      'z-index:2',
      'filter:drop-shadow(0 0 16px rgba(212,168,75,0.42))',
    ].join(';');
    div.appendChild(loadingCircleImg);

    if (isTextless) return;

    const label = document.createElement('div');
    label.textContent = 'Loading...';
    label.style.cssText = [
      'position:absolute',
      'right:24px',
      'bottom:calc(24px + clamp(56px, 8vw, 112px) + 10px)',
      'z-index:2',
      'font-size:0.82rem',
      'letter-spacing:0.14em',
      'text-transform:uppercase',
      'text-shadow:0 0 14px rgba(212,168,75,0.45)',
    ].join(';');
    div.appendChild(label);
  }
}
