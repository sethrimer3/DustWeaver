import { createWorldState, WorldState, MAX_PARTICLES, MAX_WALLS } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { tick } from '../sim/tick';
import { RngState, createRng, nextFloat, nextFloatRange } from '../sim/rng';
import { createSnapshot } from '../render/snapshot';
import { renderParticles } from '../render/particles/renderer';
import { renderClusters, renderWalls } from '../render/clusters/renderer';
import { renderHudOverlay, HudState } from '../render/hud/overlay';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners, collectCommands, JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import { CommandKind } from '../input/commands';
import { LevelDef } from '../levels/levelDef';

const FIXED_DT_MS = 16.666;
/** Total particles spawned for the player cluster — distributed across loadout kinds. */
const PARTICLE_COUNT_PER_CLUSTER = 20;
/** Number of background Fluid particles filling the entire arena. */
const BACKGROUND_FLUID_COUNT = 300;

// Delay (ms) after all enemies are defeated before triggering onLevelComplete
const VICTORY_DELAY_MS = 2000;

/** Boss clusters receive this multiplier on their base HP for extra durability. */
const BOSS_HP_MULTIPLIER = 2;

// Touch joystick visual constants (outer radius matches the max drag radius exported from handler.ts)
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export interface GameScreenCallbacks {
  onReturnToMap: () => void;
  /** Called after victory delay with the completed level definition. */
  onLevelComplete: (level: LevelDef) => void;
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

/** Loads wall definitions from a LevelDef into the WorldState wall buffers. */
function loadWalls(world: WorldState, levelDef: LevelDef, widthWorld: number, heightWorld: number): void {
  const count = Math.min(levelDef.walls.length, MAX_WALLS);
  world.wallCount = count;
  for (let wi = 0; wi < count; wi++) {
    const def = levelDef.walls[wi];
    world.wallXWorld[wi] = def.xFraction * widthWorld;
    world.wallYWorld[wi] = def.yFraction * heightWorld;
    world.wallWWorld[wi] = def.wFraction * widthWorld;
    world.wallHWorld[wi] = def.hFraction * heightWorld;
  }
}

/** Background fill colour for each level theme. */
function themeBgColor(theme: string): string {
  switch (theme) {
    case 'water':  return '#040c18';
    case 'ice':    return '#040d14';
    case 'boss':   return '#0c0408';
    case 'fire':   return '#120400';
    case 'lava':   return '#180a00';
    case 'stone':  return '#0a0a0c';
    case 'metal':  return '#080c10';
    default:       return '#0a0a12'; // physical
  }
}

/** Returns a display label for the theme. */
function themeLabel(theme: string): string {
  switch (theme) {
    case 'water':  return 'Water';
    case 'ice':    return 'Ice';
    case 'boss':   return 'BOSS';
    case 'fire':   return 'Fire';
    case 'lava':   return 'Lava';
    case 'stone':  return 'Stone';
    case 'metal':  return 'Metal';
    default:       return 'Physical';
  }
}

export function startGameScreen(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  playerLoadout: ParticleKind[],
  levelDef: LevelDef,
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

  const world = createWorldState(FIXED_DT_MS, 42);
  const levelRng = createRng(12345);

  world.worldWidthWorld  = canvas.width;
  world.worldHeightWorld = canvas.height;

  // ── Spawn player near the floor (gravity will land them immediately) ──────
  const playerCluster = createClusterState(1, canvas.width * 0.15, canvas.height * 0.75, 1, PARTICLE_COUNT_PER_CLUSTER);
  world.clusters.push(playerCluster);
  spawnLoadoutParticles(
    world, playerCluster.entityId,
    playerCluster.positionXWorld, playerCluster.positionYWorld,
    playerLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng,
  );

  // ── Spawn enemies from level definition ──────────────────────────────────
  let nextEntityId = 2;
  for (let ei = 0; ei < levelDef.enemies.length; ei++) {
    const enemyDef = levelDef.enemies[ei];
    const ex = enemyDef.xFraction * canvas.width;
    const ey = enemyDef.yFraction * canvas.height;
    const particleCount = enemyDef.particleCount;
    const hp = enemyDef.isBossFlag === 1 ? particleCount * BOSS_HP_MULTIPLIER : particleCount;

    const enemyCluster = createClusterState(nextEntityId++, ex, ey, 0, hp);
    world.clusters.push(enemyCluster);
    spawnLoadoutParticles(world, enemyCluster.entityId, ex, ey, enemyDef.kinds, particleCount, levelRng);
  }

  // ── Spawn background Fluid particles ─────────────────────────────────────
  spawnBackgroundFluidParticles(world, BACKGROUND_FLUID_COUNT, levelRng);

  // ── Load level walls ──────────────────────────────────────────────────────
  loadWalls(world, levelDef, canvas.width, canvas.height);

  const inputState = createInputState();
  const detachInput = attachInputListeners(canvas, inputState);

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

  const bgColor = themeBgColor(levelDef.theme);

  let lastTimestampMs = 0;
  let accumulatorMs = 0;
  let frameCount = 0;
  let fpsAccMs = 0;
  let isRunning = true;
  let rafHandle = 0;

  // Victory state
  let victoryTimeMs = -1;  // -1 = no victory yet
  let victoryTriggered = false;

  function onResize(): void {
    resizeCanvas();
    loadWalls(world, levelDef, canvas.width, canvas.height);
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
    let dashAimXPx = 0;
    let dashTriggered = false;
    let jumpTriggered = false;
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      if (cmd.kind === CommandKind.ReturnToMap) {
        returnToMap = true;
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
          let dirX = cmd.aimXPx - player.positionXWorld;
          let dirY = cmd.aimYPx - player.positionYWorld;
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          if (len < 1.0) { dirX = world.playerBlockDirXWorld; dirY = world.playerBlockDirYWorld; }
          else { dirX /= len; dirY /= len; }
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

    // ── Victory check ────────────────────────────────────────────────────────
    if (!victoryTriggered) {
      let allEnemiesDead = true;
      for (let ci = 1; ci < world.clusters.length; ci++) {
        if (world.clusters[ci].isAliveFlag === 1) {
          allEnemiesDead = false;
          break;
        }
      }
      if (allEnemiesDead && world.clusters.length > 1) {
        if (victoryTimeMs < 0) {
          victoryTimeMs = timestampMs;
        } else if (timestampMs - victoryTimeMs >= VICTORY_DELAY_MS) {
          victoryTriggered = true;
          isRunning = false;
          detachInput();
          callbacks.onLevelComplete(levelDef);
          return;
        }
      }
    }

    accumulatorMs += elapsedMs;
    while (accumulatorMs >= FIXED_DT_MS) {
      const player = world.clusters[0];
      if (moveDx !== 0) {
        if (player !== undefined) {
          // Horizontal input only — movement.ts ignores Y in platformer mode
          world.playerMoveInputDxWorld = moveDx > 0 ? 1.0 : -1.0;
          world.playerMoveInputDyWorld = 0.0;
        }
      }
      // Jump trigger (one-shot per frame accumulation)
      if (jumpTriggered) {
        world.playerJumpTriggeredFlag = 1;
        jumpTriggered = false;
      }
      // Dash: horizontal direction from movement input or cursor
      if (dashTriggered) {
        world.playerDashTriggeredFlag = 1;
        if (player !== undefined) {
          if (moveDx !== 0) {
            world.playerDashDirXWorld = moveDx > 0 ? 1.0 : -1.0;
            world.playerDashDirYWorld = 0.0;
          } else {
            const dirX = dashAimXPx - player.positionXWorld;
            const absX = dirX < 0 ? -dirX : dirX;
            if (absX > 1.0) {
              world.playerDashDirXWorld = dirX > 0 ? 1.0 : -1.0;
            } else {
              // Cursor is too close — fall back to current movement direction
              world.playerDashDirXWorld = player.velocityXWorld >= 0 ? 1.0 : -1.0;
            }
            world.playerDashDirYWorld = 0.0;
          }
        }
        dashTriggered = false;
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
      webglRenderer.render(snapshot, 0, 0, 1.0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      renderParticles(ctx, snapshot, 0, 0, 1.0);
    }

    // Walls before cluster indicators so clusters are drawn on top
    renderWalls(ctx, snapshot, 0, 0, 1.0);
    renderClusters(ctx, snapshot, 0, 0, 1.0);
    renderHudOverlay(ctx, hudState);

    // ── Level name banner (top-center) ──────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '13px monospace';
    const levelLabel = `W${levelDef.worldNumber}-L${levelDef.levelNumber}  ${levelDef.name}  [${themeLabel(levelDef.theme)}]`;
    const labelW = ctx.measureText(levelLabel).width;
    ctx.fillText(levelLabel, (canvas.width - labelW) / 2, 22);

    // ── Victory banner ───────────────────────────────────────────────────────
    if (victoryTimeMs >= 0) {
      const progress = Math.min(1.0, (lastTimestampMs - victoryTimeMs) / VICTORY_DELAY_MS);
      ctx.save();
      ctx.globalAlpha = progress;
      ctx.fillStyle = 'rgba(0,207,100,0.85)';
      ctx.font = 'bold 48px monospace';
      const victoryText = 'LEVEL COMPLETE!';
      const vw = ctx.measureText(victoryText).width;
      ctx.fillText(victoryText, (canvas.width - vw) / 2, canvas.height / 2 - 20);
      ctx.font = '20px monospace';
      ctx.fillStyle = 'rgba(180,255,200,0.85)';
      const subText = 'Returning to World Map…';
      const sw = ctx.measureText(subText).width;
      ctx.fillText(subText, (canvas.width - sw) / 2, canvas.height / 2 + 20);
      ctx.restore();
    }

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
      ? 'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MAP to return'
      : 'A/D=walk  |  W/Space/↑=jump  |  Shift=dash  |  Click=attack  |  Hold=block  |  ESC=return';
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
