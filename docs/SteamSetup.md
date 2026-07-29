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
  flow and confirm it appears on the item's Steam Workshop page.
- Subscribe/unsubscribe to a Workshop item from both the Steam client and
  the in-game browser and confirm state stays consistent.
- Verify `WORKSHOP_AUTHOR` and `WORKSHOP_SUBSCRIBER` achievements unlock on
  publish/subscribe respectively.

## 5. Known gaps left for the Steam integration pass

- Playing an installed Workshop item's campaign directly from
  `workshopBrowser.ts` is not yet wired into the existing `CampaignSource`
  loader — installed items currently only support subscribe/unsubscribe and
  publish from the browser UI. Wiring "Play" requires mapping a Workshop
  item's downloaded folder into a `CampaignSource` the way local imported
  campaigns already work in `src/levels/campaignSource.ts`.
- The publish dialog (title/description/tags) referenced in the design is
  simplified to reuse whatever `WorkshopPackageManifest` the caller
  supplies; a dedicated input form for authoring metadata in
  `workshopBrowser.ts` is not yet built.
