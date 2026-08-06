# Steam Setup

Documentation-only notes for the manual steps required to finish wiring
Steam Achievements and Steam Workshop support. The code-side integration
(platform abstraction, IPC boundary, fake adapters, tests) is complete —
see `src/platform/`, `src/workshop/`, and `electron/platformBridge.cjs`.
This file only covers what a human needs to do outside the repo.

## 1. Register a Steamworks App ID

1. Create (or use an existing) app in the Steamworks partner dashboard.
2. Note the numeric App ID.
3. Add a `steam_appid.txt` file next to the built executable containing just
   the App ID (Steamworks convention — required for local testing without
   launching via Steam), and/or set the `DUSTWEAVER_STEAM_APP_ID` environment
   variable, which `electron/platformBridge.cjs` reads when initializing
   `steamworks.js`.
4. Install the `steamworks.js` npm package as an optional/native dependency
   for packaged Steam builds — it is `require()`d lazily and wrapped in a
   try/catch, so its absence does not break non-Steam builds.

## 2. Configure achievements in the Steamworks dashboard

For each ID in `src/platform/achievementIds.ts` (`FIRST_WEAVE`,
`FIRST_CLEAR`, `STORMWEAVE_MASTER`, `DUSTWEAVER_COMPLETE`, `SPEED_RUNNER`,
`NO_HIT_ROOM`, `MOTE_HOARDER`, `ICE_FREEZE_CHAIN`, `WORKSHOP_AUTHOR`,
`WORKSHOP_SUBSCRIBER`):

1. Create a matching achievement in Steamworks → Stats & Achievements, using
   the exact same string as the achievement's **API Name**. The game code
   never needs to change if the API Name matches the ID exactly.
2. Upload a locked and unlocked icon (recommended 128×128 PNG) for each.
3. Publish the achievement list to Steam's test/beta branch before
   verifying unlocks against a real Steam client.

## 3. Configure Workshop

1. Enable Steam Workshop for the app in Steamworks → Community → Workshop.
2. Configure any content tags you want available in the publish dialog
   (`src/ui/workshopBrowser.ts` sends whatever tags the player enters —
   Steamworks does not require pre-registering tags, but curated tags
   improve discoverability).
3. Set Workshop visibility/legal agreement requirements as required by your
   region.

## 4. Manual verification with a real Steam client

The fake adapters (`fakeSteamAdapter.ts`, `fakeWorkshopAdapter.ts`) cover
all logic in automated tests, but the following must be verified manually
against a running Steam client with the game launched through Steam:

- Unlock at least one achievement from each trigger site (room clear, weave
  equip, mote threshold) and confirm it appears unlocked in the Steam
  overlay and persists across a relaunch.
- Confirm achievements already unlocked in a save file (but not yet on
  Steam, e.g. after a fresh Steam install) get pushed to Steam on next load
  via `reconcileSaveSlotAchievements` in `src/progression/saveSlots.ts`.
- Publish a test Workshop item from the in-game "Browse Workshop → Publish"
  flow and confirm it appears on the item's Steam Workshop page **with the
  campaign file actually attached** (check the item's file listing, not just
  that the item exists), along with the title, description, tags, and preview
  image entered in the dialog.
- Publish the same campaign a second time and confirm it updates the existing
  item instead of creating a duplicate.
- Subscribe/unsubscribe to a Workshop item from both the Steam client and
  the in-game browser and confirm state stays consistent.
- Verify `WORKSHOP_AUTHOR` and `WORKSHOP_SUBSCRIBER` achievements unlock on
  publish/subscribe respectively.
- Subscribe to and download a real Workshop item, then press "Play" in the
  in-game Workshop browser and confirm it loads and plays through to
  completion. Also verify the localized error states surface correctly and
  leave the menu usable: an item still downloading (not yet installed), an
  item removed from Steam between listing and Play, and a manually corrupted
  package (missing `workshop-meta.json` or `.dwcampaign.json`, or an
  unsupported `formatVersion`).

## 5. How upload and download are wired

All live Steam UGC calls go through `electron/workshopUgc.cjs` (main process
only). `electron/platformBridge.cjs` owns the ipcMain handlers and delegates
there; the renderer reaches them via `src/workshop/rendererWorkshopAdapter.ts`.

**Upload.** "Browse Workshop → pick a campaign → Publish" opens
`src/ui/workshopPublishDialog.ts` (title, description, tags, visibility,
preview image, change note, optional existing item ID). The campaign is sent as
*data*, not a directory path — the main process stages it into a temp folder as
`workshop-meta.json` + `<campaignId>.dwcampaign.json`, then calls
`createItem`/`updateItem` with that folder as `contentPath`. New items are
created **private** by default, because Steam hides an item until its author
accepts the Workshop legal agreement on the item page; the dialog says so when
Steam reports `needsToAcceptAgreement`.

Re-publishing the same campaign updates the existing item rather than creating
a duplicate. The campaign → item-ID mapping lives in
`src/workshop/publishedItemRegistry.ts` (localStorage). If that mapping is lost,
paste the item ID into the dialog's "Existing item ID" field to relink.

**Download.** `dw:workshop-download` asks Steam to fetch an item and polls
until it is installed (2 minute cap; the download continues in the background
after a timeout). Subscribed items are listed with real titles via a UGC detail
query, and each row shows installed / downloading / update-available state.
Items can also be pulled in by pasting a published-file ID.

**Version note.** `steamworks.js` has renamed workshop methods across releases,
so `resolveWorkshopApi` in `workshopUgc.cjs` accepts either the modern
(`download`, `installInfo`, `subscribe`) or legacy (`downloadItem`,
`getItemInstallInfo`, `subscribeItem`) names. If a future version renames them
again, add the new name there rather than at the call sites.

## 6. Remaining gaps

- `steamworks.js` is not a dependency in this repo, so nothing above has been
  executed against a real Steam client. The staging layout, update details, and
  create-vs-update logic are covered by `src/tests/workshopUgc.test.ts` with a
  fake client; the native boundary itself is unverified.
- There is no in-game Workshop search/browse of the public catalogue — players
  subscribe from the Steam client or by pasting an item ID.
- Upload progress is reported as a single "Uploading…" state rather than a
  byte-level progress bar.
