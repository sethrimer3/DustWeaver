/**
 * roomComplexity.ts — authoritative room/campaign performance-complexity analyzer.
 *
 * A single source of truth for estimating how expensive a room is to render/
 * simulate, used by:
 *   - the editor's in-progress density warnings (via editorRoomComplexity.ts,
 *     which adapts `EditorRoomData` into the same category-count shape),
 *   - the (optional) editor density indicator,
 *   - the custom-campaign pre-play warning (`analyzeCampaignComplexity`),
 *   - tests.
 *
 * The analysis is purely a count/sum over already-serialized room data — it
 * never instantiates entities, runs simulation, or touches the renderer, so
 * it is safe to call on rooms that have never been loaded/visited.
 *
 * Two numbers are reported per room:
 *   - `totalPlacedCount`  — a raw count of discretely-placed entities. Useful
 *     for "N placed elements" style messaging, but NOT a good performance
 *     proxy on its own (a wall is far cheaper than a scene light).
 *   - `weightedScore`     — `totalPlacedCount`-like categories AND derived
 *     magnitude categories (e.g. total enemy particle count, total liquid
 *     cell area), each multiplied by a per-category cost weight
 *     (`CONTENT_COMPLEXITY_WEIGHTS`) and summed. This is the number severity
 *     tiers and "should warn" decisions are based on.
 */

import type { RoomDef } from './roomDef';
import type { RoomZoneDef } from './roomElementDefs';

// ── Categories ──────────────────────────────────────────────────────────────

/**
 * Content categories tracked for complexity scoring. Each RoomDef field maps
 * to exactly one category below (see `countRoomDefCategories`) so no placed
 * entity is ever counted toward more than one category's raw count.
 */
export type RoomComplexityCategory =
  | 'tiles'
  | 'objects'
  | 'enemies'
  | 'enemyParticles'
  | 'dustCells'
  | 'liquidCells'
  | 'emitterParticles'
  | 'hazards'
  | 'triggers'
  | 'lights';

export const ROOM_COMPLEXITY_CATEGORIES: readonly RoomComplexityCategory[] = [
  'tiles',
  'objects',
  'enemies',
  'enemyParticles',
  'dustCells',
  'liquidCells',
  'emitterParticles',
  'hazards',
  'triggers',
  'lights',
];

export type RoomComplexityCategoryCounts = Record<RoomComplexityCategory, number>;

/** Human-readable label used in warning messages, e.g. "liquid cells (24,800)". */
export const ROOM_COMPLEXITY_CATEGORY_LABELS: Record<RoomComplexityCategory, string> = {
  tiles: 'tiles',
  objects: 'objects',
  enemies: 'enemies',
  enemyParticles: 'enemy particles',
  dustCells: 'dust cells',
  liquidCells: 'liquid cells',
  emitterParticles: 'emitter particles',
  hazards: 'hazards',
  triggers: 'triggers',
  lights: 'lights',
};

/**
 * Categories that represent discretely-placed entities (one array entry =
 * one placed thing). Summed into `totalPlacedCount`. The remaining
 * categories (`enemyParticles`, `liquidCells`, `emitterParticles`) are
 * *derived magnitudes* describing entities already counted elsewhere
 * (e.g. `enemyParticles` is the simulated-particle cost of the enemies
 * already counted in `enemies`) — including them in `totalPlacedCount` too
 * would double-count the same authored content under two categories.
 */
const DISCRETE_PLACEMENT_CATEGORIES: ReadonlySet<RoomComplexityCategory> = new Set([
  'tiles',
  'objects',
  'enemies',
  'dustCells',
  'hazards',
  'triggers',
  'lights',
]);

// ── Weights ─────────────────────────────────────────────────────────────────

/**
 * Estimated relative runtime cost per unit of each category, used to compute
 * `weightedScore`. Deliberately named/exported so nothing scatters ad-hoc
 * numeric thresholds elsewhere (editor input handlers, campaign-launch code,
 * etc.) — this module is the only place these numbers should live.
 *
 * Rationale (see report for the full write-up):
 *   - tiles            — cheapest per-unit: static geometry, batched into the
 *                         wall template/chunk cache at load time.
 *   - objects          — mixed bag of mostly-static collectibles/decorations
 *                         plus a few lightweight physics bodies; moderate.
 *   - enemies          — AI tick + physics + collision + rendering per enemy;
 *                         one of the most expensive per-unit categories.
 *   - enemyParticles   — fine-grained per-particle cost within an enemy's
 *                         simulated body (bosses are large here even though
 *                         `enemies` count stays low).
 *   - dustCells        — each authored sand/dust pixel becomes a live
 *                         falling-sand simulation cell; noticeably pricier
 *                         than a static tile.
 *   - liquidCells       — liquid simulation is cheaper per-cell than sand but
 *                         zones are typically large-area, so it adds up.
 *   - emitterParticles — motes/swirls/piles are continuously
 *                         animated/attracted; moderate per-particle cost.
 *   - hazards          — per-frame collision/zone tests against the player.
 *   - triggers         — mostly idle bounding-box checks; cheap.
 *   - lights           — most expensive per-unit: scene lights run
 *                         visibility-polygon shadow casting every frame.
 */
export const CONTENT_COMPLEXITY_WEIGHTS: RoomComplexityCategoryCounts = {
  tiles: 0.02,
  objects: 0.3,
  enemies: 3.0,
  enemyParticles: 0.05,
  dustCells: 0.2,
  liquidCells: 0.1,
  emitterParticles: 0.08,
  hazards: 0.5,
  triggers: 0.2,
  lights: 2.0,
};

// ── Thresholds ──────────────────────────────────────────────────────────────

export type RoomComplexitySeverity = 'normal' | 'elevated' | 'high' | 'extreme';

const SEVERITY_ORDER: readonly RoomComplexitySeverity[] = ['normal', 'elevated', 'high', 'extreme'];

/** True if severity `a` is at least as severe as severity `b`. */
export function isRoomComplexitySeverityAtLeast(a: RoomComplexitySeverity, b: RoomComplexitySeverity): boolean {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b);
}

/**
 * Configurable warning thresholds. `category` thresholds trigger an
 * individual "this category is unusually dense" warning even if the total
 * weighted score hasn't reached `severity.elevated` yet. `severity`
 * thresholds classify the total `weightedScore` into a tier.
 */
export const ROOM_COMPLEXITY_THRESHOLDS = {
  category: {
    tiles: 20000,
    objects: 1500,
    enemies: 300,
    enemyParticles: 25000,
    dustCells: 30000,
    liquidCells: 25000,
    emitterParticles: 10000,
    hazards: 600,
    triggers: 400,
    lights: 120,
  } as RoomComplexityCategoryCounts,
  severity: {
    elevated: 1200,
    high: 3000,
    extreme: 7000,
  },
} as const;

// ── Report ──────────────────────────────────────────────────────────────────

export interface RoomComplexityReport {
  categoryCounts: RoomComplexityCategoryCounts;
  /** Sum of the discrete-placement categories only (see DISCRETE_PLACEMENT_CATEGORIES). */
  totalPlacedCount: number;
  /** Sum of `count * CONTENT_COMPLEXITY_WEIGHTS[category]` across all categories. */
  weightedScore: number;
  /** Categories whose raw count met or exceeded their individual threshold. */
  categoriesExceedingThreshold: RoomComplexityCategory[];
  severity: RoomComplexitySeverity;
  /** True if this room should surface a performance warning to the user. */
  shouldWarn: boolean;
}

function classifySeverity(weightedScore: number): RoomComplexitySeverity {
  if (weightedScore >= ROOM_COMPLEXITY_THRESHOLDS.severity.extreme) return 'extreme';
  if (weightedScore >= ROOM_COMPLEXITY_THRESHOLDS.severity.high) return 'high';
  if (weightedScore >= ROOM_COMPLEXITY_THRESHOLDS.severity.elevated) return 'elevated';
  return 'normal';
}

/**
 * The single authoritative scoring function. Takes raw per-category counts
 * (already computed from a RoomDef or an EditorRoomData — see
 * `analyzeRoomDefComplexity` and editor/editorRoomComplexity.ts) and produces
 * the full report. Deterministic and inexpensive (a fixed number of
 * multiplications/additions, no allocation beyond the returned object).
 */
export function computeRoomComplexityReport(categoryCounts: RoomComplexityCategoryCounts): RoomComplexityReport {
  let weightedScore = 0;
  let totalPlacedCount = 0;
  const categoriesExceedingThreshold: RoomComplexityCategory[] = [];

  for (const category of ROOM_COMPLEXITY_CATEGORIES) {
    const count = categoryCounts[category];
    weightedScore += count * CONTENT_COMPLEXITY_WEIGHTS[category];
    if (DISCRETE_PLACEMENT_CATEGORIES.has(category)) totalPlacedCount += count;
    if (count >= ROOM_COMPLEXITY_THRESHOLDS.category[category]) categoriesExceedingThreshold.push(category);
  }

  const severity = classifySeverity(weightedScore);
  const shouldWarn = severity !== 'normal' || categoriesExceedingThreshold.length > 0;

  return { categoryCounts, totalPlacedCount, weightedScore, categoriesExceedingThreshold, severity, shouldWarn };
}

// ── RoomDef analysis ──────────────────────────────────────────────────────────

function sumZoneCells(zones: readonly RoomZoneDef[] | undefined): number {
  if (!zones) return 0;
  let total = 0;
  for (const zone of zones) total += zone.wBlock * zone.hBlock;
  return total;
}

/**
 * Counts placed content directly from a hydrated `RoomDef`. Never
 * instantiates entities or runs simulation — pure field reads/sums over
 * already-serialized data, so it's safe to call on rooms that have never
 * been loaded into a screen (see `analyzeCampaignComplexity`).
 *
 * Procedurally-spawned content: DustWeaver's current RoomDef schema only
 * contains authored/static placements (no runtime spawner definitions), so
 * there is nothing procedural to account for today. If a spawner-style field
 * is added later (e.g. `{ maxConcurrent: number }`), it should contribute
 * `maxConcurrent * (enemies or emitterParticles weight)` as an upper-bound
 * estimate — never by actually running the spawner.
 */
export function countRoomDefCategories(room: RoomDef): RoomComplexityCategoryCounts {
  return {
    tiles: room.walls.length + (room.backgroundBlocks?.length ?? 0),
    objects:
      (room.decorations?.length ?? 0) +
      (room.dustContainers?.length ?? 0) +
      (room.dustContainerPieces?.length ?? 0) +
      (room.dustBoostJars?.length ?? 0) +
      (room.fireflyJars?.length ?? 0) +
      (room.dustPiles?.length ?? 0) +
      (room.lambdaAnchors?.length ?? 0) +
      (room.ropes?.length ?? 0) +
      room.saveTombs.length +
      (room.skillTombs?.length ?? 0) +
      (room.challengeFields?.length ?? 0) +
      (room.challengeGates?.length ?? 0) +
      (room.challengeTotems?.length ?? 0) +
      (room.springboards?.length ?? 0) +
      (room.bouncePads?.length ?? 0) +
      (room.kineticBlocks?.length ?? 0) +
      (room.grappleCarryBlocks?.length ?? 0) +
      (room.phantasmalTiles?.length ?? 0) +
      (room.breakableBlocks?.length ?? 0) +
      (room.crumbleBlocks?.length ?? 0) +
      (room.fallingBlocks?.length ?? 0) +
      (room.dustSwarms?.length ?? 0) +
      (room.guideDustPaths?.length ?? 0) +
      (room.grasshopperAreas?.length ?? 0) +
      (room.fireflyAreas?.length ?? 0),
    enemies: room.enemies.length,
    enemyParticles: room.enemies.reduce((sum, e) => sum + e.particleCount, 0),
    dustCells: room.pixelMaterials?.length ?? 0,
    liquidCells: sumZoneCells(room.waterZones) + sumZoneCells(room.lavaZones),
    emitterParticles:
      (room.dustSwarms ?? []).reduce((sum, s) => sum + s.dustCount, 0) +
      (room.dustPiles ?? []).reduce((sum, p) => sum + p.dustCount, 0) +
      (room.guideDustPaths ?? []).reduce((sum, p) => sum + p.moteCount, 0),
    hazards: (room.spikes?.length ?? 0) + (room.waterZones?.length ?? 0) + (room.lavaZones?.length ?? 0),
    triggers: (room.dialogueTriggers?.length ?? 0) + room.transitions.length,
    lights:
      (room.ambientLightBlockers?.length ?? 0) +
      (room.lightSources?.length ?? 0) +
      (room.sunbeams?.length ?? 0) +
      (room.sceneLights?.length ?? 0),
  };
}

export function analyzeRoomDefComplexity(room: RoomDef): RoomComplexityReport {
  return computeRoomComplexityReport(countRoomDefCategories(room));
}

// ── Message formatting ────────────────────────────────────────────────────────

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Builds the single-room warning message shown by the editor. Uses the
 * categories that individually crossed their threshold; if none did (the
 * warning is purely from the combined weighted score), falls back to the
 * single highest-weighted-cost category so the message still names a cause.
 */
export function formatRoomComplexityWarningMessage(report: RoomComplexityReport): string {
  const categories = report.categoriesExceedingThreshold.length > 0
    ? report.categoriesExceedingThreshold
    : [dominantCategory(report.categoryCounts)];

  if (categories.length === 1) {
    const category = categories[0];
    const count = report.categoryCounts[category];
    return `This room contains a large number of ${ROOM_COMPLEXITY_CATEGORY_LABELS[category]} (${formatCount(count)}), which may cause performance issues on some systems.`;
  }

  const parts = categories.map((category) => `${formatCount(report.categoryCounts[category])} ${ROOM_COMPLEXITY_CATEGORY_LABELS[category]}`);
  const joined = parts.length === 2
    ? parts.join(' and ')
    : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `This room may have performance issues because it contains ${joined}.`;
}

/** The category with the largest weighted contribution to the score. */
export function dominantCategory(categoryCounts: RoomComplexityCategoryCounts): RoomComplexityCategory {
  let best: RoomComplexityCategory = ROOM_COMPLEXITY_CATEGORIES[0];
  let bestWeighted = -Infinity;
  for (const category of ROOM_COMPLEXITY_CATEGORIES) {
    const weighted = categoryCounts[category] * CONTENT_COMPLEXITY_WEIGHTS[category];
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      best = category;
    }
  }
  return best;
}

// ── Campaign analysis ──────────────────────────────────────────────────────────

export interface CampaignComplexityRoomEntry {
  roomId: string;
  /** Stable 0-based position of this room in the campaign's authored room list — NOT exploration order. */
  roomIndex: number;
  roomName: string;
  report: RoomComplexityReport;
}

export interface CampaignComplexityReport {
  rooms: CampaignComplexityRoomEntry[];
  roomsExceedingThreshold: CampaignComplexityRoomEntry[];
  mostComplexRoom: CampaignComplexityRoomEntry | null;
  shouldWarnBeforePlay: boolean;
}

/**
 * Analyzes every room in a campaign from already-hydrated `RoomDef`s (see
 * `hydrateSavedCampaignToRoomDefs` in campaignSchema.ts — it performs no
 * registry mutation or gameplay instantiation, so this works for rooms the
 * player has never visited). `rooms` should be supplied in the campaign's
 * stable authored order (e.g. the Map returned by
 * `hydrateSavedCampaignToRoomDefs`, or the `SavedCampaignV1.rooms` order) —
 * `roomIndex` in the result reflects iteration order over `rooms`, not any
 * runtime exploration order.
 */
export function analyzeCampaignComplexity(
  rooms: ReadonlyMap<string, RoomDef> | readonly RoomDef[],
): CampaignComplexityReport {
  const roomList = Array.isArray(rooms) ? rooms : Array.from(rooms.values());
  const entries: CampaignComplexityRoomEntry[] = roomList.map((room, roomIndex) => ({
    roomId: room.id,
    roomIndex,
    roomName: room.name,
    report: analyzeRoomDefComplexity(room),
  }));

  const roomsExceedingThreshold = entries.filter((entry) => entry.report.shouldWarn);
  const mostComplexRoom = entries.reduce<CampaignComplexityRoomEntry | null>(
    (best, entry) => (best === null || entry.report.weightedScore > best.report.weightedScore ? entry : best),
    null,
  );

  return {
    rooms: entries,
    roomsExceedingThreshold,
    mostComplexRoom,
    shouldWarnBeforePlay: roomsExceedingThreshold.length > 0,
  };
}

// ── Campaign analysis caching ─────────────────────────────────────────────────

/**
 * Cache of the last computed `CampaignComplexityReport` per campaign object.
 * Keyed by object identity (a `WeakMap`, so entries are GC'd automatically
 * once the campaign object itself is no longer referenced) rather than by a
 * campaign id string, because campaign ids can repeat across freshly-loaded
 * instances (e.g. reloading the same file); the safest "has this exact data
 * changed" signal is the object reference itself.
 */
const campaignComplexityCache = new WeakMap<object, CampaignComplexityReport>();

/**
 * Cached wrapper around `analyzeCampaignComplexity`. `campaignKey` should be
 * the loaded campaign object (e.g. the `SavedCampaignV1`) — callers must
 * call `invalidateCampaignComplexityCache(campaignKey)` whenever they mutate
 * that object's room content in place (the editor's live per-room checks
 * don't use this cache at all, so in-editor edits never need to invalidate
 * it; this exists for the campaign-wide pre-play check, which normally
 * operates on freshly-loaded, immutable campaign data).
 *
 * `getRooms` is only invoked on a cache miss, so a cache hit skips the
 * (comparatively expensive) full-campaign hydration entirely.
 */
export function analyzeCampaignComplexityCached(
  campaignKey: object,
  getRooms: () => ReadonlyMap<string, RoomDef> | readonly RoomDef[],
): CampaignComplexityReport {
  const cached = campaignComplexityCache.get(campaignKey);
  if (cached !== undefined) return cached;
  const report = analyzeCampaignComplexity(getRooms());
  campaignComplexityCache.set(campaignKey, report);
  return report;
}

/** Evicts the cached report for `campaignKey`, forcing recomputation on the next call. */
export function invalidateCampaignComplexityCache(campaignKey: object): void {
  campaignComplexityCache.delete(campaignKey);
}

/**
 * Builds the pre-play confirmation message for a custom campaign. Returns
 * `null` when no warning is warranted (caller should skip showing a dialog).
 */
export function formatCampaignComplexityWarningMessage(report: CampaignComplexityReport): string | null {
  const count = report.roomsExceedingThreshold.length;
  if (count === 0 || report.mostComplexRoom === null) return null;

  const worst = report.mostComplexRoom;
  const causeCategories = worst.report.categoriesExceedingThreshold.length > 0
    ? worst.report.categoriesExceedingThreshold
    : [dominantCategory(worst.report.categoryCounts)];
  const causePhrase = causeCategories.map((c) => ROOM_COMPLEXITY_CATEGORY_LABELS[c]).join(' and ');

  const roomLabel = worst.roomName && worst.roomName.length > 0
    ? `Room ${worst.roomIndex + 1}, "${worst.roomName}",`
    : `Room ${worst.roomIndex + 1}`;

  return (
    `This custom campaign contains ${count} room${count === 1 ? '' : 's'} that may cause performance issues.\n` +
    `The most demanding room is ${roomLabel} with ${formatCount(worst.report.totalPlacedCount)} placed elements ` +
    `(estimated complexity: ${worst.report.severity}). Most of its estimated cost comes from ${causePhrase}.`
  );
}
