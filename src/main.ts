import { startGame } from './game';
import {
  initRoomRegistry,
  captureMainCampaignSnapshot,
  clearRegistryAndApplyCampaignMetadata,
  applyOfficialCampaignMetadata,
} from './levels/rooms';
import {
  ensureCampaignRoomCache,
  loadRoomForGameplayAsync,
  deactivateCampaignRoomCache,
} from './levels/roomFileLoader';
import { fetchOfficialPackedCampaign } from './levels/packedCampaignLoader';
import { getCampaignStartRoomId } from './levels/campaignSchema';
import { createExportProgressModal } from './editor/editorExportProgressModal';
import { installSpriteAtlasDiagnostics } from './render/atlases/spriteAtlasLoader';
import type { ExportProgressModal } from './editor/editorExportProgressModal';
import { installSpriteAtlasDevGlobals } from './render/atlases/spriteAtlasConfig';
import {
  preloadMenuAnimationFrames,
  type MenuAnimationLoadProgress,
} from './ui/menuAnimationFrames';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLDivElement;

installSpriteAtlasDiagnostics();

if (!canvas || !uiRoot) {
  throw new Error('Missing required DOM elements: game-canvas or ui-root');
}

installSpriteAtlasDevGlobals();

function createStartupLoadingScreen(): {
  update: (progress: MenuAnimationLoadProgress) => void;
  showError: (error: unknown) => void;
  destroy: () => void;
} {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000', 'display:flex',
    'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:1rem', 'background:#050403', 'color:#d4a84b',
    "font-family:'Cinzel',serif", 'letter-spacing:0.12em',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'DustWeaver';
  title.style.cssText = 'font-size:clamp(2rem,6vw,4.5rem);text-transform:uppercase;text-shadow:0 0 40px rgba(212,168,75,.35)';

  const status = document.createElement('div');
  status.style.cssText = 'font-size:.9rem;color:rgba(212,168,75,.8);text-transform:uppercase';

  const track = document.createElement('div');
  track.style.cssText = 'width:min(560px,75vw);height:4px;background:rgba(212,168,75,.15);overflow:hidden';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:#d4a84b;transition:width .1s linear;box-shadow:0 0 16px rgba(212,168,75,.7)';
  track.appendChild(fill);
  overlay.append(title, status, track);
  uiRoot.appendChild(overlay);

  return {
    update(progress): void {
      const label = progress.phase === 'loading' ? 'Loading animation frames' : 'Preparing animation frames';
      status.textContent = `${label} ${progress.completed} / ${progress.total}`;
      fill.style.width = `${progress.total === 0 ? 0 : (progress.completed / progress.total) * 100}%`;
    },
    showError(error): void {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = `Startup failed: ${message}`;
      status.style.color = '#ff8a73';
      track.style.display = 'none';
    },
    destroy(): void {
      overlay.remove();
    },
  };
}

/**
 * Initialises the official campaign room registry, then captures a snapshot
 * and starts the game.
 *
 * In Electron: tries to use the derived room file cache so only the start room
 * (and adjacent rooms preloaded lazily) are loaded at startup rather than the
 * full campaign.  Falls back to eager `initRoomRegistry()` if the file cache
 * is unavailable, missing, or fails.
 *
 * In Browser/GitHub Pages: always uses `initRoomRegistry()` (the packed
 * campaign path) since there is no Electron IPC available.
 *
 * IMPORTANT: editor mode calls `initRoomRegistry()` directly (via
 * editorController) and is NOT affected by this function.  The file-cache
 * path is strictly for gameplay startup.
 */
async function initAndStart(): Promise<void> {
  // ── Electron: try official campaign file cache (lazy loading) ─────────────
  // Gameplay mode: prefer derived room files so only the start room is loaded
  // at startup.  Adjacent rooms are preloaded lazily by the preload scheduler.
  // Editor mode: not reached here — editor calls initRoomRegistry() separately.
  if (typeof window !== 'undefined' && window.dustweaverElectron !== undefined) {
    const electronApi = window.dustweaverElectron;
    try {
      const packedCampaign = await fetchOfficialPackedCampaign();
      if (packedCampaign !== null) {
        // Minimal overlay shown during the quick manifest validation step.
        const cacheStatusDiv = document.createElement('div');
        cacheStatusDiv.id = 'room-cache-status';
        cacheStatusDiv.style.cssText = [
          'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
          'justify-content:center', 'background:#000', 'color:#ccc',
          'font:14px/1.4 monospace', 'z-index:9999', 'pointer-events:none',
        ].join(';');
        cacheStatusDiv.textContent = 'Checking room cache…';
        uiRoot.appendChild(cacheStatusDiv);

        // Full progress modal — lazily created on the first IPC progress event.
        // Only shown when the cache is stale and regeneration is actually needed.
        let cacheProgressModal: ExportProgressModal | null = null;

        electronApi.onExportProgress(event => {
          if (cacheProgressModal === null) {
            cacheStatusDiv.style.display = 'none';
            cacheProgressModal = createExportProgressModal(uiRoot, '🔄 Generating Room Cache');
          }
          cacheProgressModal.update(event);
        });

        let manifest: Awaited<ReturnType<typeof ensureCampaignRoomCache>>;
        try {
          manifest = await ensureCampaignRoomCache(packedCampaign, true);
        } finally {
          electronApi.offExportProgress();
          // TypeScript narrowing limitation: it only tracks the null
          // initialisation as proven in the outer scope; the callback
          // assignment is not visible to the control-flow analyser.
          // Cast to the declared union so that ?.destroy() resolves correctly.
          (cacheProgressModal as ExportProgressModal | null)?.destroy();
          cacheStatusDiv.remove();
        }

        if (manifest !== null) {
          // Apply metadata (revision info, campaign spawn) so that
          // getLoadedOfficialCampaignRevisionMetadata() and
          // getLoadedOfficialCampaignSpawn() return correct values even
          // though initRoomRegistry() was not called.
          applyOfficialCampaignMetadata(packedCampaign);

          // Prepare the registry with world-map metadata (world names + map
          // positions for ALL rooms) WITHOUT hydrating any room data yet.
          // This keeps the minimap and world-map overlay functional while the
          // registry is only partially populated.
          clearRegistryAndApplyCampaignMetadata(packedCampaign);

          // Load only the start room.  Adjacent rooms will be preloaded lazily
          // during gameplay by the room preload scheduler.
          const startRoomId = getCampaignStartRoomId(packedCampaign);
          const startRoom = await loadRoomForGameplayAsync(
            startRoomId,
            packedCampaign.worldMap,
          );

          if (startRoom !== undefined) {
            console.log(
              `[main] Official campaign: start room "${startRoomId}" loaded from file cache. ` +
              'Remaining rooms will be lazy-loaded during gameplay.',
            );
            captureMainCampaignSnapshot();
            startGame(canvas, uiRoot);
            return;
          }

          // Start room load failed — deactivate cache and fall through to
          // full eager load via initRoomRegistry().
          console.warn(
            `[main] Official campaign: file-cache load of start room "${startRoomId}" failed. ` +
            'Falling back to full eager load via initRoomRegistry().',
          );
          deactivateCampaignRoomCache();
        }
      }
    } catch (cacheErr) {
      console.warn('[main] Official campaign file-cache init error:', cacheErr);
      deactivateCampaignRoomCache();
    }
  }

  // ── Fallback / browser path: full eager load ───────────────────────────────
  // Used when: not Electron, file cache unavailable, or cache init failed.
  // Also used by the editor (which calls initRoomRegistry() directly via
  // editorController and never reaches this code path).
  try {
    await initRoomRegistry();
    captureMainCampaignSnapshot();
    startGame(canvas, uiRoot);
  } catch (err) {
    console.error('Failed to initialize room registry:', err);
    captureMainCampaignSnapshot();
    // Start anyway — some rooms may have loaded
    startGame(canvas, uiRoot);
  }
}

async function boot(): Promise<void> {
  const loadingScreen = createStartupLoadingScreen();
  try {
    await preloadMenuAnimationFrames(progress => loadingScreen.update(progress));
    await initAndStart();
    loadingScreen.destroy();
  } catch (error) {
    console.error('[main] Failed to prepare menu animation:', error);
    loadingScreen.showError(error);
  }
}

void boot();
