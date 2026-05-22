import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import type { PlayerProgress } from '../progression/playerProgress';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import { getElementProfile } from '../sim/particles/elementProfiles';
import type { WorldState } from '../sim/world';
import { showDeathScreen } from '../ui/deathScreen';
import { showMapOnlyModal, showSkillTombMenu } from '../ui/skillTombMenu';

export interface GameOverlayControllerState {
  isPlayerDead: boolean;
  isSkillTombMenuOpen: boolean;
  isMapOnlyOpen: boolean;
}

interface CreateGameOverlayControllerParams {
  uiRoot: HTMLElement;
  world: WorldState;
  roomRegistry: ReadonlyMap<string, RoomDef>;
  progress?: PlayerProgress;
  campaignSpawnRoom: RoomDef;
  campaignSpawnBlock: readonly [number, number];
  skillTombRenderer: SkillTombRenderer;
  getCurrentRoom: () => RoomDef;
  getCurrentRoomOrigin: () => readonly [number, number];
  loadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number) => void;
  onResetTransitionReveal: () => void;
  onResetFrameClock: () => void;
  onExitToMainMenu: () => void;
  onSave?: () => void;
  /** Called when the player activates a save point so the checkpoint timer can be snapshotted. */
  onCheckpointReached?: () => void;
  /** Called after respawn so the timer can be restored to the checkpoint value. */
  onRespawn?: () => void;
}

export interface GameOverlayController {
  state: GameOverlayControllerState;
  showPlayerDeathScreen: () => void;
  openSkillTombMenu: () => void;
  openMapOnly: () => void;
  destroy: () => void;
}

export function createGameOverlayController(
  params: CreateGameOverlayControllerParams,
): GameOverlayController {
  const {
    uiRoot,
    world,
    roomRegistry,
    progress,
    campaignSpawnRoom,
    campaignSpawnBlock,
    skillTombRenderer,
    getCurrentRoom,
    getCurrentRoomOrigin,
    loadRoom,
    onResetTransitionReveal,
    onResetFrameClock,
    onExitToMainMenu,
    onSave,
    onCheckpointReached,
    onRespawn,
  } = params;

  const state: GameOverlayControllerState = {
    isPlayerDead: false,
    isSkillTombMenuOpen: false,
    isMapOnlyOpen: false,
  };

  let deathScreenCleanup: (() => void) | null = null;
  let skillTombMenuCleanup: (() => void) | null = null;
  let mapOnlyCleanup: (() => void) | null = null;

  function closeMapOnlyIfOpen(): void {
    if (mapOnlyCleanup === null) return;
    mapOnlyCleanup();
    mapOnlyCleanup = null;
    state.isMapOnlyOpen = false;
  }

  function showPlayerDeathScreen(): void {
    if (state.isPlayerDead) return;
    state.isPlayerDead = true;
    deathScreenCleanup = showDeathScreen(uiRoot, {
      onReturnToLastSave: () => {
        state.isPlayerDead = false;
        deathScreenCleanup = null;
        if (progress && progress.lastSaveRoomId) {
          const saveRoom = roomRegistry.get(progress.lastSaveRoomId);
          if (saveRoom && progress.lastSaveSpawnBlock) {
            loadRoom(saveRoom, progress.lastSaveSpawnBlock[0], progress.lastSaveSpawnBlock[1]);
          } else {
            loadRoom(campaignSpawnRoom, campaignSpawnBlock[0], campaignSpawnBlock[1]);
          }
        } else {
          loadRoom(campaignSpawnRoom, campaignSpawnBlock[0], campaignSpawnBlock[1]);
        }
        onResetTransitionReveal();
        onResetFrameClock();
        // Restore speedrun timer to the value it had when the player last saved.
        if (onRespawn) onRespawn();
      },
      onReturnToMainMenu: () => {
        state.isPlayerDead = false;
        deathScreenCleanup = null;
        onExitToMainMenu();
      },
    });
  }

  function openSkillTombMenu(): void {
    if (state.isSkillTombMenuOpen || progress === undefined) return;
    closeMapOnlyIfOpen();
    state.isSkillTombMenuOpen = true;
    if (onSave) onSave();

    const player = world.clusters[0];
    let playerXWorld = 0;
    let playerYWorld = 0;
    let playerHealthPoints = 0;
    let playerMaxHealthPoints = 0;
    if (player !== undefined) {
      playerXWorld = player.positionXWorld;
      playerYWorld = player.positionYWorld;

      const [currentRoomOriginXWorld, currentRoomOriginYWorld] = getCurrentRoomOrigin();
      const nearbyIndex = skillTombRenderer.getNearbyTombIndex(
        player.positionXWorld - currentRoomOriginXWorld,
        player.positionYWorld - currentRoomOriginYWorld,
      );
      if (nearbyIndex >= 0) {
        const tombPos = skillTombRenderer.getTombPosition(nearbyIndex);
        if (tombPos) {
          progress.lastSaveRoomId = getCurrentRoom().id;
          progress.lastSaveSpawnBlock = [
            Math.round(tombPos.xWorld / BLOCK_SIZE_MEDIUM),
            Math.round(tombPos.yWorld / BLOCK_SIZE_MEDIUM),
          ];
          // Snapshot the speedrun timer checkpoint at save-point activation.
          if (onCheckpointReached) onCheckpointReached();
        }
      }

      player.healthPoints = player.maxHealthPoints;
      playerMaxHealthPoints = player.maxHealthPoints;
      playerHealthPoints = playerMaxHealthPoints;
      for (let particleIndex = 0; particleIndex < world.particleCount; particleIndex++) {
        if (world.ownerEntityId[particleIndex] !== player.entityId) continue;
        if (world.isTransientFlag[particleIndex] === 1) continue;
        if (world.isAliveFlag[particleIndex] === 0 && world.respawnDelayTicks[particleIndex] > 0) {
          world.respawnDelayTicks[particleIndex] = 1;
        }
        if (world.isAliveFlag[particleIndex] === 1) {
          world.particleDurability[particleIndex] = getElementProfile(world.kindBuffer[particleIndex]).toughness;
        }
      }
    }

    skillTombMenuCleanup = showSkillTombMenu(
      uiRoot,
      progress,
      getCurrentRoom().id,
      playerXWorld,
      playerYWorld,
      playerHealthPoints,
      playerMaxHealthPoints,
      {
        onClose: (updatedLoadout, updatedWeaveLoadout) => {
          state.isSkillTombMenuOpen = false;
          skillTombMenuCleanup = null;
          progress.loadout = updatedLoadout;
          progress.weaveLoadout = updatedWeaveLoadout;
          onResetFrameClock();
          if (onSave) onSave();
        },
      },
    );
  }

  function openMapOnly(): void {
    if (state.isMapOnlyOpen || state.isSkillTombMenuOpen || progress === undefined) return;
    const player = world.clusters[0];
    if (player === undefined) return;
    state.isMapOnlyOpen = true;
    mapOnlyCleanup = showMapOnlyModal(
      uiRoot,
      progress,
      getCurrentRoom().id,
      player.positionXWorld,
      player.positionYWorld,
      {
        onClose: () => {
          state.isMapOnlyOpen = false;
          mapOnlyCleanup = null;
          onResetFrameClock();
        },
      },
    );
  }

  function destroy(): void {
    if (deathScreenCleanup !== null) {
      deathScreenCleanup();
      deathScreenCleanup = null;
    }
    if (skillTombMenuCleanup !== null) {
      skillTombMenuCleanup();
      skillTombMenuCleanup = null;
    }
    if (mapOnlyCleanup !== null) {
      mapOnlyCleanup();
      mapOnlyCleanup = null;
    }
    state.isPlayerDead = false;
    state.isSkillTombMenuOpen = false;
    state.isMapOnlyOpen = false;
  }

  return {
    state,
    showPlayerDeathScreen,
    openSkillTombMenu,
    openMapOnly,
    destroy,
  };
}
