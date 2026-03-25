import { createWorldState, WorldState, MAX_PARTICLES } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { tick } from '../sim/tick';
import { RngState, createRng, nextFloatRange } from '../sim/rng';
import { createSnapshot } from '../render/snapshot';
import { renderParticles } from '../render/particles/renderer';
import { renderClusters } from '../render/clusters/renderer';
import { renderHudOverlay, HudState } from '../render/hud/overlay';
import { createInputState, attachInputListeners, collectCommands } from '../input/handler';
import { CommandKind } from '../input/commands';

const FIXED_DT_MS = 16.666;
const PLAYER_SPEED_WORLD = 100.0;
const PARTICLE_COUNT_PER_CLUSTER = 8;
const ORBIT_RADIUS_WORLD = 30.0;
const WORLD_TO_SCREEN_SCALE = 1.0;

export interface GameScreenCallbacks {
  onReturnToMap: () => void;
}

function spawnClusterParticles(
  world: WorldState,
  clusterEntityId: number,
  clusterXWorld: number,
  clusterYWorld: number,
  rng: RngState,
): void {
  const count = PARTICLE_COUNT_PER_CLUSTER;
  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;
    const angleRad = (i / count) * Math.PI * 2;
    world.positionXWorld[idx] = clusterXWorld + Math.cos(angleRad) * ORBIT_RADIUS_WORLD;
    world.positionYWorld[idx] = clusterYWorld + Math.sin(angleRad) * ORBIT_RADIUS_WORLD;
    world.velocityXWorld[idx] = nextFloatRange(rng, -10, 10);
    world.velocityYWorld[idx] = nextFloatRange(rng, -10, 10);
    world.forceX[idx] = 0;
    world.forceY[idx] = 0;
    world.massKg[idx] = 1.0;
    world.chargeUnits[idx] = 0;
    world.isAliveFlag[idx] = 1;
    world.kindBuffer[idx] = ParticleKind.Physical;
    world.ownerEntityId[idx] = clusterEntityId;
  }
}

export function startGameScreen(
  canvas: HTMLCanvasElement,
  callbacks: GameScreenCallbacks,
): () => void {
  const ctx = canvas.getContext('2d')!;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const world = createWorldState(FIXED_DT_MS);
  const rng = createRng(12345);

  const centerXWorld = canvas.width / 2;
  const centerYWorld = canvas.height / 2;

  const playerCluster = createClusterState(1, centerXWorld - 150, centerYWorld, 1, PARTICLE_COUNT_PER_CLUSTER);
  const enemyCluster = createClusterState(2, centerXWorld + 150, centerYWorld, 0, PARTICLE_COUNT_PER_CLUSTER);

  world.clusters.push(playerCluster);
  world.clusters.push(enemyCluster);

  spawnClusterParticles(world, playerCluster.entityId, playerCluster.positionXWorld, playerCluster.positionYWorld, rng);
  spawnClusterParticles(world, enemyCluster.entityId, enemyCluster.positionXWorld, enemyCluster.positionYWorld, rng);

  const inputState = createInputState();
  const detachInput = attachInputListeners(canvas, inputState);

  const hudState: HudState = { fps: 0, frameTimeMs: 0, particleCount: 0 };

  let lastTimestampMs = 0;
  let accumulatorMs = 0;
  let frameCount = 0;
  let fpsAccMs = 0;
  let isRunning = true;
  let rafHandle = 0;

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
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      if (cmd.kind === CommandKind.ReturnToMap) {
        isRunning = false;
        detachInput();
        callbacks.onReturnToMap();
        return;
      }
      if (cmd.kind === CommandKind.MovePlayer) {
        const player = world.clusters[0];
        if (player !== undefined) {
          const len = Math.sqrt(cmd.dx * cmd.dx + cmd.dy * cmd.dy);
          if (len > 0) {
            const speedWorld = PLAYER_SPEED_WORLD * (elapsedMs / 1000.0);
            player.positionXWorld += (cmd.dx / len) * speedWorld;
            player.positionYWorld += (cmd.dy / len) * speedWorld;
          }
        }
      }
    }

    accumulatorMs += elapsedMs;
    while (accumulatorMs >= FIXED_DT_MS) {
      tick(world);
      accumulatorMs -= FIXED_DT_MS;
    }

    let aliveCount = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.isAliveFlag[i] === 1) aliveCount++;
    }
    hudState.particleCount = aliveCount;

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const snapshot = createSnapshot(world);
    renderClusters(ctx, snapshot, 0, 0, WORLD_TO_SCREEN_SCALE);
    renderParticles(ctx, snapshot, 0, 0, WORLD_TO_SCREEN_SCALE);
    renderHudOverlay(ctx, hudState);

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px monospace';
    ctx.fillText('ESC - Return to Map | WASD - Move', canvas.width / 2 - 120, canvas.height - 10);

    rafHandle = requestAnimationFrame(frame);
  }

  rafHandle = requestAnimationFrame(frame);

  return () => {
    isRunning = false;
    if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
    detachInput();
  };
}
