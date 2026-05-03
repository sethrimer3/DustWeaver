# DustWeaver — Legacy & Removed Logic

This file documents significant logic that was changed or removed, and explains
why the old approach was replaced.  See `DECISIONS.md` for the current design.

---

## BUILD 231 — Grapple Anchor Placement (changed, not removed)

### Old Behaviour (before BUILD 231)

`fireGrapple()` placed the anchor at the **exact raycast hit point** on the wall
surface:

```typescript
// Old code (fireGrapple, grapple.ts)
const anchorX = hit.x;
const anchorY = hit.y;
world.grappleAnchorXWorld = anchorX;
world.grappleAnchorYWorld = anchorY;
```

`RayHit` had no surface normal fields:

```typescript
// Old RayHit (grappleMiss.ts)
export interface RayHit {
  t: number;
  x: number;
  y: number;
  wallIndex: number;
}
```

The `raycastWalls` function tracked no per-wall hit axis, so it could not return
the outward normal for the hit face.

### Why it was changed

Placing the anchor at `hit.x, hit.y` (the exact wall boundary) means the anchor
sits precisely on a float32 boundary.  In subsequent frames, `resolveAABBPenetration`
and other "is point inside AABB?" checks can return true for a point that is
mathematically on the boundary — a floating-point equality edge case.  This was the
root cause of the "grapple briefly enters swing state then instantly detaches"
behaviour observed after the grapple speed was increased (BUILD 223), because:
1. The faster miss-chain tip had more per-tick travel, increasing the probability
   that it stopped exactly at a wall face.
2. Any subsequent frame that called a point-in-AABB validation would see the anchor
   as "inside" solid and release the grapple.

### New Behaviour (BUILD 231)

`raycastWalls` now tracks which axis's slab entry was tightest (`hitAxis`) and uses
it to compute a unit outward normal at the best hit.  `RayHit` includes `normalX`
and `normalY`.

`fireGrapple` offsets the anchor by `GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD = 0.1 wu`
along the outward normal:

```typescript
// New code (fireGrapple, grapple.ts)
const anchorX = hit.x - hit.normalX * GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD;
const anchorY = hit.y - hit.normalY * GRAPPLE_ANCHOR_SURFACE_EPSILON_WORLD;
```

The anchor is now provably OUTSIDE the wall by 0.1 wu, which is below the 8 wu
block size so it is visually indistinguishable from "touching the surface".

---

## BUILD 231 — `WorldState` and `WorldSnapshot` new fields

The following fields were **added** (not removed); they are documented here because
future maintainers should understand their purpose before removing or repurposing
them.

| Field | Type | Purpose |
|---|---|---|
| `grappleAnchorNormalXWorld` | `number` | Outward X normal at anchor surface |
| `grappleAnchorNormalYWorld` | `number` | Outward Y normal at anchor surface |
| `grappleDebugSweepFromXWorld` | `number` | Debug: sweep ray origin X |
| `grappleDebugSweepFromYWorld` | `number` | Debug: sweep ray origin Y |
| `grappleDebugSweepToXWorld` | `number` | Debug: sweep ray endpoint X |
| `grappleDebugSweepToYWorld` | `number` | Debug: sweep ray endpoint Y |
| `grappleDebugRawHitXWorld` | `number` | Debug: raw hit before epsilon X |
| `grappleDebugRawHitYWorld` | `number` | Debug: raw hit before epsilon Y |
| `isGrappleDebugActiveFlag` | `0\|1` | Debug: 1 if debug data is fresh |

These fields have no effect on physics.  Removing them only affects the debug
overlay in `renderGrapple` (renderer.ts).  Before removing, also remove the
corresponding initialisation in `createWorldState`, the snapshot copy in
`snapshot.ts`, the public type in `snapshotTypes.ts`, and the debug block in
`renderer.ts`.

---

## Rationale for Not Adding a Tile-Occupancy Grid

The problem statement suggested preserving a separate tile grid for exact collision
queries.  After analysis, DustWeaver's merged-rectangle system already produces
exact integer boundaries (all tile edges are multiples of BLOCK_SIZE_MEDIUM = 8 wu),
so there are no sub-pixel gaps between adjacent merged rectangles.  A separate tile
grid would duplicate data, add complexity, and require two collision systems to stay
in sync.  The merged rectangles ARE the precise collision source; the "broad-phase
only" concern does not apply when merging is gap-free.

See `DECISIONS.md §Grapple Collision Authority & Surface-Anchor Design (BUILD 231)`
for the authoritative design rationale.
