import type { WorldSnapshot } from '../snapshot';
import {
  DE_STATE_DYING,
  DE_STATE_LUNGE_ACTIVE,
  DL_STATE_DYING,
  DL_STATE_SIPHON_ACTIVE,
  DL_STATE_SIPHON_TELEGRAPH,
  DL_STATE_SPAWN_ECHO,
} from '../../sim/clusters/dustLeechAi';
import {
  DE_BODY_MOTE_COUNT,
  DE_CORE_RADIUS_WORLD,
  DE_DEATH_FADE_TICKS,
  DE_MOTE_BRIGHT_THRESHOLD,
  DE_MOTE_BRIGHTNESS_AMPLITUDE,
  DE_MOTE_BRIGHTNESS_BASE,
  DL_ACTIVATION_RANGE_WORLD,
  DL_CORE_RADIUS_WORLD,
  DL_DEATH_DURATION_TICKS,
  DL_ECHO_RING_ALPHA_BASE,
  DL_ECHO_RING_ALPHA_STEP,
  DL_ECHO_RING_SCALE,
  DL_ECHO_RING_STEP_WORLD,
  DL_HALO_RADIUS_WORLD,
  DL_MOTE_BRIGHT_THRESHOLD,
  DL_MOTE_BRIGHTNESS_AMPLITUDE,
  DL_MOTE_BRIGHTNESS_BASE,
  DL_MOTE_ORBIT_BASE_WORLD,
  DL_MOTE_ORBIT_EXPANSION_WORLD,
  DL_MOTE_SATED_CHARGE_THRESHOLD,
  DL_RIM_THICKNESS_WORLD,
  DL_SIPHON_CHARGE_REQUIRED,
  DL_SIPHON_RANGE_WORLD,
  DL_TELEGRAPH_ALPHA_BASE,
  DL_TELEGRAPH_ALPHA_STEP,
  DL_TELEGRAPH_STEP_PX,
  EPSILON_DISTANCE_WORLD,
  MAX_MOTES_PER_DE,
  MAX_MOTES_PER_DL,
} from '../../sim/clusters/dustLeechConfig';

const DL_CORE_FILL = '#0a0510';
const DL_RIM_COLOR = 'rgba(100,40,180,0.85)';
const DL_RIM_BRIGHT = 'rgba(160,80,255,0.95)';
const DL_HALO_COLOR = 'rgba(40,10,80,0.15)';
const DL_MOTE_SATED = 'rgba(130,70,200,0.75)';
const DL_MOTE_HUNGRY = 'rgba(80,30,140,0.55)';
const DL_SIPHON_COLOR = 'rgba(160,100,220,0.70)';
const DL_STREAM_COLOR = 'rgba(120,70,200,0.50)';
const DE_MOTE_COLOR = 'rgba(170,130,230,0.80)';
const DE_MOTE_DIM = 'rgba(100,70,160,0.50)';
const DE_CORE_COLOR = 'rgba(200,160,255,0.60)';
const DE_LUNGE_COLOR = 'rgba(220,160,255,0.90)';

const DBG_RANGE = 'rgba(120,70,180,0.07)';
const DBG_SIPHON = 'rgba(180,120,240,0.08)';
const DBG_HITBOX = 'rgba(220,140,255,0.45)';
const DBG_LINK = 'rgba(180,120,255,0.35)';
const DBG_TEXT = 'rgba(235,210,255,0.95)';

function _sx(wx: number, ox: number, scale: number): number {
  return Math.round((wx + ox) * scale);
}

function _sy(wy: number, oy: number, scale: number): number {
  return Math.round((wy + oy) * scale);
}

function _drawLeech(
  ctx: CanvasRenderingContext2D,
  cluster: WorldSnapshot['clusters'][number],
  snapshot: WorldSnapshot,
  player: WorldSnapshot['clusters'][number] | null,
  ox: number,
  oy: number,
  scale: number,
): void {
  const cx = cluster.renderPositionXWorld;
  const cy = cluster.renderPositionYWorld;
  const sx = _sx(cx, ox, scale);
  const sy = _sy(cy, oy, scale);
  const hitFlash = cluster.dustLeechHitFlashTicks > 0;
  const coreR = Math.max(1, Math.round(DL_CORE_RADIUS_WORLD * scale));

  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(1, Math.round(DL_HALO_RADIUS_WORLD * scale)), 0, Math.PI * 2);
  ctx.fillStyle = DL_HALO_COLOR;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(sx, sy, coreR + DL_RIM_THICKNESS_WORLD, 0, Math.PI * 2);
  ctx.fillStyle = hitFlash ? DL_RIM_BRIGHT : DL_RIM_COLOR;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = DL_CORE_FILL;
  ctx.fill();

  if (cluster.dustLeechSlotIndex >= 0) {
    const base = cluster.dustLeechSlotIndex * MAX_MOTES_PER_DL;
    const ratio = Math.max(0, Math.min(1, cluster.dustLeechSiphonCharge / DL_SIPHON_CHARGE_REQUIRED));
    const orbitRadiusWorld = DL_MOTE_ORBIT_BASE_WORLD + ratio * DL_MOTE_ORBIT_EXPANSION_WORLD;
    const moteSizePx = scale < 2 ? 1 : 2;
    for (let m = 0; m < MAX_MOTES_PER_DL; m++) {
      const mi = base + m;
      const angle = snapshot.dlMoteAngleRad[mi];
      const pulse = snapshot.dlMotePulsePhaseRad[mi];
      const bright = DL_MOTE_BRIGHTNESS_BASE + DL_MOTE_BRIGHTNESS_AMPLITUDE * Math.sin(pulse);
      const mx = cx + Math.cos(angle) * orbitRadiusWorld;
      const my = cy + Math.sin(angle) * orbitRadiusWorld;
      const msx = _sx(mx, ox, scale);
      const msy = _sy(my, oy, scale);
      ctx.fillStyle = bright > DL_MOTE_BRIGHT_THRESHOLD || ratio > DL_MOTE_SATED_CHARGE_THRESHOLD ? DL_MOTE_SATED : DL_MOTE_HUNGRY;
      ctx.fillRect(msx - Math.floor(moteSizePx / 2), msy - Math.floor(moteSizePx / 2), moteSizePx, moteSizePx);
    }
  }

  if (player !== null) {
    const dx = player.renderPositionXWorld - cx;
    const dy = player.renderPositionYWorld - cy;
    const length = Math.sqrt(dx * dx + dy * dy) + EPSILON_DISTANCE_WORLD;
    const dirX = dx / length;
    const dirY = dy / length;
    if (cluster.dustLeechState === DL_STATE_SIPHON_TELEGRAPH) {
      for (let i = 0; i < 4; i++) {
        const stepPx = DL_TELEGRAPH_STEP_PX * (i + 1);
        const tx = sx + dirX * stepPx;
        const ty = sy + dirY * stepPx;
        ctx.fillStyle = `rgba(160,100,220,${(DL_TELEGRAPH_ALPHA_BASE - i * DL_TELEGRAPH_ALPHA_STEP).toFixed(2)})`;
        ctx.fillRect(Math.round(tx), Math.round(ty), 1, 1);
      }
    } else if (cluster.dustLeechState === DL_STATE_SIPHON_ACTIVE) {
      for (let i = 1; i <= 8; i++) {
        const t = i / 9;
        const mx = player.renderPositionXWorld + (cx - player.renderPositionXWorld) * t;
        const my = player.renderPositionYWorld + (cy - player.renderPositionYWorld) * t;
        ctx.fillStyle = DL_STREAM_COLOR;
        ctx.fillRect(_sx(mx, ox, scale), _sy(my, oy, scale), scale < 2 ? 1 : 2, scale < 2 ? 1 : 2);
      }
    }
  }

  if (cluster.dustLeechState === DL_STATE_SPAWN_ECHO) {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(sx, sy, (coreR + i * DL_ECHO_RING_STEP_WORLD) * DL_ECHO_RING_SCALE, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,160,255,${(DL_ECHO_RING_ALPHA_BASE - i * DL_ECHO_RING_ALPHA_STEP).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function _drawEcho(
  ctx: CanvasRenderingContext2D,
  cluster: WorldSnapshot['clusters'][number],
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
): void {
  const cx = cluster.renderPositionXWorld;
  const cy = cluster.renderPositionYWorld;
  const sx = _sx(cx, ox, scale);
  const sy = _sy(cy, oy, scale);
  const hitFlash = cluster.dustEchoHitFlashTicks > 0;
  const moteSizePx = cluster.dustEchoState === DE_STATE_LUNGE_ACTIVE ? 2 : (scale < 2 ? 1 : 2);

  if (cluster.dustEchoSlotIndex >= 0) {
    const base = cluster.dustEchoSlotIndex * MAX_MOTES_PER_DE;
    for (let m = 0; m < DE_BODY_MOTE_COUNT; m++) {
      const mi = base + m;
      const pulse = DE_MOTE_BRIGHTNESS_BASE + DE_MOTE_BRIGHTNESS_AMPLITUDE * Math.sin(snapshot.deMotePulsePhaseRad[mi]);
      const mx = cx + snapshot.deMoteOffsetXWorld[mi];
      const my = cy + snapshot.deMoteOffsetYWorld[mi];
      const color = cluster.dustEchoState === DE_STATE_LUNGE_ACTIVE
        ? DE_LUNGE_COLOR
        : (hitFlash || pulse > DE_MOTE_BRIGHT_THRESHOLD ? DE_MOTE_COLOR : DE_MOTE_DIM);
      ctx.fillStyle = color;
      ctx.fillRect(_sx(mx, ox, scale), _sy(my, oy, scale), moteSizePx, moteSizePx);
    }
  }

  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(1, Math.round(DE_CORE_RADIUS_WORLD * scale)), 0, Math.PI * 2);
  ctx.fillStyle = hitFlash ? DE_LUNGE_COLOR : DE_CORE_COLOR;
  ctx.fill();
}

export function renderDustLeeches(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  ox: number,
  oy: number,
  scale: number,
  isDebugMode: boolean,
): void {
  let player: WorldSnapshot['clusters'][number] | null = null;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isPlayerFlag === 1 && cluster.isAliveFlag === 1) {
      player = cluster;
      break;
    }
  }

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isDustLeechFlag !== 1 && cluster.isDustEchoFlag !== 1) continue;

    const prevAlpha = ctx.globalAlpha;
    if (cluster.isDustLeechFlag === 1) {
      if (cluster.isAliveFlag === 0 && cluster.dustLeechState !== DL_STATE_DYING) continue;
      if (cluster.dustLeechState === DL_STATE_DYING) {
        ctx.globalAlpha *= Math.max(0, 1 - cluster.dustLeechStateTicks / DL_DEATH_DURATION_TICKS);
      }
      _drawLeech(ctx, cluster, snapshot, player, ox, oy, scale);
    }

    if (cluster.isDustEchoFlag === 1) {
      if (cluster.isAliveFlag === 0 && cluster.dustEchoState !== DE_STATE_DYING) continue;
      if (cluster.dustEchoState === DE_STATE_DYING) {
        ctx.globalAlpha *= Math.max(0, 1 - cluster.dustEchoStateTicks / DE_DEATH_FADE_TICKS);
      }
      _drawEcho(ctx, cluster, snapshot, ox, oy, scale);
    }
    ctx.globalAlpha = prevAlpha;

    if (!isDebugMode) continue;

    const sx = _sx(cluster.renderPositionXWorld, ox, scale);
    const sy = _sy(cluster.renderPositionYWorld, oy, scale);

    if (cluster.isDustLeechFlag === 1) {
      ctx.beginPath();
      ctx.arc(sx, sy, Math.round(DL_ACTIVATION_RANGE_WORLD * scale), 0, Math.PI * 2);
      ctx.fillStyle = DBG_RANGE;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sx, sy, Math.round(DL_SIPHON_RANGE_WORLD * scale), 0, Math.PI * 2);
      ctx.fillStyle = DBG_SIPHON;
      ctx.fill();

      ctx.strokeStyle = DBG_HITBOX;
      ctx.strokeRect(
        sx - Math.round(cluster.halfWidthWorld * scale),
        sy - Math.round(cluster.halfHeightWorld * scale),
        Math.round(cluster.halfWidthWorld * scale * 2),
        Math.round(cluster.halfHeightWorld * scale * 2),
      );

      if (player !== null && cluster.dustLeechState === DL_STATE_SIPHON_ACTIVE) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(_sx(player.renderPositionXWorld, ox, scale), _sy(player.renderPositionYWorld, oy, scale));
        ctx.strokeStyle = DL_SIPHON_COLOR;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = DBG_TEXT;
      ctx.font = '10px monospace';
      ctx.fillText(`DL ${cluster.dustLeechState} ch=${cluster.dustLeechSiphonCharge.toFixed(2)}`, sx + 8, sy - 8);
    }

    if (cluster.isDustEchoFlag === 1) {
      ctx.strokeStyle = DBG_HITBOX;
      ctx.strokeRect(
        sx - Math.round(cluster.halfWidthWorld * scale),
        sy - Math.round(cluster.halfHeightWorld * scale),
        Math.round(cluster.halfWidthWorld * scale * 2),
        Math.round(cluster.halfHeightWorld * scale * 2),
      );
      if (cluster.dustEchoOwnerEntityId >= 0) {
        for (let oi = 0; oi < snapshot.clusters.length; oi++) {
          const owner = snapshot.clusters[oi];
          if (owner.entityId !== cluster.dustEchoOwnerEntityId) continue;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(_sx(owner.renderPositionXWorld, ox, scale), _sy(owner.renderPositionYWorld, oy, scale));
          ctx.strokeStyle = DBG_LINK;
          ctx.lineWidth = 1;
          ctx.stroke();
          break;
        }
      }
      ctx.fillStyle = DBG_TEXT;
      ctx.font = '10px monospace';
      ctx.fillText(`DE ${cluster.dustEchoState}`, sx + 8, sy - 8);
    }
  }
}
