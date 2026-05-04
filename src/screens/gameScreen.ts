import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles } from '../sim/clusters/grapple';
import { ParticleKind } from '../sim/particles/kinds';
import { tick } from '../sim/tick';
import { createRng, nextFloat, nextFloatTriangle } from '../sim/rng';
import { createReusableSnapshot, updateSnapshotInPlace, resetReusableSnapshot } from '../render/snapshot';
import { renderParticles } from '../render/particles/renderer';
import { renderClusters, renderWalls } from '../render/clusters/renderer';
import { renderGrapple } from '../render/clusters/grappleRenderer';
import { PlayerCloak } from '../render/clusters/playerCloak';
import { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import { renderHudOverlay, HudState, HudDebugState } from '../render/hud/overlay';
import { EnvironmentalDustLayer } from '../render/environmentalDust';
import { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import { CrumbleDebrisRenderer } from '../render/crumbleDebrisRenderer';
import { ArrowWeaveRenderer } from '../render/effects/arrowWeaveRenderer';
import { SwordWeaveRenderer } from '../render/effects/swordWeaveRenderer';
import { FallingBlockDustRenderer } from '../render/fallingBlocks/fallingBlockRenderer';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners } from '../input/handler';
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ROOM_REGISTRY, STARTING_ROOM_ID } from '../levels/rooms';
import { renderHazards } from '../render/hazards';
import { createCameraState, snapCamera, updateCamera, getCameraOffset } from '../render/camera';
import { setActiveBlockSpriteWorld, setActiveBlockSpriteTheme, setActiveBlockLighting, setActiveDarkAmbientBlockers } from '../render/walls/blockSpriteRenderer';
import { showPauseMenu, PauseMenuState } from '../ui/pauseMenu';
import { createDebugPanel, DebugPanel } from '../ui/debugPanel';
import { renderWorldBackground } from '../render/backgroundRenderer';
import { showDeathScreen } from '../ui/deathScreen';
import { showSkillTombMenu, showMapOnlyModal } from '../ui/skillTombMenu';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import { PlayerProgress } from '../progression/playerProgress';
import { createEditorController, EditorController } from '../editor/editorController';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout } from '../sim/weaves/playerLoadout';
import { WEAVE_STORM } from '../sim/weaves/weaveDefinition';
import { resetRadiantTetherState } from '../sim/clusters/radiantTetherAi';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';
import { getSelectedRenderSize, getMusicVolume, getSfxVolume, getGraphicsQuality } from '../ui/renderSettings';
import { createMusicManager, MusicManager } from '../audio/musicManager';
import { isTheroShowcaseRoom, renderTheroShowcaseEffect, renderCrystallineCracksBackground } from '../render/effects/theroEffectManager';
import { BloomSystem } from '../render/effects/bloomSystem';
import { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import { DEFAULT_BLOOM_CONFIG } from '../render/effects/bloomConfig';
import { RenderProfiler } from '../render/hud/renderProfiler';
import { getTotalCapacity, getMaxParticlesForDust } from '../progression/dustCapacity';
import { getElementProfile } from '../sim/particles/elementProfiles';
import {
  spawnClusterParticles,
  spawnWeaveLoadoutParticles,
  spawnBackgroundFluidParticles,
  spawnDustPileParticles,
  spawnEnemyClusters,
  PARTICLE_COUNT_PER_CLUSTER,
  BACKGROUND_FLUID_COUNT,
  PLAYER_INITIAL_HEALTH,
} from './gameSpawn';
import {
  loadRoomWalls,
  loadRoomHazards,
  loadRoomRopes,
  loadRoomFallingBlocks,
  worldBgColor,
  drawTunnelDarkness,
  resolveSpawnBlock,
  DUST_CONTAINER_PICKUP_RADIUS_WORLD,
  DUST_CONTAINER_DUST_GAIN,
} from './gameRoom';
import { renderFrame } from './gameRender';
import { createCombatTextSystem } from '../render/hud/combatText';
import { processLargeSlimeSplits } from '../sim/clusters/slimeAi';
import { DecorationWaveState, buildRoomDecorations } from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { renderGrasshoppers } from '../render/critters/grasshopperRenderer';
import { MAX_GRASSHOPPERS, GRASSHOPPER_INITIAL_TIMER_MAX_TICKS, MAX_CRUMBLE_BLOCKS } from '../sim/world';
import { processPlayerCommands } from './gameCommandProcessor';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import {
  checkRoomTransitions,
} from './gameTransitions';

const FIXED_DT_MS = 16.666;

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
  const bloomSystem = new BloomSystem({ ...DEFAULT_BLOOM_CONFIG });
  const darkRoomOverlay = new DarkRoomOverlay();
  const renderProfiler = new RenderProfiler();

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
  /** Keys in the format `${roomId}:${xBlock}:${yBlock}` for already-consumed skill tombs. */
  const consumedSkillTombKeySet: Set<string> = new Set();

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
    // Build the ambientLightBlockers tile-key set from authored room data.
    // These tiles are opaque to the ambient-light solver in
    // `blockSpriteRenderer` (but NOT to collision and NOT to local lights
    // — see `roomDef.ts` for the full authoring model).
    let blockerKeys: Set<string> | undefined;
    let darkBlockerKeys: Set<string> | undefined;
    if (room.ambientLightBlockers && room.ambientLightBlockers.length > 0) {
      blockerKeys = new Set<string>();
      for (const b of room.ambientLightBlockers) {
        const key = `${b.xBlock},${b.yBlock}`;
        blockerKeys.add(key);
        if (b.isDark) {
          if (!darkBlockerKeys) darkBlockerKeys = new Set<string>();
          darkBlockerKeys.add(key);
        }
      }
    }
    setActiveBlockLighting(
      room.lightingEffect ?? 'Ambient',
      room.widthBlocks,
      room.heightBlocks,
      room.ambientLightDirection,
      blockerKeys,
    );
    setActiveDarkAmbientBlockers(darkBlockerKeys);

    // Notify the music manager about the new room
    musicManager.notifyRoomEntered(room.songId ?? '_continue');

    // Preserve the player's current health across room transitions.
    // On the very first load there is no existing player, so fall back to full health.
    let carryHealthPoints = PLAYER_INITIAL_HEALTH;
    if (world.clusters.length > 0 && world.clusters[0].isPlayerFlag === 1) {
      carryHealthPoints = world.clusters[0].healthPoints;
    }

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
    world.isGrappleZipActiveFlag = 0;
    world.isGrappleStuckFlag      = 0;
    world.hasGrappleChargeFlag    = 1;
    world.grappleParticleStartIndex = -1;

    // Reset Radiant Tether boss state
    resetRadiantTetherState();

    // Spawn player at the given block position
    const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
    const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
    const playerCluster = createClusterState(1, spawnXWorld, spawnYWorld, 1, PLAYER_INITIAL_HEALTH);
    // Restore health carried from the previous room (createClusterState sets both
    // healthPoints and maxHealthPoints to PLAYER_INITIAL_HEALTH; we only override
    // healthPoints so the health bar displays correctly).
    // Clamp to maxHealthPoints so an out-of-range carry value cannot violate the invariant.
    playerCluster.healthPoints = Math.min(carryHealthPoints, playerCluster.maxHealthPoints);
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
    // Phase 8: set orbit source flag — 1 if Storm is primary, 0 for inventory source
    world.isMoteSourceOrbitFlag = world.playerPrimaryWeaveId === WEAVE_STORM ? 1 : 0;

    // Initialise the ordered mote queue from the player particles just spawned.
    // Must be called after player particle spawning and before enemy spawning
    // (enemy particles are excluded by ownerEntityId, but calling early is safer).
    initMoteQueueFromParticles(world, playerCluster.entityId);

    // Spawn enemies
    spawnEnemyClusters(world, room.enemies, 2, levelRng);

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

    // Load ropes
    loadRoomRopes(world, room);

    // Load falling block groups (after walls so group wall slots come after static geometry)
    loadRoomFallingBlocks(world, room);

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
          world.grasshopperXWorld[gi] = areaXWorld + areaWidthWorld  * 0.5
            + nextFloatTriangle(world.rng) * areaWidthWorld  * 0.5;
          world.grasshopperYWorld[gi] = areaYWorld + areaHeightWorld * 0.5
            + nextFloatTriangle(world.rng) * areaHeightWorld * 0.5;
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
    sunbeamRenderer.initFromRoom(room);
    atmosphericLightDust.initFromRoom(room);

    // Reset procedural cloak on room transition
    playerCloak.reset();
    phantomCloak.reset();

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

    // Seed the render-interpolation buffers with the freshly spawned cluster
    // positions so the very first rendered frame has a valid prevPos baseline.
    // Without this, prevPos stays at zero until the first physics tick runs,
    // which can show a one-frame teleport glitch on high-refresh-rate displays.
    if (prevClusterPosX.length < world.clusters.length) {
      prevClusterPosX = new Float32Array(world.clusters.length * 2);
      prevClusterPosY = new Float32Array(world.clusters.length * 2);
    }
    for (let ci = 0; ci < world.clusters.length; ci++) {
      prevClusterPosX[ci] = world.clusters[ci].positionXWorld;
      prevClusterPosY[ci] = world.clusters[ci].positionYWorld;
    }

    // Init save tomb renderer (with room walls for floor detection)
    skillTombRenderer.init(room.saveTombs, room.walls);

    // Init skill tomb effect renderer
    skillTombEffectRenderer.init(room.skillTombs);
    // Remove any skill tombs that were already consumed in this session.
    // Iterate in reverse so splice indices remain valid.
    const roomSkillTombsForInit = room.skillTombs ?? [];
    for (let i = roomSkillTombsForInit.length - 1; i >= 0; i--) {
      const st = roomSkillTombsForInit[i];
      if (consumedSkillTombKeySet.has(`${room.id}:${st.xBlock}:${st.yBlock}`)) {
        skillTombEffectRenderer.removeTomb(i);
      }
    }

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
  const sunbeamRenderer = new SunbeamRenderer();
  const atmosphericLightDust = new AtmosphericLightDust();
  const skidDebris = new SkidDebrisRenderer();
  const crumbleDebris = new CrumbleDebrisRenderer();
  const skillTombRenderer = new SkillTombRenderer();
  const skillTombEffectRenderer = new SkillTombEffectRenderer();
  const playerCloak = new PlayerCloak();
  const phantomCloak = new PhantomCloakExtension();
  const decorationWaveState = new DecorationWaveState();
  const arrowWeaveRenderer = new ArrowWeaveRenderer();
  const swordWeaveRenderer = new SwordWeaveRenderer();
  const fallingBlockDust = new FallingBlockDustRenderer();

  // ── Per-frame allocation-free state ─────────────────────────────────────
  // All three are populated once per room load in loadRoom() and reused every
  // frame so renderFrame() never allocates decorations or snapshots on the heap.
  let cachedWallDecorations: WallDecoration[] = [];
  const cachedDecorationCenterX = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  const cachedDecorationCenterY = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  const reusableSnapshot = createReusableSnapshot(world);

  // ── Crumble block prev-state tracking ───────────────────────────────────
  // Snapshot of per-block hit state from the previous tick so we can detect
  // damage and destruction transitions and fire visual events + lighting rebuild.
  const prevCrumbleActive = new Uint8Array(MAX_CRUMBLE_BLOCKS);
  const prevCrumbleHits   = new Uint8Array(MAX_CRUMBLE_BLOCKS);

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
    graphicsQuality: getGraphicsQuality(),
  };

  function openPauseMenu(): void {
    if (isPaused || isPlayerDead || isSkillTombMenuOpen || isMapOnlyOpen) return;
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

  // ── Map-only modal state ────────────────────────────────────────────────
  let isMapOnlyOpen = false;
  let mapOnlyCleanup: (() => void) | null = null;

  function openSkillTombMenu(): void {
    if (isSkillTombMenuOpen || !progress) return;
    // Close the map-only modal if it's open before opening the full menu.
    if (mapOnlyCleanup !== null) {
      mapOnlyCleanup();
      isMapOnlyOpen = false;
      mapOnlyCleanup = null;
    }
    isSkillTombMenuOpen = true;

    // Save progress
    if (callbacks.onSave) callbacks.onSave();

    // Record save point
    const player = world.clusters[0];
    let playerXWorld = 0;
    let playerYWorld = 0;
    if (player) {
      playerXWorld = player.positionXWorld;
      playerYWorld = player.positionYWorld;

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

      // Heal player to full and restore all dust motes.
      player.healthPoints = player.maxHealthPoints;
      for (let i = 0; i < world.particleCount; i++) {
        if (world.ownerEntityId[i] !== player.entityId) continue;
        if (world.isTransientFlag[i] === 1) continue;
        if (world.isAliveFlag[i] === 0 && world.respawnDelayTicks[i] > 0) {
          // Instant respawn: set delay to 1 so the next tick's lifetime update
          // will decrement it to 0 and trigger the respawn logic.
          world.respawnDelayTicks[i] = 1;
        }
        if (world.isAliveFlag[i] === 1) {
          // Restore durability to the particle's maximum toughness.
          world.particleDurability[i] = getElementProfile(world.kindBuffer[i]).toughness;
        }
      }
    }

    skillTombMenuCleanup = showSkillTombMenu(uiRoot, progress, currentRoom.id, playerXWorld, playerYWorld, player.healthPoints, player.maxHealthPoints, {
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

  function openMapOnly(): void {
    if (isMapOnlyOpen || isSkillTombMenuOpen || !progress) return;
    const player = world.clusters[0];
    if (!player) return;
    isMapOnlyOpen = true;
    mapOnlyCleanup = showMapOnlyModal(
      uiRoot,
      progress,
      currentRoom.id,
      player.positionXWorld,
      player.positionYWorld,
      {
        onClose: () => {
          isMapOnlyOpen = false;
          mapOnlyCleanup = null;
          lastTimestampMs = 0;
        },
      },
    );
  }

  function onResize(): void {
    resizeCanvas();
  }
  window.addEventListener('resize', onResize);

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
        updateSnapshotInPlace(reusableSnapshot, world, 1.0, prevClusterPosX, prevClusterPosY);
        const snapshot = reusableSnapshot;

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

    const { moveDx, jumpTriggered, openPause, interactTriggered, interactInputPulseTrigger } =
      processPlayerCommands({
        inputState, world, canvas,
        offsetXPx, offsetYPx, zoom,
        virtualWidthPx, virtualHeightPx,
        skillTombRenderer, skillTombEffectRenderer,
        progress, consumedSkillTombKeySet, combatText,
        currentRoomId: currentRoom.id,
        openMapOnly,
      });

    if (interactInputPulseTrigger) {
      interactInputPulseMs = 150;
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
    if (isPaused || isSkillTombMenuOpen || isMapOnlyOpen) {
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // While dead, still render the frozen scene but skip sim
    if (isPlayerDead) {
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Room transition check ──────────────────────────────────────────────
    if (checkRoomTransitions(world, currentRoom, roomWidthWorld, roomHeightWorld, (room, spawnX, spawnY) => loadRoom(room, spawnX, spawnY))) {
      // Room changed — skip this frame's sim, render the new room next frame
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // Latch one-shot jump and down inputs into world state before ticking.
    // This preserves edge-triggered inputs on high-refresh frames where no
    // fixed sim tick runs (accumulator < FIXED_DT_MS).
    if (jumpTriggered) {
      world.playerJumpTriggeredFlag = 1;
    }
    if (inputState.isDownTriggeredFlag) {
      world.playerDownTriggeredFlag = 1;
      inputState.isDownTriggeredFlag = false;
    }
    world.playerJumpHeldFlag = inputState.isJumpHeldFlag ? 1 : 0;


    // ── Sim ticks ──────────────────────────────────────────────────────────
    // Cap the catch-up budget to 5 fixed ticks so that long pauses (tab switch,
    // DevTools breakpoint, OS sleep) cannot drive hundreds of unconstrained ticks
    // in a single render frame, which would cause instant death, runaway enemy AI,
    // and multi-second browser stalls.
    accumulatorMs = Math.min(accumulatorMs + elapsedMs, FIXED_DT_MS * 5);

    while (accumulatorMs >= FIXED_DT_MS) {
      // Capture cluster positions just before THIS tick so that after the loop,
      // prevClusterPos holds the positions from the start of the LAST tick that
      // ran.  Combined with renderAlpha (the remaining accumulator fraction),
      // this enables smooth sub-tick interpolation at any display refresh rate:
      // the renderer blends from prevPos to currentPos as renderAlpha grows from
      // 0 toward 1 between ticks, producing continuous motion with no lurching.
      // Capturing before ALL ticks (the old approach) caused the sprite to freeze
      // at currentPos on no-tick frames then snap back when a tick finally fired.
      const clusterCountForTick = world.clusters.length;
      if (prevClusterPosX.length < clusterCountForTick) {
        prevClusterPosX = new Float32Array(clusterCountForTick * 2);
        prevClusterPosY = new Float32Array(clusterCountForTick * 2);
      }
      for (let clusterIndex = 0; clusterIndex < clusterCountForTick; clusterIndex++) {
        prevClusterPosX[clusterIndex] = world.clusters[clusterIndex].positionXWorld;
        prevClusterPosY[clusterIndex] = world.clusters[clusterIndex].positionYWorld;
      }

      const player = world.clusters[0];
      if (player !== undefined) {
        world.playerMoveInputDxWorld = moveDx !== 0 ? (moveDx > 0 ? 1.0 : -1.0) : 0.0;
        world.playerMoveInputDyWorld = inputState.isKeyS ? 1.0 : 0.0;
      }
      // Pass sprint and crouch input to the sim
      world.playerSprintHeldFlag = inputState.isSprintHeldFlag ? 1 : 0;
      world.playerCrouchHeldFlag = inputState.isKeyS ? 1 : 0;
      tick(world);
      // If the player died during this tick, stop processing further ticks in
      // this frame.  Continuing to run enemy AI, spike contact, and force
      // accumulation on a dead cluster produces erratic post-death effects.
      if (world.clusters[0]?.isAliveFlag === 0) {
        accumulatorMs -= FIXED_DT_MS;
        break;
      }
      // Process large slime splits (spawn child slimes when large slime dies)
      const newSlimes = processLargeSlimeSplits(world);
      for (let s = 0; s < newSlimes.length; s++) {
        world.clusters.push(newSlimes[s]);
      }
      environmentalDust.update(world, FIXED_DT_MS);
      atmosphericLightDust.update(FIXED_DT_MS);
      skidDebris.update(world, FIXED_DT_MS);

      // ── Crumble block debris events & ambient lighting rebuild ────────────
      for (let ci = 0; ci < world.crumbleBlockCount; ci++) {
        const nowActive = world.isCrumbleBlockActiveFlag[ci];
        const nowHits   = world.crumbleBlockHitsRemaining[ci];
        const wasActive = prevCrumbleActive[ci];
        const wasHits   = prevCrumbleHits[ci];

        if (wasActive === 1) {
          if (nowActive === 0) {
            // Block fully destroyed this tick.
            // The wall sprite renderer detects the changed wall-layout signature
            // automatically and rebuilds ambient lighting on the next frame.
            crumbleDebris.notifyBlockHit(world.crumbleBlockXWorld[ci], world.crumbleBlockYWorld[ci], true);
          } else if (nowHits < wasHits) {
            // Block cracked (first hit) this tick
            crumbleDebris.notifyBlockHit(world.crumbleBlockXWorld[ci], world.crumbleBlockYWorld[ci], false);
          }
        }

        prevCrumbleActive[ci] = nowActive;
        prevCrumbleHits[ci]   = nowHits;
      }

      crumbleDebris.update(FIXED_DT_MS);
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
          isGrappleMissActive:  world.isGrappleMissActiveFlag === 1,
          grappleParticleStartIndex: world.grappleParticleStartIndex,
          isGrappleChainHiddenFlag: true,
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
      // Use the render-interpolated player position so the cloak chain anchor
      // matches the pixel position where the player sprite will be drawn.
      // Using raw physics positionXWorld instead causes the cloak root to sit
      // one-tick ahead of the sprite at non-60 Hz refresh rates, making the
      // cloak appear to detach and jitter relative to the player body.
      const cloakInterpXWorld = prevClusterPosX[0] + (cloakPlayer.positionXWorld - prevClusterPosX[0]) * renderAlpha;
      const cloakInterpYWorld = prevClusterPosY[0] + (cloakPlayer.positionYWorld - prevClusterPosY[0]) * renderAlpha;
      playerCloak.update(elapsedMs / 1000, {
        positionXWorld: cloakInterpXWorld,
        positionYWorld: cloakInterpYWorld,
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
      // Update phantom cloak extension — roots at the main cloak's tip.
      phantomCloak.update(elapsedMs / 1000, {
        positionXWorld:    cloakInterpXWorld,
        positionYWorld:    cloakInterpYWorld,
        velocityXWorld:    cloakPlayer.velocityXWorld,
        velocityYWorld:    cloakPlayer.velocityYWorld,
        isFacingLeftFlag:  cloakPlayer.isFacingLeftFlag,
        isGrappleActiveFlag: world.isGrappleActiveFlag,
        rootXWorld:        playerCloak.getTipXWorld(),
        rootYWorld:        playerCloak.getTipYWorld(),
      });
    }

    // ── Render frame (all canvas draw calls delegated to gameRender.ts) ───
    updateSnapshotInPlace(reusableSnapshot, world, renderAlpha, prevClusterPosX, prevClusterPosY);
    renderFrame({
      ctx, deviceCtx, virtualCanvas, canvas,
      webglRenderer, environmentalDust, skidDebris, crumbleDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
      playerCloak, phantomCloak, darkRoomOverlay, decorationWaveState, arrowWeaveRenderer, swordWeaveRenderer,
      sunbeamRenderer, atmosphericLightDust, fallingBlockDust,
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
      graphicsQuality: pauseMenuState.graphicsQuality,
      renderProfiler,
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
    if (mapOnlyCleanup !== null) mapOnlyCleanup();
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
