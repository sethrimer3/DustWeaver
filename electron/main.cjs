const { app, BrowserWindow, ipcMain, protocol, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  SAFE_ROOM_ID_RE,
  SAFE_CAMPAIGN_ID_RE,
  OFFICIAL_CAMPAIGN_ID,
  tryReadExistingManifest,
  validateRoomCacheOnDisk,
  exportCampaignToDisk,
} = require("./campaignExport.cjs");
const { registerPlatformIpcHandlers } = require("./platformBridge.cjs");
const { getContentTypeForPath, resolveDistFilePath: resolveDistFilePathPure } = require("./distFilePathResolver.cjs");

registerPlatformIpcHandlers();

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

ipcMain.handle("dw:open-external", async (_event, url) => {
  if (typeof url !== "string") return false;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:") return false;
    await shell.openExternal(parsedUrl.toString());
    return true;
  } catch {
    return false;
  }
});

// ── Safety constants ──────────────────────────────────────────────────────────

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

// ── Static asset serving helpers ──────────────────────────────────────────────
// getContentTypeForPath / resolveDistFilePath now live in distFilePathResolver.cjs
// (a pure module with no Electron dependency) so they can be unit-tested directly.

function resolveDistFilePath(url) {
  return resolveDistFilePathPure(url, __dirname);
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
      const stat = await fs.promises.stat(filePath);
      const rangeHeader = request.headers.get("range");
      let status = 200;
      let data;
      const responseHeaders = {
        "Content-Type": getContentTypeForPath(filePath),
        "Content-Security-Policy": ELECTRON_PROD_CSP,
        "Accept-Ranges": "bytes",
      };

      if (rangeHeader !== null) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (match === null || (match[1] === "" && match[2] === "")) {
          return new Response(null, {
            status: 416,
            headers: { ...responseHeaders, "Content-Range": `bytes */${stat.size}` },
          });
        }

        const requestedStart = match[1] === "" ? Math.max(0, stat.size - Number(match[2])) : Number(match[1]);
        const requestedEnd = match[2] === "" ? stat.size - 1 : Number(match[2]);
        if (!Number.isSafeInteger(requestedStart) || !Number.isSafeInteger(requestedEnd)
            || requestedStart < 0 || requestedStart >= stat.size || requestedEnd < requestedStart) {
          return new Response(null, {
            status: 416,
            headers: { ...responseHeaders, "Content-Range": `bytes */${stat.size}` },
          });
        }

        const end = Math.min(requestedEnd, stat.size - 1);
        const handle = await fs.promises.open(filePath, "r");
        try {
          const buffer = Buffer.alloc(end - requestedStart + 1);
          await handle.read(buffer, 0, buffer.length, requestedStart);
          data = buffer;
        } finally {
          await handle.close();
        }
        status = 206;
        responseHeaders["Content-Range"] = `bytes ${requestedStart}-${end}/${stat.size}`;
      } else {
        data = await fs.promises.readFile(filePath);
      }
      responseHeaders["Content-Length"] = String(data.length);
      return new Response(data, {
        status,
        headers: responseHeaders,
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
ipcMain.handle("dw:save-official-campaign", async (_event, campaign) => {
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

    // ── Delegate to the shared write routine (fails hard on any room or
    // manifest write error — see exportCampaignToDisk in campaignExport.cjs) ──
    const campaignDir = resolveCampaignDir();
    const result = await exportCampaignToDisk({
      campaign,
      campaignMeta,
      campaignId: campaignMeta.id,
      rooms,
      roomIdFirstIndex,
      isOfficialCampaign: true,
      campaignDir,
    });
    if (!result.ok) {
      console.error("[dw:save-official-campaign] Export failed:", result.error);
      return { ok: false, error: result.error };
    }

    console.log(
      `[dw:save-official-campaign] Wrote ${result.writtenRooms} room(s) (${result.skippedRooms} unchanged) ` +
      `+ packed campaign to ${campaignDir}` +
      (result.removedCount > 0 ? ` (removed ${result.removedCount} stale room file(s))` : "")
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
 *   { step: 'cancelled', message }
 *   { step: 'error', message }
 *
 * `opts.exportId`, if provided, registers a cancellation flag that
 * 'dw:cancel-export' can flip. The write loop in exportCampaignToDisk polls
 * it between rooms; see that function's docstring for why a mid-export
 * cancellation is safe (atomic per-room writes, manifest untouched).
 *
 * Returns { ok: true, campaignDir } on success, { ok: false, cancelled: true }
 * if cancelled, or { ok: false, error } on failure.
 */
const activeExportCancelFlags = new Map();

ipcMain.handle("dw:cancel-export", (_event, exportId) => {
  const flag = activeExportCancelFlags.get(exportId);
  if (flag) flag.cancelled = true;
  return { ok: true };
});

ipcMain.handle("dw:export-campaign-with-progress", async (event, campaign, opts) => {
  const sendProgress = (data) => {
    try {
      event.sender.send("dw:export-progress", data);
    } catch {
      // Renderer may have been destroyed; ignore.
    }
  };

  const exportId = opts && opts.exportId;
  const cancelFlag = { cancelled: false };
  if (typeof exportId === "string" && exportId.length > 0) {
    activeExportCancelFlags.set(exportId, cancelFlag);
  }

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

    // ── Delegate to the shared write routine (fails hard on any room or
    // manifest write error, and validates the cache before reporting success —
    // see exportCampaignToDisk in campaignExport.cjs) ──────────────────────
    const result = await exportCampaignToDisk({
      campaign,
      campaignMeta,
      campaignId,
      rooms,
      roomIdFirstIndex,
      isOfficialCampaign,
      campaignDir,
      onProgress: sendProgress,
      isCancelled: () => cancelFlag.cancelled,
    });
    if (!result.ok) {
      // exportCampaignToDisk already sent an 'error' or 'cancelled' progress event.
      return { ok: false, error: result.error, cancelled: !!result.cancelled };
    }

    const { writtenRooms, skippedRooms, removedCount } = result;
    const completeMsg = `Export complete — ${writtenRooms} room(s) written, ${skippedRooms} unchanged` +
      (removedCount > 0 ? `, ${removedCount} stale file(s) removed` : "");
    sendProgress({
      step: "complete",
      message: completeMsg,
      writtenRooms,
      skippedRooms,
    });

    console.log(`[dw:export-campaign-with-progress] ${completeMsg} → ${campaignDir}`);
    return { ok: true, campaignDir, writtenRooms, skippedRooms, removedCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dw:export-campaign-with-progress] Write failed:", message);
    sendProgress({ step: "error", message: `Export failed: ${message}` });
    return { ok: false, error: message };
  } finally {
    if (typeof exportId === "string" && exportId.length > 0) {
      activeExportCancelFlags.delete(exportId);
    }
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
    if (manifest === null) {
      return { ok: false, error: `No valid manifest found for campaign "${campaignId}"` };
    }

    return validateRoomCacheOnDisk(roomsDir, manifest);
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

  // Only open DevTools when explicitly requested (e.g. `npm run electron:dev`),
  // not on every unpackaged launch — otherwise the desktop shortcut (which also
  // runs unpackaged via `npm run desktop`) would pop DevTools on every launch.
  if (process.env.DUSTWEAVER_DEVTOOLS === "1") {
    win.webContents.openDevTools();
  }

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("FAILED TO LOAD:", errorCode, errorDescription, validatedURL);
  });

  win.webContents.on("console-message", (event) => {
    console.log(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
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
