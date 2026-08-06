/**
 * Main-process Steam platform + Workshop bridge.
 *
 * Registers ipcMain handlers for the achievement and Workshop IPC channels
 * (channel names mirror src/platform/ipcBridge.ts — kept as string literals
 * here since this file runs unbundled and cannot import the TS module).
 *
 * `steamworks.js` is required lazily and wrapped in try/catch: if it is
 * missing or a Steam client is not running, every handler degrades to a
 * safe no-op/in-memory response instead of throwing.
 */
const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const workshopUgc = require("./workshopUgc.cjs");

/**
 * Steam App ID used for UGC calls. `steamworks.js` infers it from the running
 * Steam context, but `createItem`/`updateItem` still take it explicitly — the
 * previous hardcoded `0` would have created items under no app at all.
 */
function getSteamAppId() {
  const raw = process.env.DUSTWEAVER_STEAM_APP_ID;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const ACHIEVEMENT_IDS = [
  "FIRST_WEAVE",
  "FIRST_CLEAR",
  "STORMWEAVE_MASTER",
  "DUSTWEAVER_COMPLETE",
  "SPEED_RUNNER",
  "NO_HIT_ROOM",
  "MOTE_HOARDER",
  "ICE_FREEZE_CHAIN",
  "WORKSHOP_AUTHOR",
  "WORKSHOP_SUBSCRIBER",
];

function loadSteamworks() {
  try {
    const steamworks = require("steamworks.js");
    const appId = process.env.DUSTWEAVER_STEAM_APP_ID
      ? Number(process.env.DUSTWEAVER_STEAM_APP_ID)
      : undefined;
    return appId !== undefined ? steamworks.init(appId) : steamworks.init();
  } catch {
    return null;
  }
}

/**
 * Where locally "published" packages land when no Steam client is present, so
 * authors can still exercise the full publish → list → play path in a plain
 * dev build. Never used when Steam is available.
 */
function fallbackWorkshopRoot() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "WORKSHOP_LOCAL");
}

/** Re-reads locally staged packages so they survive an app restart. */
function loadFallbackWorkshopItems() {
  const items = new Map();
  let root;
  try {
    root = fallbackWorkshopRoot();
    if (!fs.existsSync(root)) return items;
  } catch {
    return items;
  }
  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry);
    const metaPath = path.join(dir, "workshop-meta.json");
    try {
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      items.set(entry, {
        steamPublishedFileId: entry,
        title: meta.title || entry,
        description: meta.description || "",
        authorName: meta.authorSteamId || "",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        subscribed: true,
        installed: true,
        localPath: dir,
      });
    } catch {
      // Skip unreadable/partial directories rather than failing startup.
    }
  }
  return items;
}

function registerPlatformIpcHandlers() {
  const client = loadSteamworks();

  // In-memory fallback state used whenever Steam is unavailable, so unlocks
  // are at least idempotent/visible for the current process lifetime.
  const fallbackUnlocked = new Map();
  const fallbackWorkshopItems = client ? new Map() : loadFallbackWorkshopItems();

  ipcMain.handle("dw:platform-unlock-achievement", async (_event, { id }) => {
    try {
      if (client) {
        client.achievement.activate(id);
      } else if (!fallbackUnlocked.has(id)) {
        fallbackUnlocked.set(id, Date.now());
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:platform-get-achievement", async (_event, { id }) => {
    try {
      const unlocked = client ? client.achievement.isActivated(id) : fallbackUnlocked.has(id);
      return { ok: true, status: { id, unlocked } };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:platform-get-all-achievements", async () => {
    try {
      const statuses = ACHIEVEMENT_IDS.map((id) => ({
        id,
        unlocked: client ? client.achievement.isActivated(id) : fallbackUnlocked.has(id),
      }));
      return { ok: true, statuses };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:platform-store-stats", async () => {
    return { ok: true };
  });

  ipcMain.handle("dw:platform-get-persona-name", async () => {
    try {
      return { ok: true, personaName: client ? client.localplayer.getName() : null };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  // ── Workshop ──────────────────────────────────────────────────────────
  ipcMain.handle("dw:workshop-publish", async (_event, input) => {
    try {
      if (client && client.workshop) {
        const result = await workshopUgc.publishItem(client, getSteamAppId(), input);
        return { ok: true, item: result.item, needsToAcceptAgreement: result.needsToAcceptAgreement };
      }

      // No Steam client: stage the package into userData anyway so the
      // publish → list → play round trip is exercisable in plain dev builds.
      const { manifest, campaign, existingPublishedFileId, previewImageDataUrl } = input;
      const steamPublishedFileId =
        existingPublishedFileId || `local-${manifest.campaignId}`;
      const localRoot = path.join(fallbackWorkshopRoot(), steamPublishedFileId);
      fs.rmSync(localRoot, { recursive: true, force: true });
      fs.mkdirSync(localRoot, { recursive: true });
      const staged = workshopUgc.stageCampaignPackage(manifest, campaign, previewImageDataUrl);
      for (const entry of fs.readdirSync(staged.contentPath)) {
        fs.copyFileSync(path.join(staged.contentPath, entry), path.join(localRoot, entry));
      }
      workshopUgc.cleanupStagedPackage(staged.contentPath);

      const item = {
        steamPublishedFileId,
        title: manifest.title,
        description: manifest.description,
        authorName: manifest.authorSteamId,
        tags: manifest.tags,
        subscribed: true,
        installed: true,
        localPath: localRoot,
      };
      fallbackWorkshopItems.set(steamPublishedFileId, item);
      return { ok: true, item, needsToAcceptAgreement: false };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:workshop-get-items", async () => {
    try {
      if (client && client.workshop) {
        return { ok: true, items: await workshopUgc.listSubscribedItems(client) };
      }
      return { ok: true, items: Array.from(fallbackWorkshopItems.values()) };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  // Asks Steam to fetch the item and waits until it is installed on disk,
  // returning the install path. `dw:workshop-install-path` only reports what is
  // already there; this is the channel that actually triggers a download.
  ipcMain.handle("dw:workshop-download", async (_event, { steamPublishedFileId }) => {
    try {
      if (client && client.workshop) {
        const installPath = await workshopUgc.downloadAndWait(client, steamPublishedFileId);
        return { ok: true, installPath };
      }
      const item = fallbackWorkshopItems.get(steamPublishedFileId);
      if (!item || !item.localPath) {
        return { ok: false, error: `Workshop item ${steamPublishedFileId} is not available offline` };
      }
      item.installed = true;
      return { ok: true, installPath: item.localPath };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:workshop-subscribe", async (_event, { steamPublishedFileId }) => {
    try {
      if (client && client.workshop) {
        await workshopUgc.resolveWorkshopApi(client).subscribe(BigInt(steamPublishedFileId));
      } else {
        const item = fallbackWorkshopItems.get(steamPublishedFileId);
        if (item) item.subscribed = true;
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:workshop-unsubscribe", async (_event, { steamPublishedFileId }) => {
    try {
      if (client && client.workshop) {
        await workshopUgc.resolveWorkshopApi(client).unsubscribe(BigInt(steamPublishedFileId));
      } else {
        const item = fallbackWorkshopItems.get(steamPublishedFileId);
        if (item) item.subscribed = false;
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:workshop-install-path", async (_event, { steamPublishedFileId }) => {
    try {
      if (client && client.workshop) {
        const api = workshopUgc.resolveWorkshopApi(client);
        const info = api.installInfo ? api.installInfo(BigInt(steamPublishedFileId)) : null;
        return { ok: true, installPath: info ? info.folder : null };
      }
      const item = fallbackWorkshopItems.get(steamPublishedFileId);
      return { ok: true, installPath: item ? item.localPath || null : null };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  // Reads an installed Workshop package's workshop-meta.json + *.dwcampaign.json
  // + a full file listing (for src/workshop/packageValidator.ts) from disk.
  // Mirrors src/workshop/steamWorkshopAdapter.ts::readInstalledWorkshopPackageFromDisk
  // — duplicated here (like every other Workshop handler in this file) because
  // this module runs unbundled and cannot import the TS module.
  ipcMain.handle("dw:workshop-read-package", async (_event, { localPath }) => {
    try {
      let resolvedRoot;
      try {
        resolvedRoot = fs.realpathSync(path.resolve(localPath));
      } catch {
        return { ok: false, error: `Workshop install directory not found: "${localPath}"` };
      }
      if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        return { ok: false, error: `Workshop install directory not found: "${localPath}"` };
      }

      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, entry);
          // Resolve symlinks and verify the real path never escapes the
          // installed package root before trusting its stat/contents.
          const realFullPath = fs.realpathSync(fullPath);
          if (!(realFullPath === resolvedRoot || realFullPath.startsWith(resolvedRoot + path.sep))) {
            continue;
          }
          const stat = fs.statSync(realFullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (stat.isFile()) {
            const relPath = path.relative(resolvedRoot, fullPath).split(path.sep).join("/");
            files.push({ path: relPath, sizeBytes: stat.size });
          }
        }
      };
      walk(resolvedRoot);

      const manifestFile = files.find((f) => f.path === "workshop-meta.json");
      if (!manifestFile) {
        return { ok: false, error: `Workshop package at "${localPath}" is missing workshop-meta.json` };
      }
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(resolvedRoot, "workshop-meta.json"), "utf8"));
      } catch (err) {
        return { ok: false, error: `Workshop package at "${localPath}" has an invalid workshop-meta.json: ${String(err && err.message ? err.message : err)}` };
      }

      const campaignFiles = files.filter((f) => f.path.toLowerCase().endsWith(".dwcampaign.json"));
      if (campaignFiles.length === 0) {
        return { ok: false, error: `Workshop package at "${localPath}" contains no .dwcampaign.json file` };
      }
      let campaignData;
      try {
        campaignData = JSON.parse(fs.readFileSync(path.join(resolvedRoot, campaignFiles[0].path), "utf8"));
      } catch (err) {
        return { ok: false, error: `Workshop package at "${localPath}" has an invalid campaign file: ${String(err && err.message ? err.message : err)}` };
      }

      return { ok: true, manifest, campaignData, files };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });
}

module.exports = { registerPlatformIpcHandlers };
