# Dust Types & Weaves Archive

This document preserves the design of all removed dust types and weave combat techniques
from the pre-rework system (BUILD 111 and earlier). These were removed during the combat
rework that introduced the Storm Weave and Shield Weave system.

---

## Removed Dust Types

All dust types below were removed. Only **Golden Dust** (Physical, index 0) was retained.

| Kind Index | Name           | Shape    | Slot Cost | Color Hex | Description |
|------------|----------------|----------|-----------|-----------|-------------|
| 1          | Flame Dust     | Triangle | 2         | #ff5500   | Flickering embers that rise and bob with heat-like motion. Chaotic, short-lived. Mass 0.4, strong upward bias (32), high noise. |
| 2          | Frost Dust     | Hexagon  | 2         | #88ddff   | Crystalline shards that hang in place a moment before drifting back. Structured, long-lived. Mass 1.5, low noise. |
| 3          | Lightning Dust | Diamond  | 3         | #ffff44   | Electric sparks. Explosive and volatile. Mass 0.3, very high noise (85), high instability. |
| 4          | Poison Dust    | Star     | 2         | #44ff44   | Toxic motes. Sticky and diffuse. Mass 0.8, high diffusion (18). |
| 5          | Arcane Dust    | Star     | 3         | #cc44ff   | Mystic spiraling particles of strange turbulence. Mass 1.0, high curl strength (25). |
| 6          | Wind Dust      | Diamond  | 2         | #88ffee   | Fast gusts that swirl in spiral arcs around the Weaver. Mass 0.3, strong orbital (45). |
| 7          | Holy Dust      | Cross    | 3         | #ffeeaa   | Sacred motes. Rising and orderly. Mass 1.2, upward bias (20), high stability. |
| 8          | Shadow Dust    | Square   | 3         | #9966ff   | Dark tendrils. Sinking and unstable. Mass 1.0, downward bias (-15), high instability. |
| 9          | Iron Dust      | Square   | 3         | #aabbcc   | Heavy iron shards. Dense and durable. Mass 4.0, high drag (3.5), strong toughness. |
| 10         | Earth Dust     | Triangle | 2         | #aa8833   | Grounded fragments with steady, weighty drift. Mass 2.0, downward bias (-6). |
| 11         | Nature Dust    | Circle   | 1         | #44cc44   | Organic motes. Light and gentle. Mass 0.5, cohesion-heavy, organic movement. |
| 12         | Crystal Dust   | Hexagon  | 3         | #aaeeff   | Prismatic shards. Precise and brilliant. Mass 1.8, high stability, geometric motion. |
| 13         | Void Dust      | Ring     | 4         | #9933cc   | Dark matter particles. Unstable phase-like drifting. Mass 1.5, exotic and powerful. |
| 15         | Water Dust     | Circle   | 2         | #2299ee   | Flowing motes that roll low and spread outward. World 1 water enemy theme. |
| 16         | Lava Dust      | Circle   | 4         | #ff2200   | Molten rock. Slow, devastating, few particles. Burning aura. World 2 lava theme. Mass 6.0. |
| 17         | Stone Dust     | Triangle | 2         | #888899   | Rock fragments. Heavy low hover with short hops. Shatters on wall impact. World 2 stone theme. |

### Element Profile Properties (per dust type)

Each dust type had an ElementProfile with ~20 tunable physics coefficients:
- `massKg`, `drag`, `attractionStrength`, `orbitalStrength`, `orbitRadiusWorld`
- `noiseAmplitude`, `instability`, `curlStrength`, `diffusion`, `upwardBias`
- `cohesion`, `separation`, `alignment` (boid forces)
- `lifetimeBaseTicks`, `lifetimeVarianceTicks`
- `temperature`, `stability`, `toughness`, `attackPower`
- `maxPopulationCount`, `regenerationRateTicks`

---

## Removed Weave Techniques

All 6 weave techniques were removed and replaced with the Storm/Shield system.

### 1. Aegis Weave (id: 'aegis')
- **Pattern**: Orbiting shield ring around the player (sustained while held)
- **Slot Capacity**: 4 dust slots
- **Cooldown**: 30 ticks (~0.5 sec)
- **Behavior**: Particles distributed evenly around a circle at 8 world units radius, rotating at 0.06 rad/tick. Spring forces (400 N/wu) pulled particles to orbit positions.

### 2. Bastion Weave (id: 'bastion')
- **Pattern**: Directional wall perpendicular to aim direction (sustained while held)
- **Slot Capacity**: 4 dust slots
- **Cooldown**: 30 ticks
- **Behavior**: Particles arranged in a straight line at 7.5 world units from player, perpendicular to aim direction, with 10/6 world unit spacing between particles.

### 3. Spire Weave (id: 'spire')
- **Pattern**: Straight line shot forward in aimed direction (burst)
- **Slot Capacity**: 3 dust slots
- **Duration**: 45 ticks (~0.75 sec)
- **Cooldown**: 45 ticks
- **Deploy Speed**: 350 world units/sec
- **Spread**: 0.12 radians (very tight line)

### 4. Torrent Weave (id: 'torrent')
- **Pattern**: Cone spray burst in aimed direction
- **Slot Capacity**: 4 dust slots
- **Duration**: 35 ticks
- **Cooldown**: 50 ticks
- **Deploy Speed**: 250 world units/sec
- **Spread**: π/2 radians (90° cone)

### 5. Comet Weave (id: 'comet')
- **Pattern**: Compressed dense projectile mass
- **Slot Capacity**: 5 dust slots
- **Duration**: 60 ticks
- **Cooldown**: 90 ticks
- **Deploy Speed**: 300 world units/sec
- **Spread**: 0 (single mass)

### 6. Scatter Weave (id: 'scatter')
- **Pattern**: Outward explosion in all directions
- **Slot Capacity**: 4 dust slots
- **Duration**: 40 ticks
- **Cooldown**: 60 ticks
- **Deploy Speed**: 280 world units/sec
- **Spread**: 2π radians (full circle)

---

## Removed Systems

### Weave Loadout System
- Players bound dust types to primary (LMB) and secondary (RMB) weave slots
- Each weave had a `dustSlotCapacity` limiting how much dust could be bound
- Different dust types cost different amounts of capacity (1-4 slots per dust)
- UI allowed selecting weaves and dragging dust types onto them

### Dust Capacity / Container Model
- Dust containers each granted 4 capacity points
- Total capacity = containers × 4
- Different dust types consumed different capacity per particle
- Example: Golden Dust cost 1 → 8 particles from 2 containers

### Weave Role System
- `WeaveRole.PrimaryOnly` — left click only
- `WeaveRole.SecondaryOnly` — right click only
- `WeaveRole.Either` — either slot (all weaves used this)

### Particle Behavior Modes (for weaves)
- Mode 0: Passive orbit (dust type motion)
- Mode 3: Weave active (executing pattern)
- Mode 4: Returning (transitioning back to passive)
- Sustained weaves: stayed in mode 3 while input held
- Burst weaves: auto-transitioned to mode 4 after `durationTicks`
