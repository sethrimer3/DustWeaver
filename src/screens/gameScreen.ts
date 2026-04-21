import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles, fireGrapple, releaseGrapple } from '../sim/clusters/grapple';
import { ParticleKind } from '../sim/particles/kinds';
import { tick } from '../sim/tick';
import { createRng, nextFloat } from '../sim/rng';
import { createSnapshot, createReusableSnapshot, updateSnapshotInPlace, resetReusableSnapshot } from '../render/snapshot';
import { renderParticles } from '../render/particles/renderer';
import { renderClusters, renderWalls, renderGrapple } from '../render/clusters/renderer';
import { PlayerCloak } from '../render/clusters/playerCloak';
import { renderHudOverlay, HudState, HudDebugState } from '../render/hud/overlay';
import { EnvironmentalDustLayer } from '../render/environmentalDust';
import { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners, collectCommands } from '../input/handler';
import { CommandKind } from '../input/commands';
import { RoomDef, RoomTransitionDef, TransitionDirection, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ROOM_REGISTRY, STARTING_ROOM_ID } from '../levels/rooms';
import { renderHazards } from '../render/hazards';
import { createCameraState, snapCamera, updateCamera, getCameraOffset } from '../render/camera';
import { setActiveBlockSpriteWorld, setActiveBlockSpriteTheme, setActiveBlockLighting } from '../render/walls/blockSpriteRenderer';
import { showPauseMenu, PauseMenuState } from '../ui/pauseMenu';
import { createDebugPanel, DebugPanel } from '../ui/debugPanel';
import { renderWorldBackground } from '../render/backgroundRenderer';
import { showDeathScreen } from '../ui/deathScreen';
import { showSkillTombMenu } from '../ui/skillTombMenu';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import { PlayerProgress } from '../progression/playerProgress';
import { createEditorController, EditorController } from '../editor/editorController';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout } from '../sim/weaves/playerLoadout';
import { resetRadiantTetherState } from '../sim/clusters/radiantTetherAi';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';
import { getSelectedRenderSize, getMusicVolume, getSfxVolume } from '../ui/renderSettings';
import { createMusicManager, MusicManager } from '../audio/musicManager';
import { isTheroShowcaseRoom, renderTheroShowcaseEffect, renderCrystallineCracksBackground } from '../render/effects/theroEffectManager';
import { BloomSystem } from '../render/effects/bloomSystem';
import { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import { DEFAULT_BLOOM_CONFIG } from '../render/effects/bloomConfig';
import { getTotalCapacity, getMaxParticlesForDust } from '../progression/dustCapacity';
import { unlockActiveWeave } from '../progression/unlocks';
import {
  spawnClusterParticles,
  spawnLoadoutParticles,
  spawnWeaveLoadoutParticles,
  spawnBackgroundFluidParticles,
  spawnDustPileParticles,
  PARTICLE_COUNT_PER_CLUSTER,
  BACKGROUND_FLUID_COUNT,
  BOSS_HP_MULTIPLIER,
  PLAYER_INITIAL_HEALTH,
} from './gameSpawn';
import {
  loadRoomWalls,
  loadRoomHazards,
  worldBgColor,
  drawTunnelDarkness,
  screenToWorld,
  resolveSpawnBlock,
  TUNNEL_DETECT_MARGIN_WORLD,
  DUST_CONTAINER_PICKUP_RADIUS_WORLD,
  DUST_CONTAINER_DUST_GAIN,
  FLYING_EYE_HALF_SIZE_WORLD,
} from './gameRoom';
import { renderFrame } from './gameRender';
import { createCombatTextSystem } from '../render/hud/combatText';
import { processLargeSlimeSplits, SLIME_HALF_SIZE_WORLD, LARGE_SLIME_HALF_SIZE_WORLD } from '../sim/clusters/slimeAi';
import { WHEEL_ENEMY_HALF_SIZE_WORLD } from '../sim/clusters/wheelEnemyAi';
import { BEETLE_HALF_SIZE_WORLD } from '../sim/clusters/beetleAi';
import { BUBBLE_HALF_SIZE_WORLD, WATER_BUBBLE_REGEN_INTERVAL_TICKS } from '../sim/clusters/bubbleAi';
import { DecorationWaveState, buildRoomDecorations } from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { renderGrasshoppers } from '../render/critters/grasshopperRenderer';
import { MAX_GRASSHOPPERS, GRASSHOPPER_INITIAL_TIMER_MAX_TICKS } from '../sim/world';

const FIXED_DT_MS = 16.666;

const SLIME_HOP_INTERVAL_INITIAL_TICKS = 30;
const LARGE_SLIME_HOP_INTERVAL_INITIAL_TICKS = 45;

/** Baseline virtual width at 16:9; height is authoritative for fixed zoom. */
const BASE_VIRTUAL_WIDTH_PX = 480;
/** Fixed virtual height so world-to-pixel zoom stays constant on every display. */
const FIXED_VIRTUAL_HEIGHT_PX = 270;
/** Vite base URL for assets. */
const BASE = import.meta.env.BASE_URL;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function createFallbackRoomDef(): RoomDef {
  return {
    id: 'fallback_boot_room',
    name: 'Fallback Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 80,
    heightBlocks: 45,
    walls: [
      { xBlock: 0, yBlock: 44, wBlock: 80, hBlock: 1 }, // floor
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 45 }, // left wall
      { xBlock: 79, yBlock: 0, wBlock: 1, hBlock: 45 }, // right wall
    ],
    enemies: [],
    playerSpawnBlock: [40, 40],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
  };
}

export interface GameScreenCallbacks {
  onReturnToMenu: () => void;
  onSave?: () => void;
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
  const bloomSystem = new BloomSystem(DEFAULT_BLOOM_CONFIG);
  const darkRoomOverlay = new DarkRoomOverlay();

  // ── Weave loadout (replaces flat particle loadout for combat) ──────────
  // Initialize from progress if available, otherwise create default
  const playerWeaveLoadout: PlayerWeaveLoadout = progress?.weaveLoadout
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
  virtualCtx.imageSmoothingEnabled = false;

  // The device-facing canvas is used only as the upscale target.
  const deviceCtx = canvas.getContext('2d')!;

  function resizeCanvas(): void {
    const deviceScale = window.devicePixelRatio || 1;
    const selectedRenderSize = getSelectedRenderSize();
    canvas.width = Math.round(selectedRenderSize.widthPx * deviceScale);
    canvas.height = Math.round(selectedRenderSize.heightPx * deviceScale);
    virtualWidthPx = Math.max(1, Math.round((canvas.width / canvas.height) * virtualHeightPx));
    virtualCanvas.width = virtualWidthPx;
    virtualCanvas.height = virtualHeightPx;
    // Canvas resize resets 2D context state, so enforce nearest-neighbour
    // sampling again for pixel-art sprite rendering.
    virtualCtx.imageSmoothingEnabled = false;
    // WebGL particle canvas also renders at virtual resolution
    if (webglRenderer.isAvailable) {
      webglRenderer.resize(virtualWidthPx, virtualHeightPx);
    }
    bloomSystem.resize(virtualWidthPx, virtualHeightPx);
    darkRoomOverlay.resize(virtualWidthPx, virtualHeightPx);
  }

  resizeCanvas();

  if (webglRenderer.isAvailable) {
    // Hide the WebGL canvas from display — we'll drawImage it onto the device canvas
    webglRenderer.canvas.style.display = 'none';
  }

  const ctx = virtualCtx;
  const camera = createCameraState();

  // ── Background music manager ─────────────────────────────────────────────
  const musicManager: MusicManager = createMusicManager(BASE);
  musicManager.setVolume(getMusicVolume());

  // ── Room state ────────────────────────────────────────────────────────────
  const firstAvailableRoom: RoomDef | null = ROOM_REGISTRY.values().next().value ?? null;
  const configuredSpawnRoom: RoomDef | null = ROOM_REGISTRY.get('lobby')
    ?? ROOM_REGISTRY.get(STARTING_ROOM_ID)
    ?? firstAvailableRoom;
  const requestedStartRoom: RoomDef | null = (startRoomId !== null ? ROOM_REGISTRY.get(startRoomId) : undefined)
    ?? ROOM_REGISTRY.get(STARTING_ROOM_ID)
    ?? configuredSpawnRoom;
  const fallbackRoom = createFallbackRoomDef();
  const campaignSpawnRoom: RoomDef = configuredSpawnRoom ?? fallbackRoom;
  const initialRoom: RoomDef = requestedStartRoom ?? campaignSpawnRoom;
  if (requestedStartRoom === null || configuredSpawnRoom === null) {
    console.error('[gameScreen] No rooms were loaded. Starting in fallback room.');
  }
  const campaignSpawnBlock: readonly [number, number] = campaignSpawnRoom.playerSpawnBlock;
  const shouldOpenFailsafeEditor = (startRoomId !== null && ROOM_REGISTRY.get(startRoomId) === undefined)
    || !ROOM_REGISTRY.has('lobby');

  let currentRoom: RoomDef = initialRoom;
  let bgColor = worldBgColor(currentRoom.worldNumber);
  let roomWidthWorld = currentRoom.widthBlocks * BLOCK_SIZE_MEDIUM;
  let roomHeightWorld = currentRoom.heightBlocks * BLOCK_SIZE_MEDIUM;
  const dustContainerSprite = new Image();
  dustContainerSprite.src = `${BASE}SPRITES/objects/collectables/dust_container_stub.svg`;
  let isDustContainerSpriteLoaded = false;
  dustContainerSprite.onload = () => { isDustContainerSpriteLoaded = true; };
  /** Keys in the format `${roomId}:${containerIndex}` for already-collected dust containers. */
  const collectedDustContainerKeySet: Set<string> = new Set();

  /** Initialises (or re-initialises) world state for the given room. */
  function loadRoom(room: RoomDef, spawnXBlock: number, spawnYBlock: number, preserveCamera = false): void {
    currentRoom = room;
    bgColor = worldBgColor(room.worldNumber);
    roomWidthWorld = room.widthBlocks * BLOCK_SIZE_MEDIUM;
    roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;

    // Apply world-specific block sprites and background
    if (room.blockTheme) {
      setActiveBlockSpriteTheme(room.blockTheme);
    } else {
      setActiveBlockSpriteWorld(room.worldNumber);
    }
    setActiveBlockLighting(room.lightingEffect ?? 'DEFAULT', room.widthBlocks, room.heightBlocks);

    // Notify the music manager about the new room
    musicManager.notifyRoomEntered(room.songId ?? '_continue');

    // Reset world state
    world.tick = 0;
    world.particleCount = 0;
    world.clusters.length = 0;
    world.wallCount = 0;
    world.worldWidthWorld = roomWidthWorld;
    world.worldHeightWorld = roomHeightWorld;

    // Reset grapple state
    world.isGrappleActiveFlag     = 0;
    world.isGrappleMissActiveFlag = 0;
    world.isGrappleRetractingFlag = 0;
    world.isGrappleTopSurfaceFlag = 0;
    world.isGrappleStuckFlag      = 0;
    world.hasGrappleChargeFlag    = 1;
    world.grappleParticleStartIndex = -1;

    // Reset Radiant Tether boss state
    resetRadiantTetherState();

    // Spawn player at the given block position
    const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
    const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
    const playerCluster = createClusterState(1, spawnXWorld, spawnYWorld, 1, PLAYER_INITIAL_HEALTH);
    world.clusters.push(playerCluster);

    // Spawn player dust particles based on capacity model.
    // If the player has dust containers and unlocked dust, use capacity-based spawning.
    // If the player has a weave loadout with bound dust, use that for weave-slot assignment.
    // Otherwise (brand new profile with nothing), spawn no particles.
    const playerCapacity = progress ? getTotalCapacity(progress.dustContainerCount) : 0;
    const hasWeaveBoundDust = playerWeaveLoadout.primary.boundDust.length > 0
      || playerWeaveLoadout.secondary.boundDust.length > 0;

    if (hasWeaveBoundDust) {
      // Player has dust bound to weaves — use weave loadout spawning
      spawnWeaveLoadoutParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, playerWeaveLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng);
    } else if (progress && progress.unlockedDustKinds.length > 0 && playerCapacity > 0) {
      // Player has unlocked dust and capacity but no weave bindings.
      // Spawn particles based on capacity (e.g., auto-assigned Golden Dust).
      const dustKind = progress.unlockedDustKinds[0];
      const particleCount = getMaxParticlesForDust(dustKind, playerCapacity);
      if (particleCount > 0) {
        spawnClusterParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, dustKind, particleCount, levelRng);
      }
    }
    // else: brand new profile with nothing — no particles spawned

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
      } else if (enemyDef.isGrappleHunterFlag === 1) {
        enemyCluster.isGrappleHunterFlag = 1;
        enemyCluster.grappleHunterState = 0;
        enemyCluster.halfWidthWorld = 5.0;
        enemyCluster.halfHeightWorld = 5.0;
      } else if (enemyDef.isSlimeFlag === 1) {
        enemyCluster.isSlimeFlag = 1;
        enemyCluster.halfWidthWorld = SLIME_HALF_SIZE_WORLD;
        enemyCluster.halfHeightWorld = SLIME_HALF_SIZE_WORLD;
        enemyCluster.slimeHopTimerTicks = SLIME_HOP_INTERVAL_INITIAL_TICKS;
      } else if (enemyDef.isLargeSlimeFlag === 1) {
        enemyCluster.isLargeSlimeFlag = 1;
        enemyCluster.halfWidthWorld = LARGE_SLIME_HALF_SIZE_WORLD;
        enemyCluster.halfHeightWorld = LARGE_SLIME_HALF_SIZE_WORLD;
        enemyCluster.slimeHopTimerTicks = LARGE_SLIME_HOP_INTERVAL_INITIAL_TICKS;
      } else if (enemyDef.isWheelEnemyFlag === 1) {
        enemyCluster.isWheelEnemyFlag = 1;
        enemyCluster.halfWidthWorld = WHEEL_ENEMY_HALF_SIZE_WORLD;
        enemyCluster.halfHeightWorld = WHEEL_ENEMY_HALF_SIZE_WORLD;
      } else if (enemyDef.isBeetleFlag === 1) {
        enemyCluster.isBeetleFlag              = 1;
        enemyCluster.halfWidthWorld            = BEETLE_HALF_SIZE_WORLD;
        enemyCluster.halfHeightWorld           = BEETLE_HALF_SIZE_WORLD;
        // Start in a crawl state; AI will pick the first real state on the first tick.
        enemyCluster.beetleAiState             = 2; // idle briefly so it lands on a surface first
        enemyCluster.beetleAiStateTicks        = 30;
        enemyCluster.beetleSurfaceNormalXWorld = 0;
        enemyCluster.beetleSurfaceNormalYWorld = -1; // assume floor initially
        enemyCluster.beetleIsFlightModeFlag    = 0;
        enemyCluster.beetlePrevHealthPoints    = enemyCluster.healthPoints;
      } else if (enemyDef.isBubbleEnemyFlag === 1) {
        enemyCluster.isBubbleEnemyFlag      = 1;
        enemyCluster.isIceBubbleFlag        = (enemyDef.isIceBubbleFlag ?? 0) as 0 | 1;
        enemyCluster.halfWidthWorld         = BUBBLE_HALF_SIZE_WORLD;
        enemyCluster.halfHeightWorld        = BUBBLE_HALF_SIZE_WORLD;
        enemyCluster.bubbleState            = 0;
        enemyCluster.bubbleMaxParticleCount = enemyDef.particleCount;
        enemyCluster.bubbleOrbitAngleRad    = 0;
        enemyCluster.bubbleRegenTicks       = WATER_BUBBLE_REGEN_INTERVAL_TICKS;
        enemyCluster.bubbleDriftPhaseRad    = 0;
        enemyCluster.bubblePrevHealthPoints = enemyCluster.healthPoints;
      }

      world.clusters.push(enemyCluster);
      spawnLoadoutParticles(world, enemyCluster.entityId, ex, ey, enemyDef.kinds, enemyDef.particleCount, levelRng);
    }

    // Spawn background Fluid particles
    spawnBackgroundFluidParticles(world, BACKGROUND_FLUID_COUNT, levelRng);

    // Reserve grapple chain particle slots
    initGrappleChainParticles(world, 1);

    // Reserve grapple hunter chain particle slots
    for (let ci = 0; ci < world.clusters.length; ci++) {
      const cl = world.clusters[ci];
      if (cl.isGrappleHunterFlag === 1) {
        initGrappleHunterChainParticles(world, cl);
      }
    }

    // Load walls
    loadRoomWalls(world, room);

    // Load environmental hazards (after walls so breakable blocks can be added as walls)
    loadRoomHazards(world, room);

    // Reset and spawn grasshoppers
    world.grasshopperCount = 0;
    if (room.grasshopperAreas) {
      for (const area of room.grasshopperAreas) {
        const areaXWorld = area.xBlock * BLOCK_SIZE_MEDIUM;
        const areaYWorld = area.yBlock * BLOCK_SIZE_MEDIUM;
        const areaWidthWorld = area.wBlock * BLOCK_SIZE_MEDIUM;
        const areaHeightWorld = area.hBlock * BLOCK_SIZE_MEDIUM;
        for (let g = 0; g < area.count && world.grasshopperCount < MAX_GRASSHOPPERS; g++) {
          const gi = world.grasshopperCount++;
          world.grasshopperXWorld[gi] = areaXWorld + nextFloat(world.rng) * areaWidthWorld;
          world.grasshopperYWorld[gi] = areaYWorld + nextFloat(world.rng) * areaHeightWorld;
          world.grasshopperVelXWorld[gi] = 0;
          world.grasshopperVelYWorld[gi] = 0;
          world.grasshopperHopTimerTicks[gi] = nextFloat(world.rng) * GRASSHOPPER_INITIAL_TIMER_MAX_TICKS;
          world.isGrasshopperAliveFlag[gi] = 1;
        }
      }
    }

    // Spawn dust pile particles (unowned Gold Dust for Storm Weave attraction)
    for (let i = 0; i < world.dustPileCount; i++) {
      spawnDustPileParticles(
        world,
        world.dustPileXWorld[i],
        world.dustPileYWorld[i],
        world.dustPileDustCount[i],
        world.rng,
      );
    }

    // Init dust
    environmentalDust.initFromWorld(world, room.worldNumber);

    // Reset procedural cloak on room transition
    playerCloak.reset();

    // Reset decoration wave state for new room
    decorationWaveState.reset(room.decorations?.length ?? 0);

    // Build and cache wall decorations and their center coordinates once per
    // room load so renderFrame() never allocates a WallDecoration[] each frame.
    cachedWallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
    for (let _di = 0; _di < cachedWallDecorations.length; _di++) {
      const _d = cachedWallDecorations[_di];
      // Decoration center X = left edge + half block width (mid-block horizontally).
      cachedDecorationCenterX[_di] = _d.worldLeftPx + BLOCK_SIZE_SMALL / 2;
      cachedDecorationCenterY[_di] = _d.worldAnchorYPx;
    }

    // Rebuild the reusable snapshot cluster pool to match this room's cluster
    // count so updateSnapshotInPlace() never needs to grow the pool mid-frame.
    resetReusableSnapshot(reusableSnapshot, world);

    // Init save tomb renderer (with room walls for floor detection)
    skillTombRenderer.init(room.saveTombs, room.walls);

    // Init skill tomb effect renderer
    skillTombEffectRenderer.init(room.skillTombs);

    // Track explored room
    if (progress && !progress.exploredRoomIds.includes(room.id)) {
      progress.exploredRoomIds.push(room.id);
    }

    // Snap camera to player position (skip when called from editor to preserve editor camera)
    if (!preserveCamera) {
      snapCamera(camera, spawnXWorld, spawnYWorld, roomWidthWorld, roomHeightWorld, virtualWidthPx, virtualHeightPx);
    }
  }

  const world = createWorldState(FIXED_DT_MS, 42);
  // Set the selected character on the world for rendering
  world.characterId = progress?.characterId ?? 'knight';
  const levelRng = createRng(12345);
  const environmentalDust = new EnvironmentalDustLayer();
  const skidDebris = new SkidDebrisRenderer();
  const skillTombRenderer = new SkillTombRenderer();
  const skillTombEffectRenderer = new SkillTombEffectRenderer();
  const playerCloak = new PlayerCloak();
  const decorationWaveState = new DecorationWaveState();

  // ── Per-frame allocation-free state ─────────────────────────────────────
  // All three are populated once per room load in loadRoom() and reused every
  // frame so renderFrame() never allocates decorations or snapshots on the heap.
  let cachedWallDecorations: WallDecoration[] = [];
  const cachedDecorationCenterX = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  const cachedDecorationCenterY = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  const reusableSnapshot = createReusableSnapshot(world);

  // ── Render-interpolation buffers ─────────────────────────────────────────
  // Cluster positions captured immediately before the physics tick loop each
  // frame.  The renderer blends between these and the post-tick positions using
  // the remaining accumulator fraction (renderAlpha) so sprites advance
  // continuously rather than snapping once per physics tick.
  // Sized to match MAX_REUSABLE_CLUSTERS; grows lazily if needed.
  let prevClusterPosX = new Float32Array(64);
  let prevClusterPosY = new Float32Array(64);

  // ── Health bar state ─────────────────────────────────────────────────────
  /** Map of entityId -> tick when health bar should hide. */
  const healthBarDisplayUntilTick: Map<number, number> = new Map();
  /** Previous health values to detect damage. */
  const prevHealthMap: Map<number, number> = new Map();

  // ── Combat text system (floating damage numbers) ─────────────────────────
  const combatText = createCombatTextSystem();
  /** Tracks the last seen world.lastPlayerBlockedTick to detect new BLOCKED events. */
  const prevLastPlayerBlockedTick = { value: -1 };

  // ── Dust container state (armor system) ─────────────────────────────────
  /** Number of dust particles the player currently has. */
  function getPlayerDustCount(): number {
    const player = world.clusters[0];
    if (player === undefined || player.isAliveFlag === 0) return 0;
    let count = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.ownerEntityId[i] === player.entityId && world.isAliveFlag[i] === 1 && world.isTransientFlag[i] === 0) {
        count++;
      }
    }
    return count;
  }

  // Track explored rooms
  if (progress && !progress.exploredRoomIds.includes(currentRoom.id)) {
    progress.exploredRoomIds.push(currentRoom.id);
  }

  // Initial room load — use saved spawn point if returning to a save.
  // Prefer the room's own playerSpawnBlock as the fallback so the player is
  // placed at a sensible room-specific position rather than the lobby coordinates.
  // resolveSpawnBlock clamps to bounds and finds an open spot if the position
  // is inside a solid wall (handles out-of-bounds saves, new rooms, etc.).
  const desiredSpawnBlock = (progress && progress.lastSaveSpawnBlock && progress.lastSaveRoomId === currentRoom.id)
    ? progress.lastSaveSpawnBlock
    : currentRoom.playerSpawnBlock;
  const initialSpawnBlock = resolveSpawnBlock(currentRoom, desiredSpawnBlock[0], desiredSpawnBlock[1]);
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
  const editorController: EditorController = createEditorController(canvas, uiRoot, (roomDef, spawnX, spawnY, preserveCamera) => {
    // When playing from the editor the room's playerSpawnBlock may be inside a
    // wall (e.g. in a newly-created room or after heavy edits).  Always resolve
    // to an open position so the player isn't stuck on entry.
    const [validX, validY] = resolveSpawnBlock(roomDef, spawnX, spawnY);
    loadRoom(roomDef, validX, validY, preserveCamera);
  }, () => {
    // Called when editor closes (confirm or cancel)
    if (editorToggleBtn) {
      editorToggleBtn.textContent = 'World Editor';
      editorToggleBtn.style.borderColor = '#00c864';
      editorToggleBtn.style.color = '#00c864';
    }
  });

  // Failsafe: if campaign start wiring looks broken, force-open editor visual map.
  if (shouldOpenFailsafeEditor) {
    editorController.toggle(currentRoom);
    editorController.openVisualMap();
  }

  // "World Editor" toggle button — shown when debug mode is on
  let editorToggleBtn: HTMLButtonElement | null = null;
  let debugPanel: DebugPanel | null = null;
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
    // Show debug speed panel alongside editor button
    if (debugPanel === null) {
      debugPanel = createDebugPanel(uiRoot);
    }
  }
  function removeEditorButton(): void {
    if (editorToggleBtn !== null && editorToggleBtn.parentElement) {
      editorToggleBtn.parentElement.removeChild(editorToggleBtn);
      editorToggleBtn = null;
    }
    if (debugPanel !== null) {
      debugPanel.destroy();
      debugPanel = null;
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
    musicVolume: getMusicVolume(),
    sfxVolume: getSfxVolume(),
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
        // Reload from last save point or campaign spawn
        if (progress && progress.lastSaveRoomId) {
          const saveRoom = ROOM_REGISTRY.get(progress.lastSaveRoomId);
          if (saveRoom && progress.lastSaveSpawnBlock) {
            loadRoom(saveRoom, progress.lastSaveSpawnBlock[0], progress.lastSaveSpawnBlock[1]);
          } else {
            loadRoom(campaignSpawnRoom, campaignSpawnBlock[0], campaignSpawnBlock[1]);
          }
        } else {
          loadRoom(campaignSpawnRoom, campaignSpawnBlock[0], campaignSpawnBlock[1]);
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

  const TRANSITION_SPAWN_INSET_BLOCKS = 3;

  function getOppositeTransitionDirection(direction: TransitionDirection): TransitionDirection {
    if (direction === 'left') return 'right';
    if (direction === 'right') return 'left';
    if (direction === 'up') return 'down';
    return 'up';
  }

  function computeSpawnBlockForTransition(room: RoomDef, transition: RoomTransitionDef): readonly [number, number] {
    const openingCenterOffsetBlocks = Math.floor(transition.openingSizeBlocks / 2);
    if (transition.direction === 'left') {
      return [
        TRANSITION_SPAWN_INSET_BLOCKS,
        transition.positionBlock + openingCenterOffsetBlocks,
      ] as const;
    }
    if (transition.direction === 'right') {
      return [
        room.widthBlocks - TRANSITION_SPAWN_INSET_BLOCKS - 1,
        transition.positionBlock + openingCenterOffsetBlocks,
      ] as const;
    }
    if (transition.direction === 'up') {
      return [
        transition.positionBlock + openingCenterOffsetBlocks,
        TRANSITION_SPAWN_INSET_BLOCKS,
      ] as const;
    }
    return [
      transition.positionBlock + openingCenterOffsetBlocks,
      room.heightBlocks - TRANSITION_SPAWN_INSET_BLOCKS - 1,
    ] as const;
  }

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
      if (t.depthBlock !== undefined) {
        // Interior transition: fire when the player's center enters the zone
        const FADE_DEPTH = 6 * BLOCK_SIZE_MEDIUM;
        const zoneStartWorld = t.depthBlock * BLOCK_SIZE_MEDIUM;
        const zoneEndWorld   = zoneStartWorld + FADE_DEPTH;
        isInTunnel = px >= zoneStartWorld && px <= zoneEndWorld
          && py >= openTopWorld && py <= openBottomWorld;
        // For up/down interior transitions
        if (t.direction === 'up' || t.direction === 'down') {
          isInTunnel = py >= zoneStartWorld && py <= zoneEndWorld
            && px >= openTopWorld && px <= openBottomWorld;
        }
      } else if (t.direction === 'left') {
        isInTunnel = px < TUNNEL_DETECT_MARGIN_WORLD && py >= openTopWorld && py <= openBottomWorld;
      } else if (t.direction === 'right') {
        isInTunnel = px > roomWidthWorld - TUNNEL_DETECT_MARGIN_WORLD && py >= openTopWorld && py <= openBottomWorld;
      }

      if (isInTunnel) {
        const targetRoom = ROOM_REGISTRY.get(t.targetRoomId);
        if (targetRoom !== undefined) {
          const oppositeDirection = getOppositeTransitionDirection(t.direction);
          const targetReturnTransition = targetRoom.transitions.find((targetTransition) =>
            targetTransition.targetRoomId === currentRoom.id
            && targetTransition.direction === oppositeDirection,
          );

          if (targetReturnTransition !== undefined) {
            const spawnBlock = computeSpawnBlockForTransition(targetRoom, targetReturnTransition);
            loadRoom(targetRoom, spawnBlock[0], spawnBlock[1]);
          } else {
            loadRoom(targetRoom, t.targetSpawnBlock[0], t.targetSpawnBlock[1]);
          }
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
      // Use CSS display dimensions for mouse coordinate mapping (not buffer dimensions)
      const canvasRect = canvas.getBoundingClientRect();
      const isEditorConsuming = editorController.update(
        elapsedMs / 1000, camera, offsetXPx, offsetYPx, zoom,
        canvasRect.width, canvasRect.height, virtualWidthPx, virtualHeightPx,
      );

      if (isEditorConsuming) {
        // Still render the game world (walls, particles, etc.) as backdrop
        bloomSystem.beginFrame();
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
          currentRoom.backgroundId,
        );
        if (isTheroShowcaseRoom(currentRoom.id)) {
          renderTheroShowcaseEffect(ctx, currentRoom.id, virtualWidthPx, virtualHeightPx, performance.now());
        }
        if (currentRoom.backgroundId === 'crystallineCracks') {
          renderCrystallineCracksBackground(ctx, virtualWidthPx, virtualHeightPx, performance.now());
        }
        renderWalls(ctx, snapshot, eox, eoy, zoom, true);
        renderHazards(ctx, world, eox, eoy, zoom, world.tick);
        renderClusters(ctx, snapshot, eox, eoy, zoom, true);
        renderGrasshoppers(ctx, snapshot, eox, eoy, zoom);
        renderRadiantTether(ctx, snapshot, eox, eoy, zoom, true);
        renderGrapple(ctx, snapshot, eox, eoy, zoom);
        drawTunnelDarkness(ctx, currentRoom, eox, eoy, zoom);
        environmentalDust.render(ctx, eox, eoy, zoom, true);
        skillTombRenderer.render(ctx, eox, eoy, zoom);
        skillTombEffectRenderer.renderBehind(ctx, eox, eoy, zoom);
        skillTombEffectRenderer.renderSprite(ctx, eox, eoy, zoom);
        skillTombEffectRenderer.renderFront(ctx, eox, eoy, zoom);

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
        bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);

        rafHandle = requestAnimationFrame(frame);
        return;
      }
    }

    const commands = collectCommands(inputState);
    let openPause = false;
    let moveDx = 0;
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
      } else if (cmd.kind === CommandKind.ToggleFullscreen) {
        if (!document.fullscreenElement) {
          // Enter fullscreen on key press (requires user gesture; keydown path satisfies this).
          void document.documentElement.requestFullscreen().catch(() => {});
        }
      } else if (cmd.kind === CommandKind.Interact) {
        interactInputPulseMs = 150;
        const playerForInteract = world.clusters[0];
        if (playerForInteract !== undefined && playerForInteract.isAliveFlag === 1) {
          // Check if player is near a save tomb (opens the save menu)
          const nearbyIndex = skillTombRenderer.getNearbyTombIndex(
            playerForInteract.positionXWorld, playerForInteract.positionYWorld,
          );
          if (nearbyIndex >= 0) {
            interactTriggered = true;
          }
          // Check if player is near a skill tomb (unlocks a dust weave)
          const nearbySkillTombIndex = skillTombEffectRenderer.getNearbyTombIndex(
            playerForInteract.positionXWorld, playerForInteract.positionYWorld,
          );
          if (nearbySkillTombIndex >= 0 && progress) {
            const roomSkillTombs = currentRoom.skillTombs ?? [];
            const st = roomSkillTombs[nearbySkillTombIndex];
            if (st !== undefined) {
              unlockActiveWeave(progress, st.weaveId);
            }
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

    // Update music volume from pause menu settings
    musicManager.setVolume(pauseMenuState.musicVolume);

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

    // Latch one-shot jump inputs into world state before ticking.
    // This preserves edge-triggered inputs on high-refresh frames where no
    // fixed sim tick runs (accumulator < FIXED_DT_MS).
    if (jumpTriggered) {
      world.playerJumpTriggeredFlag = 1;
    }
    world.playerJumpHeldFlag = inputState.isJumpHeldFlag ? 1 : 0;


    // ── Sim ticks ──────────────────────────────────────────────────────────
    accumulatorMs += elapsedMs;

    // Capture cluster positions before any ticks run this frame.  These are
    // the "previous" positions used by render interpolation: the renderer
    // blends between these and the post-tick positions so sprites move
    // continuously rather than snapping discretely once per physics tick.
    const clusterCountBeforeTick = world.clusters.length;
    if (prevClusterPosX.length < clusterCountBeforeTick) {
      prevClusterPosX = new Float32Array(clusterCountBeforeTick * 2);
      prevClusterPosY = new Float32Array(clusterCountBeforeTick * 2);
    }
    for (let clusterIndex = 0; clusterIndex < clusterCountBeforeTick; clusterIndex++) {
      prevClusterPosX[clusterIndex] = world.clusters[clusterIndex].positionXWorld;
      prevClusterPosY[clusterIndex] = world.clusters[clusterIndex].positionYWorld;
    }

    while (accumulatorMs >= FIXED_DT_MS) {
      const player = world.clusters[0];
      if (player !== undefined) {
        world.playerMoveInputDxWorld = moveDx !== 0 ? (moveDx > 0 ? 1.0 : -1.0) : 0.0;
        world.playerMoveInputDyWorld = inputState.isKeyS ? 1.0 : 0.0;
      }
      // Pass sprint and crouch input to the sim
      world.playerSprintHeldFlag = inputState.isSprintHeldFlag ? 1 : 0;
      world.playerCrouchHeldFlag = inputState.isKeyS ? 1 : 0;
      tick(world);
      // Process large slime splits (spawn child slimes when large slime dies)
      const newSlimes = processLargeSlimeSplits(world);
      for (let s = 0; s < newSlimes.length; s++) {
        world.clusters.push(newSlimes[s]);
      }
      environmentalDust.update(world, FIXED_DT_MS);
      skidDebris.update(world, FIXED_DT_MS);
      accumulatorMs -= FIXED_DT_MS;
    }

    // Fraction of a tick remaining in the accumulator — used to blend rendered
    // cluster positions between the pre-tick and post-tick physics positions.
    const renderAlpha = accumulatorMs / FIXED_DT_MS;

    // ── Check for player death ───────────────────────────────────────────────
    const playerForDeath = world.clusters[0];
    if (playerForDeath !== undefined && playerForDeath.isAliveFlag === 0 && !isPlayerDead) {
      showPlayerDeathScreen();
    }

    // ── Update skill tomb renderer ──────────────────────────────────────────
    const playerForTomb = world.clusters[0];
    if (playerForTomb !== undefined && playerForTomb.isAliveFlag === 1) {
      skillTombRenderer.update(playerForTomb.positionXWorld, playerForTomb.positionYWorld, elapsedMs / 1000);
      skillTombEffectRenderer.update(playerForTomb.positionXWorld, playerForTomb.positionYWorld, elapsedMs / 1000);

      // Dust container pickup: grants +1 dust container (+4 capacity) and spawns particles.
      const roomDustContainers = currentRoom.dustContainers ?? [];
      for (let i = 0; i < roomDustContainers.length; i++) {
        const pickupKey = `${currentRoom.id}:${i}`;
        if (collectedDustContainerKeySet.has(pickupKey)) continue;

        const dc = roomDustContainers[i];
        const cx = (dc.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
        const cy = (dc.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
        const dx = playerForTomb.positionXWorld - cx;
        const dy = playerForTomb.positionYWorld - cy;
        if (dx * dx + dy * dy <= DUST_CONTAINER_PICKUP_RADIUS_WORLD * DUST_CONTAINER_PICKUP_RADIUS_WORLD) {
          collectedDustContainerKeySet.add(pickupKey);
          // Grant a container to the player's progression state
          if (progress) {
            progress.dustContainerCount += 1;
          }
          spawnClusterParticles(
            world,
            playerForTomb.entityId,
            playerForTomb.positionXWorld,
            playerForTomb.positionYWorld,
            ParticleKind.Physical,
            DUST_CONTAINER_DUST_GAIN,
            levelRng,
          );
        }
      }

      // Dust boost jar pickup: spawn temporary dust particles of the jar's kind.
      // The sim (hazards.ts) sets isDustBoostJarActiveFlag=0 on contact; we detect
      // the transition here and spawn particles on the renderer side.
      for (let i = 0; i < world.dustBoostJarCount; i++) {
        const jarKey = `dustjar:${currentRoom.id}:${i}`;
        if (world.isDustBoostJarActiveFlag[i] === 0 && !collectedDustContainerKeySet.has(jarKey)) {
          collectedDustContainerKeySet.add(jarKey);
          const dustKind = world.dustBoostJarKind[i] as ParticleKind;
          const dustCount = world.dustBoostJarDustCount[i];
          spawnClusterParticles(
            world,
            playerForTomb.entityId,
            playerForTomb.positionXWorld,
            playerForTomb.positionYWorld,
            dustKind,
            dustCount,
            levelRng,
          );
        }
      }
    }

    // ── Update camera to follow player ──────────────────────────────────────
    const playerForCamera = world.clusters[0];
    if (playerForCamera !== undefined && playerForCamera.isAliveFlag === 1) {
      // Use the render-interpolated player position so the camera tracks the
      // same sub-tick position that the sprite will be drawn at.  This keeps
      // the player visually centred and prevents background/wall parallax
      // jitter relative to the sprite.
      const camTargetX = prevClusterPosX[0] + (playerForCamera.positionXWorld - prevClusterPosX[0]) * renderAlpha;
      const camTargetY = prevClusterPosY[0] + (playerForCamera.positionYWorld - prevClusterPosY[0]) * renderAlpha;
      updateCamera(
        camera,
        camTargetX,
        camTargetY,
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
        const isStandingOnSurface =
          playerClusterForHud.isGroundedFlag === 1 || world.isGrappleStuckFlag === 1;
        const dbg: HudDebugState = {
          isGrounded:           playerClusterForHud.isGroundedFlag === 1,
          isStandingOnSurface,
          coyoteTimeTicks:      playerClusterForHud.coyoteTimeTicks,
          jumpBufferTicks:      playerClusterForHud.jumpBufferTicks,
          isWallSlidingFlag:    playerClusterForHud.isWallSlidingFlag === 1,
          isTouchingWallLeft:   playerClusterForHud.isTouchingWallLeftFlag === 1,
          isTouchingWallRight:  playerClusterForHud.isTouchingWallRightFlag === 1,
          wallJumpLockoutTicks: playerClusterForHud.wallJumpLockoutTicks,
          isGrappleActive:      world.isGrappleActiveFlag === 1,
          grappleLengthWorld:   world.grappleLengthWorld,
          grapplePullInAmountWorld: world.grapplePullInAmountWorld,
          isSkidding:           playerClusterForHud.isSkiddingFlag === 1,
          isSliding:            playerClusterForHud.isSlidingFlag === 1,
          isSprinting:          playerClusterForHud.isSprintingFlag === 1,
          inputUp: inputState.isJumpHeldFlag || inputState.isJumpTriggeredFlag,
          inputLeft: inputState.isKeyA,
          inputRight: inputState.isKeyD,
          inputDown: inputState.isKeyS,
          inputShift: inputState.isSprintHeldFlag,
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

    if (interactInputPulseMs > 0) {
      interactInputPulseMs = Math.max(0, interactInputPulseMs - elapsedMs);
    }

    // ── Update procedural cloak (per-frame visual, not per-tick sim) ──────
    const cloakPlayer = world.clusters[0];
    if (cloakPlayer !== undefined && cloakPlayer.isAliveFlag === 1 && cloakPlayer.isPlayerFlag === 1) {
      playerCloak.update(elapsedMs / 1000, {
        positionXWorld: cloakPlayer.positionXWorld,
        positionYWorld: cloakPlayer.positionYWorld,
        velocityXWorld: cloakPlayer.velocityXWorld,
        velocityYWorld: cloakPlayer.velocityYWorld,
        isFacingLeftFlag: cloakPlayer.isFacingLeftFlag,
        isGroundedFlag: cloakPlayer.isGroundedFlag,
        isSprintingFlag: cloakPlayer.isSprintingFlag,
        isCrouchingFlag: cloakPlayer.isCrouchingFlag,
        isWallSlidingFlag: cloakPlayer.isWallSlidingFlag,
        halfWidthWorld: cloakPlayer.halfWidthWorld,
        halfHeightWorld: cloakPlayer.halfHeightWorld,
      });
    }

    // ── Render frame (all canvas draw calls delegated to gameRender.ts) ───
    updateSnapshotInPlace(reusableSnapshot, world, renderAlpha, prevClusterPosX, prevClusterPosY);
    renderFrame({
      ctx, deviceCtx, virtualCanvas, canvas,
      webglRenderer, environmentalDust, skidDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
      playerCloak, darkRoomOverlay, decorationWaveState,
      world, currentRoom,
      snapshot: reusableSnapshot,
      cachedDecorations: cachedWallDecorations,
      cachedDecorationCenterX,
      cachedDecorationCenterY,
      ox, oy, zoom, virtualWidthPx, virtualHeightPx,
      bgColor, isDebugMode, hudState, inputState,
      prevHealthMap, healthBarDisplayUntilTick,
      combatText, prevLastPlayerBlockedTick,
      collectedDustContainerKeySet,
      isDustContainerSpriteLoaded,
      dustContainerSprite,
      getPlayerDustCount,
    });

    rafHandle = requestAnimationFrame(frame);
  }

  rafHandle = requestAnimationFrame(frame);

  return () => {
    isRunning = false;
    if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
    if (pauseMenuCleanup !== null) pauseMenuCleanup();
    if (deathScreenCleanup !== null) deathScreenCleanup();
    if (skillTombMenuCleanup !== null) skillTombMenuCleanup();
    // Stop background music and release resources
    musicManager.dispose();
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
