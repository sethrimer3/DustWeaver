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
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ROOM_REGISTRY, STARTING_ROOM_ID } from '../levels/rooms';
import { createCameraState, snapCamera, updateCamera, getCameraOffset } from '../render/camera';
import { setActiveBlockSpriteWorld } from '../render/walls/blockSpriteRenderer';
import { showPauseMenu, PauseMenuState } from '../ui/pauseMenu';
import { renderWorldBackground } from '../render/backgroundRenderer';
import { showDeathScreen } from '../ui/deathScreen';
import { showSkillTombMenu } from '../ui/skillTombMenu';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { PlayerProgress } from '../progression/playerProgress';
import { createEditorController, EditorController } from '../editor/editorController';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout, WEAVE_SLOT_PRIMARY, WEAVE_SLOT_SECONDARY } from '../sim/weaves/playerLoadout';
import { resetRadiantTetherState } from '../sim/clusters/radiantTetherAi';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';

const FIXED_DT_MS = 16.666;

/** Baseline virtual width at 16:9; height is authoritative for fixed zoom. */
const BASE_VIRTUAL_WIDTH_PX = 480;
/** Fixed virtual height so world-to-pixel zoom stays constant on every display. */
const FIXED_VIRTUAL_HEIGHT_PX = 270;
/** Total particles spawned for the player cluster — distributed across loadout kinds. */
const PARTICLE_COUNT_PER_CLUSTER = 20;
/** Number of background Fluid particles filling the entire arena. */
const BACKGROUND_FLUID_COUNT = 300;

/** Boss clusters receive this multiplier on their base HP for extra durability. */
const BOSS_HP_MULTIPLIER = 2;

/** Half-width and half-height (world units) of a flying eye cluster hitbox. */
const FLYING_EYE_HALF_SIZE_WORLD = 2.8;

// Touch joystick visual constants (outer radius matches the max drag radius exported from handler.ts)
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/** Blocks of transition tunnel extending past room boundary. */
const TUNNEL_DETECT_MARGIN_WORLD = 2 * BLOCK_SIZE_MEDIUM;

export interface GameScreenCallbacks {
  onReturnToMenu: () => void;
  onSave?: () => void;
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
 * Spawns particles for a Weave loadout, assigning weaveSlotId to each particle
 * based on which Weave binding owns the dust type.
 */
function spawnWeaveLoadoutParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  weaveLoadout: PlayerWeaveLoadout,
  totalCount: number,
  rng: RngState,
): void {
  // Collect all dust from both bindings
  const allDust = [...weaveLoadout.primary.boundDust, ...weaveLoadout.secondary.boundDust];
  if (allDust.length === 0) {
    spawnClusterParticles(world, clusterEntityId, clusterXWorld, clusterYWorld, ParticleKind.Physical, totalCount, rng);
    return;
  }

  // Distribute totalCount across all bound dust types
  const baseCount = Math.floor(totalCount / allDust.length);
  let remainder = totalCount - baseCount * allDust.length;

  // Track the particle index range for each dust entry so we can assign weave slots
  const primaryCount = weaveLoadout.primary.boundDust.length;

  for (let k = 0; k < allDust.length; k++) {
    const extraCount = remainder > 0 ? 1 : 0;
    remainder -= extraCount;
    const count = baseCount + extraCount;

    const startIdx = world.particleCount;
    spawnClusterParticles(world, clusterEntityId, clusterXWorld, clusterYWorld, allDust[k], count, rng);
    const endIdx = world.particleCount;

    // Assign weave slot based on which binding this dust came from
    const weaveSlot = k < primaryCount ? WEAVE_SLOT_PRIMARY : WEAVE_SLOT_SECONDARY;
    for (let i = startIdx; i < endIdx; i++) {
      world.weaveSlotId[i] = weaveSlot;
    }
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

/**
 * Loads wall definitions from a RoomDef into the WorldState wall buffers.
 * After converting block units to world units, runs an iterative merge pass
 * that combines axis-aligned, contiguous wall rectangles into larger AABBs.
 * This eliminates internal seam edges that cause ghost collisions.
 */
function loadRoomWalls(world: WorldState, room: RoomDef): void {
  const rawCount = Math.min(room.walls.length, MAX_WALLS);

  // Pre-allocated merge workspace (avoid per-call allocation)
  // We use simple arrays here because this runs only at room load, not per-tick.
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  const hs: number[] = [];

  // Convert block units to world units
  for (let wi = 0; wi < rawCount; wi++) {
    const def = room.walls[wi];
    xs.push(def.xBlock * BLOCK_SIZE_MEDIUM);
    ys.push(def.yBlock * BLOCK_SIZE_MEDIUM);
    ws.push(Math.max(BLOCK_SIZE_MEDIUM, def.wBlock * BLOCK_SIZE_MEDIUM));
    hs.push(Math.max(BLOCK_SIZE_MEDIUM, def.hBlock * BLOCK_SIZE_MEDIUM));
  }

  // ── Iterative merge pass ─────────────────────────────────────────────────
  // Two rectangles may merge if they share a complete face:
  //   - Same Y and height, contiguous on X (horizontal merge)
  //   - Same X and width,  contiguous on Y (vertical merge)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        // Horizontal merge: same Y, same H, contiguous on X axis
        if (ys[i] === ys[j] && hs[i] === hs[j]) {
          const rightI = xs[i] + ws[i];
          const rightJ = xs[j] + ws[j];
          if (rightI === xs[j]) {
            // i is left of j — extend i to cover j
            ws[i] += ws[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
          if (rightJ === xs[i]) {
            // j is left of i — extend i leftward to cover j
            xs[i] = xs[j];
            ws[i] += ws[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
        }
        // Vertical merge: same X, same W, contiguous on Y axis
        if (xs[i] === xs[j] && ws[i] === ws[j]) {
          const bottomI = ys[i] + hs[i];
          const bottomJ = ys[j] + hs[j];
          if (bottomI === ys[j]) {
            // i is above j — extend i downward to cover j
            hs[i] += hs[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
          if (bottomJ === ys[i]) {
            // j is above i — extend i upward to cover j
            ys[i] = ys[j];
            hs[i] += hs[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
      if (merged) break;
    }
  }

  // Write merged rectangles into wall buffers
  const finalCount = Math.min(xs.length, MAX_WALLS);
  world.wallCount = finalCount;
  for (let wi = 0; wi < finalCount; wi++) {
    world.wallXWorld[wi] = xs[wi];
    world.wallYWorld[wi] = ys[wi];
    world.wallWWorld[wi] = ws[wi];
    world.wallHWorld[wi] = hs[wi];
  }
}



/** Background fill colour for each world number. */
function worldBgColor(worldNumber: number): string {
  switch (worldNumber) {
    case 0:  return '#0d1a0f'; // pale dark green
    case 1:  return '#051408'; // deep dark green
    case 2:  return '#080c1a'; // dark blue
    case 3:  return '#1a0500'; // deep dark red-orange (fire/lava world)
    default: return '#0a0a12';
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
  const roomWidthWorld = room.widthBlocks * BLOCK_SIZE_MEDIUM;
  const fadeDepthWorld = 4 * BLOCK_SIZE_MEDIUM; // 4 blocks of fade

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];
    const openTopWorld = t.positionBlock * BLOCK_SIZE_MEDIUM;
    const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;

    if (t.direction === 'left') {
      // Fade from left room edge inward
      const x0Screen = 0 * zoom + offsetXPx;
      const x1Screen = fadeDepthWorld * zoom + offsetXPx;
      const y0Screen = (openTopWorld - BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;
      const y1Screen = (openBottomWorld + BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(x0Screen, 0, x1Screen, 0);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen - 200, y0Screen, x1Screen - x0Screen + 200, y1Screen - y0Screen);
    } else if (t.direction === 'right') {
      // Fade from right room edge inward
      const x0Screen = (roomWidthWorld - fadeDepthWorld) * zoom + offsetXPx;
      const x1Screen = roomWidthWorld * zoom + offsetXPx;
      const y0Screen = (openTopWorld - BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;
      const y1Screen = (openBottomWorld + BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;

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
 * Converts a device-space aim position (mouse/touch in device pixels)
 * back to world coordinates given the current camera transform.
 * First maps device coords to virtual canvas space, then applies camera inverse.
 */
function screenToWorld(
  deviceXPx: number,
  deviceYPx: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  deviceWidthPx: number,
  deviceHeightPx: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
): { xWorld: number; yWorld: number } {
  // Map device pixels to virtual canvas pixels
  const virtualXPx = (deviceXPx / deviceWidthPx)  * virtualWidthPx;
  const virtualYPx = (deviceYPx / deviceHeightPx) * virtualHeightPx;
  return {
    xWorld: (virtualXPx - offsetXPx) / zoom,
    yWorld: (virtualYPx - offsetYPx) / zoom,
  };
}

export function startGameScreen(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  _legacyPlayerLoadout: ParticleKind[],
  startRoomId: string | null,
  callbacks: GameScreenCallbacks,
  progress?: PlayerProgress,
): () => void {
  const webglRenderer = new WebGLParticleRenderer();

  // ── Weave loadout (replaces flat particle loadout for combat) ──────────
  // Initialize from progress if available, otherwise create default
  let playerWeaveLoadout: PlayerWeaveLoadout = progress?.weaveLoadout
    ?? createDefaultWeaveLoadout();

  // ── Virtual resolution pipeline ──────────────────────────────────────────
  // Stage 1: All game content is drawn to a fixed-height offscreen canvas.
  // Stage 2: The offscreen canvas is upscaled to the device canvas each frame.
  const virtualCanvas = document.createElement('canvas');
  let virtualWidthPx = BASE_VIRTUAL_WIDTH_PX;
  const virtualHeightPx = FIXED_VIRTUAL_HEIGHT_PX;
  virtualCanvas.width  = virtualWidthPx;
  virtualCanvas.height = virtualHeightPx;
  const virtualCtx = virtualCanvas.getContext('2d')!;

  // The device-facing canvas is used only as the upscale target.
  const deviceCtx = canvas.getContext('2d')!;

  function resizeCanvas(): void {
    const deviceScale = window.devicePixelRatio || 1;
    canvas.width  = Math.round(window.innerWidth  * deviceScale);
    canvas.height = Math.round(window.innerHeight * deviceScale);
    virtualWidthPx = Math.max(1, Math.round((canvas.width / canvas.height) * virtualHeightPx));
    virtualCanvas.width = virtualWidthPx;
    virtualCanvas.height = virtualHeightPx;
    // WebGL particle canvas also renders at virtual resolution
    if (webglRenderer.isAvailable) {
      webglRenderer.resize(virtualWidthPx, virtualHeightPx);
    }
  }

  resizeCanvas();

  if (webglRenderer.isAvailable) {
    // Hide the WebGL canvas from display — we'll drawImage it onto the device canvas
    webglRenderer.canvas.style.display = 'none';
  }

  const ctx = virtualCtx;
  const camera = createCameraState();

  // ── Room state ────────────────────────────────────────────────────────────
  let currentRoom: RoomDef = ROOM_REGISTRY.get(startRoomId ?? STARTING_ROOM_ID)!;
  let bgColor = worldBgColor(currentRoom.worldNumber);
  let roomWidthWorld = currentRoom.widthBlocks * BLOCK_SIZE_MEDIUM;
  let roomHeightWorld = currentRoom.heightBlocks * BLOCK_SIZE_MEDIUM;

  /** Initialises (or re-initialises) world state for the given room. */
  function loadRoom(room: RoomDef, spawnXBlock: number, spawnYBlock: number): void {
    currentRoom = room;
    bgColor = worldBgColor(room.worldNumber);
    roomWidthWorld = room.widthBlocks * BLOCK_SIZE_MEDIUM;
    roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;

    // Apply world-specific block sprites and background
    setActiveBlockSpriteWorld(room.worldNumber);

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

    // Reset Radiant Tether boss state
    resetRadiantTetherState();

    // Spawn player at the given block position
    const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
    const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
    const playerCluster = createClusterState(1, spawnXWorld, spawnYWorld, 1, PARTICLE_COUNT_PER_CLUSTER);
    world.clusters.push(playerCluster);
    spawnWeaveLoadoutParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, playerWeaveLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng);

    // Apply weave IDs to world state for combat dispatch
    world.playerPrimaryWeaveId = playerWeaveLoadout.primary.weaveId;
    world.playerSecondaryWeaveId = playerWeaveLoadout.secondary.weaveId;

    // Spawn enemies
    let nextEntityId = 2;
    for (let ei = 0; ei < room.enemies.length; ei++) {
      const enemyDef = room.enemies[ei];
      const ex = enemyDef.xBlock * BLOCK_SIZE_MEDIUM;
      const ey = enemyDef.yBlock * BLOCK_SIZE_MEDIUM;
      const hp = enemyDef.isBossFlag === 1 ? enemyDef.particleCount * BOSS_HP_MULTIPLIER : enemyDef.particleCount;
      const enemyCluster = createClusterState(nextEntityId++, ex, ey, 0, hp);

      if (enemyDef.isFlyingEyeFlag === 1) {
        enemyCluster.isFlyingEyeFlag     = 1;
        enemyCluster.flyingEyeElementKind = enemyDef.kinds.length > 0
          ? enemyDef.kinds[0]
          : ParticleKind.Wind;
        // Flying eyes are larger than ground enemies
        enemyCluster.halfWidthWorld  = FLYING_EYE_HALF_SIZE_WORLD;
        enemyCluster.halfHeightWorld = FLYING_EYE_HALF_SIZE_WORLD;
      } else if (enemyDef.isRollingEnemyFlag === 1) {
        enemyCluster.isRollingEnemyFlag    = 1;
        enemyCluster.rollingEnemySpriteIndex = enemyDef.rollingEnemySpriteIndex ?? 1;
        enemyCluster.rollingEnemyRollAngleRad = 0;
      } else if (enemyDef.isRockElementalFlag === 1) {
        enemyCluster.isRockElementalFlag = 1;
        enemyCluster.rockElementalSpawnXWorld = ex;
        enemyCluster.rockElementalSpawnYWorld = ey;
        enemyCluster.rockElementalState = 0; // start inactive
        // Rock Elemental is slightly larger than regular enemies
        enemyCluster.halfWidthWorld = 4.5;
        enemyCluster.halfHeightWorld = 4.5;
      } else if (enemyDef.isRadiantTetherFlag === 1) {
        enemyCluster.isRadiantTetherFlag = 1;
        enemyCluster.radiantTetherState = 0; // start inactive
        enemyCluster.halfWidthWorld = 6.0;
        enemyCluster.halfHeightWorld = 6.0;
      }

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

    // Init skill tomb renderer
    skillTombRenderer.init(room.skillTombs);

    // Track explored room
    if (progress && !progress.exploredRoomIds.includes(room.id)) {
      progress.exploredRoomIds.push(room.id);
    }

    // Snap camera to player position
    snapCamera(camera, spawnXWorld, spawnYWorld, roomWidthWorld, roomHeightWorld, virtualWidthPx, virtualHeightPx);
  }

  const world = createWorldState(FIXED_DT_MS, 42);
  // Set the selected character on the world for rendering
  world.characterId = progress?.characterId ?? 'knight';
  const levelRng = createRng(12345);
  const environmentalDust = new EnvironmentalDustLayer();
  const skillTombRenderer = new SkillTombRenderer();

  // Track explored rooms
  if (progress && !progress.exploredRoomIds.includes(currentRoom.id)) {
    progress.exploredRoomIds.push(currentRoom.id);
  }

  // Initial room load — use saved spawn point if returning to a save
  const initialSpawnBlock = (progress && progress.lastSaveSpawnBlock && progress.lastSaveRoomId === currentRoom.id)
    ? progress.lastSaveSpawnBlock
    : currentRoom.playerSpawnBlock;
  loadRoom(currentRoom, initialSpawnBlock[0], initialSpawnBlock[1]);

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

  // ── World Editor ────────────────────────────────────────────────────────
  const editorController: EditorController = createEditorController(canvas, uiRoot, (roomDef, spawnX, spawnY) => {
    loadRoom(roomDef, spawnX, spawnY);
  });

  // "World Editor" toggle button — shown when debug mode is on
  let editorToggleBtn: HTMLButtonElement | null = null;
  function ensureEditorButton(): void {
    if (editorToggleBtn !== null) return;
    editorToggleBtn = document.createElement('button');
    editorToggleBtn.style.cssText = `
      position: absolute; top: 38px; right: 16px;
      background: rgba(0,0,0,0.6); border: 2px solid #00c864; color: #00c864;
      padding: 6px 14px; font-size: 0.85rem; font-family: 'Cinzel', serif;
      cursor: pointer; border-radius: 6px; z-index: 800;
    `;
    editorToggleBtn.textContent = 'World Editor';
    editorToggleBtn.addEventListener('click', () => {
      editorController.toggle(currentRoom);
      editorToggleBtn!.textContent = editorController.state.isActive ? 'Exit Editor' : 'World Editor';
      editorToggleBtn!.style.borderColor = editorController.state.isActive ? '#ff6644' : '#00c864';
      editorToggleBtn!.style.color = editorController.state.isActive ? '#ff6644' : '#00c864';
    });
    uiRoot.appendChild(editorToggleBtn);
  }
  function removeEditorButton(): void {
    if (editorToggleBtn !== null && editorToggleBtn.parentElement) {
      editorToggleBtn.parentElement.removeChild(editorToggleBtn);
      editorToggleBtn = null;
    }
  }

  const hudState: HudState = { fps: 0, frameTimeMs: 0, particleCount: 0 };

  let lastTimestampMs = 0;
  let accumulatorMs = 0;
  let frameCount = 0;
  let fpsAccMs = 0;
  let isRunning = true;
  let rafHandle = 0;
  let interactInputPulseMs = 0;

  // ── Pause / debug / settings state ──────────────────────────────────────
  let isPaused = false;
  let pauseMenuCleanup: (() => void) | null = null;
  let isDebugMode = false;
  const pauseMenuState: PauseMenuState = {
    isDebugOn: false,
    musicVolume: 0.7,
    sfxVolume: 0.7,
    graphicsQuality: 'med',
  };

  function openPauseMenu(): void {
    if (isPaused || isPlayerDead || isSkillTombMenuOpen) return;
    isPaused = true;
    pauseMenuCleanup = showPauseMenu(uiRoot, pauseMenuState, {
      onResume: () => {
        isPaused = false;
        pauseMenuCleanup = null;
        // Reset timestamp so elapsed doesn't include paused time
        lastTimestampMs = 0;
      },
      onExitToMainMenu: () => {
        isPaused = false;
        pauseMenuCleanup = null;
        isRunning = false;
        detachInput();
        callbacks.onReturnToMenu();
      },
      onToggleDebug: () => {
        isDebugMode = !isDebugMode;
        pauseMenuState.isDebugOn = isDebugMode;
        if (isDebugMode) { ensureEditorButton(); } else { removeEditorButton(); }
      },
    });
  }

  // ── Death screen state ───────────────────────────────────────────────────
  let isPlayerDead = false;
  let deathScreenCleanup: (() => void) | null = null;

  function showPlayerDeathScreen(): void {
    if (isPlayerDead) return;
    isPlayerDead = true;
    deathScreenCleanup = showDeathScreen(uiRoot, {
      onReturnToLastSave: () => {
        isPlayerDead = false;
        deathScreenCleanup = null;
        // Reload from last save point or starting room
        if (progress && progress.lastSaveRoomId) {
          const saveRoom = ROOM_REGISTRY.get(progress.lastSaveRoomId);
          if (saveRoom && progress.lastSaveSpawnBlock) {
            loadRoom(saveRoom, progress.lastSaveSpawnBlock[0], progress.lastSaveSpawnBlock[1]);
          } else {
            loadRoom(currentRoom, currentRoom.playerSpawnBlock[0], currentRoom.playerSpawnBlock[1]);
          }
        } else {
          loadRoom(currentRoom, currentRoom.playerSpawnBlock[0], currentRoom.playerSpawnBlock[1]);
        }
        lastTimestampMs = 0;
      },
      onReturnToMainMenu: () => {
        isPlayerDead = false;
        deathScreenCleanup = null;
        isRunning = false;
        detachInput();
        callbacks.onReturnToMenu();
      },
    });
  }

  // ── Skill tomb menu state ───────────────────────────────────────────────
  let isSkillTombMenuOpen = false;
  let skillTombMenuCleanup: (() => void) | null = null;

  function openSkillTombMenu(): void {
    if (isSkillTombMenuOpen || !progress) return;
    isSkillTombMenuOpen = true;

    // Save progress
    if (callbacks.onSave) callbacks.onSave();

    // Record save point
    const player = world.clusters[0];
    if (player) {
      const nearbyIndex = skillTombRenderer.getNearbyTombIndex(player.positionXWorld, player.positionYWorld);
      if (nearbyIndex >= 0) {
        const tombPos = skillTombRenderer.getTombPosition(nearbyIndex);
        if (tombPos) {
          progress.lastSaveRoomId = currentRoom.id;
          progress.lastSaveSpawnBlock = [
            Math.round(tombPos.xWorld / BLOCK_SIZE_MEDIUM),
            Math.round(tombPos.yWorld / BLOCK_SIZE_MEDIUM),
          ];
        }
      }
    }

    skillTombMenuCleanup = showSkillTombMenu(uiRoot, progress, currentRoom.id, {
      onClose: (updatedLoadout, updatedWeaveLoadout) => {
        isSkillTombMenuOpen = false;
        skillTombMenuCleanup = null;
        progress.loadout = updatedLoadout;
        progress.weaveLoadout = updatedWeaveLoadout;
        lastTimestampMs = 0;
        // Save after closing
        if (callbacks.onSave) callbacks.onSave();
      },
    });
  }

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
      const openTopWorld = t.positionBlock * BLOCK_SIZE_MEDIUM;
      const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;

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
    const { offsetXPx, offsetYPx } = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
    const zoom = camera.zoom;

    // ── Editor mode gate ──────────────────────────────────────────────────
    // When the editor is active, it takes over camera and input; skip gameplay.
    if (editorController.state.isActive) {
      const isEditorConsuming = editorController.update(elapsedMs / 1000, camera, offsetXPx, offsetYPx, zoom);

      if (isEditorConsuming) {
        // Still render the game world (walls, particles, etc.) as backdrop
        const camOff = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
        const eox = camOff.offsetXPx;
        const eoy = camOff.offsetYPx;
        const snapshot = createSnapshot(world);

        if (webglRenderer.isAvailable) {
          webglRenderer.render(snapshot, eox, eoy, zoom);
          ctx.clearRect(0, 0, virtualWidthPx, virtualHeightPx);
        } else {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
        }

        renderWorldBackground(
          ctx,
          currentRoom.worldNumber,
          virtualWidthPx,
          virtualHeightPx,
          eox,
          eoy,
          currentRoom.widthBlocks * BLOCK_SIZE_SMALL,
          currentRoom.heightBlocks * BLOCK_SIZE_SMALL,
          zoom,
        );
        renderWalls(ctx, snapshot, eox, eoy, zoom, true);
        renderClusters(ctx, snapshot, eox, eoy, zoom, true);
        renderRadiantTether(ctx, snapshot, eox, eoy, zoom, true);
        renderGrapple(ctx, snapshot, eox, eoy, zoom);
        drawTunnelDarkness(ctx, currentRoom, eox, eoy, zoom);
        environmentalDust.render(ctx, eox, eoy, zoom, true);
        skillTombRenderer.render(ctx, eox, eoy, zoom);

        if (!webglRenderer.isAvailable) {
          renderParticles(ctx, snapshot, eox, eoy, zoom);
        }

        // Draw editor overlays on top
        editorController.render(ctx, eox, eoy, zoom, virtualWidthPx, virtualHeightPx);

        if (isDebugMode) {
          renderHudOverlay(ctx, hudState);
        }

        // ── Upscale virtual canvas to device canvas ──────────────────────
        deviceCtx.imageSmoothingEnabled = false;
        deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
        if (webglRenderer.isAvailable) {
          deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
        }

        rafHandle = requestAnimationFrame(frame);
        return;
      }
    }

    const commands = collectCommands(inputState);
    let openPause = false;
    let moveDx = 0;
    let dashAimXPx = 0;
    let dashTriggered = false;
    let jumpTriggered = false;
    let interactTriggered = false;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      if (cmd.kind === CommandKind.ReturnToMap) {
        openPause = true;
      } else if (cmd.kind === CommandKind.MovePlayer) {
        moveDx = cmd.dx;
      } else if (cmd.kind === CommandKind.Jump) {
        jumpTriggered = true;
      } else if (cmd.kind === CommandKind.Dash) {
        dashTriggered = true;
        dashAimXPx = cmd.aimXPx;
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
          let dirX = aim.xWorld - player.positionXWorld;
          let dirY = aim.yWorld - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = 1.0; dirY = 0.0; } else { dirX /= len; dirY /= len; }
          world.playerWeaveAimDirXWorld = dirX;
          world.playerWeaveAimDirYWorld = dirY;
          world.playerPrimaryWeaveTriggeredFlag = 1;
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
      } else if (cmd.kind === CommandKind.WeaveActivateSecondary) {
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
      } else if (cmd.kind === CommandKind.WeaveHoldSecondary) {
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
      } else if (cmd.kind === CommandKind.WeaveEndSecondary) {
        world.playerSecondaryWeaveEndFlag = 1;
      } else if (cmd.kind === CommandKind.GrappleFire) {
        const player = world.clusters[0];
        if (player !== undefined && player.isAliveFlag === 1) {
          const aim = screenToWorld(cmd.aimXPx, cmd.aimYPx, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
          fireGrapple(world, aim.xWorld, aim.yWorld);
        }
      } else if (cmd.kind === CommandKind.GrappleRelease) {
        releaseGrapple(world);
      } else if (cmd.kind === CommandKind.Interact) {
        interactInputPulseMs = 150;
        // Check if player is near a skill tomb
        const playerForInteract = world.clusters[0];
        if (playerForInteract !== undefined && playerForInteract.isAliveFlag === 1) {
          const nearbyIndex = skillTombRenderer.getNearbyTombIndex(
            playerForInteract.positionXWorld, playerForInteract.positionYWorld,
          );
          if (nearbyIndex >= 0) {
            interactTriggered = true;
          }
        }
      }
    }

    if (openPause) {
      openPauseMenu();
    }

    if (interactTriggered && progress) {
      openSkillTombMenu();
    }

    // While paused or in a menu, still render the frozen scene but skip sim and transitions
    if (isPaused || isSkillTombMenuOpen) {
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // While dead, still render the frozen scene but skip sim
    if (isPlayerDead) {
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Room transition check ──────────────────────────────────────────────
    if (checkRoomTransitions()) {
      // Room changed — skip this frame's sim, render the new room next frame
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // Latch one-shot jump/dash inputs into world state before ticking.
    // This preserves edge-triggered inputs on high-refresh frames where no
    // fixed sim tick runs (accumulator < FIXED_DT_MS).
    if (jumpTriggered) {
      world.playerJumpTriggeredFlag = 1;
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
          const aim = screenToWorld(dashAimXPx, 0, offsetXPx, offsetYPx, zoom, canvas.width, canvas.height, virtualWidthPx, virtualHeightPx);
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
      // Pass sprint and crouch input to the sim
      world.playerSprintHeldFlag = inputState.isSprintHeldFlag ? 1 : 0;
      world.playerCrouchHeldFlag = inputState.isKeyS ? 1 : 0;
      tick(world);
      environmentalDust.update(world, FIXED_DT_MS);
      accumulatorMs -= FIXED_DT_MS;
    }

    // ── Check for player death ───────────────────────────────────────────────
    const playerForDeath = world.clusters[0];
    if (playerForDeath !== undefined && playerForDeath.isAliveFlag === 0 && !isPlayerDead) {
      showPlayerDeathScreen();
    }

    // ── Update skill tomb renderer ──────────────────────────────────────────
    const playerForTomb = world.clusters[0];
    if (playerForTomb !== undefined && playerForTomb.isAliveFlag === 1) {
      skillTombRenderer.update(playerForTomb.positionXWorld, playerForTomb.positionYWorld, elapsedMs / 1000);
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
        virtualWidthPx,
        virtualHeightPx,
        elapsedMs / 1000,
      );
    }

    // ── Recompute camera offset after update ─────────────────────────────────
    const camOff = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
    const ox = camOff.offsetXPx;
    const oy = camOff.offsetYPx;

    let aliveCount = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.isAliveFlag[i] === 1) aliveCount++;
    }
    hudState.particleCount = aliveCount;

    // ── Populate movement debug state from the player cluster ─────────────────
    if (isDebugMode) {
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
          inputUp: inputState.isJumpHeldFlag || inputState.isJumpTriggeredFlag,
          inputLeft: inputState.isKeyA,
          inputRight: inputState.isKeyD,
          inputDown: inputState.isKeyS,
          inputLeftClick: inputState.isMouseDownFlag === 1,
          inputRightClick: inputState.isRightMouseDownFlag === 1,
          inputGrapple: inputState.isGrappleHeldFlag === 1,
          inputInteract: interactInputPulseMs > 0,
        };
        hudState.debug = dbg;
      }
    } else {
      hudState.debug = undefined;
    }

    const snapshot = createSnapshot(world);

    // ── Render to virtual canvas (dynamic width × fixed height) ───────────
    if (webglRenderer.isAvailable) {
      webglRenderer.render(snapshot, ox, oy, zoom);
      ctx.clearRect(0, 0, virtualWidthPx, virtualHeightPx);
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
    }

    // ── World background with parallax (behind everything else) ───────────
    renderWorldBackground(
      ctx,
      currentRoom.worldNumber,
      virtualWidthPx,
      virtualHeightPx,
      ox,
      oy,
      currentRoom.widthBlocks * BLOCK_SIZE_SMALL,
      currentRoom.heightBlocks * BLOCK_SIZE_SMALL,
      zoom,
    );

    // Walls before cluster indicators so clusters are drawn on top
    renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);
    renderClusters(ctx, snapshot, ox, oy, zoom, isDebugMode);
    renderRadiantTether(ctx, snapshot, ox, oy, zoom, isDebugMode);
    renderGrapple(ctx, snapshot, ox, oy, zoom);

    // Tunnel darkness overlays
    drawTunnelDarkness(ctx, currentRoom, ox, oy, zoom);

    environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);

    // Skill tombs (sprite + dust particles)
    skillTombRenderer.render(ctx, ox, oy, zoom);

    // Particles drawn on top of all game layers (Canvas 2D fallback only —
    // WebGL renders to its own offscreen canvas at virtual resolution)
    if (!webglRenderer.isAvailable) {
      renderParticles(ctx, snapshot, ox, oy, zoom);
    }

    // Debug-only HUD and room name
    if (isDebugMode) {
      renderHudOverlay(ctx, hudState);

      // ── Room name banner (top-center) ──────────────────────────────────────
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '7px monospace';
      const roomLabel = currentRoom.name;
      const labelW = ctx.measureText(roomLabel).width;
      ctx.fillText(roomLabel, (virtualWidthPx - labelW) / 2, 22);
    }

    if (interactInputPulseMs > 0) {
      interactInputPulseMs = Math.max(0, interactInputPulseMs - elapsedMs);
    }

    // ── Upscale virtual canvas to device canvas ────────────────────────────
    deviceCtx.imageSmoothingEnabled = false;
    deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
    // Composite WebGL particle canvas on top (also at virtual resolution)
    if (webglRenderer.isAvailable) {
      deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
    }

    // ── Touch joystick (drawn on device canvas in screen space) ───────────
    if (inputState.isTouchJoystickActiveFlag === 1) {
      const bx = inputState.touchJoystickBaseXPx;
      const by = inputState.touchJoystickBaseYPx;
      const joystickCurrentXPx = inputState.touchJoystickCurrentXPx;
      const joystickCurrentYPx = inputState.touchJoystickCurrentYPx;

      deviceCtx.save();
      deviceCtx.beginPath();
      deviceCtx.arc(bx, by, JOYSTICK_OUTER_RADIUS_PX, 0, Math.PI * 2);
      deviceCtx.strokeStyle = 'rgba(0,207,255,0.35)';
      deviceCtx.lineWidth = 2;
      deviceCtx.stroke();
      deviceCtx.fillStyle = 'rgba(0,207,255,0.08)';
      deviceCtx.fill();

      const dx = joystickCurrentXPx - bx;
      const dy = joystickCurrentYPx - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let thumbXPx = joystickCurrentXPx;
      let thumbYPx = joystickCurrentYPx;
      if (dist > JOYSTICK_OUTER_RADIUS_PX) {
        thumbXPx = bx + (dx / dist) * JOYSTICK_OUTER_RADIUS_PX;
        thumbYPx = by + (dy / dist) * JOYSTICK_OUTER_RADIUS_PX;
      }

      deviceCtx.beginPath();
      deviceCtx.arc(thumbXPx, thumbYPx, JOYSTICK_INNER_RADIUS_PX, 0, Math.PI * 2);
      deviceCtx.fillStyle = 'rgba(0,207,255,0.45)';
      deviceCtx.fill();
      deviceCtx.restore();
    }

    // ── Control hints (debug only, drawn on device canvas) ──────────────────
    if (isDebugMode) {
      const controlHintText = IS_TOUCH_DEVICE
        ? 'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MENU to return'
        : 'A/D=walk  |  W/Space/↑=jump  |  Shift=dash  |  Click=attack  |  Hold=block  |  Hold E=grapple  |  ESC=menu';
      deviceCtx.fillStyle = 'rgba(255,255,255,0.3)';
      deviceCtx.font = '12px monospace';
      const hintWidthPx = deviceCtx.measureText(controlHintText).width;
      deviceCtx.fillText(controlHintText, (canvas.width - hintWidthPx) / 2, canvas.height - 10);
    }

    rafHandle = requestAnimationFrame(frame);
  }

  rafHandle = requestAnimationFrame(frame);

  return () => {
    isRunning = false;
    if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
    if (pauseMenuCleanup !== null) pauseMenuCleanup();
    if (deathScreenCleanup !== null) deathScreenCleanup();
    if (skillTombMenuCleanup !== null) skillTombMenuCleanup();
    editorController.destroy();
    removeEditorButton();
    detachInput();
    webglRenderer.dispose();
    window.removeEventListener('resize', onResize);
    if (menuButton !== null && menuButton.parentElement !== null) {
      menuButton.parentElement.removeChild(menuButton);
    }
  };
}
