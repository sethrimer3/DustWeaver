# DustWeaver — Manual Test Checklist

## Main Menu
- [ ] App launches showing "DustWeaver" title on black background
- [ ] "PLAY" button visible and hoverable
- [ ] Clicking "PLAY" transitions to World Map

## World Map
- [ ] World Map shows "Lobby" and "World 1 - Level 1" buttons
- [ ] Clicking "Lobby" shows "Lobby - Coming Soon" message
- [ ] Clicking "World 1 - Level 1" starts gameplay

## Gameplay
- [ ] Canvas renders with black/dark background
- [ ] Player cluster (green core) visible on left side
- [ ] Enemy cluster (orange core) visible on right side
- [ ] Particles (cyan = player, red = enemy) orbit their cores
- [ ] WASD moves player cluster
- [ ] ESC returns to World Map
- [ ] Performance overlay shows FPS, frame time, particle count
- [ ] Particles from opposing clusters destroy each other on contact
- [ ] Health bars decrease when particles are destroyed

## Performance
- [ ] 60 FPS with 16 particles active
- [ ] Performance overlay always visible during gameplay

## Save/Load (future)
- [ ] Not yet implemented
