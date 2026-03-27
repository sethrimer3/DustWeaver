import { createWorldState, WorldState, MAX_PARTICLES, MAX_WALLS } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles, fireGrapple, releaseGrapple } from '../sim/clusters/grapple';
import { ParticleKind } from '../sim/particles/kinds';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { tick } from '../sim/tick';
import { RngState, createRng, nextFloat, nextFloatRange } from '../sim/rng';
import { createSnapshot } from '../render/snapshot';
import { renderParticles } from '../render/particles/renderer';
import { renderClusters, renderWalls, renderGrapple } from '../render/clusters/renderer';
import { renderHudOverlay, HudState, HudDebugState } from '../render/hud/overlay';
import { EnvironmentalDustLayer } from '../render/environmentalDust';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners, collectCommands, JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import { CommandKind } from '../input/commands';
import { RoomDef, BLOCK_SIZE_WORLD } from '../levels/roomDef';
import { ROOM_REGISTRY, STARTING_ROOM_ID } from '../levels/rooms';
import { createCameraState, snapCamera, updateCamera, getCameraOffset } from '../render/camera';
import { setActiveBlockSpriteWorld } from '../render/walls/blockSpriteRenderer';

const FIXED_DT_MS = 16.666;
/** Canonical level-grid block size (sprites/objects snap to this). */
const BLOCK_SIZE_PX = BLOCK_SIZE_WORLD;
/** Total particles spawned for the player cluster — distributed across loadout kinds. */
const PARTICLE_COUNT_PER_CLUSTER = 20;
/** Number of background Fluid particles filling the entire arena. */
const BACKGROUND_FLUID_COUNT = 300;

/** Boss clusters receive this multiplier on their base HP for extra durability. */
const BOSS_HP_MULTIPLIER = 2;

// Touch joystick visual constants (outer radius matches the max drag radius exported from handler.ts)
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/** Blocks of transition tunnel extending past room boundary. */
const TUNNEL_DETECT_MARGIN_WORLD = 2 * BLOCK_SIZE_WORLD;

export interface GameScreenCallbacks {
  onReturnToMenu: () => void;
}

/**
 * Spawns `count` particles of `kind` orbiting the given cluster position.
 * Sets all new particle buffer fields including anchor, lifetime, and noise seed.
 */
function spawnClusterParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  kind: ParticleKind,
  count: number,
  rng: RngState,
): void {
  const profile = getElementProfile(kind);

  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;

    // Evenly-spaced anchor angles with a small random offset
    const baseAngleRad = (i / count) * Math.PI * 2;
    const jitter = nextFloatRange(rng, -0.3, 0.3);
    const anchorAngleRad = baseAngleRad + jitter;

    const radiusVariance = profile.orbitRadiusWorld * 0.25;
    const anchorRadius   = profile.orbitRadiusWorld
      + nextFloatRange(rng, -radiusVariance, radiusVariance);

    // Spawn position at anchor target
    world.positionXWorld[idx] = clusterXWorld + Math.cos(anchorAngleRad) * anchorRadius;
    world.positionYWorld[idx] = clusterYWorld + Math.sin(anchorAngleRad) * anchorRadius;

    const spawnSpeed = 15.0;
    world.velocityXWorld[idx] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);
    world.velocityYWorld[idx] = nextFloatRange(rng, -spawnSpeed, spawnSpeed);

    world.forceX[idx]            = 0;
    world.forceY[idx]            = 0;
    world.massKg[idx]            = profile.massKg;
    world.chargeUnits[idx]       = 0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = kind;
    world.ownerEntityId[idx]     = clusterEntityId;
    world.anchorAngleRad[idx]    = anchorAngleRad;
    world.anchorRadiusWorld[idx] = anchorRadius;

    // Stagger initial age so particles don't all respawn simultaneously
    const ageOffsetTicks = nextFloatRange(rng, 0, profile.lifetimeBaseTicks);
    const lifetimeVariance = nextFloatRange(
      rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks,
    );
    world.lifetimeTicks[idx] = Math.max(2.0, profile.lifetimeBaseTicks + lifetimeVariance);
    world.ageTicks[idx]      = ageOffsetTicks;

    // Unique per-particle noise phase so particles don't all jitter in unison
    world.noiseTickSeed[idx] = (nextFloat(rng) * 0xffffffff) >>> 0;

    world.behaviorMode[idx]        = 0;
    world.particleDurability[idx]  = profile.toughness;
    world.respawnDelayTicks[idx]   = 0;
    world.attackModeTicksLeft[idx] = 0;
  }
}

/**
 * Distributes `totalCount` particles across the kinds in `loadout`,
 * spreading them as evenly as possible.
 */
function spawnLoadoutParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  loadout: ParticleKind[],
  totalCount: number,
  rng: RngState,
): void {
  if (loadout.length === 0) {
    // Fallback to Physical if somehow the loadout is empty
    spawnClusterParticles(world, clusterEntityId, clusterXWorld, clusterYWorld, ParticleKind.Physical, totalCount, rng);
    return;
  }

  const baseCount = Math.floor(totalCount / loadout.length);
  let remainder   = totalCount - baseCount * loadout.length;

  for (let k = 0; k < loadout.length; k++) {
    const extraCount = remainder > 0 ? 1 : 0;
    remainder -= extraCount;
    spawnClusterParticles(
      world,
      clusterEntityId,
      clusterXWorld,
      clusterYWorld,
      loadout[k],
      baseCount + extraCount,
      rng,
    );
  }
}

/**
 * Scatters `count` background Fluid particles randomly across the world area.
 */
function spawnBackgroundFluidParticles(
  world: WorldState,
  count: number,
  rng: RngState,
): void {
  const profile = getElementProfile(ParticleKind.Fluid);

  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;

    world.positionXWorld[idx] = nextFloat(rng) * world.worldWidthWorld;
    world.positionYWorld[idx] = nextFloat(rng) * world.worldHeightWorld;
    world.velocityXWorld[idx] = 0.0;
    world.velocityYWorld[idx] = 0.0;
    world.forceX[idx]            = 0.0;
    world.forceY[idx]            = 0.0;
    world.massKg[idx]            = profile.massKg;
    world.chargeUnits[idx]       = 0.0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = ParticleKind.Fluid;
    world.ownerEntityId[idx]     = -1;
    world.anchorAngleRad[idx]    = 0.0;
    world.anchorRadiusWorld[idx] = 0.0;
    world.disturbanceFactor[idx] = 0.0;

    const lifetimeVariance = nextFloatRange(rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks);
    world.lifetimeTicks[idx] = Math.max(2.0, profile.lifetimeBaseTicks + lifetimeVariance);
    world.ageTicks[idx]      = nextFloat(rng) * profile.lifetimeBaseTicks;

    world.noiseTickSeed[idx] = (nextFloat(rng) * 0xffffffff) >>> 0;
  }
}

/** Loads wall definitions from a RoomDef into the WorldState wall buffers. */
function loadRoomWalls(world: WorldState, room: RoomDef): void {
  const count = Math.min(room.walls.length, MAX_WALLS);
  world.wallCount = count;
  for (let wi = 0; wi < count; wi++) {
    const def = room.walls[wi];
    world.wallXWorld[wi] = def.xBlock * BLOCK_SIZE_PX;
    world.wallYWorld[wi] = def.yBlock * BLOCK_SIZE_PX;
    world.wallWWorld[wi] = Math.max(BLOCK_SIZE_PX, def.wBlock * BLOCK_SIZE_PX);
    world.wallHWorld[wi] = Math.max(BLOCK_SIZE_PX, def.hBlock * BLOCK_SIZE_PX);
  }
}



/** Background fill colour for each world number. */
function worldBgColor(worldNumber: number): string {
  switch (worldNumber) {
    case 0:  return '#0d1a0f'; // pale dark green
    case 1:  return '#051408'; // deep dark green
    case 2:  return '#080c1a'; // dark blue
    default: return '#0a0a12';
  }
}

/** Background fill colour as RGB floats for WebGL. */
function worldBgColorRgb(worldNumber: number): [number, number, number] {
  switch (worldNumber) {
    case 0:  return [0.051, 0.102, 0.059]; // #0d1a0f
    case 1:  return [0.020, 0.078, 0.031]; // #051408
    case 2:  return [0.031, 0.047, 0.102]; // #080c1a
    default: return [0.039, 0.039, 0.071]; // #0a0a12
  }
}

/**
 * Draws a gradient darkness overlay at room transition tunnel edges.
 * The gradient goes from transparent to 100% black at the very edge.
 */
function drawTunnelDarkness(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const roomWidthWorld = room.widthBlocks * BLOCK_SIZE_PX;
  const fadeDepthWorld = 4 * BLOCK_SIZE_PX; // 4 blocks of fade

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];
    const openTopWorld = t.positionBlock * BLOCK_SIZE_PX;
    const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_PX;

    if (t.direction === 'left') {
      // Fade from left room edge inward
      const x0Screen = 0 * zoom + offsetXPx;
      const x1Screen = fadeDepthWorld * zoom + offsetXPx;
      const y0Screen = (openTopWorld - BLOCK_SIZE_PX) * zoom + offsetYPx;
      const y1Screen = (openBottomWorld + BLOCK_SIZE_PX) * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(x0Screen, 0, x1Screen, 0);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen - 200, y0Screen, x1Screen - x0Screen + 200, y1Screen - y0Screen);
    } else if (t.direction === 'right') {
      // Fade from right room edge inward
      const x0Screen = (roomWidthWorld - fadeDepthWorld) * zoom + offsetXPx;
      const x1Screen = roomWidthWorld * zoom + offsetXPx;
      const y0Screen = (openTopWorld - BLOCK_SIZE_PX) * zoom + offsetYPx;
      const y1Screen = (openBottomWorld + BLOCK_SIZE_PX) * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(x0Screen, 0, x1Screen, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen, y0Screen, x1Screen - x0Screen + 200, y1Screen - y0Screen);
    }
  }

  ctx.restore();
}

/**
 * Converts a screen-space aim position (mouse/touch in screen pixels)
 * back to world coordinates given the current camera transform.
 */
function screenToWorld(screenXPx: number, screenYPx: number, offsetXPx: number, offsetYPx: number, zoom: number): { xWorld: number; yWorld: number } {
  return {
    xWorld: (screenXPx - offsetXPx) / zoom,
    yWorld: (screenYPx - offsetYPx) / zoom,
  };
}

export function startGameScreen(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  playerLoadout: ParticleKind[],
  startRoomId: string | null,
  callbacks: GameScreenCallbacks,
): () => void {
  const webglRenderer = new WebGLParticleRenderer();

  function resizeCanvas(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (webglRenderer.isAvailable) {
      webglRenderer.resize(canvas.width, canvas.height);
    }
  }

  resizeCanvas();

  if (webglRenderer.isAvailable) {
    canvas.parentElement!.insertBefore(webglRenderer.canvas, canvas);
  }

  const ctx = canvas.getContext('2d')!;
  const camera = createCameraState();

  // ── Room state ────────────────────────────────────────────────────────────
  let currentRoom: RoomDef = ROOM_REGISTRY.get(startRoomId ?? STARTING_ROOM_ID)!;
  let bgColor = worldBgColor(currentRoom.worldNumber);
  let roomWidthWorld = currentRoom.widthBlocks * BLOCK_SIZE_PX;
  let roomHeightWorld = currentRoom.heightBlocks * BLOCK_SIZE_PX;

  /** Initialises (or re-initialises) world state for the given room. */
  function loadRoom(room: RoomDef, spawnXBlock: number, spawnYBlock: number): void {
    currentRoom = room;
    bgColor = worldBgColor(room.worldNumber);
    roomWidthWorld = room.widthBlocks * BLOCK_SIZE_PX;
    roomHeightWorld = room.heightBlocks * BLOCK_SIZE_PX;

    // Apply world-specific block sprites and background
    setActiveBlockSpriteWorld(room.worldNumber);
    const [bgR, bgG, bgB] = worldBgColorRgb(room.worldNumber);
    webglRenderer.setBackgroundColor(bgR, bgG, bgB);

    // Reset world state
    world.tick = 0;
    world.particleCount = 0;
    world.clusters.length = 0;
    world.wallCount = 0;
    world.worldWidthWorld = roomWidthWorld;
    world.worldHeightWorld = roomHeightWorld;

    // Reset grapple state
    world.isGrappleActiveFlag = 0;
    world.grappleParticleStartIndex = -1;

    // Spawn player at the given block position
    const spawnXWorld = spawnXBlock * BLOCK_SIZE_PX;
    const spawnYWorld = spawnYBlock * BLOCK_SIZE_PX;
    const playerCluster = createClusterState(1, spawnXWorld, spawnYWorld, 1, PARTICLE_COUNT_PER_CLUSTER);
    world.clusters.push(playerCluster);
    spawnLoadoutParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, playerLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng);

    // Spawn enemies
    let nextEntityId = 2;
    for (let ei = 0; ei < room.enemies.length; ei++) {
      const enemyDef = room.enemies[ei];
      const ex = enemyDef.xBlock * BLOCK_SIZE_PX;
      const ey = enemyDef.yBlock * BLOCK_SIZE_PX;
      const hp = enemyDef.isBossFlag === 1 ? enemyDef.particleCount * BOSS_HP_MULTIPLIER : enemyDef.particleCount;
      const enemyCluster = createClusterState(nextEntityId++, ex, ey, 0, hp);
      world.clusters.push(enemyCluster);
      spawnLoadoutParticles(world, enemyCluster.entityId, ex, ey, enemyDef.kinds, enemyDef.particleCount, levelRng);
    }

    // Spawn background Fluid particles
    spawnBackgroundFluidParticles(world, BACKGROUND_FLUID_COUNT, levelRng);

    // Reserve grapple chain particle slots
    initGrappleChainParticles(world, 1);

    // Load walls
    loadRoomWalls(world, room);

    // Init dust
    environmentalDust.initFromWorld(world);

    // Snap camera to player position
    snapCamera(camera, spawnXWorld, spawnYWorld, roomWidthWorld, roomHeightWorld, canvas.width, canvas.height);
  }

  const world = createWorldState(FIXED_DT_MS, 42);
  const levelRng = createRng(12345);
  const environmentalDust = new EnvironmentalDustLayer();

  // Initial room load
  loadRoom(currentRoom, currentRoom.playerSpawnBlock[0], currentRoom.playerSpawnBlock[1]);

  const inputState = createInputState();
  const detachInput = attachInputListeners(canvas, inputState);

  let menuButton: HTMLButtonElement | null = null;
  if (IS_TOUCH_DEVICE) {
    menuButton = document.createElement('button');
    menuButton.textContent = 'MENU';
    menuButton.style.cssText = `
      position: absolute; top: 16px; right: 16px;
      background: rgba(0,0,0,0.6); border: 2px solid #00cfff; color: #00cfff;
      padding: 10px 20px; font-size: 1rem; font-family: 'Cinzel', serif;
      cursor: pointer; border-radius: 6px; touch-action: manipulation;
    `;
    menuButton.addEventListener('click', () => {
      inputState.isEscapePressed = true;
    });
    uiRoot.appendChild(menuButton);
  }

  const hudState: HudState = { fps: 0, frameTimeMs: 0, particleCount: 0 };

  let lastTimestampMs = 0;
  let accumulatorMs = 0;
  let frameCount = 0;
  let fpsAccMs = 0;
  let isRunning = true;
  let rafHandle = 0;

  function onResize(): void {
    resizeCanvas();
  }
  window.addEventListener('resize', onResize);

  /**
   * Check if the player has entered a transition tunnel and should move
   * to the adjacent room.
   */
  function checkRoomTransitions(): boolean {
    const player = world.clusters[0];
    if (player === undefined || player.isAliveFlag === 0) return false;

    const px = player.positionXWorld;
    const py = player.positionYWorld;

    for (let ti = 0; ti < currentRoom.transitions.length; ti++) {
      const t = currentRoom.transitions[ti];
      const openTopWorld = t.positionBlock * BLOCK_SIZE_PX;
      const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_PX;

      let isInTunnel = false;
      if (t.direction === 'left') {
        isInTunnel = px < TUNNEL_DETECT_MARGIN_WORLD && py >= openTopWorld && py <= openBottomWorld;
      } else if (t.direction === 'right') {
        isInTunnel = px > roomWidthWorld - TUNNEL_DETECT_MARGIN_WORLD && py >= openTopWorld && py <= openBottomWorld;
      }

      if (isInTunnel) {
        const targetRoom = ROOM_REGISTRY.get(t.targetRoomId);
        if (targetRoom !== undefined) {
          loadRoom(targetRoom, t.targetSpawnBlock[0], t.targetSpawnBlock[1]);
          return true;
        }
      }
    }
    return false;
  }

  function frame(timestampMs: number): void {
    if (!isRunning) return;

    const elapsedMs = lastTimestampMs === 0 ? FIXED_DT_MS : timestampMs - lastTimestampMs;
    lastTimestampMs = timestampMs;

    hudState.frameTimeMs = elapsedMs;
    fpsAccMs += elapsedMs;
    frameCount++;
    if (fpsAccMs >= 500) {
      hudState.fps = (frameCount / fpsAccMs) * 1000;
      fpsAccMs = 0;
      frameCount = 0;
    }

    // ── Compute camera offset for screen → world conversion ──────────────
    const { offsetXPx, offsetYPx } = getCameraOffset(camera, canvas.width, canvas.height);
    const zoom = camera.zoom;

    const commands = collectCommands(inputState);
    let returnToMenu = false;
    let moveDx = 0;
    let dashAimXPx = 0;
    let dashTriggered = false;
    let jumpTriggered = false;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      if (cmd.kind === CommandKind.ReturnToMap) {
        returnToMenu = true;
      } else if (cmd.kind === CommandKind.MovePlayer) {
        moveDx = cmd.dx;
      } else if (cmd.kind === CommandKind.Jump) {
        jumpTriggered = true;
      } else if (cmd.kind === CommandKind.Dash) {
        dashTriggered = true;
        dashAimXPx = cmd.aimXPx;
      } else if (cmd.kind === CommandKind.Attack) {
        const player = world.clusters[0];
        if (player !== undefined) {
          // Convert screen-space aim to world coordinates
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom);
          let dirX = aim.xWorld - player.positionXWorld;
          let dirY = aim.yWorld - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = 1.0; dirY = 0.0; } else { dirX /= len; dirY /= len; }
          world.playerAttackDirXWorld = dirX;
          world.playerAttackDirYWorld = dirY;
          world.playerAttackTriggeredFlag = 1;
        }
      } else if (cmd.kind === CommandKind.BlockStart || cmd.kind === CommandKind.BlockUpdate) {
        const player = world.clusters[0];
        if (player !== undefined) {
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom);
          let dirX = aim.xWorld - player.positionXWorld;
          let dirY = aim.yWorld - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = world.playerBlockDirXWorld; dirY = world.playerBlockDirYWorld; }
          else { dirX /= len; dirY /= len; }
          world.playerBlockDirXWorld = dirX;
          world.playerBlockDirYWorld = dirY;
          world.isPlayerBlockingFlag = 1;
        }
      } else if (cmd.kind === CommandKind.BlockEnd) {
        world.isPlayerBlockingFlag = 0;
      } else if (cmd.kind === CommandKind.GrappleFire) {
        const player = world.clusters[0];
        if (player !== undefined && player.isAliveFlag === 1) {
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom);
          fireGrapple(world, aim.xWorld, aim.yWorld);
        }
      } else if (cmd.kind === CommandKind.GrappleRelease) {
        releaseGrapple(world);
      }
    }

    if (returnToMenu) {
      isRunning = false;
      detachInput();
      callbacks.onReturnToMenu();
      return;
    }

    // ── Room transition check ──────────────────────────────────────────────
    if (checkRoomTransitions()) {
      // Room changed — skip this frame's sim, render the new room next frame
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Sim ticks ──────────────────────────────────────────────────────────
    accumulatorMs += elapsedMs;
    while (accumulatorMs >= FIXED_DT_MS) {
      const player = world.clusters[0];
      if (moveDx !== 0) {
        if (player !== undefined) {
          world.playerMoveInputDxWorld = moveDx > 0 ? 1.0 : -1.0;
          world.playerMoveInputDyWorld = 0.0;
        }
      }
      if (jumpTriggered) {
        world.playerJumpTriggeredFlag = 1;
        jumpTriggered = false;
      }
      world.playerJumpHeldFlag = inputState.isJumpHeldFlag ? 1 : 0;
      if (dashTriggered) {
        world.playerDashTriggeredFlag = 1;
        const playerForDash = world.clusters[0];
        if (playerForDash !== undefined) {
          if (moveDx !== 0) {
            world.playerDashDirXWorld = moveDx > 0 ? 1.0 : -1.0;
            world.playerDashDirYWorld = 0.0;
          } else {
            const aim = screenToWorld(dashAimXPx, 0, offsetXPx, offsetYPx, zoom);
            const dirX = aim.xWorld - playerForDash.positionXWorld;
            const absX = dirX < 0 ? -dirX : dirX;
            if (absX > 1.0) {
              world.playerDashDirXWorld = dirX > 0 ? 1.0 : -1.0;
            } else {
              world.playerDashDirXWorld = playerForDash.velocityXWorld >= 0 ? 1.0 : -1.0;
            }
            world.playerDashDirYWorld = 0.0;
          }
        }
        dashTriggered = false;
      }
      tick(world);
      environmentalDust.update(world, FIXED_DT_MS);
      accumulatorMs -= FIXED_DT_MS;
    }

    // ── Update camera to follow player ──────────────────────────────────────
    const playerForCamera = world.clusters[0];
    if (playerForCamera !== undefined && playerForCamera.isAliveFlag === 1) {
      updateCamera(
        camera,
        playerForCamera.positionXWorld,
        playerForCamera.positionYWorld,
        roomWidthWorld,
        roomHeightWorld,
        canvas.width,
        canvas.height,
        elapsedMs / 1000,
      );
    }

    // ── Recompute camera offset after update ─────────────────────────────────
    const camOff = getCameraOffset(camera, canvas.width, canvas.height);
    const ox = camOff.offsetXPx;
    const oy = camOff.offsetYPx;

    let aliveCount = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.isAliveFlag[i] === 1) aliveCount++;
    }
    hudState.particleCount = aliveCount;

    // ── Populate movement debug state from the player cluster ─────────────────
    const playerClusterForHud = world.clusters[0];
    if (playerClusterForHud !== undefined && playerClusterForHud.isAliveFlag === 1) {
      const dbg: HudDebugState = {
        isGrounded:           playerClusterForHud.isGroundedFlag === 1,
        coyoteTimeTicks:      playerClusterForHud.coyoteTimeTicks,
        jumpBufferTicks:      playerClusterForHud.jumpBufferTicks,
        isWallSlidingFlag:    playerClusterForHud.isWallSlidingFlag === 1,
        isTouchingWallLeft:   playerClusterForHud.isTouchingWallLeftFlag === 1,
        isTouchingWallRight:  playerClusterForHud.isTouchingWallRightFlag === 1,
        wallJumpLockoutTicks: playerClusterForHud.wallJumpLockoutTicks,
        isGrappleActive:      world.isGrappleActiveFlag === 1,
        grappleLengthWorld:   world.grappleLengthWorld,
        grapplePullInAmountWorld: world.grapplePullInAmountWorld,
      };
      hudState.debug = dbg;
    }

    const snapshot = createSnapshot(world);

    // ── Render ───────────────────────────────────────────────────────────────
    if (webglRenderer.isAvailable) {
      webglRenderer.render(snapshot, ox, oy, zoom);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      renderParticles(ctx, snapshot, ox, oy, zoom);
    }

    // Walls before cluster indicators so clusters are drawn on top
    renderWalls(ctx, snapshot, ox, oy, zoom);
    renderClusters(ctx, snapshot, ox, oy, zoom);
    renderGrapple(ctx, snapshot, ox, oy, zoom);

    // Tunnel darkness overlays
    drawTunnelDarkness(ctx, currentRoom, ox, oy, zoom);

    environmentalDust.render(ctx, ox, oy, zoom);
    renderHudOverlay(ctx, hudState);

    // ── Room name banner (top-center) ──────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '13px monospace';
    const roomLabel = currentRoom.name;
    const labelW = ctx.measureText(roomLabel).width;
    ctx.fillText(roomLabel, (canvas.width - labelW) / 2, 22);

    // ── Touch joystick ───────────────────────────────────────────────────────
    if (inputState.isTouchJoystickActiveFlag === 1) {
      const bx = inputState.touchJoystickBaseXPx;
      const by = inputState.touchJoystickBaseYPx;
      const cx = inputState.touchJoystickCurrentXPx;
      const cy = inputState.touchJoystickCurrentYPx;

      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, JOYSTICK_OUTER_RADIUS_PX, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,207,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,207,255,0.08)';
      ctx.fill();

      const dx = cx - bx;
      const dy = cy - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let thumbXPx = cx;
      let thumbYPx = cy;
      if (dist > JOYSTICK_OUTER_RADIUS_PX) {
        thumbXPx = bx + (dx / dist) * JOYSTICK_OUTER_RADIUS_PX;
        thumbYPx = by + (dy / dist) * JOYSTICK_OUTER_RADIUS_PX;
      }

      ctx.beginPath();
      ctx.arc(thumbXPx, thumbYPx, JOYSTICK_INNER_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,207,255,0.45)';
      ctx.fill();
      ctx.restore();
    }

    // ── Control hints ────────────────────────────────────────────────────────
    const controlHintText = IS_TOUCH_DEVICE
      ? 'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MENU to return'
      : 'A/D=walk  |  W/Space/↑=jump  |  Shift=dash  |  Click=attack  |  Hold=block  |  Hold E=grapple  |  ESC=menu';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px monospace';
    const hintWidthPx = ctx.measureText(controlHintText).width;
    ctx.fillText(controlHintText, (canvas.width - hintWidthPx) / 2, canvas.height - 10);

    rafHandle = requestAnimationFrame(frame);
  }

  rafHandle = requestAnimationFrame(frame);

  return () => {
    isRunning = false;
    if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
    detachInput();
    webglRenderer.dispose();
    window.removeEventListener('resize', onResize);
    if (menuButton !== null && menuButton.parentElement !== null) {
      menuButton.parentElement.removeChild(menuButton);
    }
  };
}
