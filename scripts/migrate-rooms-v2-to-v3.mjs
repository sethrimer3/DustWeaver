/**
 * migrate-rooms-v2-to-v3.mjs
 *
 * Migrates all v2 room JSON files to v3 format:
 *   - Extracts `exactWalls` (1×1 and 2×2 uniform solid walls)
 *   - Compresses them into `solids.v1ByTheme` using runs + points only
 *   - Sets `v: 3`
 *   - Removes the `exactWalls` key
 *
 * V2 rooms that have no `exactWalls` are left unchanged (already optimal).
 * Already-v3 rooms are skipped.
 *
 * Usage:
 *   node scripts/migrate-rooms-v2-to-v3.mjs [--dry-run]
 *
 * The default theme sentinel key matches the TypeScript constant DEFAULT_THEME_KEY.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_THEME_KEY = '__default__';
const RUN_MIN_LENGTH = 2;

// ─── Block theme ID helpers (mirrors blockTheme.ts) ──────────────────────────

/** Map from BlockTheme (display name) to BlockThemeId (compact string). */
const THEME_TO_ID = {
  blackRock:    'bk',
  tealRock:     'tr',
  redRock:      'rr',
  greyRock:     'gr',
  whiteRock:    'wr',
  purpleRock:   'pr',
  brownRock:    'br',
  goldRock:     'go',
  ashRock:      'ar',
  greenRock:    'gn',
  pinkRock:     'pk',
  waterStone:   'ws',
  iceRock:      'ir',
  sandRock:     'sr',
  obsidian:     'ob',
  coralRock:    'cr',
  glowRock:     'lr',
  caveWood:     'cw',
  mushroom:     'mu',
  bone:         'bo',
  crystal:      'cy',
  voidRock:     'vr',
  magmaRock:    'mr',
  nebula:       'nb',
  snowRock:     'sn',
  forestRock:   'fr',
  jungle:       'ju',
  overgrowth:   'og',
  ruins:        'ru',
  ancient:      'an',
  marble:       'ma',
  alabaster:    'al',
};

/** Map from BlockThemeId → BlockTheme (reverse lookup). */
const ID_TO_THEME = Object.fromEntries(Object.entries(THEME_TO_ID).map(([k, v]) => [v, k]));

/** Resolve a theme string (either ID or full name) to its canonical full name. */
function resolveTheme(raw) {
  if (!raw) return undefined;
  if (THEME_TO_ID[raw]) return raw;
  if (ID_TO_THEME[raw]) return ID_TO_THEME[raw];
  // Unknown — pass through as-is (future themes, etc.)
  return raw;
}

/** Convert a BlockTheme full name to its compact ID. */
function themeToId(theme) {
  return THEME_TO_ID[theme] ?? theme;
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────

function createGrid(w, h) {
  return { w, h, cells: new Uint8Array(w * h) };
}

function paintRect(grid, x, y, ww, hh) {
  for (let dy = 0; dy < hh; dy++) {
    for (let dx = 0; dx < ww; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx >= 0 && cx < grid.w && cy >= 0 && cy < grid.h) {
        grid.cells[cy * grid.w + cx] = 1;
      }
    }
  }
}

/** Extract runs + points only (no 2D rects) from a grid. */
function extract1x1Layer(grid) {
  const runs = [];
  const points = [];
  for (let y = 0; y < grid.h; y++) {
    let x = 0;
    while (x < grid.w) {
      if (grid.cells[y * grid.w + x] !== 1) { x++; continue; }
      let end = x + 1;
      while (end < grid.w && grid.cells[y * grid.w + end] === 1) end++;
      const len = end - x;
      if (len >= RUN_MIN_LENGTH) {
        runs.push([y, x, end]);
      } else {
        points.push([x, y]);
      }
      x = end;
    }
  }
  runs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  points.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const layer = {};
  if (runs.length > 0) layer.runs = runs;
  if (points.length > 0) layer.points = points;
  return layer;
}

// ─── Per-room migration ───────────────────────────────────────────────────────

function migrateRoom(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const room = JSON.parse(raw);

  if (room.v === 3) {
    return { status: 'skip', reason: 'already v3' };
  }
  if (room.v !== 2) {
    return { status: 'skip', reason: `unknown version ${room.v}` };
  }

  const exactWalls = room.exactWalls;
  if (!Array.isArray(exactWalls) || exactWalls.length === 0) {
    // No exactWalls — just bump the version.
    const updated = { ...room, v: 3 };
    delete updated.exactWalls;
    if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    return { status: 'migrated', exactWallCount: 0, message: 'bumped version (no exactWalls)' };
  }

  const [widthBlocks, heightBlocks] = room.size;
  const defaultThemeRaw = room.theme;
  const defaultTheme = resolveTheme(defaultThemeRaw) ?? 'blackRock';

  // Group exactWalls by theme key.
  const byThemeWalls = new Map();
  for (const sw of exactWalls) {
    const [x, y, w, h] = sw.r;
    const wallThemeRaw = sw.theme;
    let themeKey;
    if (wallThemeRaw) {
      const resolved = resolveTheme(wallThemeRaw);
      themeKey = resolved !== defaultTheme ? themeToId(resolved) : DEFAULT_THEME_KEY;
    } else {
      themeKey = DEFAULT_THEME_KEY;
    }
    const list = byThemeWalls.get(themeKey) ?? [];
    list.push({ x, y, w, h });
    if (!byThemeWalls.has(themeKey)) byThemeWalls.set(themeKey, list);
  }

  // Build v1ByTheme.
  const v1ByTheme = {};
  const themeKeys = [...byThemeWalls.keys()].sort();
  for (const themeKey of themeKeys) {
    const walls = byThemeWalls.get(themeKey);
    const grid = createGrid(widthBlocks, heightBlocks);
    for (const { x, y, w, h } of walls) paintRect(grid, x, y, w, h);
    const layer = extract1x1Layer(grid);
    if (layer.runs || layer.points) v1ByTheme[themeKey] = layer;
  }

  // Merge into solids.
  const solids = { ...(room.solids ?? { byTheme: {} }) };
  if (Object.keys(v1ByTheme).length > 0) solids.v1ByTheme = v1ByTheme;

  const updated = { ...room, v: 3, solids };
  delete updated.exactWalls;

  if (!DRY_RUN) writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');

  return {
    status: 'migrated',
    exactWallCount: exactWalls.length,
    v1RunCount: Object.values(v1ByTheme).reduce((s, l) => s + (l.runs?.length ?? 0), 0),
    v1PointCount: Object.values(v1ByTheme).reduce((s, l) => s + (l.points?.length ?? 0), 0),
  };
}

// ─── Walk all room directories ────────────────────────────────────────────────

function findRoomFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findRoomFiles(full));
    } else if (entry.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

const campaignsDir = join(REPO_ROOT, 'ASSETS', 'CAMPAIGNS');
const roomFiles = findRoomFiles(campaignsDir).filter(f => f.includes('/ROOMS/'));

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Migrating ${roomFiles.length} room files…\n`);

let migratedCount = 0;
let skippedCount = 0;
let totalExactWallsSaved = 0;

for (const filePath of roomFiles.sort()) {
  const rel = filePath.replace(REPO_ROOT + '/', '');
  const result = migrateRoom(filePath);

  if (result.status === 'skip') {
    console.log(`  SKIP  ${rel}  (${result.reason})`);
    skippedCount++;
  } else {
    const saved = result.exactWallCount;
    const newPrimitives = (result.v1RunCount ?? 0) + (result.v1PointCount ?? 0);
    const msg = saved > 0
      ? `exactWalls: ${saved} → ${newPrimitives} primitives  (runs: ${result.v1RunCount ?? 0}, points: ${result.v1PointCount ?? 0})`
      : result.message ?? '';
    console.log(`  OK    ${rel}  ${msg}`);
    totalExactWallsSaved += saved;
    migratedCount++;
  }
}

console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
if (totalExactWallsSaved > 0) {
  console.log(`Total exactWalls compressed: ${totalExactWallsSaved}`);
}
