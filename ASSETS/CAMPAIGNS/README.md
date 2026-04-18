# Campaign Framework

DustWeaver now loads rooms from `CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/`.

## Required files per campaign
- `campaign_info.txt`
- `ROOMS/manifest.json`
- `ROOMS/*.json` room files
- `worldMap/world-map.json` (optional but recommended)

## campaign_info.txt format
Use `key: value` lines:
- `id`
- `title`
- `creator`
- `description`
- `initial_room_id`
- `initial_room_image` (optional relative path for Custom Campaigns preview)

## Registering campaigns
1. Duplicate `TEMPLATE_CAMPAIGN` and rename it.
2. Add the folder name to `CAMPAIGNS/manifest.json`.
3. Keep `DUSTWEAVER_CAMPAIGN` in the manifest for the main game.

Any manifest entry that is not `DUSTWEAVER_CAMPAIGN` appears in Main Menu → Custom Campaigns.
