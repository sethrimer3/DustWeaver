/**
 * measure-resident-memory.mts — how much heap a resident zone actually costs.
 *
 *   node --expose-gc --import tsx scripts/measure-resident-memory.mts
 *
 * Cross-zone preloading means holding more than one zone's resident
 * `WorldState`s at once.  Those carry enemies, hazards, ropes, dust piles and
 * several typed-array buffers per room, so "just keep the neighbour zone
 * resident too" is a memory decision, not a scheduling one.  This measures the
 * real cost per room and per zone using the real builder, so the preload budget
 * can be set from data instead of guessed.
 *
 * Reports both process heap delta (what the GC actually holds) and a direct
 * sum of the typed-array bytes in each built world (what is structurally
 * unavoidable), because the two answer different questions: the first tells you
 * what residency costs today, the second tells you the floor.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RoomDef } from '../src/levels/roomDef';
import type { WorldState } from '../src/sim/world';
import { hydrateV2Room, isSavedRoomV2 } from '../src/levels/roomSchemaHydrator';
import { roomJsonDefToRoomDef } from '../src/levels/roomJsonToRoomDef';
import { buildResidentWorldState } from '../src/screens/residentWorldBuilder';
import { RoomRuntimeCache } from '../src/screens/roomRuntimeCache';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOMS_DIR = process.env.DW_ROOMS_DIR
  ?? path.resolve(HERE, '../ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS');

/** Minimal canvas stand-in so the real builder path can run under node. */
function installCanvasStub(): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return;
  const fakeCtx = new Proxy({}, {
    get: (_t, prop) => (prop === 'canvas' ? { width: 1, height: 1 } : () => {}),
    set: () => true,
  });
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => (tag === 'canvas'
      ? { width: 1, height: 1, getContext: () => fakeCtx }
      : {}),
  };
}

function loadRegistry(): Map<string, RoomDef> {
  const registry = new Map<string, RoomDef>();
  for (const f of fs.readdirSync(ROOMS_DIR)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, f), 'utf8'));
    if (!isSavedRoomV2(raw)) continue;
    const def = roomJsonDefToRoomDef(hydrateV2Room(raw));
    registry.set(def.id, def);
  }
  return registry;
}

/**
 * Sums the bytes of every typed array reachable from a WorldState, one level
 * deep plus cluster arrays.  Deliberately structural rather than a deep walk:
 * the typed arrays ARE the bulk, and a full object graph walk would double-count
 * shared references.
 */
function typedArrayBytes(world: WorldState): number {
  let total = 0;
  const seen = new Set<ArrayBufferLike>();
  const add = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) {
      const buf = (v as ArrayBufferView).buffer;
      if (!seen.has(buf)) { seen.add(buf); total += buf.byteLength; }
    }
  };
  for (const v of Object.values(world as unknown as Record<string, unknown>)) {
    add(v);
    if (Array.isArray(v)) for (const el of v) {
      if (el !== null && typeof el === 'object') {
        for (const cv of Object.values(el as Record<string, unknown>)) add(cv);
      }
    }
  }
  return total;
}

function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g !== undefined) { g(); g(); }
}

function heapMB(): number {
  return process.memoryUsage().heapUsed / 1048576;
}

function main(): void {
  installCanvasStub();
  const registry = loadRegistry();

  const zones = new Map<number, RoomDef[]>();
  for (const [, r] of registry) {
    const z = r.worldNumber ?? 1;
    if (!zones.has(z)) zones.set(z, []);
    zones.get(z)!.push(r);
  }

  console.log(`rooms=${registry.size} zones=${[...zones.keys()].sort((a, b) => a - b).join(',')}`);
  if ((globalThis as { gc?: unknown }).gc === undefined) {
    console.log('NOTE: run with --expose-gc for reliable heap deltas.\n');
  }

  const perZone: Array<Record<string, unknown>> = [];

  for (const [zoneNo, rooms] of [...zones.entries()].sort((a, b) => a[0] - b[0])) {
    const cache = new RoomRuntimeCache(256);
    const held: WorldState[] = [];
    const perRoom: Array<{ id: string; heapMB: number; taKB: number; area: number }> = [];

    gc();
    const zoneHeap0 = heapMB();

    for (const room of rooms) {
      gc();
      const h0 = heapMB();
      let world: WorldState;
      try {
        world = buildResidentWorldState(room, 12345, cache);
      } catch (err) {
        console.log(`  ! build failed: ${room.id}`);
        console.log((err as Error).stack?.split('\n').slice(0, 6).join('\n'));
        continue;
      }
      held.push(world);
      gc();
      perRoom.push({
        id: room.id,
        heapMB: +(heapMB() - h0).toFixed(2),
        taKB: +(typedArrayBytes(world) / 1024).toFixed(0),
        area: room.widthBlocks * room.heightBlocks,
      });
    }

    gc();
    const zoneHeapMB = heapMB() - zoneHeap0;
    const taTotalKB = perRoom.reduce((a, r) => a + r.taKB, 0);
    perRoom.sort((a, b) => b.taKB - a.taKB);

    perZone.push({
      zone: zoneNo,
      rooms: rooms.length,
      builtWorlds: held.length,
      zoneHeapMB: +zoneHeapMB.toFixed(1),
      typedArrayTotalMB: +(taTotalKB / 1024).toFixed(1),
      meanRoomKB: held.length === 0 ? 0 : Math.round(taTotalKB / held.length),
      heaviestRooms: perRoom.slice(0, 5).map(r => `${r.id} ${r.taKB}KB (area ${r.area})`),
    });

    // Release before the next zone so zones are measured independently.
    held.length = 0;
    gc();
  }

  console.log(JSON.stringify({ perZone }, null, 2));

  const totalMB = perZone.reduce((a, z) => a + (z.zoneHeapMB as number), 0);
  const maxZone = Math.max(...perZone.map(z => z.zoneHeapMB as number));
  console.log(`\nall zones resident simultaneously: ~${totalMB.toFixed(1)} MB`);
  console.log(`largest single zone:                ~${maxZone.toFixed(1)} MB`);
  console.log(`active + one neighbour (worst case): ~${(maxZone * 2).toFixed(1)} MB`);
}

main();
