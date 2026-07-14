import type { RoomDef } from '../levels/roomDef';
import type { PlayerProgress } from '../progression/playerProgress';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import type { WorldState } from '../sim/world';
import { showDeathScreen } from '../ui/deathScreen';
import { showMapOnlyModal, showSkillTombMenu } from '../ui/skillTombMenu';
import {
  executeGameDeathRespawn,
  type GameDeathRespawnPorts,
} from './gameDeathRespawnCoordinator';
import {
  applySkillTombActivation,
  type SkillTombActivationPorts,
} from './gameSkillTombActivation';

export interface GameOverlayControllerState {
  isPlayerDead: boolean;
  isSkillTombMenuOpen: boolean;
  isMapOnlyOpen: boolean;
}

interface CreateGameOverlayControllerParams {
  uiRoot: HTMLElement;
  getWorld: () => WorldState;
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
    getWorld,
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

  const skillTombActivationPorts: SkillTombActivationPorts = {
    getCurrentRoomOrigin,
    getCurrentRoomId: () => getCurrentRoom().id,
    getNearbyTombIndex: (localXWorld, localYWorld) => (
      skillTombRenderer.getNearbyTombIndex(localXWorld, localYWorld)
    ),
    getTombPosition: (index) => skillTombRenderer.getTombPosition(index),
    onCheckpointReached,
    onSave,
  };

  const deathRespawnPorts: GameDeathRespawnPorts = {
    getRoomById: (roomId) => roomRegistry.get(roomId),
    loadRoom,
    resetTransitionReveal: onResetTransitionReveal,
    resetFrameClock: onResetFrameClock,
    onRespawn,
  };

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
        executeGameDeathRespawn(progress, campaignSpawnRoom, campaignSpawnBlock, deathRespawnPorts);
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

    const world = getWorld();
    const activation = applySkillTombActivation(world, progress, skillTombActivationPorts);

    skillTombMenuCleanup = showSkillTombMenu(
      uiRoot,
      progress,
      getCurrentRoom().id,
      activation.playerXWorld,
      activation.playerYWorld,
      activation.playerHealthPoints,
      activation.playerMaxHealthPoints,
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
    const world = getWorld();
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
