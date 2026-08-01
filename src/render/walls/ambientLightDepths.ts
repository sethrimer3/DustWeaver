/**
 * Ambient-light depth solver for the block sprite renderer.
 *
 * Extracted from blockSpriteRenderer.ts to keep that module focused on sprite
 * loading and drawing. This module is a pure computation layer with no DOM or
 * browser dependencies — it reads only tile-occupancy data and room dimensions.
 *
 * Two-phase algorithm:
 *   1. Lit-air flood: BFS from room edges that face the ambient-light source
 *      through empty cells not blocked by authored `ambientLightBlockers`.
 *   2. Solid-depth BFS: starting from solid cells adjacent to lit-air,
 *      assigns an incrementing depth to each deeper solid tile. Depth drives
 *      the exponential darkness tint in `getDarknessAlphaFromAirDepth`.
 */

import type { AmbientLightDirection } from '../../levels/roomDef';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns the string key for a tile grid coordinate. */
function _tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Returns true if the cell at (col, row) is occupied by a solid wall block. */
function _isOccupied(occupied: Set<string>, col: number, row: number): boolean {
  return occupied.has(_tileKey(col, row));
}

function _isInsideRoom(col: number, row: number, widthBlocks: number, heightBlocks: number): boolean {
  return col >= 0 && col < widthBlocks && row >= 0 && row < heightBlocks;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Unit 2-D vector associated with each {@link AmbientLightDirection} value.
 *
 * The vector points in the direction light TRAVELS (e.g. `'down-right'` →
 * (+1, +1) normalised, meaning light enters the room from the upper-left
 * and moves toward the lower-right). The `'omni'` value returns (0,0),
 * signalling the solver to skip directional biasing.
 */
export function ambientDirectionVector(dir: AmbientLightDirection): { dx: number; dy: number } {
  switch (dir) {
    case 'omni':       return { dx:  0, dy:  0 };
    case 'down':       return { dx:  0, dy:  1 };
    case 'down-right': return { dx:  1, dy:  1 };
    case 'down-left':  return { dx: -1, dy:  1 };
    case 'up':         return { dx:  0, dy: -1 };
    case 'up-right':   return { dx:  1, dy: -1 };
    case 'up-left':    return { dx: -1, dy: -1 };
    case 'left':       return { dx: -1, dy:  0 };
    case 'right':      return { dx:  1, dy:  0 };
  }
}

/**
 * Converts open-air distance (in tiles) into darkness alpha.
 * Darkness accelerates with depth: each additional tile from open air
 * contributes twice the darkness of the previous tile.
 */
export function getDarknessAlphaFromAirDepth(airDepth: number): number {
  if (airDepth <= 0) return 0;
  const BASE_DARKNESS_STEP = 0.1;
  const acceleratedAlpha = BASE_DARKNESS_STEP * (Math.pow(2, airDepth) - 1);
  return Math.min(1, acceleratedAlpha);
}

/**
 * Unified ambient-light depth solver.
 *
 * Two-phase algorithm that replaces the legacy split between `'DEFAULT'`
 * (omni BFS from any air-touching solid) and `'Above'` (vertical scan only):
 *
 * 1. **Lit-air flood**: compute the set of in-room AIR cells that are
 *    "connected to the sky". Seeds are air cells on a room edge that faces
 *    the ambient-light direction (or every edge, for `'omni'`). The flood
 *    propagates through empty cells only, skipping solids and skipping
 *    `ambientBlockers`. When a direction is set, a cell only propagates into
 *    neighbours whose offset dot-producted with the direction vector is
 *    `≥ 0`, so light naturally spills in a diagonal cone instead of bending
 *    around arbitrary corners.
 *
 * 2. **Solid depth BFS**: every solid cell 8-adjacent to a lit-air cell is
 *    depth 0 ("directly exposed"). BFS outward through adjacent solids
 *    assigns each deeper solid an incrementing depth, which drives the
 *    exponential darkness tint in {@link getDarknessAlphaFromAirDepth}.
 *
 * Air cells inside an enclosed/blocked pocket never enter the lit-air set, so
 * solid walls adjacent to them stay at `maxFallbackDepth` (fully dark). When
 * a breakable wall is destroyed its tile becomes empty, the wall-layout
 * signature changes, and this function is re-run — light then spills in
 * naturally on the next bake. See `ambientLightBlockers` docs in
 * `roomDef.ts` for the full authoring model.
 *
 * @param occupied         Set of `"col,row"` keys for solid tiles.
 * @param blockers         Authored ambient-light blocker keys — opaque to
 *                         both the air flood and the final rendering.
 * @param direction        Ambient-light travel direction.
 * @param roomWidthBlocks  Room width in tile units.
 * @param roomHeightBlocks Room height in tile units.
 * @returns Map from tile key to integer depth (0 = surface-exposed).
 */
export function buildAmbientDepths(
  occupied: Set<string>,
  blockers: ReadonlySet<string>,
  direction: AmbientLightDirection,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
): Map<string, number> {
  const depths = new Map<string, number>();
  if (roomWidthBlocks <= 0 || roomHeightBlocks <= 0) return depths;

  const _devT0 = import.meta.env?.DEV ? performance.now() : 0;
  const { dx: directionVectorX, dy: directionVectorY } = ambientDirectionVector(direction);
  const isOmni = directionVectorX === 0 && directionVectorY === 0;

  // ── Phase 1: flood-fill "lit air" cells ──────────────────────────────────
  // `litAir` tracks which empty cells are connected to the sky (directional
  // mode only).  For omni mode `litAir` stays null — Phase 2 uses an inline
  // `!occupied && !blockers` check instead.  This avoids the O(W×H) string
  // allocation that caused 10–20 s main-thread freezes for large sparse rooms.
  let litAir: Set<string> | null = null;

  if (!isOmni) {
    litAir = new Set<string>();
    const airQueueCols: number[] = [];
    const airQueueRows: number[] = [];
    let airQueueIndex = 0;

    const pushAirSeed = (c: number, r: number): void => {
      if (!_isInsideRoom(c, r, roomWidthBlocks, roomHeightBlocks)) return;
      const key = _tileKey(c, r);
      if ((litAir as Set<string>).has(key)) return;
      if (occupied.has(key)) return;       // solid: not a sky-seed
      if (blockers.has(key)) return;       // authored blocker: opaque to ambient
      (litAir as Set<string>).add(key);
      airQueueCols.push(c);
      airQueueRows.push(r);
    };

    // Seeds come from the room edges facing the sky (opposite to the direction
    // vector); the flood propagates inward through connected air so a hidden
    // pocket walled off from the sky-facing edge naturally stays dark.
    const seedTop    = directionVectorY > 0;  // light moves downward ⇒ enters from top
    const seedBottom = directionVectorY < 0;
    const seedLeft   = directionVectorX > 0;
    const seedRight  = directionVectorX < 0;

    if (seedTop)    for (let c = 0; c < roomWidthBlocks; c++) pushAirSeed(c, 0);
    if (seedBottom) for (let c = 0; c < roomWidthBlocks; c++) pushAirSeed(c, roomHeightBlocks - 1);
    if (seedLeft)   for (let r = 0; r < roomHeightBlocks; r++) pushAirSeed(0, r);
    if (seedRight)  for (let r = 0; r < roomHeightBlocks; r++) pushAirSeed(roomWidthBlocks - 1, r);

    // Flood-fill. Directional bias: only step into a neighbour whose offset
    // has a non-negative dot product with the direction vector (light keeps
    // travelling generally with the direction; perpendicular spread allowed).
    while (airQueueIndex < airQueueCols.length) {
      const col = airQueueCols[airQueueIndex];
      const row = airQueueRows[airQueueIndex];
      airQueueIndex++;

      for (let ny = -1; ny <= 1; ny++) {
        for (let nx = -1; nx <= 1; nx++) {
          if (nx === 0 && ny === 0) continue;
          const dot = nx * directionVectorX + ny * directionVectorY;
          if (dot < 0) continue; // skip stepping "uphill"
          const c = col + nx;
          const r = row + ny;
          if (!_isInsideRoom(c, r, roomWidthBlocks, roomHeightBlocks)) continue;
          const key = _tileKey(c, r);
          if (litAir.has(key) || occupied.has(key) || blockers.has(key)) continue;
          litAir.add(key);
          airQueueCols.push(c);
          airQueueRows.push(r);
        }
      }
    }
  }

  // ── Phase 2: BFS depth into solid cells from lit-air neighbours ─────────
  const solidQueueCols: number[] = [];
  const solidQueueRows: number[] = [];
  const solidQueueDepths: number[] = [];
  let qIndex = 0;

  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideRoom(col, row, roomWidthBlocks, roomHeightBlocks)) continue;

    // Solid cell is "exposed" if any 8-neighbour is a lit-air cell.
    // For omni mode litAir is null — every non-occupied non-blocker neighbour
    // counts as lit air; TypeScript narrows the type in the litAir !== null branch.
    let touchesLitAir = false;
    for (let dy = -1; dy <= 1 && !touchesLitAir; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks)) continue;
        const neighborKey = _tileKey(nc, nr);
        const isLitAirCell = litAir === null
          ? (!occupied.has(neighborKey) && !blockers.has(neighborKey))
          : litAir.has(neighborKey);
        if (isLitAirCell) {
          touchesLitAir = true;
          break;
        }
      }
    }

    if (touchesLitAir) {
      depths.set(key, 0);
      solidQueueCols.push(col);
      solidQueueRows.push(row);
      solidQueueDepths.push(0);
    }
  }

  while (qIndex < solidQueueCols.length) {
    const col = solidQueueCols[qIndex];
    const row = solidQueueRows[qIndex];
    const depth = solidQueueDepths[qIndex];
    qIndex++;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks) || !_isOccupied(occupied, nc, nr)) continue;
        const neighborKey = _tileKey(nc, nr);
        if (depths.has(neighborKey)) continue;
        const nextDepth = depth + 1;
        depths.set(neighborKey, nextDepth);
        solidQueueCols.push(nc);
        solidQueueRows.push(nr);
        solidQueueDepths.push(nextDepth);
      }
    }
  }

  // Solid cells never reached by the flood are authored dark pockets
  // (enclosed by walls or by a blocker field). Assign the maximum fallback
  // depth so the darkness tint saturates.
  const maxFallbackDepth = Math.max(roomWidthBlocks, roomHeightBlocks);
  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideRoom(col, row, roomWidthBlocks, roomHeightBlocks)) continue;
    if (!depths.has(key)) depths.set(key, maxFallbackDepth);
  }

  if (import.meta.env?.DEV && _devT0 > 0) {
    const ms = performance.now() - _devT0;
    const area = roomWidthBlocks * roomHeightBlocks;
    if (ms > 5 || area > 65536) {
      console.log(
        `[ambientLight] buildAmbientDepths: ${roomWidthBlocks}×${roomHeightBlocks}` +
        ` area=${area} walls=${occupied.size} dir=${direction} ms=${ms.toFixed(1)}`,
      );
    }
  }

  return depths;
}

// ── Default directional-lighting parameter values ─────────────────────────────

/** At 0 = broad ambient (side exposure contributes a lot); at 1 = strict spotlight. */
export const DEFAULT_DIRECTIONAL_BIAS = 0.65;
/**
 * How strongly non-sky-facing air neighbours (side/bottom) contribute to tile
 * brightness relative to sky-facing neighbours.  Applied to ALL side/bottom air
 * neighbours, whether sky-connected or not — this prevents open-cave walls from
 * producing a broad warm glow effect even when the cave interior is sky-connected.
 */
export const DEFAULT_SIDE_EXPOSURE_STRENGTH = 0.35;
/** Minimum brightness fraction for any solid tile adjacent to open air. */
export const DEFAULT_MINIMUM_WALL_LIGHT = 0.15;
/** Gamma-like exponent applied to the raw exposure value before computing darkness. */
export const DEFAULT_FALLOFF_POWER = 1.4;
/**
 * Optional warm-light spill onto the air/background layer.
 * 0.0 = no spill (default — prevents cloudy blob artefacts).
 * Higher values add a subtle warm haze into open spaces near lit walls.
 */
export const DEFAULT_BACKGROUND_LIGHT_SPILL = 0.0;
/**
 * Softness of the per-tile darkness overlay (0 = crisp pixel-art, 1 = max blur).
 * Keep at 0 to preserve sharp tile boundaries; increase slightly for softer look.
 */
export const DEFAULT_SOLID_LIGHT_SOFTNESS = 0.0;

/**
 * Blended directional ambient-light solver.
 *
 * Replaces the integer-depth output of {@link buildAmbientDepths} with a
 * smooth per-tile **darkness alpha** (0 = fully lit, 1 = pitch black) that
 * respects the primary light direction while giving solid tiles beside open
 * air some minimum visibility — preventing rooms with sealed ceilings from
 * rendering their walls as pure black.
 *
 * Three-phase algorithm:
 *
 * 1. **Lit-air flood** — identical to {@link buildAmbientDepths}: BFS from the
 *    sky-facing edge through non-solid, non-blocker cells.
 *
 * 2. **Surface tile computation** — for every solid tile that has at least one
 *    air neighbour, compute a darkness alpha from weighted directional exposure:
 *    - Each air neighbour contributes according to how closely the direction to
 *      that neighbour aligns with the light source direction.
 *    - Sky-facing neighbours (cosAngle > 0) get full effectiveness regardless of
 *      lit-air status.  Side and bottom neighbours are always attenuated by
 *      `sideExposureStrength`, whether the adjacent air is sky-connected or not.
 *      This prevents open caves from creating a broad warm glow on all their
 *      surrounding walls even when the entire cave interior is sky-connected.
 *    - `directionalBias` blends between a broad (low-bias) and a tight
 *      (high-bias) directional weighting.
 *    - The minimum brightness for any air-adjacent tile is clamped to
 *      `minimumWallLight`.
 *
 * 3. **Buried BFS** — solid tiles with no air neighbour are reached by BFS from
 *    the surface tiles; darkness deepens using the same exponential curve as
 *    {@link getDarknessAlphaFromAirDepth}, keeping the familiar gradient inside
 *    thick terrain. Tiles entirely unreachable by BFS are set to 1.0.
 *
 * @param occupied              Set of `"col,row"` keys for solid tiles.
 * @param blockers              Authored ambient-light blocker keys.
 * @param direction             Ambient-light travel direction.
 * @param roomWidthBlocks       Room width in tile units.
 * @param roomHeightBlocks      Room height in tile units.
 * @param directionalBias       0 = broad ambient, 1 = strict spotlight.
 * @param sideExposureStrength  Contribution weight for non-sky-connected air.
 * @param minimumWallLight      Brightness floor for air-adjacent tiles (0–1).
 * @param falloffPower          Exponent applied to raw exposure before darkness.
 * @returns Map from tile key to darkness alpha (0–1).
 */
export function buildAmbientDarknessAlphas(
  occupied:             Set<string>,
  blockers:             ReadonlySet<string>,
  direction:            AmbientLightDirection,
  roomWidthBlocks:      number,
  roomHeightBlocks:     number,
  directionalBias:      number,
  sideExposureStrength: number,
  minimumWallLight:     number,
  falloffPower:         number,
): Map<string, number> {
  const alphas = new Map<string, number>();
  if (roomWidthBlocks <= 0 || roomHeightBlocks <= 0) return alphas;

  const _devT0 = import.meta.env?.DEV ? performance.now() : 0;
  const { dx: dirVecX, dy: dirVecY } = ambientDirectionVector(direction);
  const isOmni = dirVecX === 0 && dirVecY === 0;

  // srcDir: vector pointing FROM the light source INTO the room (= travel direction).
  // We want the angle between the neighbour offset and the "arrival" direction so
  // that an air cell directly above a top-lit tile scores cosAngle = 1.0.
  // For 'down' (light travels downward), srcDx=0, srcDy=1; the neighbour above
  // (ny=-1) gives cos = dot((0,-1),(0,1))/(1·1) = -1 — that's wrong.
  // We want the neighbour OPPOSITE to the travel direction (i.e. the sky side).
  // Convention: srcDir = -travelDir so that the sky-facing neighbour scores +1.
  const srcDx = -dirVecX;
  const srcDy = -dirVecY;
  const srcMag = isOmni ? 1 : Math.sqrt(srcDx * srcDx + srcDy * srcDy); // always 1 for unit dirs

  // ── Phase 1 (removed): lit-air flood-fill ────────────────────────────────
  // Phase 2 computes surface darkness purely from geometric neighbor checks
  // (`!occupied && !blockers`). A separate lit-air Set is not needed and was
  // never consulted by Phase 2.  For large sparse rooms in omni mode the old
  // O(W×H) loop over all cells created millions of strings and caused 10–20 s
  // main-thread freezes.  Removing it has no effect on output correctness.

  if (import.meta.env?.DEV) {
    const _area = roomWidthBlocks * roomHeightBlocks;
    if (_area > 65536) {
      console.log(
        `[largeRoom] buildAmbientDarknessAlphas: ${roomWidthBlocks}×${roomHeightBlocks}` +
        ` area=${_area} walls=${occupied.size} dir=${direction}` +
        ` — sparse path (no O(W×H) litAir build)`,
      );
    }
  }

  // ── Phase 2: surface tile darkness computation ────────────────────────────
  // BFS queue for Phase 3. We store the "effective depth" so the exponential
  // falloff inside thick terrain matches the existing getDarknessAlphaFromAirDepth curve.
  const solidQCols: number[] = [];
  const solidQRows: number[] = [];
  const solidQEffDepths: number[] = [];

  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideRoom(col, row, roomWidthBlocks, roomHeightBlocks)) continue;

    // Accumulate multi-neighbour exposure via probabilistic product rule.
    let exposureProduct = 1.0;
    let hasAirNeighbor = false;

    for (let ny = -1; ny <= 1; ny++) {
      for (let nx = -1; nx <= 1; nx++) {
        if (nx === 0 && ny === 0) continue;
        const nc = col + nx;
        const nr = row + ny;
        if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks)) continue;
        const neighborKey = _tileKey(nc, nr);
        if (occupied.has(neighborKey) || blockers.has(neighborKey)) continue; // solid / blocker: skip
        hasAirNeighbor = true;

        let weight: number;
        let effectiveness: number;
        if (isOmni) {
          weight = 1.0;
          effectiveness = 1.0;
        } else {
          // Cosine of the angle between the neighbour offset and the sky direction.
          // Normalise the offset (its magnitude is 1 for cardinal, √2 for diagonal).
          const neighborMag = Math.sqrt(nx * nx + ny * ny);
          const cosAngle = (nx * srcDx + ny * srcDy) / (neighborMag * srcMag);
          // broadFactor: gently weighted even for side/opposite neighbours.
          const broadFactor = Math.max(0.15, (cosAngle + 1) / 2);
          // tightFactor: only sky-facing neighbours count.
          const tightFactor = Math.max(0, cosAngle) ** 2;
          // Blend between broad and tight according to directionalBias.
          weight = broadFactor + (tightFactor - broadFactor) * directionalBias;

          // Effectiveness is direction-based, not sky-connectivity-based.
          // Sky-facing neighbours (cosAngle > 0) receive full effectiveness;
          // side and bottom neighbours are always attenuated by sideExposureStrength.
          // This prevents open caves (where all interior air is sky-connected) from
          // producing a broad warm-glow artefact on all surrounding walls.
          const skyFacing = Math.max(0, cosAngle); // 0 (side/below) … 1 (straight up)
          effectiveness = skyFacing + (1 - skyFacing) * sideExposureStrength;
        }
        const contribution = weight * effectiveness;
        if (contribution >= 1) {
          // Full contribution from this neighbour → tile is fully lit, short-circuit.
          exposureProduct = 0;
          break;
        }
        exposureProduct *= (1 - contribution);
      }
      if (exposureProduct === 0) break;
    }

    if (!hasAirNeighbor) continue; // Tile will be reached via Phase 3 BFS or remain in Phase 4.

    const exposure = 1 - exposureProduct;
    const finalExposure = exposure <= 0 ? 0 : Math.pow(exposure, falloffPower);
    const brightness = Math.max(finalExposure, minimumWallLight);
    const da = Math.min(1, Math.max(0, 1 - brightness));

    alphas.set(key, da);
    // Invert getDarknessAlphaFromAirDepth: da = 0.1*(2^d - 1) ⟹ d = log2(da/0.1 + 1).
    const effDepth = Math.log2(da * 10 + 1);
    solidQCols.push(col);
    solidQRows.push(row);
    solidQEffDepths.push(effDepth);
  }

  // ── Phase 3: BFS into buried solid tiles ─────────────────────────────────
  // Saturation: getDarknessAlphaFromAirDepth(d) ≥ 1 when d ≥ log2(11) ≈ 3.46.
  const SATURATE_DEPTH = Math.log2(11);

  let solidQIdx = 0;
  while (solidQIdx < solidQCols.length) {
    const col = solidQCols[solidQIdx];
    const row = solidQRows[solidQIdx];
    const parentEffDepth = solidQEffDepths[solidQIdx];
    solidQIdx++;

    const childEffDepth = parentEffDepth + 1;
    if (childEffDepth > SATURATE_DEPTH) {
      // All future children will also be saturated — expand but assign 1.0 directly.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nc = col + dx;
          const nr = row + dy;
          if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks)) continue;
          const neighborKey = _tileKey(nc, nr);
          if (!occupied.has(neighborKey) || alphas.has(neighborKey)) continue;
          alphas.set(neighborKey, 1.0);
          solidQCols.push(nc);
          solidQRows.push(nr);
          solidQEffDepths.push(childEffDepth);
        }
      }
    } else {
      const childDa = getDarknessAlphaFromAirDepth(childEffDepth);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nc = col + dx;
          const nr = row + dy;
          if (!_isInsideRoom(nc, nr, roomWidthBlocks, roomHeightBlocks)) continue;
          const neighborKey = _tileKey(nc, nr);
          if (!occupied.has(neighborKey) || alphas.has(neighborKey)) continue;
          alphas.set(neighborKey, childDa);
          solidQCols.push(nc);
          solidQRows.push(nr);
          solidQEffDepths.push(childEffDepth);
        }
      }
    }
  }

  // ── Phase 4: unreached solid tiles (fully dark) ───────────────────────────
  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideRoom(col, row, roomWidthBlocks, roomHeightBlocks)) continue;
    if (!alphas.has(key)) alphas.set(key, 1.0);
  }

  if (import.meta.env?.DEV && _devT0 > 0) {
    const ms = performance.now() - _devT0;
    const area = roomWidthBlocks * roomHeightBlocks;
    if (ms > 5 || area > 65536) {
      console.log(
        `[ambientLight] buildAmbientDarknessAlphas: ${roomWidthBlocks}×${roomHeightBlocks}` +
        ` area=${area} walls=${occupied.size} dir=${direction} ms=${ms.toFixed(1)}`,
      );
    }
  }

  return alphas;
}
