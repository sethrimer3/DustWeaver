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

function registerPlatformIpcHandlers() {
  const client = loadSteamworks();

  // In-memory fallback state used whenever Steam is unavailable, so unlocks
  // are at least idempotent/visible for the current process lifetime.
  const fallbackUnlocked = new Map();
  const fallbackWorkshopItems = new Map();

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
  ipcMain.handle("dw:workshop-publish", async (_event, { manifest, campaignDir }) => {
    try {
      if (client && client.workshop) {
        const { itemId } = await client.workshop.createItem(0);
        const update = client.workshop.startItemUpdate(0, itemId);
        await client.workshop.submitItemUpdate(update, `Publish ${manifest.title}`);
        const item = {
          steamPublishedFileId: itemId.toString(),
          title: manifest.title,
          description: manifest.description,
          authorName: manifest.authorSteamId,
          tags: manifest.tags,
          subscribed: true,
          installed: true,
          localPath: campaignDir,
        };
        return { ok: true, item };
      }
      const steamPublishedFileId = `fake-${fallbackWorkshopItems.size + 1}`;
      const item = {
        steamPublishedFileId,
        title: manifest.title,
        description: manifest.description,
        authorName: manifest.authorSteamId,
        tags: manifest.tags,
        subscribed: true,
        installed: true,
        localPath: campaignDir,
      };
      fallbackWorkshopItems.set(steamPublishedFileId, item);
      return { ok: true, item };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:workshop-get-items", async () => {
    try {
      if (client && client.workshop) {
        const ids = client.workshop.getSubscribedItems();
        const items = ids.map((itemId) => {
          const info = client.workshop.getItemInstallInfo(itemId);
          return {
            steamPublishedFileId: itemId.toString(),
            title: "",
            description: "",
            authorName: "",
            tags: [],
            subscribed: true,
            installed: info !== null,
            localPath: info ? info.folder : undefined,
          };
        });
        return { ok: true, items };
      }
      return { ok: true, items: Array.from(fallbackWorkshopItems.values()) };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle("dw:workshop-subscribe", async (_event, { steamPublishedFileId }) => {
    try {
      if (client && client.workshop) {
        await client.workshop.subscribeItem(BigInt(steamPublishedFileId));
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
        await client.workshop.unsubscribeItem(BigInt(steamPublishedFileId));
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
        const itemId = BigInt(steamPublishedFileId);
        const info = client.workshop.getItemInstallInfo(itemId);
        return { ok: true, installPath: info ? info.folder : null };
      }
      const item = fallbackWorkshopItems.get(steamPublishedFileId);
      return { ok: true, installPath: item ? item.localPath || null : null };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });
}

module.exports = { registerPlatformIpcHandlers };
