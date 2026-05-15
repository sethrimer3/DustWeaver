import { showMainMenu } from './ui/mainMenu';
import { showLoadoutScreen } from './ui/weaveLoadout';
import { startGameScreen } from './screens/gameScreen';
import { ParticleKind } from './sim/particles/kinds';
import { createDefaultProgress, PlayerProgress } from './progression/playerProgress';
import { SaveSlotData, saveSaveSlot } from './progression/saveSlots';
import type { CampaignSource } from './levels/campaignSource';
import type { EditableCampaignSession } from './editor/editableCampaignSession';
import { registerRoomsFromPackedCampaign, restoreMainCampaignSnapshot, initRoomRegistry, getLoadedOfficialCampaignSpawn } from './levels/rooms';
import { setActiveCampaignId } from './levels/campaigns';


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
      const activeLoadout = loadout ?? progress.loadout;
      const savedRoomId = progress.lastSaveRoomId ?? null;
      // If the player has no saved room, start at the campaign spawn if one is defined.
      const officialSpawn = savedRoomId === null ? getLoadedOfficialCampaignSpawn() : null;
      const startRoomId = savedRoomId ?? officialSpawn?.roomId ?? null;
      const campaignSpawnOverride: readonly [number, number] | null =
        officialSpawn !== null ? [officialSpawn.xBlock, officialSpawn.yBlock] : null;
      cleanup = startGameScreen(canvas, uiRoot, activeLoadout, startRoomId, {
        onReturnToMenu: () => {
          persistSaveSlot();
          navigate('mainMenu');
        },
        onSave: () => {
          persistSaveSlot();
        },
      }, progress, undefined, undefined, campaignSpawnOverride);
    } else if (to === 'customCampaignPlay') {
      // Play a custom campaign: load rooms into ROOM_REGISTRY, then start gameplay.
      // Save data is not used — custom campaign games start fresh.
      const source = customCampaignSource!;
      const doPlay = async (): Promise<void> => {
        let startRoomId: string;
        let customSpawnOverride: readonly [number, number] | null = null;
        if (source.loadPackedCampaign !== undefined) {
          const campaign = await source.loadPackedCampaign();
          registerRoomsFromPackedCampaign(campaign);
          const cSpawn = campaign.campaign.campaignSpawn;
          if (cSpawn !== undefined) {
            startRoomId = cSpawn.roomId;
            customSpawnOverride = [cSpawn.xBlock, cSpawn.yBlock];
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
        }, undefined, null, false, customSpawnOverride);
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
