# Sprite Atlases

This folder contains derived sprite atlas outputs generated from source sprites under `ASSETS/SPRITES/`.
These files are safe to regenerate. Do not hand-edit atlas PNG or JSON files.

Runtime rendering does not depend on these atlases by default. Atlas usage is experimental and opt-in only.

Commands:

```bash
npm run build:atlases -- --deterministic
npm run validate:atlases -- --strict
npm run compare:atlases
npm run preview:atlases
```
