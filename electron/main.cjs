const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ── Safety constants ──────────────────────────────────────────────────────────

/** Only the official campaign ID is allowed through the official write path. */
const OFFICIAL_CAMPAIGN_ID = "DUSTWEAVER_CAMPAIGN";
/** Packed campaign filename for the official campaign. */
const PACKED_CAMPAIGN_FILENAME = "DustweaverCampaign.dwcampaign.json";
/** Regex for safe room IDs — letters, digits, underscores, hyphens only. */
const SAFE_ROOM_ID_RE = /^[a-zA-Z0-9_-]+$/;
/** Regex for a safe campaign ID used in filesystem paths. */
const SAFE_CAMPAIGN_ID_RE = /^[a-zA-Z0-9_-]+$/;
/** Version of the room cache manifest format written by this code. */
const ROOM_CACHE_VERSION = 1;
/** Suffix used for individual room cache files. */
const ROOM_FILE_SUFFIX = "_room.json";

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

// ── Deterministic hash ────────────────────────────────────────────────────────

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
    try {
      fs.mkdirSync(roomsDir, { recursive: true });
    } catch (dirErr) {
      const msg = dirErr instanceof Error ? dirErr.message : String(dirErr);
      return { ok: false, error: `Failed to create campaign directory "${roomsDir}": ${msg}` };
    }

    // ── Write packed campaign file ────────────────────────────────────────
    const packedPath = path.join(campaignDir, PACKED_CAMPAIGN_FILENAME);
    fs.writeFileSync(packedPath, JSON.stringify(campaign, null, 2), "utf8");

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
        fs.writeFileSync(roomPath, JSON.stringify(room, null, 2), "utf8");
      }

      manifestRooms[room.id] = {
        roomId: room.id,
        file: roomFilename,
        hash: roomHash,
        updatedAt: isUnchanged ? (prev.updatedAt || nowIso) : nowIso,
      };
    }

    // ── Write enhanced manifest ───────────────────────────────────────────
    const manifest = {
      campaignId: campaignMeta.id,
      campaignName: campaignMeta.title || campaignMeta.id,
      campaignHash,
      campaignVersion: (campaign.metadata && campaign.metadata.version) || 0,
      campaignSchemaVersion: campaign.v,
      roomCacheVersion: ROOM_CACHE_VERSION,
      exportedAt: nowIso,
      rooms: manifestRooms,
    };
    const manifestPath = path.join(roomsDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

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

    // ── Write packed campaign file ────────────────────────────────────────
    sendProgress({ step: "writing-campaign", message: "Writing campaign file…" });

    const packedFilename = isOfficialCampaign
      ? PACKED_CAMPAIGN_FILENAME
      : `${campaignId}.dwcampaign.json`;
    const packedPath = path.join(campaignDir, packedFilename);
    fs.writeFileSync(packedPath, JSON.stringify(campaign, null, 2), "utf8");

    // ── Load existing manifest for selective updates ───────────────────────
    const existingManifest = tryReadExistingManifest(roomsDir);
    const existingRooms = (
      existingManifest &&
      typeof existingManifest.rooms === "object" &&
      existingManifest.rooms !== null
    )
      ? existingManifest.rooms
      : {};

    // ── Write individual room files ───────────────────────────────────────
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
        fs.writeFileSync(roomPath, JSON.stringify(room, null, 2), "utf8");
        writtenRooms += 1;
      }

      manifestRooms[roomId] = {
        roomId,
        file: roomFilename,
        hash: roomHash,
        updatedAt: isUnchanged ? (prev.updatedAt || nowIso) : nowIso,
      };
    }

    // ── Write enhanced manifest ───────────────────────────────────────────
    sendProgress({ step: "writing-manifest", message: "Writing room manifest…" });

    const manifest = {
      campaignId,
      campaignName: campaignMeta.title || campaignId,
      campaignHash,
      campaignVersion: (campaign.metadata && campaign.metadata.version) || 0,
      campaignSchemaVersion: campaign.v,
      roomCacheVersion: ROOM_CACHE_VERSION,
      exportedAt: nowIso,
      rooms: manifestRooms,
    };
    const manifestPath = path.join(roomsDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

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

// ── Window factory ────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
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

  win.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});