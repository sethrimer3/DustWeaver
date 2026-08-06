/**
 * workshopUgc.cjs — real Steam UGC (Workshop) operations for the main process.
 *
 * This is the SINGLE source of truth for talking to `steamworks.js`'s workshop
 * API. `platformBridge.cjs` owns the ipcMain handlers and delegates the actual
 * Steam work here; nothing else in the repo may call the native module.
 *
 * Two things this module deliberately does that the previous scaffolding did
 * not:
 *
 *  1. **Stages content before uploading.** Steam uploads a *directory*, so a
 *     campaign is first written to a temp folder as `workshop-meta.json` plus
 *     `<campaignId>.dwcampaign.json` (the exact layout
 *     `readInstalledWorkshopPackageFromDisk` expects on the way back down).
 *     Publishing without a content path produces an empty Workshop item, which
 *     is what the earlier code did.
 *
 *  2. **Normalizes the native API surface.** `steamworks.js` has renamed these
 *     methods across versions (`download`/`downloadItem`, `installInfo`/
 *     `getItemInstallInfo`, `subscribe`/`subscribeItem`). `resolveWorkshopApi`
 *     picks whichever exists so a version bump degrades to a clear error
 *     instead of a `TypeError` deep inside a publish.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

/** Steam's UGC visibility enum (ISteamRemoteStorage::ERemoteStoragePublishedFileVisibility). */
const VISIBILITY = {
  public: 0,
  friendsOnly: 1,
  private: 2,
  unlisted: 3,
};

/** ISteamUGC item-state bitflags, used to tell "installed" from "downloading". */
const ITEM_STATE = {
  subscribed: 1,
  legacyItem: 2,
  installed: 4,
  needsUpdate: 8,
  downloading: 16,
  downloadPending: 32,
};

function firstFn(obj, names) {
  for (const name of names) {
    if (obj && typeof obj[name] === "function") {
      return obj[name].bind(obj);
    }
  }
  return null;
}

/**
 * Maps a `steamworks.js` client's workshop object onto the stable set of
 * operations this module needs. Returns null when the client has no workshop
 * surface at all; individual members may still be null if that version lacks
 * the call, and every caller checks before use.
 */
function resolveWorkshopApi(client) {
  const w = client && client.workshop;
  if (!w) return null;
  return {
    raw: w,
    createItem: firstFn(w, ["createItem"]),
    updateItem: firstFn(w, ["updateItem"]),
    subscribe: firstFn(w, ["subscribe", "subscribeItem"]),
    unsubscribe: firstFn(w, ["unsubscribe", "unsubscribeItem"]),
    getSubscribedItems: firstFn(w, ["getSubscribedItems"]),
    download: firstFn(w, ["download", "downloadItem"]),
    downloadInfo: firstFn(w, ["downloadInfo", "getItemDownloadInfo"]),
    installInfo: firstFn(w, ["installInfo", "getItemInstallInfo"]),
    state: firstFn(w, ["state", "getItemState"]),
    getItem: firstFn(w, ["getItem"]),
    getItems: firstFn(w, ["getItems"]),
  };
}

// ── Staging ────────────────────────────────────────────────────────────────

/**
 * Reduces a campaign ID to a safe single path segment. Separators are replaced
 * and dot-runs collapsed, so a hostile ID like `../../evil` can never escape the
 * staging directory or produce a relative-looking filename inside the uploaded
 * package.
 */
function sanitizeForFilename(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[._-]+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "campaign";
}

/**
 * Decodes a `data:image/...;base64,...` URL into a preview file inside `dir`.
 * Returns the written path, or null when the input is absent or not a
 * supported image data URL. Steam caps preview images at 1 MiB, so anything
 * larger is rejected rather than sent and failed server-side.
 */
function writePreviewImage(dir, previewImageDataUrl) {
  if (typeof previewImageDataUrl !== "string" || previewImageDataUrl.length === 0) {
    return null;
  }
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(previewImageDataUrl);
  if (!match) return null;
  const ext = match[1] === "png" ? "png" : "jpg";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 1024 * 1024) return null;
  const previewPath = path.join(dir, `preview.${ext}`);
  fs.writeFileSync(previewPath, bytes);
  return previewPath;
}

/**
 * Writes `campaign` + `manifest` into a fresh temp directory laid out the way
 * an installed Workshop package looks, and returns
 * `{ contentPath, previewPath }`. The caller is responsible for calling
 * `cleanupStagedPackage` once the upload finishes.
 */
function stageCampaignPackage(manifest, campaign, previewImageDataUrl) {
  const contentPath = fs.mkdtempSync(path.join(os.tmpdir(), "dw-workshop-"));
  fs.writeFileSync(
    path.join(contentPath, "workshop-meta.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  const campaignFileName = `${sanitizeForFilename(manifest.campaignId)}.dwcampaign.json`;
  fs.writeFileSync(
    path.join(contentPath, campaignFileName),
    JSON.stringify(campaign),
    "utf8",
  );
  const previewPath = writePreviewImage(contentPath, previewImageDataUrl);
  return { contentPath, previewPath };
}

function cleanupStagedPackage(contentPath) {
  try {
    fs.rmSync(contentPath, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is harmless; never fail a successful publish
    // because cleanup lost a race with an antivirus scanner file lock.
  }
}

// ── Publish / update ───────────────────────────────────────────────────────

function normalizeVisibility(visibility) {
  if (typeof visibility === "number") return visibility;
  return Object.prototype.hasOwnProperty.call(VISIBILITY, visibility)
    ? VISIBILITY[visibility]
    : VISIBILITY.private;
}

/**
 * Creates (or updates, when `existingPublishedFileId` is supplied) a Workshop
 * item and uploads the staged campaign as its content.
 *
 * New items default to `private` visibility: Steam requires the author to
 * accept the Workshop legal agreement on the item's page before a new item can
 * go public, and publishing straight to public would otherwise surface a
 * half-configured item. The renderer surfaces `needsToAcceptAgreement` so the
 * UI can link the author to that page.
 */
async function publishItem(client, appId, input) {
  const api = resolveWorkshopApi(client);
  if (!api || !api.updateItem) {
    throw new Error("Steam Workshop is unavailable (steamworks.js workshop API not found)");
  }

  const { manifest, campaign, existingPublishedFileId, visibility, changeNote, previewImageDataUrl } = input;
  const staged = stageCampaignPackage(manifest, campaign, previewImageDataUrl);

  try {
    let itemId;
    let needsToAcceptAgreement = false;

    if (existingPublishedFileId) {
      itemId = BigInt(existingPublishedFileId);
    } else {
      if (!api.createItem) {
        throw new Error("Steam Workshop is unavailable (createItem not found)");
      }
      const created = await api.createItem(appId);
      itemId = typeof created === "object" && created !== null && created.itemId !== undefined
        ? BigInt(created.itemId)
        : BigInt(created);
      needsToAcceptAgreement = Boolean(created && created.needsToAcceptAgreement);
    }

    const details = {
      title: manifest.title,
      description: manifest.description,
      changeNote: changeNote || (existingPublishedFileId ? "Updated from DustWeaver" : "Initial release"),
      contentPath: staged.contentPath,
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
      visibility: normalizeVisibility(
        visibility !== undefined ? visibility : existingPublishedFileId ? undefined : "private",
      ),
    };
    if (staged.previewPath) {
      details.previewPath = staged.previewPath;
    }

    const updated = await api.updateItem(itemId, details, appId);
    if (updated && updated.needsToAcceptAgreement) {
      needsToAcceptAgreement = true;
    }

    return {
      item: {
        steamPublishedFileId: itemId.toString(),
        title: manifest.title,
        description: manifest.description,
        authorName: manifest.authorSteamId,
        tags: details.tags,
        subscribed: true,
        installed: true,
        localPath: undefined,
      },
      needsToAcceptAgreement,
    };
  } finally {
    cleanupStagedPackage(staged.contentPath);
  }
}

// ── Listing / download ─────────────────────────────────────────────────────

function stateFlags(api, itemId) {
  if (!api.state) return null;
  try {
    return Number(api.state(itemId));
  } catch {
    return null;
  }
}

function installInfoFor(api, itemId) {
  if (!api.installInfo) return null;
  try {
    return api.installInfo(itemId) || null;
  } catch {
    return null;
  }
}

/**
 * Fills in the human-readable metadata Steam holds for `itemIds`. This is what
 * kept the in-game list rendering blank rows: `getSubscribedItems` returns bare
 * IDs, so titles/descriptions/authors must be queried separately. Failure here
 * is non-fatal — the row still renders with its ID as a fallback title.
 */
async function queryItemDetails(api, itemIds) {
  const byId = new Map();
  if (itemIds.length === 0) return byId;

  try {
    if (api.getItems) {
      const results = await api.getItems(itemIds);
      for (const entry of results || []) {
        if (entry && entry.publishedFileId !== undefined) {
          byId.set(String(entry.publishedFileId), entry);
        }
      }
      if (byId.size > 0) return byId;
    }
    if (api.getItem) {
      for (const itemId of itemIds) {
        const entry = await api.getItem(itemId);
        if (entry) byId.set(itemId.toString(), entry);
      }
    }
  } catch {
    // Leave whatever was resolved; callers fall back to ID-only rows.
  }
  return byId;
}

async function listSubscribedItems(client) {
  const api = resolveWorkshopApi(client);
  if (!api || !api.getSubscribedItems) return [];

  const ids = api.getSubscribedItems() || [];
  const details = await queryItemDetails(api, ids);

  return ids.map((itemId) => {
    const key = itemId.toString();
    const info = installInfoFor(api, itemId);
    const flags = stateFlags(api, itemId);
    const meta = details.get(key);
    const downloading =
      flags !== null && (flags & (ITEM_STATE.downloading | ITEM_STATE.downloadPending)) !== 0;
    const installed = info !== null
      ? true
      : flags !== null
        ? (flags & ITEM_STATE.installed) !== 0
        : false;

    return {
      steamPublishedFileId: key,
      title: (meta && meta.title) || key,
      description: (meta && meta.description) || "",
      authorName: (meta && (meta.owner && meta.owner.steamId64 ? String(meta.owner.steamId64) : meta.owner)) || "",
      tags: (meta && Array.isArray(meta.tags) ? meta.tags : []) || [],
      subscribed: true,
      installed,
      downloading,
      needsUpdate: flags !== null && (flags & ITEM_STATE.needsUpdate) !== 0,
      localPath: info ? info.folder : undefined,
    };
  });
}

/**
 * Asks Steam to download `itemId` and waits until it is installed.
 *
 * Steam's download call is fire-and-forget, so this polls install state. It
 * gives up after `timeoutMs` rather than hanging the UI forever — the item
 * keeps downloading in the background and will simply show as installed on the
 * next refresh.
 */
async function downloadAndWait(client, steamPublishedFileId, timeoutMs = 120000, pollMs = 500) {
  const api = resolveWorkshopApi(client);
  if (!api || !api.download) {
    throw new Error("Steam Workshop is unavailable");
  }
  const itemId = BigInt(steamPublishedFileId);

  const existing = installInfoFor(api, itemId);
  const flags = stateFlags(api, itemId);
  const needsUpdate = flags !== null && (flags & ITEM_STATE.needsUpdate) !== 0;
  if (existing && !needsUpdate) {
    return existing.folder;
  }

  api.download(itemId, true);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = installInfoFor(api, itemId);
    if (info) return info.folder;
    if (Date.now() >= deadline) {
      throw new Error(
        `Workshop item ${steamPublishedFileId} is still downloading. It will finish in the background — try again shortly.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function getDownloadProgress(client, steamPublishedFileId) {
  const api = resolveWorkshopApi(client);
  if (!api || !api.downloadInfo) return null;
  try {
    const info = api.downloadInfo(BigInt(steamPublishedFileId));
    if (!info) return null;
    return { bytesDownloaded: Number(info.current || 0), bytesTotal: Number(info.total || 0) };
  } catch {
    return null;
  }
}

module.exports = {
  VISIBILITY,
  ITEM_STATE,
  resolveWorkshopApi,
  stageCampaignPackage,
  cleanupStagedPackage,
  writePreviewImage,
  publishItem,
  listSubscribedItems,
  downloadAndWait,
  getDownloadProgress,
  queryItemDetails,
};
