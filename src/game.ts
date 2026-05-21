import { showMainMenu } from './ui/mainMenu';
import { showLoadoutScreen } from './ui/weaveLoadout';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';
import { SaveSlotData, saveSaveSlot } from './progression/saveSlots';
import type { CampaignSource } from './levels/campaignSource';
import type { EditableCampaignSession } from './editor/editableCampaignSession';
import { registerRoomsFromPackedCampaign, restoreMainCampaignSnapshot, initRoomRegistry, getLoadedOfficialCampaignSpawn, clearRegistryAndApplyCampaignMetadata, ROOM_REGISTRY } from './levels/rooms';
import { setActiveCampaignId } from './levels/campaigns';
import { stringToParticleKind } from './editor/roomJsonSchema';
import { unlockDustType, unlockActiveWeave } from './progression/unlocks';
import { WEAVE_REGISTRY } from './sim/weaves/weaveDefinition';
import { PLAYER_INITIAL_HEALTH } from './screens/gameSpawn';
import {
  ensureCampaignRoomCache,
  loadRoomForGameplayAsync,
  deactivateCampaignRoomCache,
  isRoomFileCacheActive,
  isOfficialCampaignCacheActive,
  getActiveRoomAdjacency,
  getActiveCampaignId,
} from './levels/roomFileLoader';
import { getCampaignStartRoomId } from './levels/campaignSchema';
import { createExportProgressModal } from './editor/editorExportProgressModal';
import type { ExportProgressModal } from './editor/editorExportProgressModal';


export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void {
  let cleanup: (() => void) | null = null;

  let progress: PlayerProgress = createDefaultProgress();

  /** Active save-slot index (set when player picks a slot). */
  let activeSlotIndex = 0;
  /** Timestamp (ms from performance.now) when gameplay started for the current session (for play-time tracking). */
  let sessionStartMs = 0;
  /** Active save data reference for persisting updates. */
  let activeSaveData: SaveSlotData | null = null;

  /** Persist the current save slot (update lastPlayed and accumulate play time). */
  function persistSaveSlot(): void {
    if (activeSaveData === null) return;
    const now = performance.now();
    if (sessionStartMs > 0) {
      activeSaveData.playTimeMs += now - sessionStartMs;
      sessionStartMs = now;
    }
    activeSaveData.lastPlayedIso = new Date().toISOString();
    activeSaveData.progress = progress;
    saveSaveSlot(activeSlotIndex, activeSaveData);
  }

  function navigate(
    to: 'mainMenu' | 'loadout' | 'gameplay' | 'customCampaignPlay' | 'customCampaignEdit',
    loadout?: ParticleKind[],
    customCampaignSource?: CampaignSource,
    customCampaignSession?: EditableCampaignSession,
  ): void {
    // Persist progress when leaving gameplay
    if (cleanup !== null) {
      if (activeSaveData !== null && sessionStartMs > 0) {
        persistSaveSlot();
      }
      cleanup();
      cleanup = null;
    }

    if (to === 'mainMenu') {
      // Restore main campaign rooms if we came from a custom campaign session.
      restoreMainCampaignSnapshot();
      // Only deactivate the room file cache when leaving a custom campaign
      // session.  The official campaign cache must remain active across main-menu
      // visits so that lazy loading works when the player presses Play again.
      // Deactivating it here was the root cause of the Electron "points to
      // missing room" bug: the cache was cleared before the player pressed Play,
      // leaving ROOM_REGISTRY with only the start room and no way to load others.
      if (!isOfficialCampaignCacheActive()) {
        deactivateCampaignRoomCache();
      }

      cleanup = showMainMenu(uiRoot, {
        onPlay: (slotIndex, saveData) => {
          activeSlotIndex = slotIndex;
          activeSaveData = saveData;
          progress = saveData.progress;
          sessionStartMs = performance.now();
          // Returning player (has explored rooms): skip straight to gameplay
          if (progress.exploredRoomIds.length > 0) {
            navigate('gameplay', progress.loadout);
          } else {
            // Brand new profile: auto-select outcast, skip character selection screen.
            // Do NOT open the loadout screen — the player starts with nothing.
            progress.characterId = 'outcast';
            navigate('gameplay', []);
          }
        },
        onPlayCustomCampaign: (source: CampaignSource) => {
          navigate('customCampaignPlay', undefined, source, undefined);
        },
        onEditCustomCampaign: (source: CampaignSource, session: EditableCampaignSession) => {
          navigate('customCampaignEdit', undefined, source, session);
        },
        onCreateNewCampaign: (session: EditableCampaignSession) => {
          navigate('customCampaignEdit', undefined, undefined, session);
        },
      });
    } else if (to === 'loadout') {
      // Loadout screen is now only used at save tombs, not during the initial flow.
      // Keep this branch for backward compatibility / explicit navigation.
      cleanup = showLoadoutScreen(uiRoot, progress, {
        onConfirm: (chosenLoadout, chosenWeaveLoadout) => {
          progress.loadout = chosenLoadout.slice();
          progress.weaveLoadout = chosenWeaveLoadout;
          navigate('gameplay', chosenLoadout);
        },
        onCancel: () => navigate('mainMenu'),
      });
    } else if (to === 'gameplay') {
      // Use an async wrapper so we can await lazy room loading when needed.
      // The pattern mirrors the 'customCampaignPlay' branch.
      const doPlayGameplay = async (): Promise<void> => {
        const activeLoadout = loadout ?? progress.loadout;
        const savedRoomId = progress.lastSaveRoomId ?? null;
        // If the player has no saved room, start at the campaign spawn if one is defined.
        const officialSpawn = savedRoomId === null ? getLoadedOfficialCampaignSpawn() : null;
        let startRoomId = savedRoomId ?? officialSpawn?.roomId ?? null;
        const campaignSpawnOverride: readonly [number, number] | null =
          officialSpawn !== null ? [officialSpawn.xBlock, officialSpawn.yBlock] : null;

        // In Electron lazy-load mode the saved room may not yet be in
        // ROOM_REGISTRY.  Attempt to load it from the file cache so that
        // resolveGameStartRoomSelection (called inside startGameScreen) can
        // find it rather than falling back to the lobby / campaign start.
        if (
          savedRoomId !== null &&
          isRoomFileCacheActive() &&
          ROOM_REGISTRY.get(savedRoomId) === undefined
        ) {
          const savedRoom = await loadRoomForGameplayAsync(savedRoomId);
          if (savedRoom !== undefined) {
            console.log(`[game] Lazy-loaded saved room "${savedRoomId}" before gameplay start.`);
            startRoomId = savedRoomId;
          } else {
            console.warn(
              `[game] Could not lazy-load saved room "${savedRoomId}". ` +
              'Falling back to campaign start room.',
            );
            // Clear startRoomId so the game falls through to the default start room.
            startRoomId = officialSpawn?.roomId ?? null;
          }
        }

        // ── Defensive guard: ensure ROOM_REGISTRY is not partial without a cache ──
        // If the cache was unexpectedly deactivated (e.g. by a bug in a previous
        // session) and the registry only has the start room, re-initialize fully
        // so the player can transition to adjacent rooms normally.
        if (!isRoomFileCacheActive() && ROOM_REGISTRY.size <= 1) {
          console.warn(
            '[game] ROOM_REGISTRY is partial (size=' + ROOM_REGISTRY.size + ') and ' +
            'no room file cache is active. Re-initializing room registry to recover.',
          );
          try {
            await initRoomRegistry();
          } catch (reInitErr) {
            console.error('[game] Re-initialization of room registry failed:', reInitErr);
          }
        }

        // ── Dev diagnostics logged every time Play is pressed ─────────────────
        {
          const _adj = getActiveRoomAdjacency();
          const _resolvedStart = startRoomId ?? 'lobby';
          const _startRoom = ROOM_REGISTRY.get(_resolvedStart);
          console.log(
            '[game:startup] Play pressed:',
            `\n  isRoomFileCacheActive      = ${isRoomFileCacheActive()}`,
            `\n  isOfficialCampaignCache    = ${isOfficialCampaignCacheActive()}`,
            `\n  activeCampaignId           = ${getActiveCampaignId() ?? '(none)'}`,
            `\n  ROOM_REGISTRY.size         = ${ROOM_REGISTRY.size}`,
            `\n  startRoomId                = ${_resolvedStart}`,
            `\n  startRoomInRegistry        = ${_startRoom !== undefined}`,
            `\n  adjacencyManifestExists    = ${_adj !== null}`,
            `\n  startRoom→w1_room1         = ${_startRoom?.transitions?.some(t => t.targetRoomId === 'w1_room1') ?? false}`,
          );
        }

        cleanup = startGameScreen(canvas, uiRoot, activeLoadout, startRoomId, {
          onReturnToMenu: () => {
            persistSaveSlot();
            navigate('mainMenu');
          },
          onSave: () => {
            persistSaveSlot();
          },
        }, progress, undefined, undefined, campaignSpawnOverride);
      };
      void doPlayGameplay();
    } else if (to === 'customCampaignPlay') {
      // Play a custom campaign: load rooms into ROOM_REGISTRY, then start gameplay.
      // Save data is not used — custom campaign games start fresh.
      const source = customCampaignSource!;
      const doPlay = async (): Promise<void> => {
        let startRoomId: string;
        let customSpawnOverride: readonly [number, number] | null = null;
        let campaignStartProgress: PlayerProgress | undefined;
        if (source.loadPackedCampaign !== undefined) {
          const campaign = await source.loadPackedCampaign();

          // ── Electron: validate / generate room file cache ─────────────────
          // In Electron, prefer lazy loading from the derived room file cache
          // rather than eagerly loading all rooms from the packed campaign.
          // Only the start room is loaded at startup; adjacent rooms are
          // preloaded lazily by the room preload scheduler during gameplay.
          //
          // Editor mode uses registerRoomsFromPackedCampaign (see below) —
          // room files are derived artifacts, not editable source files.
          //
          // In browser/GitHub Pages mode (no dustweaverElectron) the packed
          // campaign path is used unchanged.
          let usedFileCache = false;
          if (typeof window !== 'undefined' && window.dustweaverElectron !== undefined) {
            const electronApi = window.dustweaverElectron;

            // Minimal overlay shown during the quick manifest validation step.
            const statusDiv = document.createElement('div');
            statusDiv.id = 'room-cache-status';
            statusDiv.style.cssText = [
              'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
              'justify-content:center', 'background:#000', 'color:#ccc',
              'font:14px/1.4 monospace', 'z-index:9999', 'pointer-events:none',
            ].join(';');
            statusDiv.textContent = 'Checking room cache…';
            uiRoot.appendChild(statusDiv);

            // Full progress modal — lazily created on the first IPC progress event.
            // It is only shown if cache regeneration is actually needed; if the
            // existing manifest is valid the listener fires zero times and the
            // heavy modal is never constructed.
            let cacheProgressModal: ExportProgressModal | null = null;

            // Register the progress listener BEFORE calling ensureCampaignRoomCache
            // so that no events are missed even if generation starts immediately.
            electronApi.onExportProgress(event => {
              if (cacheProgressModal === null) {
                // Switch from the plain text overlay to the full progress modal.
                statusDiv.style.display = 'none';
                cacheProgressModal = createExportProgressModal(uiRoot, '🔄 Generating Room Cache');
              }
              cacheProgressModal.update(event);
            });

            // Pass light status text to the plain overlay when the modal is absent
            // (i.e. during the validation-only phase).
            const onStatus = (msg: string): void => {
              if (cacheProgressModal === null) {
                statusDiv.textContent = msg;
              }
            };

            try {
              const manifest = await ensureCampaignRoomCache(campaign, false, onStatus);
              if (manifest !== null) {
                // Gameplay mode: apply world-map metadata (world names + map
                // positions) from campaign data WITHOUT loading all rooms.
                // The registry starts empty; only the start room is loaded now.
                // Adjacent rooms are loaded lazily by the preload scheduler.
                clearRegistryAndApplyCampaignMetadata(campaign);

                const spawnRoomId = getCampaignStartRoomId(campaign);
                onStatus('Loading start room from file cache…');
                const startRoomDef = await loadRoomForGameplayAsync(
                  spawnRoomId,
                  campaign.worldMap,
                );

                if (startRoomDef !== undefined) {
                  usedFileCache = true;
                  console.log(
                    '[game] Custom campaign: start room loaded from file cache. ' +
                    'Remaining rooms will be lazy-loaded during gameplay.',
                  );
                } else {
                  console.warn(
                    '[game] Custom campaign: start room could not be loaded from file cache ' +
                    `("${spawnRoomId}") — falling back to packed campaign.`,
                  );
                }
              } else {
                console.warn(
                  '[game] Room file cache unavailable for campaign ' +
                  `"${campaign.campaign.id}" — falling back to packed campaign.`,
                );
              }
            } catch (cacheErr) {
              console.warn('[game] Room cache check error:', cacheErr);
            } finally {
              electronApi.offExportProgress();
              // TypeScript narrowing limitation: it only tracks the null
              // initialisation as proven in the outer scope; the callback
              // assignment is not visible to the control-flow analyser.
              // Cast to the declared union so that ?.destroy() resolves correctly.
              (cacheProgressModal as ExportProgressModal | null)?.destroy();
              statusDiv.remove();
            }
          }

          // If the file cache path was not used (browser, IPC failure, missing
          // start room, etc.), fall back to the packed campaign as before.
          // This eagerly loads all rooms but is always safe.
          if (!usedFileCache) {
            registerRoomsFromPackedCampaign(campaign);
          }

          const cSpawn = campaign.campaign.campaignSpawn;
          if (cSpawn !== undefined) {
            startRoomId = cSpawn.roomId;
            customSpawnOverride = [cSpawn.xBlock, cSpawn.yBlock];
            // Apply campaign spawn starting options to a fresh progress.
            campaignStartProgress = createDefaultProgress();
            if (cSpawn.startingHealth !== undefined) {
              campaignStartProgress.startingHealth = Math.max(1, Math.min(cSpawn.startingHealth, PLAYER_INITIAL_HEALTH));
            }
            if (cSpawn.startingDustContainerCount !== undefined) {
              campaignStartProgress.dustContainerCount = Math.max(0, Math.floor(cSpawn.startingDustContainerCount));
            }
            if (Array.isArray(cSpawn.startingDustTypes)) {
              for (const name of cSpawn.startingDustTypes) {
                const kind = stringToParticleKind(name);
                if (kind !== null) {
                  unlockDustType(campaignStartProgress, kind);
                }
              }
            }
            if (Array.isArray(cSpawn.startingWeaves)) {
              for (const weaveId of cSpawn.startingWeaves) {
                if (WEAVE_REGISTRY.has(weaveId)) {
                  unlockActiveWeave(campaignStartProgress, weaveId);
                }
              }
            }
          } else {
            startRoomId = campaign.campaign.initialRoomId;
          }
        } else if (source.loadFolderCampaign !== undefined) {
          // For folder-based campaigns, set the active campaign then reload the registry.
          setActiveCampaignId(source.id);
          await initRoomRegistry();
          startRoomId = source.initialRoomId;
        } else {
          console.error('[game] Campaign source has no loader:', source.id);
          navigate('mainMenu');
          return;
        }

        if (cleanup !== null) { cleanup(); cleanup = null; }
        cleanup = startGameScreen(canvas, uiRoot, [], startRoomId, {
          onReturnToMenu: () => navigate('mainMenu'),
        }, campaignStartProgress, null, false, customSpawnOverride);
      };
      void doPlay().catch(e => {
        console.error('[game] Failed to load custom campaign for play:', e);
        navigate('mainMenu');
      });
    } else if (to === 'customCampaignEdit') {
      // Edit a custom campaign: load rooms, open editor immediately.
      const session = customCampaignSession!;
      const doEdit = async (): Promise<void> => {
        registerRoomsFromPackedCampaign(session.campaign);
        const cSpawn = session.campaign.campaign.campaignSpawn;
        const startRoomId = cSpawn?.roomId ?? session.campaign.campaign.initialRoomId;

        if (cleanup !== null) { cleanup(); cleanup = null; }
        cleanup = startGameScreen(canvas, uiRoot, [], startRoomId, {
          onReturnToMenu: () => navigate('mainMenu'),
        }, undefined, session, true);
      };
      void doEdit().catch(e => {
        console.error('[game] Failed to start campaign edit session:', e);
        navigate('mainMenu');
      });
    }
  }

  navigate('mainMenu');
}
