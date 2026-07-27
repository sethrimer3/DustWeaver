# DustWeaver — Manual Test Checklist

## Main Menu
- [ ] App launches showing "DustWeaver" title on black background
- [ ] Save slot buttons visible (3 slots)
- [ ] Selecting an empty save slot transitions to Character Select

## Character Select (New Profile)
- [ ] Character cards visible (Knight, Demon Fox, Princess)
- [ ] Selecting a character transitions directly to Gameplay (no loadout screen)

## New Profile Gameplay
- [ ] Player spawns with NO dust particles (blank slate)
- [ ] Player spawns with NO dust containers displayed in HUD
- [ ] Health bar appears in top-left HUD (not over the character)
- [ ] Health bar is positioned above dust container display area
- [ ] Loadout screen does NOT appear on a brand new profile

## Progression Unlocks
- [ ] Unlocking Cycle passive technique works without requiring equip slots
- [ ] Unlocking Golden Dust + 2 containers automatically gives 8 Golden Dust particles
- [ ] Auto-assigned particles visibly orbit/cycle around the player
- [ ] Dust containers (2 squares) appear in top-left HUD after unlock

## Dust Recharge
- [ ] Dust particles respawn when player is grounded (standing on floor)
- [ ] Dust particles do NOT respawn when player is airborne (jumping/falling)

## HUD Layout (top-left)
- [ ] Health bar always visible, screen-anchored
- [ ] Dust container display below health bar
- [ ] Enemy health bars still appear over enemy characters when damaged

## Save Tombs / Loadout
- [ ] Interacting with a save tomb opens the Skill Tomb Menu
- [ ] Loadout tab allows changing dust types and active weave assignments
- [ ] Loadout changes only happen at save tombs, not freely at game start

## Returning Player
- [ ] Loading an existing save with explored rooms skips character/loadout select
- [ ] Player starts at last save room with saved loadout

## Combat
- [ ] Left-click and right-click active weave assignment still works
- [ ] Weave patterns (Spire, Aegis, etc.) function correctly
- [ ] Particle durability and combat destruction still work

## Block Rendering
- [ ] Procedural block sprites show a faint inverted-colour rim on the three innermost pixels next to open air
- [ ] The rim appears independently from ambient-light darkness settings

## Room Transitions / Map Editor
- [ ] Edge transitions on ceilings and floors render on the correct map edge and trigger room changes in gameplay
- [ ] Snapping two transitions together in the visual map editor shows the "Link rooms?" prompt with a 5-second timer bar
- [ ] Clicking the prompt or "Yes" links both transitions and exported room files include the updated targets

## Performance
- [ ] 60 FPS with particles active
- [ ] Performance overlay shows FPS, frame time, particle count
