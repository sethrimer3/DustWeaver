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
import { unlockActiveWeave, unlockDustType } from '../progression/unlocks';
import { getWeaveDefinition } from '../sim/weaves/weaveDefinition';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { RngState } from '../sim/rng';
import { ParticleKind } from '../sim/particles/kinds';
import { stringToParticleKind } from '../editor/roomJsonSchema';
import { spawnClusterParticles } from './gameSpawn';

/** Radius within which the player can collect a dust swarm by pressing F. */
const DUST_SWARM_COLLECT_RADIUS_WORLD = BLOCK_SIZE_MEDIUM * 2;

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
  /** The active room definition (used for dust swarm pickups). */
  currentRoom: RoomDef;
  /** Keys in the format `${roomId}:dustswarm:${index}` for collected dust swarms. */
  collectedDustSwarmKeySet: Set<string>;
  /** Room-level RNG for particle spawning. */
  levelRng: RngState;
  /** Wall-clock timestamp for the current frame (ms); used for UI animations only. */
  nowMs: number;
  /** Index (0-based) into `currentRoom.lambdaAnchors[]` for the linked anchor, or -1 if none. */
  linkedAnchorIndex: number;
  /** Room ID of the room where the linked anchor lives, or '' if none. */
  linkedAnchorRoomId: string;
  /** Called to link (or re-link) to anchor `index` in room `roomId`. */
  setLambdaAnchorLink: (index: number, roomId: string) => void;
  /** Called to clear the lambda anchor link. */
  clearLambdaAnchorLink: () => void;
  /** Called to trigger a teleport flash effect. `alpha` starts at 1.0. */
  lambdaTeleportFlash: () => void;
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
  /** True when a grapple fire command was accepted for the player this frame. */
  grappleFireTriggered: boolean;
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
    currentRoom, collectedDustSwarmKeySet, levelRng, nowMs,
    linkedAnchorIndex, linkedAnchorRoomId,
    setLambdaAnchorLink, clearLambdaAnchorLink, lambdaTeleportFlash,
  } = ctx;

  const commands = collectCommands(inputState);
  let openPause = false;
  let moveDx = 0;
  let jumpTriggered = false;
  let interactTriggered = false;
  let interactInputPulseTrigger = false;
  let grappleFireTriggered = false;

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
          grappleFireTriggered = true;
          // If RMB is held while firing, trigger an instant zip toward the new anchor.
          if (world.isGrappleActiveFlag === 1 && world.isGrappleZipActiveFlag === 0
              && ctx.inputState.isRightMouseDownFlag === 1) {
            world.isGrappleZipTriggeredFlag = 1;
          }
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
              nowMs,
            );
          }
          // Do NOT set interactTriggered — picking up a weave should not open the motes menu.
        }

        // ── Dust swarm collection ──────────────────────────────────────────────
        // Player presses F near a dust swarm to collect it, receiving dust particles.
        const roomDustSwarms = currentRoom.dustSwarms ?? [];
        for (let i = 0; i < roomDustSwarms.length; i++) {
          const swarmKey = `${currentRoomId}:dustswarm:${i}`;
          if (collectedDustSwarmKeySet.has(swarmKey)) continue;
          const sw = roomDustSwarms[i];
          const swCx = (sw.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
          const swCy = (sw.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
          const sdx = playerForInteract.positionXWorld - swCx;
          const sdy = playerForInteract.positionYWorld - swCy;
          if (sdx * sdx + sdy * sdy <= DUST_SWARM_COLLECT_RADIUS_WORLD * DUST_SWARM_COLLECT_RADIUS_WORLD) {
            collectedDustSwarmKeySet.add(swarmKey);
            const rawKind = stringToParticleKind(sw.dustKind);
            const dustKind = rawKind !== null ? rawKind : ParticleKind.Physical;
            // Permanently unlock this dust type in the player's progression.
            if (progress) {
              unlockDustType(progress, dustKind);
              // Persist swarm collection key so swarms don't reappear after save/load.
              if (!progress.collectedDustSwarmKeys.includes(swarmKey)) {
                progress.collectedDustSwarmKeys.push(swarmKey);
              }
            }
            spawnClusterParticles(
              world,
              playerForInteract.entityId,
              playerForInteract.positionXWorld,
              playerForInteract.positionYWorld,
              dustKind,
              sw.dustCount,
              levelRng,
            );
            const kindName = sw.dustKind;
            combatText.spawnLabel(
              playerForInteract.positionXWorld,
              playerForInteract.positionYWorld - 10,
              `+${sw.dustCount} ${kindName} Dust`,
              nowMs,
            );
          }
        }
        // ── Lambda Anchor interaction ──────────────────────────────────────────
        // First press F near anchor → link. Second press F while already linked
        // in this room → teleport back to the anchor's position.
        const LAMBDA_INTERACT_RADIUS_WORLD = BLOCK_SIZE_MEDIUM * 2;
        const roomAnchors = currentRoom.lambdaAnchors ?? [];
        for (let i = 0; i < roomAnchors.length; i++) {
          const anchor = roomAnchors[i];
          const anchorCX = (anchor.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
          const anchorCY = (anchor.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
          const adx = playerForInteract.positionXWorld - anchorCX;
          const ady = playerForInteract.positionYWorld - anchorCY;
          const distSq = adx * adx + ady * ady;
          if (distSq > LAMBDA_INTERACT_RADIUS_WORLD * LAMBDA_INTERACT_RADIUS_WORLD) continue;

          if (linkedAnchorIndex === i && linkedAnchorRoomId === currentRoomId) {
            // Already linked to this anchor — teleport back to it.
            const player = world.clusters.find(c => c.isPlayerFlag === 1);
            if (player) {
              player.positionXWorld = anchorCX;
              player.positionYWorld = anchorCY - player.halfHeightWorld;
              player.velocityXWorld = 0;
              player.velocityYWorld = 0;
              lambdaTeleportFlash();
              clearLambdaAnchorLink();
            }
          } else {
            // Not yet linked — link to this anchor.
            setLambdaAnchorLink(i, currentRoomId);
            combatText.spawnLabel(
              playerForInteract.positionXWorld,
              playerForInteract.positionYWorld - 10,
              'Anchor Linked',
              nowMs,
            );
          }
          break; // Only interact with the nearest anchor (first match).
        }
      }
    }
  }

  return { moveDx, jumpTriggered, openPause, interactTriggered, interactInputPulseTrigger, grappleFireTriggered };
}
