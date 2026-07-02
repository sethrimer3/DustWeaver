# Sprite Atlases

This folder contains derived block/tile sprite atlas files generated from source sprites under `ASSETS/SPRITES/`.
Runtime rendering does not depend on these atlases yet.

Regenerate atlases:

```bash
npm run build:atlases -- --force
npm run build:atlases -- --deterministic
```

Validate atlas metadata, source dimensions, bounds, and overlaps:

```bash
npm run validate:atlases -- --summary
npm run validate:atlases -- --strict
```

Generate the developer inspection preview:

```bash
npm run preview:atlases
```

All files in this folder are derived output and safe to regenerate. Source sprites live outside this folder and should not be edited by atlas tooling.
