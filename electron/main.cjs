const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "dustweaver",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// ── Safety constants ──────────────────────────────────────────────────────────

/** Only the official campaign ID is allowed through the official write path. */
const OFFICIAL_CAMPAIGN_ID = "DUSTWEAVER_CAMPAIGN";
/** Packed campaign filename for the official campaign. */
const PACKED_CAMPAIGN_FILENAME = "DustweaverCampaign.dwcampaign.json";
/** Base name used for official campaign backup files (no extension). */
const OFFICIAL_BACKUP_BASE_NAME = "DustweaverCampaign";
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
const ELECTRON_APP_ORIGIN = "dustweaver://app";
const ELECTRON_DEV_SERVER_URL =
  process.env.DUSTWEAVER_ELECTRON_DEV_URL ||
  process.env.ELECTRON_RENDERER_URL ||
  process.env.VITE_DEV_SERVER_URL ||
  "";
const IS_ELECTRON_DEV_SERVER = !app.isPackaged && ELECTRON_DEV_SERVER_URL.length > 0;
const ELECTRON_PROD_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");
const ELECTRON_DEV_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
].join("; ");
const ELECTRON_APP_ICON_FILENAME = "Dustweaver_Icon.ico";

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolves the absolute path to the DUSTWEAVER_CAMPAIGN directory.
 *
 * - Dev / unpackaged: writes directly into the project source tree at
 *   <repo>/ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN, using app.getAppPath() to
 *   locate the repo root reliably regardless of how the process was started.
 * - Packaged (asar): the app bundle is read-only, so we use the writable
 *   userData directory instead.
 */
function resolveCampaignDir() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "CAMPAIGNS", OFFICIAL_CAMPAIGN_ID);
  }
  // app.getAppPath() returns the directory containing package.json (repo root).
  return path.join(app.getAppPath(), "ASSETS", "CAMPAIGNS", OFFICIAL_CAMPAIGN_ID);
}

/**
 * Resolves the campaign directory for a custom (non-official) campaign.
 * Writes to userData/CUSTOM_CAMPAIGNS/<safeId>/ regardless of dev/packaged.
 * Path traversal is prevented by validating the ID with SAFE_CAMPAIGN_ID_RE.
 */
function resolveCustomCampaignDir(campaignId) {
  return path.join(app.getPath("userData"), "CUSTOM_CAMPAIGNS", campaignId);
}

function resolveAppIconPath() {
  return path.resolve(app.getAppPath(), "ASSETS", "icon", ELECTRON_APP_ICON_FILENAME);
}

// ── Atomic file write helpers ─────────────────────────────────────────────────

/**
 * Returns an ISO 8601 timestamp string that is safe to embed in a filename.
 * Colons are replaced with hyphens so the result is valid on Windows/macOS.
 * Example: "2026-05-21T03-44-12-123Z"
 *
 * @param {Date} date - The date to format.
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

function getContentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".ttf":
      return "font/ttf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function resolveDistFilePath(url) {
  const distDir = path.join(__dirname, "../dist");
  const parsedUrl = new URL(url);
  const decodedPath = decodeURIComponent(parsedUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(distDir, relativePath));
  const normalizedDistDir = path.normalize(distDir);
  if (filePath !== normalizedDistDir && !filePath.startsWith(normalizedDistDir + path.sep)) {
    return null;
  }
  return filePath;
}

function registerElectronCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = IS_ELECTRON_DEV_SERVER ? ELECTRON_DEV_CSP : ELECTRON_PROD_CSP;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

function registerElectronAppProtocol() {
  protocol.handle("dustweaver", async (request) => {
    const filePath = resolveDistFilePath(request.url);
    if (filePath === null) {
      return new Response("Blocked invalid DustWeaver asset path.", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": ELECTRON_PROD_CSP },
      });
    }
    try {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": getContentTypeForPath(filePath),
          "Content-Security-Policy": ELECTRON_PROD_CSP,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(message, {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": ELECTRON_PROD_CSP },
      });
    }
  });
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
 * Backup filename pattern: `<backupBaseName>_<timestamp>.dwcampaign.json`
 * Example: `DustweaverCampaign_2026-05-21T03-44-12-123Z.dwcampaign.json`
 *
 * Only creates a backup if `packedPath` already exists and is readable.
 * Logs a warning and returns (without throwing) if backup creation fails so
 * the calling export can still proceed.
 */
function ensureRollingBackup(packedPath, backupsDir, backupBaseName, maxBackups) {
  // Only back up if the packed file currently exists.
  let existingText;
  try {
    existingText = fs.readFileSync(packedPath, "utf8");
  } catch {
    return; // No existing file — nothing to back up.
  }

  // Ensure the BACKUPS directory exists.
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

  // Prune excess backups.
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

/**
 * Returns a deterministic JSON serialisation of `value` with sorted object
 * keys.  Arrays preserve their order.  Produces the same string for the same
 * data structure regardless of key insertion order.
 */
/**
 * Deterministic JSON stringify with sorted object keys.
 *
 * NOTE: This is intentionally duplicated from `src/utils/deterministicHash.ts`
 * because main.cjs runs in Node.js (CommonJS) and cannot import the TypeScript
 * source directly.  Both implementations must produce identical output for the
 * same input so hashes stored in manifest.json remain portable across contexts.
 * Keep the two implementations in sync if the algorithm ever changes.
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
 * This is intentionally truncated (not the full 256-bit digest) because the
 * hash is only used for cache invalidation — not cryptographic security.
 * 64 bits is sufficient to detect accidental staleness with negligible
 * collision probability for campaign-sized data.
 *
 * Volatile fields (e.g. `lastEditedIso`, `exportedAt`) must be excluded
 * before passing to this function so the hash is stable across re-exports
 * that did not change any game data.
 *
 * NOTE: The renderer-side equivalent is `computeContentHash` in
 * `src/levels/roomFileLoader.ts`, which uses the Web Crypto API (SubtleCrypto)
 * to compute the same SHA-256 hash.  Both must produce identical hashes for
 * the same input so that manifest validation works across processes.
 * If the algorithm changes here, update roomFileLoader.ts to match.
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
 *
 * @param {Array}         rooms        - Array of SavedRoomV2 room objects from the campaign.
 * @param {Set<string>}   knownRoomIds - Set of room IDs present in manifest.rooms.
 * @returns {Object} adjacency map: { [roomId]: { roomId, targets: string[] } }
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
      // Only include targets that are known rooms in the manifest.
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


// ── IPC handler: dw:save-official-campaign (legacy) ──────────────────────────

/**
 * Handles 'dw:save-official-campaign' (legacy).
 *
 * Retained for backward compatibility.  New code should prefer
 * 'dw:export-campaign-with-progress' which supports progress reporting,
 * content-hash-based selective updates, and custom campaigns.
 *
 * Validates that the payload is a SavedCampaignV1 for the official campaign,
 * then writes:
 *   <campaignDir>/DustweaverCampaign.dwcampaign.json
 *   <campaignDir>/ROOMS/<roomId>_room.json   (one file per room)
 *   <campaignDir>/ROOMS/manifest.json        (enhanced manifest with hashes)
 *
 * Returns { ok: true } on success or { ok: false, error: string } on failure.
 */
ipcMain.handle("dw:save-official-campaign", (_event, campaign) => {
  try {
    // ── Validate top-level shape ───────────────────────────────────────────
    if (
      typeof campaign !== "object" ||
      campaign === null ||
      campaign.v !== 1 ||
      campaign.kind !== "DustWeaverCampaign"
    ) {
      return { ok: false, error: "Payload is not a valid SavedCampaignV1 (missing v:1 or kind)" };
    }

    const campaignMeta = campaign.campaign;
    if (
      typeof campaignMeta !== "object" ||
      campaignMeta === null ||
      campaignMeta.id !== OFFICIAL_CAMPAIGN_ID
    ) {
      return {
        ok: false,
        error: `campaign.id must be "${OFFICIAL_CAMPAIGN_ID}" for the official project write path`,
      };
    }

    const rooms = campaign.rooms;
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return { ok: false, error: '"rooms" must be a non-empty array' };
    }

    // ── Validate room IDs ─────────────────────────────────────────────────
    const roomIds = [];
    /** Maps room id → first-seen index for clearer duplicate error messages. */
    const roomIdFirstIndex = new Map();
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      if (typeof room !== "object" || room === null) {
        return { ok: false, error: `rooms[${i}] is not an object` };
      }
      const id = room.id;
      if (typeof id !== "string" || !SAFE_ROOM_ID_RE.test(id)) {
        return {
          ok: false,
          error: `rooms[${i}].id "${id}" contains unsafe characters — only a-z, A-Z, 0-9, _ and - are allowed`,
        };
      }
      if (roomIdFirstIndex.has(id)) {
        return {
          ok: false,
          error: `Duplicate room id "${id}": first at index ${roomIdFirstIndex.get(id)}, duplicate at index ${i}`,
        };
      }
      roomIdFirstIndex.set(id, i);
      roomIds.push(id);
    }

    // ── Ensure directories exist ──────────────────────────────────────────
    const campaignDir = resolveCampaignDir();
    const roomsDir = path.join(campaignDir, "ROOMS");
    const backupsDir = path.join(campaignDir, "BACKUPS");
    try {
      fs.mkdirSync(roomsDir, { recursive: true });
    } catch (dirErr) {
      const msg = dirErr instanceof Error ? dirErr.message : String(dirErr);
      return { ok: false, error: `Failed to create campaign directory "${roomsDir}": ${msg}` };
    }

    // ── Rolling backup of the existing packed campaign file ───────────────
    // The backup is created BEFORE overwriting the packed file.
    // Only done if the packed file already exists and is readable.
    const packedPath = path.join(campaignDir, PACKED_CAMPAIGN_FILENAME);
    ensureRollingBackup(packedPath, backupsDir, OFFICIAL_BACKUP_BASE_NAME, MAX_BACKUPS);

    // ── Write packed campaign file (atomic) ───────────────────────────────
    try {
      writeJsonAtomic(packedPath, campaign);
    } catch (writeErr) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      return { ok: false, error: `Failed to write packed campaign file: ${msg}` };
    }

    // ── Write individual room files and build enhanced manifest ───────────
    const nowIso = new Date().toISOString();
    const campaignHash = computeCampaignHash(campaign);
    const existingManifest = tryReadExistingManifest(roomsDir);
    const existingRooms = (existingManifest && typeof existingManifest.rooms === "object")
      ? existingManifest.rooms
      : {};

    const manifestRooms = {};
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const roomFilename = `${room.id}${ROOM_FILE_SUFFIX}`;
      const roomPath = path.join(roomsDir, roomFilename);
      const roomHash = computeContentHash(room);

      const prev = existingRooms[room.id];
      const isUnchanged = prev && typeof prev.hash === 'string' && prev.hash === roomHash;
      if (!isUnchanged) {
        try {
          writeJsonAtomic(roomPath, room);
        } catch (roomErr) {
          console.warn(`[dw:save-official-campaign] Failed to write room "${room.id}":`, roomErr);
        }
      }

      manifestRooms[room.id] = {
        roomId: room.id,
        file: roomFilename,
        hash: roomHash,
        updatedAt: isUnchanged ? (prev.updatedAt || nowIso) : nowIso,
      };
    }

    // ── Write enhanced manifest (atomic) ──────────────────────────────────
    const knownRoomIds = new Set(Object.keys(manifestRooms));
    const manifest = {
      campaignId: campaignMeta.id,
      campaignName: campaignMeta.title || campaignMeta.id,
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
      console.warn("[dw:save-official-campaign] Failed to write manifest atomically:", manifestErr);
    }

    // ── Remove stale room files no longer in the manifest ─────────────────
    let removedCount = 0;
    try {
      const existing = fs.readdirSync(roomsDir);
      for (const filename of existing) {
        if (!filename.endsWith(ROOM_FILE_SUFFIX)) continue;
        const candidateId = filename.slice(0, -ROOM_FILE_SUFFIX.length);
        if (!SAFE_ROOM_ID_RE.test(candidateId)) continue;
        if (roomIdFirstIndex.has(candidateId)) continue;
        try {
          fs.unlinkSync(path.join(roomsDir, filename));
          removedCount += 1;
          console.log(`[dw:save-official-campaign] Removed stale room file: ${filename}`);
        } catch (unlinkErr) {
          console.warn(`[dw:save-official-campaign] Could not remove stale file "${filename}":`, unlinkErr);
        }
      }
    } catch (readdirErr) {
      console.warn("[dw:save-official-campaign] Could not read ROOMS directory for stale cleanup:", readdirErr);
    }

    console.log(
      `[dw:save-official-campaign] Wrote ${rooms.length} room(s) + packed campaign to ${campaignDir}` +
      (removedCount > 0 ? ` (removed ${removedCount} stale room file(s))` : "")
    );
    return { ok: true, campaignDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dw:save-official-campaign] Write failed:", message);
    return { ok: false, error: message };
  }
});

// ── IPC handler: dw:export-campaign-with-progress ────────────────────────────

/**
 * Handles 'dw:export-campaign-with-progress'.
 *
 * Writes the campaign file, individual room files, and an enhanced manifest.
 * Streams progress events back to the renderer via 'dw:export-progress' so
 * the editor can show a live progress modal.
 *
 * Supports both the official campaign and custom campaigns:
 *   - Official (isOfficialCampaign: true): writes to resolveCampaignDir().
 *   - Custom: writes to userData/CUSTOM_CAMPAIGNS/<safeId>/.
 *
 * Selective update: each room's content hash is compared against the existing
 * manifest.  Only rooms whose hash changed are rewritten, saving I/O for large
 * campaigns where only a few rooms were edited.
 *
 * Progress events (sent via event.sender.send('dw:export-progress', ...)):
 *   { step: 'serializing', message }
 *   { step: 'writing-campaign', message }
 *   { step: 'exporting-room', roomIndex, totalRooms, roomId, message }
 *   { step: 'writing-manifest', message }
 *   { step: 'cleaning-stale', message }
 *   { step: 'complete', message, writtenRooms, skippedRooms }
 *   { step: 'error', message }
 *
 * Returns { ok: true, campaignDir } on success or { ok: false, error } on failure.
 */
ipcMain.handle("dw:export-campaign-with-progress", (event, campaign, opts) => {
  const sendProgress = (data) => {
    try {
      event.sender.send("dw:export-progress", data);
    } catch {
      // Renderer may have been destroyed; ignore.
    }
  };

  try {
    // ── Validate top-level shape ───────────────────────────────────────────
    if (
      typeof campaign !== "object" ||
      campaign === null ||
      campaign.v !== 1 ||
      campaign.kind !== "DustWeaverCampaign"
    ) {
      const error = "Payload is not a valid SavedCampaignV1 (missing v:1 or kind)";
      sendProgress({ step: "error", message: error });
      return { ok: false, error };
    }

    const campaignMeta = campaign.campaign;
    if (typeof campaignMeta !== "object" || campaignMeta === null) {
      const error = "campaign.campaign metadata is missing or invalid";
      sendProgress({ step: "error", message: error });
      return { ok: false, error };
    }

    const campaignId = campaignMeta.id;
    if (typeof campaignId !== "string" || !SAFE_CAMPAIGN_ID_RE.test(campaignId)) {
      const error = `campaign.id "${campaignId}" contains unsafe characters`;
      sendProgress({ step: "error", message: error });
      return { ok: false, error };
    }

    const isOfficialCampaign = !!(opts && opts.isOfficialCampaign);

    const rooms = campaign.rooms;
    if (!Array.isArray(rooms) || rooms.length === 0) {
      const error = '"rooms" must be a non-empty array';
      sendProgress({ step: "error", message: error });
      return { ok: false, error };
    }

    // ── Validate all room IDs before writing anything ─────────────────────
    const roomIdFirstIndex = new Map();
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      if (typeof room !== "object" || room === null) {
        const error = `rooms[${i}] is not an object`;
        sendProgress({ step: "error", message: error });
        return { ok: false, error };
      }
      const id = room.id;
      if (typeof id !== "string" || !SAFE_ROOM_ID_RE.test(id)) {
        const error = `rooms[${i}].id "${id}" contains unsafe characters`;
        sendProgress({ step: "error", message: error });
        return { ok: false, error };
      }
      if (roomIdFirstIndex.has(id)) {
        const error = `Duplicate room id "${id}" at index ${i} (first at ${roomIdFirstIndex.get(id)})`;
        sendProgress({ step: "error", message: error });
        return { ok: false, error };
      }
      roomIdFirstIndex.set(id, i);
    }

    // ── Resolve directories ───────────────────────────────────────────────
    sendProgress({ step: "serializing", message: "Serializing campaign…" });

    const campaignDir = isOfficialCampaign
      ? resolveCampaignDir()
      : resolveCustomCampaignDir(campaignId);
    const roomsDir = path.join(campaignDir, "ROOMS");
    const backupsDir = path.join(campaignDir, "BACKUPS");

    try {
      fs.mkdirSync(roomsDir, { recursive: true });
    } catch (dirErr) {
      const msg = dirErr instanceof Error ? dirErr.message : String(dirErr);
      const error = `Failed to create campaign directory "${roomsDir}": ${msg}`;
      sendProgress({ step: "error", message: error });
      return { ok: false, error };
    }

    // ── Compute campaign hash ─────────────────────────────────────────────
    const campaignHash = computeCampaignHash(campaign);

    // ── Rolling backup of the existing packed campaign file ───────────────
    // Back up BEFORE overwriting.  Only runs if the file already exists.
    const packedFilename = isOfficialCampaign
      ? PACKED_CAMPAIGN_FILENAME
      : `${campaignId}.dwcampaign.json`;
    const packedPath = path.join(campaignDir, packedFilename);
    const backupBaseName = isOfficialCampaign ? OFFICIAL_BACKUP_BASE_NAME : campaignId;
    ensureRollingBackup(packedPath, backupsDir, backupBaseName, MAX_BACKUPS);

    // ── Write packed campaign file (atomic) ───────────────────────────────
    sendProgress({ step: "writing-campaign", message: "Writing campaign file…" });

    try {
      writeJsonAtomic(packedPath, campaign);
    } catch (writeErr) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      const error = `Failed to write packed campaign file: ${msg}`;
      sendProgress({ step: "error", message: error });
      return { ok: false, error };
    }

    // ── Load existing manifest for selective updates ───────────────────────
    const existingManifest = tryReadExistingManifest(roomsDir);
    const existingRooms = (
      existingManifest &&
      typeof existingManifest.rooms === "object" &&
      existingManifest.rooms !== null
    )
      ? existingManifest.rooms
      : {};

    // ── Write individual room files (atomic) ──────────────────────────────
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
      const isUnchanged = prev && typeof prev.hash === "string" && prev.hash === roomHash;

      const roomName = (typeof room.name === "string" && room.name.length > 0) ? room.name : roomId;
      sendProgress({
        step: "exporting-room",
        message: `Exporting room ${i + 1} / ${totalRooms}: ${roomName}`,
        roomIndex: i + 1,
        totalRooms,
        roomId,
      });

      if (isUnchanged) {
        skippedRooms += 1;
      } else {
        try {
          writeJsonAtomic(roomPath, room);
        } catch (roomErr) {
          console.warn(`[dw:export-campaign-with-progress] Failed to write room "${roomId}":`, roomErr);
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

    // ── Write enhanced manifest (atomic) ──────────────────────────────────
    sendProgress({ step: "writing-manifest", message: "Writing room manifest…" });

    const knownRoomIds = new Set(Object.keys(manifestRooms));
    const manifest = {
      campaignId,
      campaignName: campaignMeta.title || campaignId,
      campaignHash,
      // campaignVersion is a convenience diagnostic; campaignHash is the
      // authoritative stale-cache check.  See roomCacheManifest.ts for details.
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
      console.warn("[dw:export-campaign-with-progress] Failed to write manifest atomically:", manifestErr);
    }

    // ── Remove stale room files ───────────────────────────────────────────
    sendProgress({ step: "cleaning-stale", message: "Cleaning up stale files…" });

    let removedCount = 0;
    try {
      const existing = fs.readdirSync(roomsDir);
      for (const filename of existing) {
        if (!filename.endsWith(ROOM_FILE_SUFFIX)) continue;
        const candidateId = filename.slice(0, -ROOM_FILE_SUFFIX.length);
        if (!SAFE_ROOM_ID_RE.test(candidateId)) continue;
        if (roomIdFirstIndex.has(candidateId)) continue;
        try {
          fs.unlinkSync(path.join(roomsDir, filename));
          removedCount += 1;
          console.log(`[dw:export-campaign-with-progress] Removed stale room file: ${filename}`);
        } catch (unlinkErr) {
          console.warn(`[dw:export-campaign-with-progress] Could not remove stale file "${filename}":`, unlinkErr);
        }
      }
    } catch (readdirErr) {
      console.warn("[dw:export-campaign-with-progress] Could not read ROOMS directory for stale cleanup:", readdirErr);
    }

    const completeMsg = `Export complete — ${writtenRooms} room(s) written, ${skippedRooms} unchanged` +
      (removedCount > 0 ? `, ${removedCount} stale file(s) removed` : "");
    sendProgress({
      step: "complete",
      message: completeMsg,
      writtenRooms,
      skippedRooms,
    });

    console.log(`[dw:export-campaign-with-progress] ${completeMsg} → ${campaignDir}`);
    return { ok: true, campaignDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dw:export-campaign-with-progress] Write failed:", message);
    sendProgress({ step: "error", message: `Export failed: ${message}` });
    return { ok: false, error: message };
  }
});

// ── IPC handler: dw:validate-room-cache-files ────────────────────────────────

/**
 * Handles 'dw:validate-room-cache-files'.
 *
 * Reads the manifest for the given campaign and verifies that every room file
 * listed in `manifest.rooms` actually exists on disk.  This prevents missing
 * room files from causing delayed runtime failures during lazy loading.
 *
 * Path traversal is prevented by validating campaignId and each room file
 * path against their respective safe regexes.
 *
 * Returns { ok: true } if all files exist, or { ok: false, error } if any
 * file is missing or a validation error occurs.
 */
ipcMain.handle("dw:validate-room-cache-files", (_event, campaignId, isOfficialCampaign) => {
  try {
    if (typeof campaignId !== "string" || !SAFE_CAMPAIGN_ID_RE.test(campaignId)) {
      return { ok: false, error: `Unsafe campaign ID: "${campaignId}"` };
    }
    const campaignDir = isOfficialCampaign
      ? resolveCampaignDir()
      : resolveCustomCampaignDir(campaignId);
    const roomsDir = path.join(campaignDir, "ROOMS");

    const manifest = tryReadExistingManifest(roomsDir);
    if (manifest === null || typeof manifest.rooms !== "object" || manifest.rooms === null) {
      return { ok: false, error: `No valid manifest found for campaign "${campaignId}"` };
    }

    for (const [roomId, entry] of Object.entries(manifest.rooms)) {
      if (typeof roomId !== "string" || !SAFE_ROOM_ID_RE.test(roomId)) {
        // Skip unsafe room IDs — they would also be rejected at load time.
        continue;
      }
      if (typeof entry.file !== "string") {
        return {
          ok: false,
          error: `Room cache is incomplete: manifest entry for "${roomId}" has no file path`,
        };
      }
      // Path traversal protection: reject any file path that escapes the ROOMS dir.
      const roomFilePath = path.join(roomsDir, entry.file);
      if (!roomFilePath.startsWith(roomsDir + path.sep)) {
        return {
          ok: false,
          error: `Room cache is incomplete: file path escapes ROOMS directory for "${roomId}"`,
        };
      }
      if (!fs.existsSync(roomFilePath)) {
        return {
          ok: false,
          error: `Room cache is incomplete: missing file ROOMS/${entry.file}`,
        };
      }
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

// ── IPC handler: dw:read-room-cache-manifest ─────────────────────────────────

/**
 * Handles 'dw:read-room-cache-manifest'.
 *
 * Reads the manifest.json from an already-exported campaign's ROOMS directory.
 * Used by the runtime to validate whether the room cache is still fresh.
 *
 * Returns { ok: true, manifest } on success or { ok: false, error } on failure.
 */
ipcMain.handle("dw:read-room-cache-manifest", (_event, campaignId, isOfficialCampaign) => {
  try {
    if (typeof campaignId !== "string" || !SAFE_CAMPAIGN_ID_RE.test(campaignId)) {
      return { ok: false, error: `Unsafe campaign ID: "${campaignId}"` };
    }
    const campaignDir = isOfficialCampaign
      ? resolveCampaignDir()
      : resolveCustomCampaignDir(campaignId);
    const manifestPath = path.join(campaignDir, "ROOMS", "manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    return { ok: true, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

// ── IPC handler: dw:read-room-file ───────────────────────────────────────────

/**
 * Handles 'dw:read-room-file'.
 *
 * Reads a single derived room JSON file from an already-exported campaign's
 * ROOMS directory.  Used by the renderer to load room data from the file
 * cache during gameplay, preferring derived files over reparsing the full
 * packed campaign.
 *
 * Security: campaignId and roomId are validated against their respective safe
 * regexes before being used in filesystem paths to prevent path traversal.
 *
 * Returns { ok: true, roomData, expectedHash } on success or
 *         { ok: false, error } on failure.
 */
ipcMain.handle("dw:read-room-file", (_event, campaignId, roomId, isOfficialCampaign) => {
  try {
    if (typeof campaignId !== "string" || !SAFE_CAMPAIGN_ID_RE.test(campaignId)) {
      return { ok: false, error: `Unsafe campaign ID: "${campaignId}"` };
    }
    if (typeof roomId !== "string" || !SAFE_ROOM_ID_RE.test(roomId)) {
      return { ok: false, error: `Unsafe room ID: "${roomId}"` };
    }
    const campaignDir = isOfficialCampaign
      ? resolveCampaignDir()
      : resolveCustomCampaignDir(campaignId);
    const roomsDir = path.join(campaignDir, "ROOMS");

    // Read manifest to find the file path and expected hash for this room.
    const manifest = tryReadExistingManifest(roomsDir);
    if (manifest === null || typeof manifest.rooms !== "object" || manifest.rooms === null) {
      return { ok: false, error: `No valid manifest found for campaign "${campaignId}"` };
    }
    const entry = manifest.rooms[roomId];
    if (entry === undefined || typeof entry.file !== "string") {
      return { ok: false, error: `Room "${roomId}" not found in manifest for campaign "${campaignId}"` };
    }

    // Reject any path that escapes the ROOMS directory.
    const roomFilePath = path.join(roomsDir, entry.file);
    if (!roomFilePath.startsWith(roomsDir + path.sep)) {
      return { ok: false, error: `Room file path escapes ROOMS directory: "${entry.file}"` };
    }

    const raw = fs.readFileSync(roomFilePath, "utf8");
    const roomData = JSON.parse(raw);
    return { ok: true, roomData, expectedHash: entry.hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

// ── IPC handler: dw:read-all-room-files ──────────────────────────────────────

/**
 * Handles 'dw:read-all-room-files'.
 *
 * Reads ALL derived room JSON files for a campaign in a single IPC call,
 * returning them as an array.  Used at gameplay startup to populate
 * ROOM_REGISTRY from the file cache without making N separate IPC calls.
 *
 * Each element in the `rooms` array is { roomId, data, expectedHash }.
 * Any room file that cannot be read is skipped with a console warning.
 *
 * Returns { ok: true, rooms, manifest } on success or { ok: false, error }.
 */
ipcMain.handle("dw:read-all-room-files", (_event, campaignId, isOfficialCampaign) => {
  try {
    if (typeof campaignId !== "string" || !SAFE_CAMPAIGN_ID_RE.test(campaignId)) {
      return { ok: false, error: `Unsafe campaign ID: "${campaignId}"` };
    }
    const campaignDir = isOfficialCampaign
      ? resolveCampaignDir()
      : resolveCustomCampaignDir(campaignId);
    const roomsDir = path.join(campaignDir, "ROOMS");

    const manifest = tryReadExistingManifest(roomsDir);
    if (manifest === null || typeof manifest.rooms !== "object" || manifest.rooms === null) {
      return { ok: false, error: `No valid manifest found for campaign "${campaignId}"` };
    }

    const rooms = [];
    for (const [roomId, entry] of Object.entries(manifest.rooms)) {
      if (typeof roomId !== "string" || !SAFE_ROOM_ID_RE.test(roomId)) {
        console.warn(`[dw:read-all-room-files] Skipping unsafe room ID: "${roomId}"`);
        continue;
      }
      if (typeof entry.file !== "string") {
        console.warn(`[dw:read-all-room-files] Skipping room "${roomId}": missing file path`);
        continue;
      }
      const roomFilePath = path.join(roomsDir, entry.file);
      if (!roomFilePath.startsWith(roomsDir + path.sep)) {
        console.warn(`[dw:read-all-room-files] Skipping room "${roomId}": path escapes ROOMS dir`);
        continue;
      }
      try {
        const raw = fs.readFileSync(roomFilePath, "utf8");
        const data = JSON.parse(raw);
        rooms.push({ roomId, data, expectedHash: entry.hash });
      } catch (fileErr) {
        const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
        console.warn(`[dw:read-all-room-files] Skipping room "${roomId}": ${msg}`);
      }
    }
    return { ok: true, rooms, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

// ── Window factory ────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    icon: resolveAppIconPath(),
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"),
    }
  });

  // Only open DevTools in development; packaged builds ship without them.
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("FAILED TO LOAD:", errorCode, errorDescription, validatedURL);
  });

  if (IS_ELECTRON_DEV_SERVER) {
    win.loadURL(ELECTRON_DEV_SERVER_URL);
  } else {
    win.loadURL(`${ELECTRON_APP_ORIGIN}/index.html`);
  }
}

app.whenReady().then(() => {
  registerElectronCsp();
  registerElectronAppProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
