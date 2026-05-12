# Campaign Framework

DustWeaver supports two campaign formats.

---

## 1. Folder-based campaigns (existing)

The main DustWeaver campaign and legacy custom campaigns use this format:

```
ASSETS/CAMPAIGNS/<CAMPAIGN_ID>/
  campaign_info.txt
  ROOMS/manifest.json
  ROOMS/*.json
  worldMap/world-map.json    (optional but recommended)
```

### campaign_info.txt format

Use `key: value` lines:
- `id`
- `title`
- `creator`
- `description`
- `initial_room_id`
- `initial_room_image` (optional relative path for Custom Campaigns preview)

### Registering folder campaigns

1. Duplicate `TEMPLATE_CAMPAIGN` and rename it.
2. Add the folder name to `CAMPAIGNS/manifest.json`.
3. Keep `DUSTWEAVER_CAMPAIGN` in the manifest for the main game.

Any manifest entry that is not `DUSTWEAVER_CAMPAIGN` appears in Main Menu → Custom Campaigns.

---

## 2. Packed campaigns (.dwcampaign.json) — new

Custom campaigns can also be distributed as a single packed JSON file:

```
ASSETS/CAMPAIGNS/CUSTOM/<campaign-id>.dwcampaign.json
```

### How packed campaigns work

- A packed campaign is a single file containing **all rooms, world-map data, and campaign metadata**.
- Rooms are stored in the compact `SavedRoomV2` format used by the existing editor save/load pipeline.
- See `src/levels/campaignSchema.ts` for the full `SavedCampaignV1` schema.

### Creating a packed campaign

1. Open DustWeaver.
2. Go to **Main Menu → Custom Campaigns**.
3. Click **Create New Campaign** to start a blank campaign in the editor.
4. Build your rooms using the room editor and world-map tools.
5. Click **📦 Export Campaign JSON** in the editor to download `<campaign-id>.dwcampaign.json`.
6. Place the file in `ASSETS/CAMPAIGNS/CUSTOM/` and commit it to the repository.

### Auto-discovery

Packed campaign files committed to `ASSETS/CAMPAIGNS/CUSTOM/` are **automatically discovered** at build time via Vite's `import.meta.glob`. You do **not** need to add them to `CAMPAIGNS/manifest.json`.

### GitHub Pages vs. future Steam/native builds

- **GitHub Pages (current)**: All packed campaigns must be committed to `ASSETS/CAMPAIGNS/CUSTOM/` and included in the build. GitHub Pages cannot scan for arbitrary files added after deployment.
- **Future Steam/native**: The same `.dwcampaign.json` format will be loadable from a user-writable `CustomCampaigns/` folder at runtime without any build step. The campaign source abstraction (`src/levels/campaignSource.ts`) is designed to support this without rewriting the UI or schema.

### Packed campaign schema summary

```json
{
  "v": 1,
  "kind": "DustWeaverCampaign",
  "campaign": {
    "id": "my_campaign",
    "title": "My Campaign",
    "creator": "Your Name",
    "description": "A short description...",
    "initialRoomId": "start",
    "initialRoomImagePath": null
  },
  "worldMap": {
    "worlds": [{ "id": 1, "name": "World 1" }],
    "rooms": [{ "id": "start", "name": "Start Room", "worldId": 1, "mapX": 0, "mapY": 0 }]
  },
  "rooms": [ /* SavedRoomV2 objects */ ],
  "editor": {
    "createdWithBuild": "283",
    "lastEditedIso": "2026-01-01T00:00:00.000Z"
  }
}
```

### Constraints

- Packed campaigns may reference only **built-in DustWeaver assets** (sprites, audio) for now.
- If a packed campaign references a missing asset id, a warning is logged but the game does not crash unless room loading fails completely.

