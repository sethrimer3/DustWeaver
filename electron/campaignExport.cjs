// campaignExport.cjs — pure (no-Electron-dependency) helpers for writing a
// campaign + room-file cache to disk.
//
// Extracted from electron/main.cjs so this logic can be unit-tested with
// plain Node (no `electron` module required) and shared between the
// 'dw:save-official-campaign' (legacy) and 'dw:export-campaign-with-progress'
// IPC handlers, which must both fail hard on any room/manifest write error.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Symlink-safe path containment ─────────────────────────────────────────────

/**
 * Resolves the real path of an existing path component, walking up parent
 * directories until a component that exists is found.
 *
 * @param {string} targetPath - Absolute path to check (may not exist yet).
 * @returns {string} The real (symlink-resolved) path of the nearest existing ancestor.
 * @throws {Error} If no existing ancestor can be found.
 */
function resolveNearestExistingAncestor(targetPath) {
  let current = path.resolve(targetPath);
  for (let depth = 0; depth < 64; depth++) {
    try {
      return fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`Could not resolve any ancestor of "${targetPath}"`);
      current = parent;
    }
  }
  throw new Error(`Could not resolve ancestor of "${targetPath}" within depth limit`);
}

/**
 * Asserts that `targetPath` (resolved through any symlinks) resides inside
 * `allowedDir` (also symlink-resolved).
 *
 * For paths that do not yet exist, the nearest existing ancestor is resolved.
 * This prevents symlinks from redirecting reads or writes outside the campaign.
 *
 * @param {string} targetPath  - Absolute path of the file or directory to check.
 * @param {string} allowedDir  - Absolute path of the allowed root directory.
 * @param {string} [label]     - Human-readable label for error messages.
 * @returns {{ ok: true } | { ok: false, error: string, realTarget: string, realAllowed: string }}
 */
function checkPathInsideCampaignDir(targetPath, allowedDir, label) {
  let realAllowed;
  try {
    realAllowed = fs.realpathSync(allowedDir);
  } catch {
    // If the allowed dir doesn't exist yet, resolve what we can.
    try { realAllowed = resolveNearestExistingAncestor(allowedDir); } catch {
      realAllowed = path.resolve(allowedDir);
    }
  }

  let realTarget;
  try {
    realTarget = fs.realpathSync(targetPath);
  } catch {
    realTarget = resolveNearestExistingAncestor(targetPath);
  }

  const sep = path.sep;
  const insideDir = realTarget === realAllowed ||
    realTarget.startsWith(realAllowed + sep) ||
    realTarget.startsWith(realAllowed + "/");

  if (!insideDir) {
    const tag = label ? ` (${label})` : "";
    return {
      ok: false,
      error: `Path containment violation${tag}: resolved path "${realTarget}" is outside campaign directory "${realAllowed}"`,
      realTarget,
      realAllowed,
    };
  }
  return { ok: true };
}

/** Regex for safe room IDs — letters, digits, underscores, hyphens only. */
const SAFE_ROOM_ID_RE = /^[a-zA-Z0-9_-]+$/;
/** Regex for a safe campaign ID used in filesystem paths. */
const SAFE_CAMPAIGN_ID_RE = /^[a-zA-Z0-9_-]+$/;
/** Version of the room cache manifest format written by this code. */
const ROOM_CACHE_VERSION = 1;
/** Suffix used for individual room cache files. */
const ROOM_FILE_SUFFIX = "_room.json";
/** Maximum number of rolling backups to keep per campaign. */
const MAX_BACKUPS = 10;
/** Only the official campaign ID is allowed through the official write path. */
const OFFICIAL_CAMPAIGN_ID = "DUSTWEAVER_CAMPAIGN";
/** Packed campaign filename for the official campaign. */
const PACKED_CAMPAIGN_FILENAME = "DustweaverCampaign.dwcampaign.json";
/** Base name used for official campaign backup files (no extension). */
const OFFICIAL_BACKUP_BASE_NAME = "DustweaverCampaign";

// ── Atomic file write helpers ─────────────────────────────────────────────────

/**
 * Returns an ISO 8601 timestamp string that is safe to embed in a filename.
 * Colons are replaced with hyphens so the result is valid on Windows/macOS.
 */
function safeTimestampForFilename(date) {
  return date.toISOString().replace(/:/g, "-");
}

/**
 * Writes `text` to `filePath` atomically:
 *   1. Write to `filePath + '.tmp'` in the same directory.
 *   2. Rename the tmp file over the target path.
 *
 * On Windows, `fs.renameSync` can fail when the target already exists.
 * We handle this by deleting the existing target and retrying the rename.
 *
 * Cleans up the tmp file on any error and re-throws.
 */
function writeTextAtomic(filePath, text) {
  const tmpPath = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, text, "utf8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Windows: target file may already exist — delete it and retry.
      try { fs.unlinkSync(filePath); } catch { /* target didn't exist — fine */ }
      fs.renameSync(tmpPath, filePath);
    }
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
    throw err;
  }
}

/**
 * Serialises `value` to pretty-printed JSON and writes it atomically.
 * See `writeTextAtomic` for the atomic-rename strategy.
 */
function writeJsonAtomic(filePath, value) {
  writeTextAtomic(filePath, JSON.stringify(value, null, 2));
}

// ── Rolling backup helpers ────────────────────────────────────────────────────

/**
 * Creates a timestamped backup of `packedPath` in `backupsDir`, then prunes
 * old backups so at most `maxBackups` remain.
 *
 * Only creates a backup if `packedPath` already exists and is readable.
 * Logs a warning and returns (without throwing) if backup creation fails so
 * the calling export can still proceed.
 */
function ensureRollingBackup(packedPath, backupsDir, backupBaseName, maxBackups) {
  let existingText;
  try {
    existingText = fs.readFileSync(packedPath, "utf8");
  } catch {
    return; // No existing file — nothing to back up.
  }

  try {
    fs.mkdirSync(backupsDir, { recursive: true });
  } catch (err) {
    console.warn(`[backup] Could not create backups directory "${backupsDir}":`, err);
    return;
  }

  const timestamp = safeTimestampForFilename(new Date());
  const backupFilename = `${backupBaseName}_${timestamp}.dwcampaign.json`;
  const backupPath = path.join(backupsDir, backupFilename);

  try {
    fs.writeFileSync(backupPath, existingText, "utf8");
    console.log(`[backup] Created backup: ${backupFilename}`);
  } catch (err) {
    console.warn(`[backup] Could not write backup "${backupFilename}":`, err);
    return;
  }

  pruneBackups(backupsDir, backupBaseName, maxBackups);
}

/**
 * Keeps only the newest `maxBackups` backup files in `backupsDir`.
 * Identifies backups by the pattern `<backupBaseName>_*.dwcampaign.json`.
 * Files are sorted lexicographically (ISO timestamps sort correctly as strings).
 */
function pruneBackups(backupsDir, backupBaseName, maxBackups) {
  let files;
  try {
    files = fs.readdirSync(backupsDir);
  } catch {
    return; // Directory doesn't exist or can't be read — nothing to prune.
  }

  const prefix = `${backupBaseName}_`;
  const suffix = ".dwcampaign.json";
  const backupFiles = files
    .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
    .sort(); // ISO timestamps sort lexicographically → oldest first

  const toDelete = backupFiles.slice(0, Math.max(0, backupFiles.length - maxBackups));
  for (const filename of toDelete) {
    try {
      fs.unlinkSync(path.join(backupsDir, filename));
      console.log(`[backup] Pruned old backup: ${filename}`);
    } catch (err) {
      console.warn(`[backup] Could not prune backup "${filename}":`, err);
    }
  }
}

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Deterministic JSON stringify with sorted object keys.
 *
 * NOTE: This is intentionally duplicated from `src/utils/deterministicHash.ts`
 * because this module runs in Node.js (CommonJS) and cannot import the
 * TypeScript source directly.  Both implementations must produce identical
 * output for the same input so hashes stored in manifest.json remain portable
 * across contexts.  Keep the two implementations in sync if the algorithm
 * ever changes.
 */
function deterministicStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(deterministicStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    const v = value[k];
    if (v === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + deterministicStringify(v));
  }
  return "{" + parts.join(",") + "}";
}

/**
 * Computes a 16-character hex content hash (first 64 bits of SHA-256) of the
 * deterministic JSON serialisation of `value`.
 *
 * NOTE: The renderer-side equivalent is `computeContentHash` in
 * `src/levels/roomFileLoader.ts`. Both must produce identical hashes for the
 * same input so that manifest validation works across processes.
 */
function computeContentHash(value) {
  const text = deterministicStringify(value);
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * Computes a stable campaign content hash from a SavedCampaignV1 payload.
 * Excludes volatile fields so the hash only changes when game content changes.
 */
function computeCampaignHash(campaign) {
  const stable = {
    v: campaign.v,
    kind: campaign.kind,
    campaign: campaign.campaign,
    worldMap: campaign.worldMap,
    rooms: campaign.rooms,
    // Intentionally exclude: campaign.editor (lastEditedIso) and
    // campaign.metadata (lastEditedAt) — those are volatile timestamps.
  };
  return computeContentHash(stable);
}

// ── Manifest helpers ──────────────────────────────────────────────────────────

/**
 * Attempts to read and parse the existing room cache manifest from `roomsDir`.
 * Returns the parsed manifest object on success, or null if it does not exist
 * or cannot be parsed.
 */
function tryReadExistingManifest(roomsDir) {
  const manifestPath = path.join(roomsDir, "manifest.json");
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    // Accept both the new object format and the legacy array format.
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds the manifest adjacency index from an array of SavedRoomV2 room objects.
 *
 * Each room's `transitions` array is inspected for `.to` target room IDs.
 * Only room IDs present in `knownRoomIds` appear as both keys and targets in
 * the result so the scheduler never tries to load rooms not in the manifest.
 * Targets are deduplicated per room.
 */
function buildManifestAdjacency(rooms, knownRoomIds) {
  const adjacency = {};
  for (const room of rooms) {
    if (typeof room !== "object" || room === null) continue;
    const roomId = room.id;
    if (typeof roomId !== "string" || !knownRoomIds.has(roomId)) continue;

    const transitions = room.transitions;
    if (!Array.isArray(transitions)) continue;

    const seen = new Set();
    const targets = [];
    for (const t of transitions) {
      if (typeof t !== "object" || t === null) continue;
      const to = t.to;
      if (typeof to !== "string" || to.length === 0) continue;
      if (!knownRoomIds.has(to)) continue;
      if (seen.has(to)) continue;
      seen.add(to);
      targets.push(to);
    }

    if (targets.length > 0) {
      adjacency[roomId] = { roomId, targets };
    }
  }
  return adjacency;
}

/**
 * Verifies that a manifest's room entries are consistent with what's on disk:
 *   - every id in `expectedRoomIds` has a manifest entry
 *   - every manifest room entry's file path stays inside `roomsDir`
 *   - every manifest room entry's file actually exists on disk
 *
 * Pure filesystem-read validation — does not write anything.  Shared by the
 * post-export consistency check and the standalone `dw:validate-room-cache-files`
 * IPC handler.
 */
function validateRoomCacheOnDisk(roomsDir, manifest, expectedRoomIds) {
  if (manifest === null || typeof manifest.rooms !== "object" || manifest.rooms === null) {
    return { ok: false, error: "No valid manifest found (missing or unparsable manifest.json)" };
  }

  if (expectedRoomIds) {
    for (const roomId of expectedRoomIds) {
      if (!Object.prototype.hasOwnProperty.call(manifest.rooms, roomId)) {
        return { ok: false, error: `Room cache is incomplete: no manifest entry for room "${roomId}"` };
      }
    }
  }

  const normalizedRoomsDir = path.normalize(roomsDir);
  for (const [roomId, entry] of Object.entries(manifest.rooms)) {
    if (typeof roomId !== "string" || !SAFE_ROOM_ID_RE.test(roomId)) {
      // Skip unsafe room IDs — they would also be rejected at load time.
      continue;
    }
    if (!entry || typeof entry.file !== "string") {
      return { ok: false, error: `Room cache is incomplete: manifest entry for "${roomId}" has no file path` };
    }
    // Path traversal protection: reject any file path that escapes the ROOMS dir.
    const roomFilePath = path.normalize(path.join(roomsDir, entry.file));
    if (roomFilePath !== normalizedRoomsDir && !roomFilePath.startsWith(normalizedRoomsDir + path.sep)) {
      return { ok: false, error: `Room cache is incomplete: file path escapes ROOMS directory for "${roomId}"` };
    }
    if (!fs.existsSync(roomFilePath)) {
      return { ok: false, error: `Room cache is incomplete: missing file ROOMS/${entry.file}` };
    }
  }

  return { ok: true };
}

// ── Core export routine ───────────────────────────────────────────────────────

/**
 * Writes a campaign's packed file, individual room-cache files, and the
 * manifest to `campaignDir`. Shared by both the legacy
 * 'dw:save-official-campaign' handler and 'dw:export-campaign-with-progress'.
 *
 * Fails immediately (before any 'complete' signal) if:
 *   - the campaign directory can't be created
 *   - the packed campaign file can't be written
 *   - any required room file can't be written
 *   - the manifest can't be written
 *   - the post-write cache validation fails
 *
 * `onProgress(event)` is called for each step (optional — pass a no-op for
 * callers that don't need streaming progress, e.g. the legacy handler).
 *
 * @returns {{ok:true, campaignDir:string, writtenRooms:number, skippedRooms:number, removedCount:number} |
 *           {ok:false, error:string}}
 */
function exportCampaignToDisk({ campaign, campaignMeta, campaignId, rooms, roomIdFirstIndex, isOfficialCampaign, campaignDir, onProgress }) {
  const notify = typeof onProgress === "function" ? onProgress : () => {};

  const roomsDir = path.join(campaignDir, "ROOMS");
  const backupsDir = path.join(campaignDir, "BACKUPS");

  try {
    fs.mkdirSync(roomsDir, { recursive: true });
  } catch (dirErr) {
    const msg = dirErr instanceof Error ? dirErr.message : String(dirErr);
    const error = `Failed to create campaign directory "${roomsDir}": ${msg}`;
    notify({ step: "error", message: error });
    return { ok: false, error };
  }

  // ── Symlink containment: verify campaign directory resolves to itself ──────
  // This catches symlinks that redirect campaign files outside the allowed root.
  const campaignDirCheck = checkPathInsideCampaignDir(campaignDir, campaignDir, "campaignDir");
  if (!campaignDirCheck.ok) {
    notify({ step: "error", message: campaignDirCheck.error });
    return { ok: false, error: campaignDirCheck.error };
  }

  const campaignHash = computeCampaignHash(campaign);

  // ── Rolling backup of the existing packed campaign file ───────────────────
  const packedFilename = isOfficialCampaign
    ? PACKED_CAMPAIGN_FILENAME
    : `${campaignId}.dwcampaign.json`;
  const packedPath = path.join(campaignDir, packedFilename);
  const backupBaseName = isOfficialCampaign ? OFFICIAL_BACKUP_BASE_NAME : campaignId;

  // Symlink check for packed campaign path before backup and write.
  const packedCheck = checkPathInsideCampaignDir(packedPath, campaignDir, "packed campaign file");
  if (!packedCheck.ok) {
    notify({ step: "error", message: packedCheck.error });
    return { ok: false, error: packedCheck.error };
  }

  ensureRollingBackup(packedPath, backupsDir, backupBaseName, MAX_BACKUPS);

  // ── Write packed campaign file (atomic) ───────────────────────────────────
  notify({ step: "writing-campaign", message: "Writing campaign file…" });
  try {
    writeJsonAtomic(packedPath, campaign);
  } catch (writeErr) {
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    const error = `Failed to write packed campaign file: ${msg}`;
    notify({ step: "error", message: error });
    return { ok: false, error };
  }

  // ── Load existing manifest for selective updates ──────────────────────────
  const existingManifest = tryReadExistingManifest(roomsDir);
  const existingRooms = (
    existingManifest &&
    typeof existingManifest.rooms === "object" &&
    existingManifest.rooms !== null
  )
    ? existingManifest.rooms
    : {};

  // ── Write individual room files (atomic) ───────────────────────────────────
  const nowIso = new Date().toISOString();
  const manifestRooms = {};
  let writtenRooms = 0;
  let skippedRooms = 0;
  const totalRooms = rooms.length;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const roomId = room.id;
    const roomFilename = `${roomId}${ROOM_FILE_SUFFIX}`;
    const roomPath = path.join(roomsDir, roomFilename);
    const roomHash = computeContentHash(room);

    const prev = existingRooms[roomId];
    const hashMatches = !!(prev && typeof prev.hash === "string" && prev.hash === roomHash);
    // Only skip the write if the hash matches AND the file actually exists on
    // disk — otherwise a hash match with a missing file would silently leave
    // the room cache incomplete.
    const isUnchanged = hashMatches && fs.existsSync(roomPath);

    const roomName = (typeof room.name === "string" && room.name.length > 0) ? room.name : roomId;
    notify({
      step: "exporting-room",
      message: `Exporting room ${i + 1} / ${totalRooms}: ${roomName}`,
      roomIndex: i + 1,
      totalRooms,
      roomId,
    });

    if (isUnchanged) {
      skippedRooms += 1;
    } else {
      // Symlink containment: verify room file path resolves inside the ROOMS directory.
      const roomCheck = checkPathInsideCampaignDir(roomPath, roomsDir, `room "${roomId}"`);
      if (!roomCheck.ok) {
        notify({ step: "error", message: roomCheck.error });
        return { ok: false, error: roomCheck.error };
      }
      try {
        writeJsonAtomic(roomPath, room);
      } catch (roomErr) {
        const msg = roomErr instanceof Error ? roomErr.message : String(roomErr);
        const error = `Failed to write room file "${roomFilename}" for room "${roomId}": ${msg}`;
        notify({ step: "error", message: error });
        return { ok: false, error };
      }
      writtenRooms += 1;
    }

    manifestRooms[roomId] = {
      roomId,
      file: roomFilename,
      hash: roomHash,
      updatedAt: isUnchanged ? (prev.updatedAt || nowIso) : nowIso,
    };
  }

  // ── Write enhanced manifest (atomic) ───────────────────────────────────────
  notify({ step: "writing-manifest", message: "Writing room manifest…" });

  const knownRoomIds = new Set(Object.keys(manifestRooms));
  const manifest = {
    campaignId,
    campaignName: campaignMeta.title || campaignId,
    campaignHash,
    campaignVersion: (campaign.metadata && campaign.metadata.version) || 0,
    campaignSchemaVersion: campaign.v,
    roomCacheVersion: ROOM_CACHE_VERSION,
    exportedAt: nowIso,
    rooms: manifestRooms,
    adjacency: buildManifestAdjacency(rooms, knownRoomIds),
  };
  const manifestPath = path.join(roomsDir, "manifest.json");
  try {
    writeJsonAtomic(manifestPath, manifest);
  } catch (manifestErr) {
    const msg = manifestErr instanceof Error ? manifestErr.message : String(manifestErr);
    const error = `Failed to write room cache manifest: ${msg}`;
    notify({ step: "error", message: error });
    return { ok: false, error };
  }

  // ── Remove stale room files ────────────────────────────────────────────────
  notify({ step: "cleaning-stale", message: "Cleaning up stale files…" });

  let removedCount = 0;
  try {
    const existing = fs.readdirSync(roomsDir);
    for (const filename of existing) {
      if (!filename.endsWith(ROOM_FILE_SUFFIX)) continue;
      const candidateId = filename.slice(0, -ROOM_FILE_SUFFIX.length);
      if (!SAFE_ROOM_ID_RE.test(candidateId)) continue;
      if (roomIdFirstIndex.has(candidateId)) continue;
      try {
        const stalePath = path.join(roomsDir, filename);
        // Symlink containment: skip deletion if the stale file resolves outside ROOMS.
        const staleCheck = checkPathInsideCampaignDir(stalePath, roomsDir, `stale file "${filename}"`);
        if (!staleCheck.ok) {
          console.warn(`[campaignExport] Skipping stale cleanup: ${staleCheck.error}`);
          continue;
        }
        fs.unlinkSync(stalePath);
        removedCount += 1;
        console.log(`[campaignExport] Removed stale room file: ${filename}`);
      } catch (unlinkErr) {
        console.warn(`[campaignExport] Could not remove stale file "${filename}":`, unlinkErr);
      }
    }
  } catch (readdirErr) {
    console.warn("[campaignExport] Could not read ROOMS directory for stale cleanup:", readdirErr);
  }

  // ── Validate the on-disk cache before reporting success ────────────────────
  const validation = validateRoomCacheOnDisk(roomsDir, manifest, Array.from(roomIdFirstIndex.keys()));
  if (!validation.ok) {
    const error = `Post-export cache validation failed: ${validation.error}`;
    notify({ step: "error", message: error });
    return { ok: false, error };
  }

  return { ok: true, campaignDir, writtenRooms, skippedRooms, removedCount };
}

module.exports = {
  SAFE_ROOM_ID_RE,
  SAFE_CAMPAIGN_ID_RE,
  ROOM_CACHE_VERSION,
  ROOM_FILE_SUFFIX,
  MAX_BACKUPS,
  OFFICIAL_CAMPAIGN_ID,
  PACKED_CAMPAIGN_FILENAME,
  OFFICIAL_BACKUP_BASE_NAME,
  safeTimestampForFilename,
  writeTextAtomic,
  writeJsonAtomic,
  ensureRollingBackup,
  pruneBackups,
  deterministicStringify,
  computeContentHash,
  computeCampaignHash,
  tryReadExistingManifest,
  buildManifestAdjacency,
  validateRoomCacheOnDisk,
  exportCampaignToDisk,
};
