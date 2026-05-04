/**
 * gameCommandProcessor.ts — Player input command dispatch for the game screen.
 *
 * Translates raw GameCommand inputs into world state mutations and returns
 * a result record used by the game loop to drive further game-state changes
 * (pause menu, death handling, etc.).  All side-effectful state mutations are
 * applied directly to `world`; the caller handles UI callbacks using the
 * returned flags.
 */

import { collectCommands, InputState } from '../input/handler';
import { CommandKind } from '../input/commands';
import { WorldState } from '../sim/world';
import { fireGrapple, releaseGrapple } from '../sim/clusters/grapple';
import { GrappleInputMode } from '../sim/worldGrappleState';
import { screenToWorld } from './gameRoom';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import type { PlayerProgress } from '../progression/playerProgress';
import type { CombatTextSystem } from '../render/hud/combatText';
import { unlockActiveWeave } from '../progression/unlocks';
import { getWeaveDefinition } from '../sim/weaves/weaveDefinition';

/** Context passed to {@link processPlayerCommands} each frame. */
export interface GameCommandContext {
  inputState: InputState;
  world: WorldState;
  canvas: HTMLCanvasElement;
  offsetXPx: number;
  offsetYPx: number;
  zoom: number;
  virtualWidthPx: number;
  virtualHeightPx: number;
  skillTombRenderer: SkillTombRenderer;
  skillTombEffectRenderer: SkillTombEffectRenderer;
  progress: PlayerProgress | undefined;
  consumedSkillTombKeySet: Set<string>;
  combatText: CombatTextSystem;
  currentRoomId: string;
  openMapOnly: () => void;
}

/** Output of {@link processPlayerCommands} consumed by the game loop. */
export interface GameCommandResult {
  /** Horizontal movement input: -1 (left), 0 (none), 1 (right). */
  moveDx: number;
  /** True when a jump command was received this frame. */
  jumpTriggered: boolean;
  /** True when the player requested to open the pause/return-to-map menu. */
  openPause: boolean;
  /** True when an interact command landed near a save tomb. */
  interactTriggered: boolean;
  /** True when the interact command fired (caller should start the interact pulse timer). */
  interactInputPulseTrigger: boolean;
}

/**
 * Processes all buffered player input commands for the current frame.
 *
 * Mutates `ctx.world` for weave/grapple commands; all other outcomes are
 * returned as flags for the caller to act on.
 */
export function processPlayerCommands(ctx: GameCommandContext): GameCommandResult {
  const {
    inputState, world, canvas,
    offsetXPx, offsetYPx, zoom,
    virtualWidthPx, virtualHeightPx,
    skillTombRenderer, skillTombEffectRenderer,
    progress, consumedSkillTombKeySet, combatText,
    currentRoomId, openMapOnly,
  } = ctx;

  const commands = collectCommands(inputState);
  let openPause = false;
  let moveDx = 0;
  let jumpTriggered = false;
  let interactTriggered = false;
  let interactInputPulseTrigger = false;

  for (let ci = 0; ci < commands.length; ci++) {
    const cmd = commands[ci];
    if (cmd.kind === CommandKind.ReturnToMap) {
      openPause = true;
    } else if (cmd.kind === CommandKind.MovePlayer) {
      moveDx = cmd.dx;
    } else if (cmd.kind === CommandKind.Jump) {
      jumpTriggered = true;
    } else if (cmd.kind === CommandKind.Attack) {
      // Legacy attack command — no longer used for player (enemies still use it internally)
      // Kept for backward compatibility; ignored for player
    } else if (cmd.kind === CommandKind.BlockStart || cmd.kind === CommandKind.BlockUpdate) {
      // Legacy block command — no longer used for player
    } else if (cmd.kind === CommandKind.BlockEnd) {
      // Legacy block end — no longer used for player
    } else if (cmd.kind === CommandKind.WeaveActivatePrimary) {
      const player = world.clusters[0];
      if (player !== undefined && player.isAliveFlag === 1) {
        const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
        // Check if tapping/clicking on a skill tomb (save point)
        const tombIndex = skillTombRenderer.getNearbyTombIndex(aim.xWorld, aim.yWorld);
        if (tombIndex >= 0) {
          // Player is also near the tomb — open the save menu
          const playerNearby = skillTombRenderer.getNearbyTombIndex(player.positionXWorld, player.positionYWorld);
          if (playerNearby >= 0) {
            interactTriggered = true;
          }
        } else {
          // Normal weave attack
          let dirX = aim.xWorld - player.positionXWorld;
          let dirY = aim.yWorld - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = 1.0; dirY = 0.0; } else { dirX /= len; dirY /= len; }
          world.playerWeaveAimDirXWorld = dirX;
          world.playerWeaveAimDirYWorld = dirY;
          world.playerPrimaryWeaveTriggeredFlag = 1;
        }
      }
    } else if (cmd.kind === CommandKind.WeaveHoldPrimary) {
      const player = world.clusters[0];
      if (player !== undefined && player.isAliveFlag === 1) {
        const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
        let dirX = aim.xWorld - player.positionXWorld;
        let dirY = aim.yWorld - player.positionYWorld;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len < 1.0) { dirX = world.playerWeaveAimDirXWorld; dirY = world.playerWeaveAimDirYWorld; }
        else { dirX /= len; dirY /= len; }
        world.playerWeaveAimDirXWorld = dirX;
        world.playerWeaveAimDirYWorld = dirY;
        // For sustained weaves, trigger on first hold frame
        if (world.isPlayerPrimaryWeaveActiveFlag === 0) {
          world.playerPrimaryWeaveTriggeredFlag = 1;
        }
      }
    } else if (cmd.kind === CommandKind.WeaveEndPrimary) {
      world.playerPrimaryWeaveEndFlag = 1;
    } else if (cmd.kind === CommandKind.GrappleZip) {
      // Right mouse pressed — zip toward anchor if grapple is attached.
      // If no grapple is active, the subsequent secondary Weave commands handle it.
      if (world.isGrappleActiveFlag === 1 && world.isGrappleZipActiveFlag === 0) {
        world.isGrappleZipTriggeredFlag = 1;
      }
    } else if (cmd.kind === CommandKind.WeaveActivateSecondary) {
      // Skip secondary Weave while grapple is active (right-click = zip in that state).
      if (!world.isGrappleActiveFlag) {
        const player = world.clusters[0];
        if (player !== undefined && player.isAliveFlag === 1) {
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
          let dirX = aim.xWorld - player.positionXWorld;
          let dirY = aim.yWorld - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = 1.0; dirY = 0.0; } else { dirX /= len; dirY /= len; }
          world.playerWeaveAimDirXWorld = dirX;
          world.playerWeaveAimDirYWorld = dirY;
          world.playerSecondaryWeaveTriggeredFlag = 1;
        }
      }
    } else if (cmd.kind === CommandKind.WeaveHoldSecondary) {
      // Suppress secondary Weave sustained hold while grapple is active (RMB = zip).
      if (!world.isGrappleActiveFlag) {
        const player = world.clusters[0];
        if (player !== undefined && player.isAliveFlag === 1) {
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
          let dirX = aim.xWorld - player.positionXWorld;
          let dirY = aim.yWorld - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = world.playerWeaveAimDirXWorld; dirY = world.playerWeaveAimDirYWorld; }
          else { dirX /= len; dirY /= len; }
          world.playerWeaveAimDirXWorld = dirX;
          world.playerWeaveAimDirYWorld = dirY;
          if (world.isPlayerSecondaryWeaveActiveFlag === 0) {
            world.playerSecondaryWeaveTriggeredFlag = 1;
          }
        }
      }
    } else if (cmd.kind === CommandKind.WeaveEndSecondary) {
      if (!world.isGrappleActiveFlag) {
        world.playerSecondaryWeaveEndFlag = 1;
      }
    } else if (cmd.kind === CommandKind.GrappleFire) {
      const player = world.clusters[0];
      if (player !== undefined && player.isAliveFlag === 1) {
        if (world.grappleInputMode === GrappleInputMode.Toggle && world.isGrappleActiveFlag === 1) {
          // Toggle mode: a second left-click releases the grapple instead of re-firing.
          releaseGrapple(world);
        } else {
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
          fireGrapple(world, aim.xWorld, aim.yWorld);
        }
      }
    } else if (cmd.kind === CommandKind.GrappleRelease) {
      // In Hold mode the grapple releases on mouse-up.
      // In Toggle mode releasing the mouse does nothing; the player clicks again to release.
      if (world.grappleInputMode === GrappleInputMode.Hold) {
        releaseGrapple(world);
      }
    } else if (cmd.kind === CommandKind.ToggleFullscreen) {
      if (!document.fullscreenElement) {
        // Enter fullscreen on key press (requires user gesture; keydown path satisfies this).
        void document.documentElement.requestFullscreen().catch(() => {});
      }
    } else if (cmd.kind === CommandKind.OpenMap) {
      openMapOnly();
    } else if (cmd.kind === CommandKind.Interact) {
      interactInputPulseTrigger = true;
      const playerForInteract = world.clusters[0];
      if (playerForInteract !== undefined && playerForInteract.isAliveFlag === 1) {
        // Check if player is near a save tomb (opens the save menu)
        const nearbyIndex = skillTombRenderer.getNearbyTombIndex(
          playerForInteract.positionXWorld, playerForInteract.positionYWorld,
        );
        if (nearbyIndex >= 0) {
          interactTriggered = true;
        }
        // Check if player is near a skill tomb (unlocks a dust weave).
        // Only show the weave-obtained label — do NOT open the motes menu.
        const nearbySkillTombIndex = skillTombEffectRenderer.getNearbyTombIndex(
          playerForInteract.positionXWorld, playerForInteract.positionYWorld,
        );
        if (nearbySkillTombIndex >= 0 && progress) {
          const tombPositionKey = skillTombEffectRenderer.getTombPositionKey(nearbySkillTombIndex);
          const consumedKey = `${currentRoomId}:${tombPositionKey}`;
          if (!consumedSkillTombKeySet.has(consumedKey)) {
            const weaveId = skillTombEffectRenderer.getTombWeaveId(nearbySkillTombIndex);
            unlockActiveWeave(progress, weaveId);
            consumedSkillTombKeySet.add(consumedKey);
            skillTombEffectRenderer.removeTomb(nearbySkillTombIndex);
            const weaveName = getWeaveDefinition(weaveId)?.displayName ?? 'Unknown Weave';
            combatText.spawnLabel(
              playerForInteract.positionXWorld,
              playerForInteract.positionYWorld - 10,
              `${weaveName} Obtained`,
              performance.now(),
            );
          }
          // Do NOT set interactTriggered — picking up a weave should not open the motes menu.
        }
      }
    }
  }

  return { moveDx, jumpTriggered, openPause, interactTriggered, interactInputPulseTrigger };
}
