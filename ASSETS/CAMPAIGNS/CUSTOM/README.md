# Custom Packed Campaigns

This directory holds single-file packed custom campaigns in the `.dwcampaign.json` format.

## How to add a custom campaign

1. Create or export your campaign from the in-game editor using **Export Campaign JSON**.
2. Place the exported file here:
   ```
   ASSETS/CAMPAIGNS/CUSTOM/<campaign-id>.dwcampaign.json
   ```
3. Commit the file to the repository.
4. After the GitHub Pages build runs, the campaign will be automatically discovered and appear under **Main Menu → Custom Campaigns**.

Packed campaign files committed here are **automatically discovered** at build time via `import.meta.glob` — you do **not** need to add them to `CAMPAIGNS/manifest.json`.

## File naming

- Use the campaign's `id` field as the filename base: `<campaign-id>.dwcampaign.json`
- Campaign IDs must contain only lowercase letters, digits, underscores (`_`), and hyphens (`-`).
- Example: `my_cave_adventure.dwcampaign.json`

## Format

See `src/levels/campaignSchema.ts` for the full `SavedCampaignV1` schema. The short version:

```json
{
  "v": 1,
  "kind": "DustWeaverCampaign",
  "campaign": {
    "id": "my_cave_adventure",
    "title": "My Cave Adventure",
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

## GitHub Pages vs. future Steam/native builds

- **GitHub Pages**: All packed campaigns must be committed to this folder and included in the build. GitHub Pages cannot scan for arbitrary files dropped in after deployment.
- **Future Steam/native**: The same `.dwcampaign.json` format will be loadable from a user-writable `CustomCampaigns/` folder at runtime. The campaign source abstraction (`src/levels/campaignSource.ts`) is designed to support this without rewriting the UI or schema.
