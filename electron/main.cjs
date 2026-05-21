const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// ── Safety constants ──────────────────────────────────────────────────────────

/** Only the official campaign ID is allowed through this IPC channel. */
const OFFICIAL_CAMPAIGN_ID = "DUSTWEAVER_CAMPAIGN";
/** Packed campaign filename written into the campaign directory. */
const PACKED_CAMPAIGN_FILENAME = "DustweaverCampaign.dwcampaign.json";
/** Regex for safe room IDs — letters, digits, underscores, hyphens only. */
const SAFE_ROOM_ID_RE = /^[a-zA-Z0-9_-]+$/;

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolves the absolute path to the DUSTWEAVER_CAMPAIGN directory.
 *
 * - Dev / unpackaged: writes directly into the project source tree at
 *   <repo>/ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN.
 * - Packaged (asar): the app bundle is read-only, so we use the writable
 *   userData directory instead.
 */
function resolveCampaignDir() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "CAMPAIGNS", OFFICIAL_CAMPAIGN_ID);
  }
  // __dirname is <repo>/electron — go up one level to reach the repo root.
  return path.resolve(__dirname, "..", "ASSETS", "CAMPAIGNS", OFFICIAL_CAMPAIGN_ID);
}

// ── IPC handler ───────────────────────────────────────────────────────────────

/**
 * Handles 'dw:save-official-campaign'.
 *
 * Validates that the payload is a SavedCampaignV1 for the official campaign,
 * then writes:
 *   <campaignDir>/DustweaverCampaign.dwcampaign.json
 *   <campaignDir>/ROOMS/<roomId>_room.json   (one file per room)
 *   <campaignDir>/ROOMS/manifest.json        (array of room IDs)
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
      roomIds.push(id);
    }

    // ── Ensure directories exist ──────────────────────────────────────────
    const campaignDir = resolveCampaignDir();
    const roomsDir = path.join(campaignDir, "ROOMS");
    fs.mkdirSync(roomsDir, { recursive: true });

    // ── Write packed campaign file ────────────────────────────────────────
    const packedPath = path.join(campaignDir, PACKED_CAMPAIGN_FILENAME);
    fs.writeFileSync(packedPath, JSON.stringify(campaign, null, 2), "utf8");

    // ── Write individual room files ───────────────────────────────────────
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const roomFilename = `${room.id}_room.json`;
      const roomPath = path.join(roomsDir, roomFilename);
      fs.writeFileSync(roomPath, JSON.stringify(room, null, 2), "utf8");
    }

    // ── Write room manifest ───────────────────────────────────────────────
    const manifestPath = path.join(roomsDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(roomIds, null, 2), "utf8");

    console.log(
      `[dw:save-official-campaign] Wrote ${rooms.length} room(s) + packed campaign to ${campaignDir}`
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dw:save-official-campaign] Write failed:", message);
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

  win.webContents.openDevTools();

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