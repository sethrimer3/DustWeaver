import { createWorldState, WorldState, MAX_PARTICLES } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { tick } from '../sim/tick';
import { RngState, createRng, nextFloat, nextFloatRange } from '../sim/rng';
import { createSnapshot } from '../render/snapshot';
import { renderParticles } from '../render/particles/renderer';
import { renderClusters } from '../render/clusters/renderer';
import { renderHudOverlay, HudState } from '../render/hud/overlay';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners, collectCommands, JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import { CommandKind } from '../input/commands';

const FIXED_DT_MS = 16.666;
const PLAYER_SPEED_WORLD = 100.0;
/** Total particles spawned for the player cluster — distributed across loadout kinds. */
const PARTICLE_COUNT_PER_CLUSTER = 20;
/** Number of background Fluid particles filling the entire arena. */
const BACKGROUND_FLUID_COUNT = 300;

// Touch joystick visual constants (outer radius matches the max drag radius exported from handler.ts)
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export interface GameScreenCallbacks {
  onReturnToMap: () => void;
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
 * These have no owner (ownerEntityId = -1) and are normally invisible;
 * they glow as they are disturbed by nearby fast-moving particles.
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

    // Stagger initial age so particles don't all expire simultaneously
    const lifetimeVariance = nextFloatRange(rng, -profile.lifetimeVarianceTicks, profile.lifetimeVarianceTicks);
    world.lifetimeTicks[idx] = Math.max(2.0, profile.lifetimeBaseTicks + lifetimeVariance);
    world.ageTicks[idx]      = nextFloat(rng) * profile.lifetimeBaseTicks;

    world.noiseTickSeed[idx] = (nextFloat(rng) * 0xffffffff) >>> 0;
  }
}

export function startGameScreen(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  playerLoadout: ParticleKind[],
  callbacks: GameScreenCallbacks,
): () => void {
  // Attempt to create the WebGL particle renderer.  If WebGL is unavailable
  // (old device, software renderer, etc.) we fall back to Canvas 2D rendering.
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
    // Insert the WebGL canvas BEFORE game-canvas so it renders underneath.
    canvas.parentElement!.insertBefore(webglRenderer.canvas, canvas);
  }

  const ctx = canvas.getContext('2d')!;

  // World RNG seed 42 — separate from the level-setup RNG below
  const world = createWorldState(FIXED_DT_MS, 42);
  // Level-setup RNG (positions, spawn scatter) — distinct from world.rng
  const levelRng = createRng(12345);

  const centerXWorld = canvas.width / 2;
  const centerYWorld = canvas.height / 2;

  // Set world bounds for Fluid background particle respawn
  world.worldWidthWorld  = canvas.width;
  world.worldHeightWorld = canvas.height;

  const playerCluster = createClusterState(1, centerXWorld - 150, centerYWorld, 1, PARTICLE_COUNT_PER_CLUSTER);
  const enemyCluster  = createClusterState(2, centerXWorld + 150, centerYWorld, 0, PARTICLE_COUNT_PER_CLUSTER);

  world.clusters.push(playerCluster);
  world.clusters.push(enemyCluster);

  // Player spawns particles from their chosen loadout.
  // Enemy always gets Ice particles.
  spawnLoadoutParticles(world, playerCluster.entityId, playerCluster.positionXWorld, playerCluster.positionYWorld, playerLoadout,       PARTICLE_COUNT_PER_CLUSTER, levelRng);
  spawnClusterParticles(world, enemyCluster.entityId,  enemyCluster.positionXWorld,  enemyCluster.positionYWorld,  ParticleKind.Ice, PARTICLE_COUNT_PER_CLUSTER, levelRng);

  // Scatter background Fluid particles across the full arena.
  // These are invisible at rest and glow when disturbed by moving particles.
  spawnBackgroundFluidParticles(world, BACKGROUND_FLUID_COUNT, levelRng);

  const inputState = createInputState();
  const detachInput = attachInputListeners(canvas, inputState);

  // Mobile "Return to Map" button — only injected when on a touch device
  let mapButton: HTMLButtonElement | null = null;
  if (IS_TOUCH_DEVICE) {
    mapButton = document.createElement('button');
    mapButton.textContent = 'MAP';
    mapButton.style.cssText = `
      position: absolute; top: 16px; right: 16px;
      background: rgba(0,0,0,0.6); border: 2px solid #00cfff; color: #00cfff;
      padding: 10px 20px; font-size: 1rem; font-family: monospace;
      cursor: pointer; border-radius: 6px; touch-action: manipulation;
    `;
    mapButton.addEventListener('click', () => {
      inputState.isEscapePressed = true;
    });
    uiRoot.appendChild(mapButton);
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

    const commands = collectCommands(inputState);
    let returnToMap = false;
    let moveDx = 0;
    let moveDy = 0;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      if (cmd.kind === CommandKind.ReturnToMap) {
        returnToMap = true;
      } else if (cmd.kind === CommandKind.MovePlayer) {
        moveDx = cmd.dx;
        moveDy = cmd.dy;
      } else if (cmd.kind === CommandKind.Attack) {
        const player = world.clusters[0];
        if (player !== undefined) {
          // Convert aim screen position to world-space direction relative to the player
          let dirX = cmd.aimXPx - player.positionXWorld;
          let dirY = cmd.aimYPx - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = 1.0; dirY = 0.0; } else { dirX /= len; dirY /= len; }
          world.playerAttackDirXWorld = dirX;
          world.playerAttackDirYWorld = dirY;
          world.playerAttackTriggeredFlag = 1;
        }
      } else if (cmd.kind === CommandKind.BlockStart || cmd.kind === CommandKind.BlockUpdate) {
        const player = world.clusters[0];
        if (player !== undefined) {
          let dirX: number;
          let dirY: number;
          if (cmd.kind === CommandKind.BlockStart) {
            dirX = cmd.dirXNorm;
            dirY = cmd.dirYNorm;
          } else {
            // BlockUpdate carries raw mouse/touch screen position
            dirX = cmd.dirXNorm - player.positionXWorld;
            dirY = cmd.dirYNorm - player.positionYWorld;
            const len = Math.sqrt(dirX * dirX + dirY * dirY);
            if (len < 1.0) { dirX = world.playerBlockDirXWorld; dirY = world.playerBlockDirYWorld; }
            else { dirX /= len; dirY /= len; }
          }
          world.playerBlockDirXWorld = dirX;
          world.playerBlockDirYWorld = dirY;
          world.isPlayerBlockingFlag = 1;
        }
      } else if (cmd.kind === CommandKind.BlockEnd) {
        world.isPlayerBlockingFlag = 0;
      }
    }

    if (returnToMap) {
      isRunning = false;
      detachInput();
      callbacks.onReturnToMap();
      return;
    }

    // Apply player movement once per fixed tick to keep speed frame-rate independent
    accumulatorMs += elapsedMs;
    while (accumulatorMs >= FIXED_DT_MS) {
      if (moveDx !== 0 || moveDy !== 0) {
        const player = world.clusters[0];
        if (player !== undefined) {
          const len = Math.sqrt(moveDx * moveDx + moveDy * moveDy);
          const speedWorld = PLAYER_SPEED_WORLD * (FIXED_DT_MS / 1000.0);
          player.positionXWorld += (moveDx / len) * speedWorld;
          player.positionYWorld += (moveDy / len) * speedWorld;
        }
      }
      tick(world);
      accumulatorMs -= FIXED_DT_MS;
    }

    let aliveCount = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.isAliveFlag[i] === 1) aliveCount++;
    }
    hudState.particleCount = aliveCount;

    const snapshot = createSnapshot(world);

    if (webglRenderer.isAvailable) {
      // WebGL canvas (behind) renders the dark background and glowing particles.
      webglRenderer.render(snapshot, 0, 0, 1.0);
      // 2D canvas (on top) is transparent so the WebGL layer shows through;
      // it only draws cluster indicators, HUD, and UI text.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      // Canvas 2D fallback: fill background and draw particles with arc calls.
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      renderParticles(ctx, snapshot, 0, 0, 1.0);
    }

    renderClusters(ctx, snapshot, 0, 0, 1.0);
    renderHudOverlay(ctx, hudState);

    // Draw touch joystick visual when active
    if (inputState.isTouchJoystickActiveFlag === 1) {
      const bx = inputState.touchJoystickBaseXPx;
      const by = inputState.touchJoystickBaseYPx;
      const cx = inputState.touchJoystickCurrentXPx;
      const cy = inputState.touchJoystickCurrentYPx;

      ctx.save();
      // Outer ring
      ctx.beginPath();
      ctx.arc(bx, by, JOYSTICK_OUTER_RADIUS_PX, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,207,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,207,255,0.08)';
      ctx.fill();

      // Clamp thumb to outer ring
      const dx = cx - bx;
      const dy = cy - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let thumbXPx = cx;
      let thumbYPx = cy;
      if (dist > JOYSTICK_OUTER_RADIUS_PX) {
        thumbXPx = bx + (dx / dist) * JOYSTICK_OUTER_RADIUS_PX;
        thumbYPx = by + (dy / dist) * JOYSTICK_OUTER_RADIUS_PX;
      }

      // Inner thumb
      ctx.beginPath();
      ctx.arc(thumbXPx, thumbYPx, JOYSTICK_INNER_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,207,255,0.45)';
      ctx.fill();
      ctx.restore();
    }

    // Control hints
    const controlHintText = IS_TOUCH_DEVICE
      ? 'L.thumb=move  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MAP to return'
      : 'WASD=move  |  Click=attack  |  Hold=block  |  ESC=return';
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
    if (mapButton !== null && mapButton.parentElement !== null) {
      mapButton.parentElement.removeChild(mapButton);
    }
  };
}
