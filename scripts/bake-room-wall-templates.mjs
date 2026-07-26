/**
 * bake-room-wall-templates.mjs
 *
 * Bakes wall templates into all active campaign room JSON files.
 *
 * For each v3 room:
 *   1. Hydrate interior walls from solids + specialWalls (mirrors roomSchemaHydrator.ts).
 *   2. Build complete boundary walls (mirrors roomBoundaryWalls.ts).
 *   3. Convert walls to world units and run the iterative merge pass
 *      (mirrors buildRoomWallTemplateIncremental in gameRoomWalls.ts).
 *   4. Compute the source hash (mirrors computeWallTemplateSourceHash).
 *   5. Write bakedWallTemplate (including themeNames for non-legacy indices)
 *      back into the room JSON file.
 *
 * Rooms with an already-valid baked template are skipped unless --force is
 * passed.  The script never rewrites room content — it only adds/updates the
 * top-level `bakedWallTemplate` key.
 *
 * Usage:
 *   node scripts/bake-room-wall-templates.mjs [--dry-run] [--force]
 *
 * Constants must stay in sync with the TypeScript sources they mirror.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

// ── Constants (must match TypeScript sources) ─────────────────────────────────
// roomDef.ts / roomWallTemplateHash.ts / surfaceRimStyle.ts
const BAKED_WALL_SCHEMA_VERSION = 2;
const BLOCK_SIZE_MEDIUM         = 8;   // virtual px per block
const WALL_THEME_DEFAULT_INDEX  = 255; // no per-wall theme override
const MAX_WALLS                 = 6000;
const WALL_MERGE_EPSILON        = 0.001;
const SURFACE_RIM_STYLE_INDEX_DEFAULT = 0xFFFF;
// roomSavedTypes.ts
const DEFAULT_THEME_KEY = '__default__';

// ── blockThemeRefToTheme (mirrors blockTheme.ts) ───────────────────────────────
/** Resolves a compact theme ID or full theme name to its canonical full name. */
function blockThemeRefToTheme(ref) {
  if (!ref) return undefined;
  switch (ref) {
    case 'blackRock': case 'brownRock': case 'dirt': return ref;
    case 'bk': return 'blackRock';
    case 'br': return 'brownRock';
    case 'dt': return 'dirt';
    default:   return ref; // folder-based themes and pass-throughs
  }
}

// ── blockThemeToSoundHardness (mirrors blockTheme.ts) ─────────────────────────
function normalizedThemeToken(theme) {
  return theme.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Returns 0=soft, 1=normal, 2=hard (mirrors blockThemeToSoundHardness + index). */
function themeSoundHardnessIndex(theme) {
  if (!theme) return 2;
  const t = normalizedThemeToken(theme);
  if (
    t.includes('dirt') || t.includes('sand') || t.includes('overgrowth') ||
    t.includes('grass') || t.includes('mud') || t.includes('soil')
  ) return 0; // soft
  if (
    t.includes('wood') || t.includes('moss') || t.includes('sandstone') ||
    t.includes('limestone') || t.includes('chalk') || t.includes('clay')
  ) return 1; // normal
  return 2; // hard
}

/** Mirrors resolveWallSoundHardnessIndex from gameRoomWalls.ts. */
function resolveWallSoundHardnessIndex(wallTheme, roomBlockTheme, roomSoundHardness) {
  // Room-level override takes priority (same as blockSoundHardnessToIndex path).
  if (roomSoundHardness !== undefined) {
    if (roomSoundHardness === 'soft')   return 0;
    if (roomSoundHardness === 'normal') return 1;
    return 2;
  }
  return themeSoundHardnessIndex(wallTheme ?? roomBlockTheme);
}

// ── hydrateSolidsByTheme (mirrors roomSchemaHydrator.ts) ───────────────────────
/** Expands compact solids into a flat array of {xBlock, yBlock, wBlock, hBlock, blockTheme?}. */
function hydrateSolidsByTheme(solids) {
  const out = [];
  if (!solids) return out;

  // byTheme: rects, runs, and points (multi-row rects allowed, hBlock may be > 1)
  if (solids.byTheme) {
    for (const themeKey of Object.keys(solids.byTheme).sort()) {
      const layer = solids.byTheme[themeKey];
      const theme = themeKey === DEFAULT_THEME_KEY ? undefined : blockThemeRefToTheme(themeKey);
      if (layer.rects) {
        for (const [x, y, w, h] of layer.rects) {
          const wall = { xBlock: x, yBlock: y, wBlock: w, hBlock: h };
          if (theme) wall.blockTheme = theme;
          out.push(wall);
        }
      }
      if (layer.runs) {
        for (const [y, xStart, xEnd] of layer.runs) {
          const wall = { xBlock: xStart, yBlock: y, wBlock: xEnd - xStart, hBlock: 1 };
          if (theme) wall.blockTheme = theme;
          out.push(wall);
        }
      }
      if (layer.points) {
        for (const [x, y] of layer.points) {
          const wall = { xBlock: x, yBlock: y, wBlock: 1, hBlock: 1 };
          if (theme) wall.blockTheme = theme;
          out.push(wall);
        }
      }
    }
  }

  // v1ByTheme: runs and points only (1×1-visual walls authored at the tile level)
  if (solids.v1ByTheme) {
    for (const themeKey of Object.keys(solids.v1ByTheme).sort()) {
      const layer = solids.v1ByTheme[themeKey];
      const theme = themeKey === DEFAULT_THEME_KEY ? undefined : blockThemeRefToTheme(themeKey);
      if (layer.runs) {
        for (const [y, xStart, xEnd] of layer.runs) {
          const wall = { xBlock: xStart, yBlock: y, wBlock: xEnd - xStart, hBlock: 1 };
          if (theme) wall.blockTheme = theme;
          out.push(wall);
        }
      }
      if (layer.points) {
        for (const [x, y] of layer.points) {
          const wall = { xBlock: x, yBlock: y, wBlock: 1, hBlock: 1 };
          if (theme) wall.blockTheme = theme;
          out.push(wall);
        }
      }
    }
  }

  return out;
}

// ── hydrateSpecialWalls (mirrors roomSchemaHydrator.ts) ────────────────────────
/** Expands saved special walls (platforms, stairs, ramps, pillars) into RoomJsonWall-like objects. */
function hydrateSpecialWalls(specialWalls) {
  if (!specialWalls || specialWalls.length === 0) return [];
  return specialWalls.map(sw => {
    const [x, y, w, h] = sw.r;
    const wall = { xBlock: x, yBlock: y, wBlock: w, hBlock: h };
    if (sw.theme) {
      const wallTheme = blockThemeRefToTheme(sw.theme);
      if (wallTheme) wall.blockTheme = wallTheme;
    }
    if (sw.plat === 1) {
      wall.isPlatform = true;
      if (sw.edge !== undefined && sw.edge !== 0) wall.platformEdge = sw.edge;
    }
    if (sw.ramp !== undefined) wall.rampOrientation = sw.ramp;
    if (sw.stairs !== undefined) wall.stairsOrientation = sw.stairs;
    if (sw.half === 1) wall.isPillarHalfWidth = true;
    return wall;
  });
}

// ── buildCompleteBoundaryWalls (mirrors roomBoundaryWalls.ts) ──────────────────
function buildCompleteBoundaryWalls(widthBlocks, heightBlocks) {
  if (widthBlocks < 2 || heightBlocks < 2) return [];
  return [
    // Top edge — full width
    { xBlock: 0,              yBlock: 0,               wBlock: widthBlocks,    hBlock: 1,              isInvisibleFlag: 1 },
    // Bottom edge — full width
    { xBlock: 0,              yBlock: heightBlocks - 1, wBlock: widthBlocks,   hBlock: 1,              isInvisibleFlag: 1 },
    // Left edge — interior height only (corners owned by top/bottom)
    { xBlock: 0,              yBlock: 1,               wBlock: 1,              hBlock: heightBlocks - 2, isInvisibleFlag: 1 },
    // Right edge — interior height only
    { xBlock: widthBlocks - 1, yBlock: 1,              wBlock: 1,              hBlock: heightBlocks - 2, isInvisibleFlag: 1 },
  ];
}

// ── buildWallTemplate (mirrors buildRoomWallTemplateIncremental in gameRoomWalls.ts) ─
/**
 * Converts all walls to world units and runs the iterative merge pass.
 * Uses the provided per-room theme registry functions so each call is
 * independent of other rooms processed in the same script run.
 */
function buildWallTemplate(allWalls, roomBlockTheme, roomSoundHardness, themeToIndex, indexToTheme) {
  const xs = [], ys = [], ws = [], hs = [];
  const fs  = []; // isPlatformFlag (0 or 1)
  const pe  = []; // platformEdge
  const ts  = []; // themeIndex
  const sh  = []; // soundHardnessIndex
  const iv  = []; // isInvisibleFlag
  const ro  = []; // shape orientation: 0-3 legacy ramp, 4-7 stairs, 255 plain rect
  const ph  = []; // isPillarHalfWidthFlag
  const ic  = []; // isIceFlag
  const uic = []; // isUltraIceFlag
  const rs  = []; // rimStyleIndex (SURFACE_RIM_STYLE_INDEX_DEFAULT = default)

  const rawCount = Math.min(allWalls.length, MAX_WALLS);
  for (let wi = 0; wi < rawCount; wi++) {
    const def = allWalls[wi];
    const isHalfWidthPillar = def.isPillarHalfWidth === true || def.isPillarHalfWidthFlag === 1;
    // Half-width pillars use half BLOCK_SIZE_MEDIUM for width; minimum is still enforced per-axis.
    const rawWWorld = isHalfWidthPillar
      ? Math.max(BLOCK_SIZE_MEDIUM / 2, def.wBlock * (BLOCK_SIZE_MEDIUM / 2))
      : Math.max(BLOCK_SIZE_MEDIUM,     def.wBlock * BLOCK_SIZE_MEDIUM);
    xs.push(def.xBlock * BLOCK_SIZE_MEDIUM);
    ys.push(def.yBlock * BLOCK_SIZE_MEDIUM);
    ws.push(rawWWorld);
    hs.push(Math.max(BLOCK_SIZE_MEDIUM, def.hBlock * BLOCK_SIZE_MEDIUM));
    fs.push((def.isPlatform === true || def.isPlatformFlag === 1) ? 1 : 0);
    pe.push(def.platformEdge ?? 0);
    const themeIdx = def.blockTheme !== undefined
      ? themeToIndex(def.blockTheme)
      : WALL_THEME_DEFAULT_INDEX;
    ts.push(themeIdx);
    sh.push(resolveWallSoundHardnessIndex(def.blockTheme, roomBlockTheme, roomSoundHardness));
    iv.push((def.isInvisible === true || def.isInvisibleFlag === 1) ? 1 : 0);
    // Mirrors wallShapeOrientationIndex() in src/levels/stairsGeometry.ts.
    ro.push(
      def.stairsOrientation !== undefined ? def.stairsOrientation + 4
      : def.rampOrientation !== undefined ? def.rampOrientation
      : 255,
    );
    ph.push(isHalfWidthPillar ? 1 : 0);
    // Ice flag derived from resolved theme name (mirrors gameRoomWalls.ts)
    const resolvedTheme = themeIdx === WALL_THEME_DEFAULT_INDEX
      ? (roomBlockTheme ?? '')
      : indexToTheme(themeIdx);
    ic.push(resolvedTheme === 'ice' || resolvedTheme === 'iceBlock' ? 1 : 0);
    uic.push(resolvedTheme === 'ultraIceBlock' ? 1 : 0);
    rs.push(def.r !== undefined ? def.r : SURFACE_RIM_STYLE_INDEX_DEFAULT);
  }

  // Iterative merge pass — identical to the TypeScript generator implementation.
  // Two walls may merge only when: same platform type, same theme, same sound
  // hardness, same invisibility; neither is a shaped wall (stairs/ramp); neither is a half-width
  // pillar; and they share a complete face on one axis.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        if (fs[i] !== fs[j] || ts[i] !== ts[j] || sh[i] !== sh[j] || iv[i] !== iv[j]) continue;
        if (rs[i] !== rs[j]) continue;
        if (ro[i] !== 255 || ro[j] !== 255) continue;
        if (ph[i] !== 0  || ph[j] !== 0)  continue;
        // Horizontal merge: same Y and H, contiguous/overlapping on X axis
        if (Math.abs(ys[i] - ys[j]) <= WALL_MERGE_EPSILON &&
            Math.abs(hs[i] - hs[j]) <= WALL_MERGE_EPSILON) {
          const rightI = xs[i] + ws[i];
          const rightJ = xs[j] + ws[j];
          if (rightI >= xs[j] - WALL_MERGE_EPSILON &&
              rightJ >= xs[i] - WALL_MERGE_EPSILON) {
            const mergedLeft  = xs[i] < xs[j] ? xs[i] : xs[j];
            const mergedRight = rightI > rightJ ? rightI : rightJ;
            xs[i] = mergedLeft;
            ws[i] = mergedRight - mergedLeft;
            ys[i] = ys[i] < ys[j] ? ys[i] : ys[j];
            hs[i] = hs[i] > hs[j] ? hs[i] : hs[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            fs.splice(j, 1); pe.splice(j, 1); ts.splice(j, 1); sh.splice(j, 1); iv.splice(j, 1);
            ro.splice(j, 1); ph.splice(j, 1); ic.splice(j, 1); uic.splice(j, 1); rs.splice(j, 1);
            merged = true;
            break outer;
          }
        }
        // Vertical merge: same X and W, contiguous/overlapping on Y axis
        if (Math.abs(xs[i] - xs[j]) <= WALL_MERGE_EPSILON &&
            Math.abs(ws[i] - ws[j]) <= WALL_MERGE_EPSILON) {
          const bottomI = ys[i] + hs[i];
          const bottomJ = ys[j] + hs[j];
          if (bottomI >= ys[j] - WALL_MERGE_EPSILON &&
              bottomJ >= ys[i] - WALL_MERGE_EPSILON) {
            const mergedTop    = ys[i] < ys[j] ? ys[i] : ys[j];
            const mergedBottom = bottomI > bottomJ ? bottomI : bottomJ;
            ys[i] = mergedTop;
            hs[i] = mergedBottom - mergedTop;
            xs[i] = xs[i] < xs[j] ? xs[i] : xs[j];
            ws[i] = ws[i] > ws[j] ? ws[i] : ws[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            fs.splice(j, 1); pe.splice(j, 1); ts.splice(j, 1); sh.splice(j, 1); iv.splice(j, 1);
            ro.splice(j, 1); ph.splice(j, 1); ic.splice(j, 1); uic.splice(j, 1); rs.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
  }

  const finalCount = Math.min(xs.length, MAX_WALLS);
  return {
    wallCount:            finalCount,
    xWorld:               xs.slice(0, finalCount),
    yWorld:               ys.slice(0, finalCount),
    wWorld:               ws.slice(0, finalCount),
    hWorld:               hs.slice(0, finalCount),
    isPlatformFlag:       fs.slice(0, finalCount),
    platformEdge:         pe.slice(0, finalCount),
    themeIndex:           ts.slice(0, finalCount),
    soundHardnessIndex:   sh.slice(0, finalCount),
    isInvisibleFlag:      iv.slice(0, finalCount),
    rampOrientationIndex: ro.slice(0, finalCount),
    isPillarHalfWidthFlag: ph.slice(0, finalCount),
    isIceFlag:            ic.slice(0, finalCount),
    isUltraIceFlag:       uic.slice(0, finalCount),
    rimStyleIndex:        rs.slice(0, finalCount),
    rimStyles:            [],
  };
}

// ── computeWallTemplateSourceHash (mirrors roomWallTemplateHash.ts) ────────────
/**
 * djb2-style hash of all wall-affecting inputs from the RoomJsonDef equivalent.
 * Must match `computeWallTemplateSourceHash` exactly.
 */
function computeWallTemplateSourceHash(
  widthBlocks, heightBlocks,
  blockTheme, blockThemeId, soundHardness,
  interiorWalls,
  rimStyles,
) {
  let h = 5381;
  function mix(n)     { h = (((h << 5) + h) ^ n) | 0; }
  function hashStr(s) { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); mix(0); }
  function hashNum(n) { hashStr(n.toString()); }
  function hashBool(b){ mix(b === undefined ? 2 : b ? 1 : 0); }

  hashNum(BAKED_WALL_SCHEMA_VERSION);
  hashNum(BLOCK_SIZE_MEDIUM);
  hashNum(widthBlocks);
  hashNum(heightBlocks);
  hashStr(blockTheme   ?? '');
  hashStr(blockThemeId ?? '');
  hashStr(soundHardness ?? '');
  hashNum(interiorWalls.length);
  for (const w of interiorWalls) {
    hashNum(w.xBlock);
    hashNum(w.yBlock);
    hashNum(w.wBlock);
    hashNum(w.hBlock);
    hashBool(w.isPlatform);
    hashStr(String(w.platformEdge ?? ''));
    hashStr(w.blockTheme  ?? '');
    hashStr(w.blockThemeId ?? '');
    hashStr(String(w.rampOrientation ?? ''));
    hashStr(String(w.stairsOrientation ?? ''));
    hashBool(w.isPillarHalfWidth);
    hashStr(String(w.r ?? ''));
  }
  hashStr(JSON.stringify(rimStyles ?? []));
  return ((h >>> 0)).toString(16).padStart(8, '0');
}

// ── bakeRoom ──────────────────────────────────────────────────────────────────
/** Bakes the wall template for a single room file.  Returns a result object. */
function bakeRoom(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const room = JSON.parse(raw);

  if (room.v !== 3) {
    return { status: 'skip', reason: `unsupported version: v${room.v ?? '?'}` };
  }
  if (room.exactWalls && room.exactWalls.length > 0) {
    // Should have been migrated by migrate-rooms-v2-to-v3.mjs; skip to be safe.
    return { status: 'skip', reason: 'has un-migrated exactWalls; run migrate-rooms-v2-to-v3.mjs first' };
  }

  const [widthBlocks, heightBlocks] = room.size;
  const blockTheme   = blockThemeRefToTheme(room.theme);
  const soundHardness = room.soundHardness; // undefined for all current rooms

  // Interior walls (matches hydrateV2Room order: uniform solids → special walls)
  const uniformWalls  = hydrateSolidsByTheme(room.solids);
  const specialWalls  = hydrateSpecialWalls(room.specialWalls);
  const interiorWalls = [...uniformWalls, ...specialWalls];

  // Source hash uses the same inputs as computeWallTemplateSourceHash in TS.
  // blockThemeId is not stored at room level in SavedRoomV2, so it is undefined.
  const sourceHash = computeWallTemplateSourceHash(
    widthBlocks, heightBlocks, blockTheme, undefined, soundHardness, interiorWalls, room.rimStyles,
  );

  // Skip if already valid (unless --force)
  if (!FORCE && room.bakedWallTemplate) {
    const b = room.bakedWallTemplate;
    if (
      b.schemaVersion === BAKED_WALL_SCHEMA_VERSION &&
      b.sourceHash    === sourceHash &&
      typeof b.wallCount === 'number' &&
      Array.isArray(b.themeIndex) &&
      b.themeIndex.length === b.wallCount &&
      Array.isArray(b.rimStyleIndex) &&
      b.rimStyleIndex.length === b.wallCount &&
      Array.isArray(b.rimStyles)
    ) {
      return { status: 'skip', reason: 'already valid', wallCount: b.wallCount, sourceHash };
    }
  }

  // Per-room theme registry: fresh for each room so themeNames stays minimal.
  const themeToIdx  = new Map([['blackRock', 0], ['brownRock', 1], ['dirt', 2]]);
  const idxToTheme  = ['blackRock', 'brownRock', 'dirt'];
  let nextThemeIdx  = 3;
  function themeToIndex(theme) {
    const ex = themeToIdx.get(theme);
    if (ex !== undefined) return ex;
    const idx = nextThemeIdx++;
    themeToIdx.set(theme, idx);
    idxToTheme.push(theme);
    return idx;
  }
  function indexToTheme(idx) { return idxToTheme[idx] ?? 'blackRock'; }

  // Build complete boundary walls + all interior walls
  const boundaryWalls = buildCompleteBoundaryWalls(widthBlocks, heightBlocks);
  const allWalls = [...boundaryWalls, ...interiorWalls];

  // Run conversion + merge pass
  const tpl = buildWallTemplate(allWalls, blockTheme, soundHardness, themeToIndex, indexToTheme);

  // Collect theme names for non-legacy dynamic indices (≥3) used in this template.
  // themeNames[i] = name for local index (i + 3), enabling session-order-independent
  // remapping in hydrateAndValidateBakedWallTemplate at runtime.
  let maxLocalIdx = 2;
  for (const idx of tpl.themeIndex) {
    if (idx !== WALL_THEME_DEFAULT_INDEX && idx > maxLocalIdx) maxLocalIdx = idx;
  }
  const themeNames = [];
  for (let i = 3; i <= maxLocalIdx; i++) themeNames.push(indexToTheme(i));

  // Assemble bakedWallTemplate (arrays stored as plain JS arrays in JSON)
  const baked = {
    schemaVersion:         BAKED_WALL_SCHEMA_VERSION,
    sourceHash,
    wallCount:             tpl.wallCount,
    xWorld:                tpl.xWorld,
    yWorld:                tpl.yWorld,
    wWorld:                tpl.wWorld,
    hWorld:                tpl.hWorld,
    isPlatformFlag:        tpl.isPlatformFlag,
    platformEdge:          tpl.platformEdge,
    themeIndex:            tpl.themeIndex,
    ...(themeNames.length > 0 ? { themeNames } : {}),
    soundHardnessIndex:    tpl.soundHardnessIndex,
    isInvisibleFlag:       tpl.isInvisibleFlag,
    rampOrientationIndex:  tpl.rampOrientationIndex,
    isPillarHalfWidthFlag: tpl.isPillarHalfWidthFlag,
    isIceFlag:             tpl.isIceFlag,
    isUltraIceFlag:        tpl.isUltraIceFlag,
    rimStyleIndex:         tpl.rimStyleIndex,
    rimStyles:             tpl.rimStyles,
  };

  const updated = { ...room, bakedWallTemplate: baked };

  if (!DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  }

  return { status: 'baked', wallCount: tpl.wallCount, sourceHash, themeNames };
}

// ── Main: walk campaign room files in manifest order ──────────────────────────

const campaignsDir = join(REPO_ROOT, 'ASSETS', 'CAMPAIGNS');
const manifestPath = join(campaignsDir, 'DUSTWEAVER_CAMPAIGN', 'ROOMS', 'manifest.json');

/** Resolve the room JSON file path from a room ID. */
function roomFilePath(roomId) {
  return join(campaignsDir, 'DUSTWEAVER_CAMPAIGN', 'ROOMS', `${roomId}_room.json`);
}

let roomIds;
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (Array.isArray(manifest)) {
    roomIds = manifest;
  } else if (Array.isArray(manifest.rooms)) {
    roomIds = manifest.rooms;
  } else if (manifest.rooms && typeof manifest.rooms === 'object') {
    // rooms is a map of roomId → metadata; preserve iteration order
    roomIds = Object.keys(manifest.rooms);
  } else {
    roomIds = Object.keys(manifest);
  }
} catch {
  // Fall back to discovering all *_room.json files alphabetically.
  const { readdirSync } = await import('node:fs');
  roomIds = readdirSync(join(campaignsDir, 'DUSTWEAVER_CAMPAIGN', 'ROOMS'))
    .filter(f => f.endsWith('_room.json'))
    .map(f => f.replace('_room.json', ''))
    .sort();
}

if (DRY_RUN) console.log('[bakeRooms] DRY RUN — no files will be written\n');

let bakedCount   = 0;
let skippedCount = 0;
let failedCount  = 0;

for (const roomId of roomIds) {
  const filePath = roomFilePath(roomId);
  let result;
  try {
    result = bakeRoom(filePath);
  } catch (err) {
    console.error(`[bakeRooms] roomId=${roomId} FAILED: ${err.message}`);
    failedCount++;
    continue;
  }

  if (result.status === 'skip') {
    if (result.reason === 'already valid') {
      console.log(`[bakeRooms] roomId=${roomId} skipped=already-valid wallCount=${result.wallCount} sourceHash=${result.sourceHash}`);
    } else {
      console.log(`[bakeRooms] roomId=${roomId} skipped reason="${result.reason}"`);
    }
    skippedCount++;
  } else {
    const themeInfo = result.themeNames && result.themeNames.length > 0
      ? ` themeNames=[${result.themeNames.join(',')}]`
      : '';
    console.log(`[bakeRooms] roomId=${roomId} baked=yes wallCount=${result.wallCount} sourceHash=${result.sourceHash}${themeInfo}`);
    bakedCount++;
  }
}

console.log(`\n[bakeRooms] updated ${bakedCount} rooms, skipped ${skippedCount} already-valid rooms, failed ${failedCount} rooms`);
if (DRY_RUN && bakedCount > 0) {
  console.log('[bakeRooms] DRY RUN — re-run without --dry-run to write changes');
}
