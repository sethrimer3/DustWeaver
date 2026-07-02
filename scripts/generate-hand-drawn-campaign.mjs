/**
 * Generator for ASSETS/CAMPAIGNS/CUSTOM/hand_drawn_dustweaver_map.dwcampaign.json
 *
 * Greybox conversion of the 2026-04-26 hand-drawn "Dust, Wurm" map sketch.
 * Produces SavedCampaignV1 with SavedRoomV2 (v3) rooms.
 *
 * Conventions:
 *  - Every room has a 3-block-thick floor at rows [h-3, h). floorTop = h-3.
 *  - left/right doors: trigger strip pos = ledgeY-7, size 7 (just above the
 *    standing surface at that edge). Default ledge = room floor.
 *  - down doors: gap in the floor at [pos, pos+size).
 *  - up doors: one-way platform stack below the opening so it is climbable.
 *  - Transition trigger zones are flush with the room edge, 3 blocks deep
 *    (engine default gradientWidth) — spawns are placed outside those zones.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'ASSETS/CAMPAIGNS/CUSTOM/hand_drawn_dustweaver_map.dwcampaign.json';
const ISO = '2026-07-01T00:00:00.000Z';

// ─────────────────────────────────────────────────────────────────────────────
// Room builder
// ─────────────────────────────────────────────────────────────────────────────

const roomSpecs = [];
function defRoom(spec) { roomSpecs.push(spec); }

/** Per-room working state while building geometry. */
class B {
  constructor(spec) {
    this.spec = spec;
    this.w = spec.w; this.h = spec.h;
    this.floorTop = spec.h - 3;
    // one occupancy grid per theme key ('__default__' or folder/theme id)
    this.grids = new Map();
    this.platforms = [];           // {r:[x,y,w,h], plat:1}
    this.water = []; this.lava = [];
    this.enemies = []; this.transitions = [];
    this.saveTombs = []; this.skillTombs = []; this.dustContainers = [];
    this.spikes = []; this.springboards = []; this.breakableBlocks = [];
    this.dustBoostJars = []; this.dustPiles = []; this.crumbles = [];
    this.bounces = []; this.ropes = []; this.lights = []; this.guidePaths = [];
    this.fallingBlocks = [];
  }
  grid(themeKey) {
    let g = this.grids.get(themeKey);
    if (!g) { g = new Uint8Array(this.w * this.h); this.grids.set(themeKey, g); }
    return g;
  }
  /** Paint a solid rect for a theme. Out-of-range cells are clipped. */
  rect(themeKey, x, y, w, h) {
    const g = this.grid(themeKey);
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) g[yy * this.w + xx] = 1;
  }
  /** Erase cells across ALL theme grids (used to carve door gaps). */
  erase(x, y, w, h) {
    for (const g of this.grids.values()) {
      for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
        for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++)
          g[yy * this.w + xx] = 0;
    }
  }
  solidAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    for (const g of this.grids.values()) if (g[y * this.w + x]) return true;
    return false;
  }
  plat(x, y, w) {
    const key = `${x},${y},${w}`;
    if (this.platforms.some(p => p.key === key)) return;
    this.platforms.push({ key, r: [x, y, w, 1] });
  }
  /** One-way platform stack from startY down to (not incl.) floorTop-1, every 4 rows. */
  stack(x, w, startY, endY) {
    for (let y = startY; y <= endY; y += 4) this.plat(x, y, w);
  }
}

/** Greedy rect extraction from an occupancy grid → SavedSolidLayer rects. */
function extractRects(grid, w, h) {
  const g = grid.slice();
  const rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!g[y * w + x]) continue;
      let rw = 1;
      while (x + rw < w && g[y * w + x + rw]) rw++;
      let rh = 1;
      outer: while (y + rh < h) {
        for (let xx = x; xx < x + rw; xx++) if (!g[(y + rh) * w + xx]) break outer;
        rh++;
      }
      for (let yy = y; yy < y + rh; yy++)
        for (let xx = x; xx < x + rw; xx++) g[yy * w + xx] = 0;
      rects.push([x, y, rw, rh]);
    }
  }
  return rects;
}

// Door helpers ────────────────────────────────────────────────────────────────

function doorLedgeY(room, door) {
  return door.ledgeY ?? (room.h - 3);
}

/** Spawn block used when ENTERING `room` through `door`.
 * `rb` is the destination room's builder (for free-cell scanning). */
function spawnFor(room, door, rb) {
  const ledge = doorLedgeY(room, door);
  switch (door.dir) {
    case 'left':  return [4, ledge - 2];
    case 'right': return [room.w - 5, ledge - 2];
    case 'up':    return [door.pos + Math.floor(door.size / 2), 5];
    case 'down': {
      // Land beside the floor gap, on the nearest clear standing column.
      const y = room.h - 5;
      const clear = (x) => x >= 1 && x < room.w - 1 && !rb.solidAt(x, y) && !rb.solidAt(x, y + 1);
      for (let off = 3; off < room.w; off++) {
        if (clear(door.pos - off)) return [door.pos - off, y];
        if (clear(door.pos + door.size - 1 + off)) return [door.pos + door.size - 1 + off, y];
      }
      return [door.pos - 3, y]; // caught by validation if still bad
    }
  }
}

/** Trigger strip pos for a left/right door (vertical span above its ledge). */
function lrPos(room, door) { return doorLedgeY(room, door) - 7; }

// ─────────────────────────────────────────────────────────────────────────────
// ROOM DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
// Dust kinds used: Physical, Fire, Ice, Water, Void, Nature, Shadow, Lava.

// 01 ─ Desert surface (Eternal Dust Storm wall left, village, pyramid entry)
defRoom({
  id: 'room_desert_surface_start', name: 'Desert Surface', w: 64, h: 24,
  theme: 'sand', light: 'Ambient', map: [-500, -120],
  doors: {
    toShip: { dir: 'right' },
    toVoid: { dir: 'down', pos: 12, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Eternal Dust Storm wall — impassable column just inside the left edge.
    b.rect('sandStone', 2, 2, 2, ft - 2);
    // Pyramid steps flanking the shaft down into the void pyramid.
    b.rect('sandStone', 8, ft - 2, 4, 2);
    b.rect('sandStone', 17, ft - 2, 4, 2);
    b.rect('sandStone', 9, ft - 4, 3, 2);
    b.rect('sandStone', 17, ft - 4, 3, 2);
    // Village silhouettes (walk-behind greybox huts as raised blocks).
    b.rect('sandStoneBrick', 32, ft - 3, 3, 3);
    b.rect('sandStoneBrick', 40, ft - 4, 3, 4);
    b.rect('sandStoneBrick', 47, ft - 2, 3, 2);
    b.saveTombs.push([28, ft - 1]);
    b.dustBoostJars.push([36, ft - 1, 'Physical', 8]);
  },
});

// 02 ─ Void pyramid upper
defRoom({
  id: 'room_void_pyramid_upper', name: 'Void Pyramid', w: 40, h: 28,
  theme: 'obsidian', light: 'DarkRoom', map: [-500, 0],
  doors: {
    toDesert: { dir: 'up', pos: 17, size: 5 },
    toLower:  { dir: 'down', pos: 8, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Stepped interior walls.
    b.rect('carvedObsidian', 0, 8, 6, 2);
    b.rect('carvedObsidian', 34, 8, 6, 2);
    b.rect('carvedObsidian', 0, 14, 10, 2);
    b.rect('carvedObsidian', 30, 14, 10, 2);
    b.plat(14, 19, 4); b.plat(24, 19, 4);
    b.lights.push([20, 10, 8, 160, 90, 255, 70], [8, ft - 4, 5, 120, 60, 220, 55]);
    b.dustBoostJars.push([30, ft - 1, 'Void', 8]);
  },
});

// 03 ─ Void pyramid lower
defRoom({
  id: 'room_void_pyramid_lower', name: 'Void Chamber', w: 40, h: 24,
  theme: 'carvedObsidian', light: 'DarkRoom', map: [-500, 120],
  doors: { toUpper: { dir: 'up', pos: 8, size: 5 } },
  extra(b) {
    const ft = b.floorTop;
    b.enemies.push({ type: 'voidSingularity', pos: [24, ft - 4], kinds: ['Void'], particleCount: 12 });
    b.dustPiles.push([32, ft - 1, 20]);
    b.lights.push([20, 8, 7, 140, 80, 240, 60]);
    // TODO: late-game void dust / ability check lives here.
  },
});

// 04 ─ Sunken ship surface basin
defRoom({
  id: 'room_sunken_ship_surface', name: 'Sunken Ship', w: 72, h: 26,
  theme: 'sand', light: 'Ambient', map: [-300, -110],
  doors: {
    toDesert: { dir: 'left' },
    toBranch: { dir: 'right' },
    toWater:  { dir: 'down', pos: 34, size: 4 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Basin banks.
    b.rect('waterStone', 20, ft - 5, 4, 5);
    b.rect('waterStone', 48, ft - 5, 4, 5);
    // Water fills the basin; the down gap (x34..38) sits under the water so
    // sinking through it leads to the underwater room.
    b.water.push([24, ft - 5, 24, 5]);
    // Half-submerged ship hull + mast; jumping the hull crosses the basin.
    // TODO: gate this crossing behind ice/freeze once that mechanic is wired up.
    b.rect('br', 30, ft - 8, 12, 2);
    b.rect('br', 35, ft - 13, 1, 5);
    b.plat(31, ft - 9, 10);
  },
});

// 05 ─ Underwater ship interior
defRoom({
  id: 'room_sunken_ship_water', name: 'Ship Depths', w: 56, h: 32,
  theme: 'waterStone', light: 'Ambient', map: [-300, 0],
  doors: {
    toSurface: { dir: 'up', pos: 26, size: 4, noStack: true },
    toSpeed:   { dir: 'right' },
  },
  extra(b) {
    const ft = b.floorTop;
    b.water.push([0, 6, 56, ft - 6]);
    // Submerged wreck platforms.
    b.rect('br', 10, ft - 5, 6, 2);
    b.rect('br', 24, ft - 9, 8, 2);
    b.rect('br', 40, ft - 5, 6, 2);
    b.breakableBlocks.push([27, ft - 10], [28, ft - 10]);
    b.enemies.push({ type: 'slime', pos: [34, ft - 2], kinds: ['Water'], particleCount: 8 });
  },
});

// 06 ─ Speed check (long momentum channel)
defRoom({
  id: 'room_speed_check_water', name: 'Speed Check', w: 112, h: 24,
  theme: 'waterStone', light: 'Ambient', map: [-160, 30],
  doors: {
    toShip: { dir: 'left',  ledgeY: 14 },
    toExit: { dir: 'right', ledgeY: 14 },
  },
  extra(b) {
    const ft = b.floorTop; // 21
    // Runway platforms with momentum gaps; water pit below.
    const spans = [[10, 14], [28, 16], [48, 16], [68, 16], [88, 14]];
    for (const [x, w] of spans) b.plat(x, 14, w);
    b.water.push([8, 17, 96, ft - 17]);
    // Bounce pads on the pit floor under each gap — fallback recovery so the
    // room is passable before speed tuning. TODO: tune into a real speed gate.
    for (const x of [25, 45, 65, 85]) b.bounces.push({ r: [x, ft - 1, 2, 1] });
    b.springboards.push([5, 13]);
    // Pixie-dust movement hint along the runway.
    b.guidePaths.push({ pts: [[6, 12], [30, 11], [56, 11], [82, 11], [106, 12]] });
  },
});

// 07 ─ Speed check exit (recovery room)
defRoom({
  id: 'room_speed_check_exit', name: 'Still Waters Landing', w: 32, h: 20,
  theme: 'grayStone', light: 'Ambient', map: [-40, 30],
  doors: { toSpeed: { dir: 'left' }, toIce: { dir: 'right' } },
  extra(b) {
    const ft = b.floorTop;
    b.saveTombs.push([14, ft - 1]);
    b.dustContainers.push([20, ft - 1]);
  },
});

// 08 ─ Branch cliff (surface junction above the light/dark shaft)
defRoom({
  id: 'room_branch_cliff_surface', name: 'Branch Cliff', w: 48, h: 36,
  theme: 'sandStone', light: 'Ambient', map: [0, -100],
  doors: {
    toShip:     { dir: 'left',  ledgeY: 12 },
    toOvergrown:{ dir: 'right', ledgeY: 12 },
    toShaft:    { dir: 'down', pos: 22, size: 5 },
  },
  extra(b) {
    // Plateau bridge with a central drop into the shaft below.
    b.plat(10, 12, 10);
    b.plat(29, 12, 10);
    b.plat(16, 20, 6);
    b.plat(27, 26, 6);
  },
});

// 09 ─ Ice zone entry
defRoom({
  id: 'room_ice_zone_entry', name: 'Ice Zone', w: 48, h: 26,
  theme: 'frozenStone', light: 'Ambient', map: [-50, 120],
  doors: {
    toExit:  { dir: 'left' },
    toVines: { dir: 'right' },
    toCaves: { dir: 'down', pos: 30, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Slippery ice strips laid over the floor.
    b.rect('iceBlock', 6, ft - 1, 10, 1);
    b.rect('iceBlock', 20, ft - 1, 6, 1);
    // Small freezable pond with banks.
    b.rect('frozenStone', 38, ft - 3, 1, 3);
    b.rect('frozenStone', 44, ft - 3, 1, 3);
    b.water.push([39, ft - 3, 5, 3]);
    b.dustBoostJars.push([36, ft - 1, 'Fire', 10]); // fuel for the vine gate next door
    b.enemies.push({ type: 'wheel', pos: [24, ft - 2], kinds: ['Ice'], particleCount: 8 });
  },
});

// 10 ─ Ice/water/vines multi-element gate
defRoom({
  id: 'room_ice_water_vines', name: 'Thaw Gate', w: 48, h: 28,
  theme: 'frozenStone', light: 'Ambient', map: [80, 120],
  doors: {
    toIce:   { dir: 'left' },
    toShaft: { dir: 'right' },
  },
  extra(b) {
    const ft = b.floorTop;
    // Central water pocket ("Water Zone").
    b.rect('waterStone', 16, ft - 4, 1, 4);
    b.rect('waterStone', 27, ft - 4, 1, 4);
    b.water.push([17, ft - 4, 10, 4]);
    // "Vines to burn" — breakable-block curtain before the right door.
    // TODO: replace with real burnable vines when fire↔plant interaction lands.
    for (let y = ft - 6; y < ft; y++) b.breakableBlocks.push([38, y], [39, y]);
    b.enemies.push({ type: 'slime', pos: [10, ft - 2], kinds: ['Water'], particleCount: 8 });
  },
});

// 11 ─ Ice caves (vertical)
defRoom({
  id: 'room_ice_caves_upper', name: 'Ice Caves', w: 40, h: 40,
  theme: 'frozenStone', light: 'Ambient', map: [-120, 220],
  doors: {
    toIce:  { dir: 'up', pos: 28, size: 5 },
    toBoss: { dir: 'left' },
    toHub:  { dir: 'right' },
  },
  extra(b) {
    const ft = b.floorTop;
    // Zigzag descent ledges.
    b.rect('frozenStone', 6, 12, 8, 2);
    b.rect('iceBlock', 22, 17, 10, 1);
    b.rect('frozenStone', 6, 23, 8, 2);
    b.rect('frozenStone', 22, 29, 10, 2);
    b.spikes.push([8, 22, 'up'], [9, 22, 'up']);
    b.enemies.push({ type: 'flyingEye', pos: [20, 24], kinds: ['Ice'], particleCount: 8 });
    b.dustPiles.push([30, ft - 1, 12]);
  },
});

// 12 ─ Boss ice approach
defRoom({
  id: 'room_boss_ice_approach', name: 'Frozen Approach', w: 36, h: 20,
  theme: 'frozenStone', light: 'Ambient', map: [-260, 250],
  doors: { toCaves: { dir: 'right' }, toBoss: { dir: 'left' } },
  extra(b) {
    const ft = b.floorTop;
    b.saveTombs.push([20, ft - 1]);
    b.dustContainers.push([26, ft - 1]);
  },
});

// 13 ─ Boss ice arena
defRoom({
  id: 'room_boss_ice', name: 'Boss Ice', w: 48, h: 24,
  theme: 'frozenStone', light: 'Ambient', map: [-390, 250],
  doors: { toApproach: { dir: 'right' } },
  extra(b) {
    const ft = b.floorTop;
    // TODO: no door-locking system found — arena stays open; annotated placeholder.
    b.rect('iceBlock', 10, ft - 1, 26, 1);
    b.enemies.push({ type: 'rockElemental', pos: [18, ft - 4], kinds: ['Ice'], particleCount: 24, boss: true });
    // Reward: ice dust + a weave pickup (stands in for the "ice ability").
    b.dustBoostJars.push([8, ft - 1, 'Ice', 12]);
    b.skillTombs.push([6, ft - 1, 'storm']);
  },
});

// 14 ─ Central cave hub
defRoom({
  id: 'room_central_cave_hub', name: 'Central Hub', w: 64, h: 40,
  theme: 'grayStone', light: 'Ambient', map: [0, 260],
  doors: {
    toCaves: { dir: 'left',  ledgeY: 20 },
    toShaft: { dir: 'right', ledgeY: 20 },
    toReset: { dir: 'down', pos: 14, size: 5 },
    toPuzzle:{ dir: 'down', pos: 44, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Winding multi-level interior ("Climb up" / arrows in the sketch).
    b.rect('grayStone', 20, 26, 10, 2);
    b.rect('grayStone', 36, 30, 10, 2);
    b.plat(14, 30, 5);
    b.plat(26, 22, 6);
    b.plat(40, 24, 6);
    b.saveTombs.push([32, ft - 1]);
    b.enemies.push(
      { type: 'basic', pos: [24, ft - 2], kinds: ['Physical'], particleCount: 6 },
      { type: 'basic', pos: [50, ft - 2], kinds: ['Physical'], particleCount: 6 },
    );
  },
});

// 15 ─ Lower caves "Reset" loop
defRoom({
  id: 'room_lower_caves_reset', name: 'Reset Caves', w: 40, h: 24,
  theme: 'grayStone', light: 'Ambient', map: [0, 380],
  doors: {
    toHub:   { dir: 'up', pos: 8, size: 5 },
    toSwing: { dir: 'right' },
  },
  extra(b) {
    const ft = b.floorTop;
    // Fall in, springboard back out — safe reset loop.
    b.springboards.push([20, ft - 1], [28, ft - 1]);
    b.dustPiles.push([16, ft - 1, 10]);
  },
});

// 16 ─ Lower caves swing (ropes over a hazard pit)
defRoom({
  id: 'room_lower_caves_swing', name: 'Swing Gallery', w: 48, h: 32,
  theme: 'grayStone', light: 'Ambient', map: [160, 390],
  doors: {
    toReset:  { dir: 'left', ledgeY: 14 },
    toPuzzle: { dir: 'left' },              // floor level (puzzle sits lower on the map)
    toDark:   { dir: 'right' },
  },
  extra(b) {
    const ft = b.floorTop;
    // Hanging swing ropes (anchor B free).
    b.ropes.push(
      { aax: 18, aay: 3, abx: 18, aby: 11, fixed: false },
      { aax: 30, aay: 3, abx: 30, aby: 11, fixed: false },
    );
    b.spikes.push([22, ft - 1, 'up'], [23, ft - 1, 'up'], [26, ft - 1, 'up'], [27, ft - 1, 'up']);
    b.bounces.push({ r: [24, ft - 1, 2, 1] });
  },
});

// 17 ─ Falling block puzzle (two stacked chambers)
defRoom({
  id: 'room_falling_block_puzzle', name: 'Falling Block Puzzle', w: 40, h: 44,
  theme: 'grayStone', light: 'Ambient', map: [-40, 470],
  doors: {
    toHub:   { dir: 'up', pos: 6, size: 5 },
    toSwing: { dir: 'right' },
  },
  extra(b) {
    const ft = b.floorTop;
    // Mid divider splits the room into stacked chambers ("2 rooms on top of
    // each other"). Left gap (x0..2) is the climb-back route; crumble bridge
    // at x30..34 is the drop-through route.
    b.rect('grayStone', 2, 20, 28, 3);
    b.rect('grayStone', 34, 20, 6, 3);
    b.crumbles.push({ r: [30, 20, 4, 1] });
    // Falling blocks resting on the divider (upper chamber affects lower).
    b.fallingBlocks.push([12, 19, 's'], [13, 19, 'c'], [14, 19, 's'], [15, 19, 'c'], [16, 19, 't']);
    // Climb-back platforms in the lower chamber, through the left gap.
    b.stack(0, 3, 25, ft - 2);
    b.dustPiles.push([20, ft - 1, 15]);
  },
});

// 18 ─ Light/dark shaft (tall junction)
defRoom({
  id: 'room_light_dark_shaft_mid', name: 'Light-Dark Shaft', w: 28, h: 48,
  theme: 'grayStone', light: 'Ambient', map: [220, 170],
  doors: {
    toVines:  { dir: 'left',  ledgeY: 12 },
    toHub:    { dir: 'left',  ledgeY: 34 },
    toLock:   { dir: 'right', ledgeY: 22 },
    toBranch: { dir: 'up', pos: 11, size: 5 },
    toDark:   { dir: 'down', pos: 11, size: 5 },
  },
  extra(b) {
    // Zigzag descent through the whole shaft; light fades downward.
    b.plat(4, 16, 6); b.plat(18, 19, 6);
    b.plat(4, 26, 6); b.plat(18, 30, 6);
    b.plat(4, 38, 6); b.plat(18, 41, 6);
    b.lights.push([14, 6, 9, 255, 240, 200, 80]);
    // Dark accents near the bottom.
    b.rect('darkStone', 0, 40, 3, 5);
    b.rect('darkStone', 25, 40, 3, 5);
  },
  ambientDir: 'down',
});

// 19 ─ Enemy lock room
defRoom({
  id: 'room_enemy_lock_room', name: 'Enemy Lock', w: 32, h: 20,
  theme: 'darkStone', light: 'Ambient', map: [340, 150],
  doors: { toShaft: { dir: 'left' }, toArena: { dir: 'right' } },
  extra(b) {
    const ft = b.floorTop;
    // TODO: doors should lock until enemies die — no lock system found; placeholder arena.
    b.enemies.push(
      { type: 'slime', pos: [12, ft - 2], kinds: ['Physical'], particleCount: 6 },
      { type: 'slime', pos: [20, ft - 2], kinds: ['Physical'], particleCount: 6 },
      { type: 'wheel', pos: [16, ft - 2], kinds: ['Physical'], particleCount: 8 },
    );
  },
});

// 20 ─ Boss lock arena
defRoom({
  id: 'room_boss_lock_arena', name: 'Boss Lock Arena', w: 44, h: 24,
  theme: 'darkStone', light: 'Ambient', map: [450, 160],
  doors: { toLock: { dir: 'left' }, toGrapple: { dir: 'right' } },
  extra(b) {
    const ft = b.floorTop;
    // TODO: room-lock + boss-fight trigger — placeholder boss until lock logic exists.
    b.enemies.push({ type: 'largeSlime', pos: [24, ft - 4], kinds: ['Nature'], particleCount: 20, boss: true });
    b.dustContainers.push([6, ft - 1]);
  },
});

// 21 ─ Dark zone lower entry
defRoom({
  id: 'room_dark_zone_lower_entry', name: 'Dark Zone', w: 44, h: 26,
  theme: 'darkStone', light: 'DarkRoom', map: [250, 360],
  doors: {
    toShaft: { dir: 'up', pos: 20, size: 5 },
    toSwing: { dir: 'left' },
    toMain:  { dir: 'right' },
    toTele:  { dir: 'down', pos: 32, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    b.lights.push([8, ft - 4, 6, 255, 220, 150, 70], [26, 10, 5, 255, 220, 150, 55]);
    b.saveTombs.push([8, ft - 1]);
    // TODO: dark-zone enemy concept (shadow that only moves in light / white
    // shadow that moves in dark) — flying eye with Shadow dust as placeholder.
    b.enemies.push({ type: 'flyingEye', pos: [22, 12], kinds: ['Shadow'], particleCount: 8 });
  },
});

// 22 ─ Dark zone main
defRoom({
  id: 'room_dark_zone_main', name: 'Deep Dark', w: 52, h: 26,
  theme: 'darkStone', light: 'DarkRoom', map: [390, 360],
  doors: { toEntry: { dir: 'left' }, toGolden: { dir: 'right' } },
  extra(b) {
    const ft = b.floorTop;
    b.lights.push([14, 12, 5, 200, 190, 255, 45], [38, 10, 5, 200, 190, 255, 45]);
    b.plat(18, ft - 5, 6); b.plat(30, ft - 8, 6);
    // "Dark Zone has less weak plants" — only a couple of breakables here.
    b.breakableBlocks.push([26, ft - 1], [27, ft - 1]);
    b.enemies.push(
      { type: 'flyingEye', pos: [16, 10], kinds: ['Shadow'], particleCount: 8 },
      { type: 'flyingEye', pos: [40, 12], kinds: ['Shadow'], particleCount: 8 },
    );
  },
});

// 23 ─ Golden dust region
defRoom({
  id: 'room_golden_dust_region', name: 'Golden Dust', w: 40, h: 24,
  theme: 'sandStone', light: 'FullyLit', map: [520, 320],
  doors: {
    toDark:    { dir: 'left' },
    toGrapple: { dir: 'up', pos: 18, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Reward chamber: looping golden dust guide path + piles.
    b.guidePaths.push({ pts: [[12, 8], [28, 8], [28, ft - 4], [12, ft - 4]], lp: 1 });
    b.dustPiles.push([16, ft - 1, 25], [20, ft - 1, 25], [24, ft - 1, 25]);
    b.dustContainers.push([30, ft - 1]);
    // TODO: "Golden Door" from the sketch — unmodelled; this room is its reward side.
  },
});

// 24 ─ Grapple vault + crumble wall secret
defRoom({
  id: 'room_grapple_vault_region', name: 'Grapple Vault', w: 36, h: 36,
  theme: 'grayStone', light: 'Ambient', map: [520, 210],
  doors: {
    toArena:  { dir: 'left', ledgeY: 16 },
    toGolden: { dir: 'down', pos: 18, size: 5 },
    toShaft:  { dir: 'up', pos: 8, size: 5 },
  },
  extra(b) {
    const ft = b.floorTop;
    b.ropes.push(
      { aax: 14, aay: 3, abx: 14, aby: 11, fixed: false },
      { aax: 24, aay: 5, abx: 24, aby: 13, fixed: false },
    );
    // "Sec." — crumble wall hiding an alcove reward.
    b.rect('grayStone', 33, ft - 8, 3, 2);
    b.crumbles.push({ r: [30, ft - 6, 2, 6] });
    b.dustBoostJars.push([34, ft - 1, 'Physical', 10]);
    b.enemies.push({ type: 'grappleHunter', pos: [18, 20], kinds: ['Physical'], particleCount: 8 });
  },
});

// 25 ─ Overgrown shaft
defRoom({
  id: 'room_overgrown_shaft', name: 'Overgrowth Zone', w: 28, h: 44,
  theme: 'overgrowth', light: 'Ambient', map: [520, 10],
  doors: {
    toGrapple: { dir: 'down', pos: 8, size: 5 },
    toUpper:   { dir: 'up', pos: 14, size: 5 },
    toMagma:   { dir: 'right', ledgeY: 20 },
  },
  extra(b) {
    const ft = b.floorTop;
    // Vine-ladder zigzag up the shaft.
    b.plat(4, 12, 6); b.plat(16, 16, 6);
    b.plat(4, 24, 6); b.plat(16, 28, 6);
    b.plat(4, 34, 6);
    b.ropes.push({ aax: 12, aay: 3, abx: 12, aby: 10, fixed: false });
    b.saveTombs.push([20, ft - 1]);
    b.enemies.push({ type: 'beetle', pos: [14, ft - 2], kinds: ['Nature'], particleCount: 8 });
  },
});

// 26 ─ Overgrown upper caves (physics chains / hanging vegetation)
defRoom({
  id: 'room_overgrown_upper', name: 'Overgrown Canopy', w: 56, h: 28,
  theme: 'overgrowth', light: 'Ambient', map: [500, -140],
  doors: {
    toShaft:  { dir: 'down', pos: 26, size: 5 },
    toBranch: { dir: 'left' },
  },
  extra(b) {
    const ft = b.floorTop;
    // Hanging physics chains ("Physics-based chain issue?" note).
    b.ropes.push(
      { aax: 14, aay: 2, abx: 14, aby: 9, fixed: false },
      { aax: 26, aay: 2, abx: 26, aby: 10, fixed: false },
      { aax: 40, aay: 2, abx: 40, aby: 9, fixed: false },
    );
    // Organic bumps + glowing patches.
    b.rect('glowingOvergrowth', 18, ft - 2, 5, 2);
    b.rect('glowingOvergrowth', 36, ft - 3, 4, 3);
    // Overgrown areas have MORE weak plants than the dark zone.
    for (const x of [10, 11, 24, 25, 33, 46, 47]) b.breakableBlocks.push([x, ft - 1]);
    b.enemies.push({ type: 'webSpider', pos: [30, 8], kinds: ['Nature'], particleCount: 10 });
  },
});

// 27 ─ Magma entry
defRoom({
  id: 'room_magma_entry', name: 'Magma Zone', w: 44, h: 24,
  theme: 'magmaStone', light: 'Ambient', map: [680, 30],
  doors: { toShaft: { dir: 'left' }, toDeeper: { dir: 'right' } },
  extra(b) {
    const ft = b.floorTop;
    // Lava pool with banks and a platform crossing.
    b.rect('magma', 15, ft - 4, 1, 4);
    b.rect('magma', 28, ft - 4, 1, 4);
    b.lava.push([16, ft - 4, 12, 4]);
    b.plat(18, ft - 7, 3); b.plat(24, ft - 7, 3);
    b.spikes.push([13, ft - 1, 'up'], [30, ft - 1, 'up']);
    b.lights.push([22, ft - 5, 7, 255, 140, 60, 65]);
    b.enemies.push({ type: 'rolling', pos: [36, ft - 2], kinds: ['Lava'], particleCount: 8 });
  },
});

// 28 ─ Magma deeper (placeholder continuation)
defRoom({
  id: 'room_magma_deeper', name: 'Magma Depths', w: 36, h: 20,
  theme: 'magma', light: 'Ambient', map: [820, 30],
  doors: { toEntry: { dir: 'left' } },
  extra(b) {
    const ft = b.floorTop;
    b.rect('magmaStone', 24, ft - 3, 1, 3);
    b.lava.push([25, ft - 3, 6, 3]);
    b.dustBoostJars.push([20, ft - 1, 'Fire', 12]);
    b.lights.push([27, ft - 4, 6, 255, 120, 50, 70]);
    // TODO: biome continues here in a later pass.
  },
});

// 29 ─ Teleporter pyramid descent
defRoom({
  id: 'room_teleporter_pyramid_entry', name: 'Pyramid Descent', w: 32, h: 40,
  theme: 'darkStone', light: 'Ambient', map: [250, 520],
  doors: {
    toDark: { dir: 'up', pos: 14, size: 5 },
    toTele: { dir: 'down', pos: 14, size: 5 },
  },
  extra(b) {
    // Long angular descent.
    b.plat(6, 14, 6); b.plat(20, 18, 6);
    b.plat(6, 24, 6); b.plat(20, 28, 6);
    b.rect('whiteMarble', 0, 32, 4, 5);
    b.rect('whiteMarble', 28, 32, 4, 5);
  },
  ambientDir: 'down',
});

// 30 ─ Teleporter room (inside pyramid)
defRoom({
  id: 'room_teleporter_room', name: 'Teleporter Room', w: 44, h: 26,
  theme: 'whiteMarble', light: 'DarkRoom', map: [250, 670],
  doors: { toEntry: { dir: 'up', pos: 20, size: 5 } },
  extra(b) {
    const ft = b.floorTop;
    // Pyramid-stepped interior walls.
    b.rect('whiteMarble', 0, 8, 6, 3);
    b.rect('whiteMarble', 38, 8, 6, 3);
    b.rect('whiteMarble', 0, 14, 10, 3);
    b.rect('whiteMarble', 34, 14, 10, 3);
    // Central dais — TODO: teleporter interactable / fast-travel hub.
    b.rect('whiteMarble', 18, ft - 2, 8, 2);
    b.lights.push([22, ft - 5, 8, 180, 230, 255, 85], [8, 10, 5, 150, 200, 255, 50], [36, 10, 5, 150, 200, 255, 50]);
    b.saveTombs.push([10, ft - 1]);
    b.dustContainers.push([32, ft - 1]);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTIONS  [roomA, doorKeyA, roomB, doorKeyB]
// ─────────────────────────────────────────────────────────────────────────────

const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };
const connections = [
  ['room_desert_surface_start', 'toShip',  'room_sunken_ship_surface', 'toDesert'],
  ['room_desert_surface_start', 'toVoid',  'room_void_pyramid_upper',  'toDesert'],
  ['room_void_pyramid_upper',   'toLower', 'room_void_pyramid_lower',  'toUpper'],
  ['room_sunken_ship_surface',  'toBranch','room_branch_cliff_surface','toShip'],
  ['room_sunken_ship_surface',  'toWater', 'room_sunken_ship_water',   'toSurface'],
  ['room_sunken_ship_water',    'toSpeed', 'room_speed_check_water',   'toShip'],
  ['room_speed_check_water',    'toExit',  'room_speed_check_exit',    'toSpeed'],
  ['room_speed_check_exit',     'toIce',   'room_ice_zone_entry',      'toExit'],
  ['room_ice_zone_entry',       'toVines', 'room_ice_water_vines',     'toIce'],
  ['room_ice_zone_entry',       'toCaves', 'room_ice_caves_upper',     'toIce'],
  ['room_ice_water_vines',      'toShaft', 'room_light_dark_shaft_mid','toVines'],
  ['room_ice_caves_upper',      'toBoss',  'room_boss_ice_approach',   'toCaves'],
  ['room_ice_caves_upper',      'toHub',   'room_central_cave_hub',    'toCaves'],
  ['room_boss_ice_approach',    'toBoss',  'room_boss_ice',            'toApproach'],
  ['room_central_cave_hub',     'toShaft', 'room_light_dark_shaft_mid','toHub'],
  ['room_central_cave_hub',     'toReset', 'room_lower_caves_reset',   'toHub'],
  ['room_central_cave_hub',     'toPuzzle','room_falling_block_puzzle','toHub'],
  ['room_lower_caves_reset',    'toSwing', 'room_lower_caves_swing',   'toReset'],
  ['room_falling_block_puzzle', 'toSwing', 'room_lower_caves_swing',   'toPuzzle'],
  ['room_lower_caves_swing',    'toDark',  'room_dark_zone_lower_entry','toSwing'],
  ['room_light_dark_shaft_mid', 'toLock',  'room_enemy_lock_room',     'toShaft'],
  ['room_light_dark_shaft_mid', 'toDark',  'room_dark_zone_lower_entry','toShaft'],
  ['room_light_dark_shaft_mid', 'toBranch','room_branch_cliff_surface','toShaft'],
  ['room_enemy_lock_room',      'toArena', 'room_boss_lock_arena',     'toLock'],
  ['room_boss_lock_arena',      'toGrapple','room_grapple_vault_region','toArena'],
  ['room_dark_zone_lower_entry','toMain',  'room_dark_zone_main',      'toEntry'],
  ['room_dark_zone_lower_entry','toTele',  'room_teleporter_pyramid_entry','toDark'],
  ['room_dark_zone_main',       'toGolden','room_golden_dust_region',  'toDark'],
  ['room_golden_dust_region',   'toGrapple','room_grapple_vault_region','toGolden'],
  ['room_grapple_vault_region', 'toShaft', 'room_overgrown_shaft',     'toGrapple'],
  ['room_overgrown_shaft',      'toUpper', 'room_overgrown_upper',     'toShaft'],
  ['room_overgrown_shaft',      'toMagma', 'room_magma_entry',         'toShaft'],
  ['room_overgrown_upper',      'toBranch','room_branch_cliff_surface','toOvergrown'],
  ['room_magma_entry',          'toDeeper','room_magma_deeper',        'toEntry'],
  ['room_teleporter_pyramid_entry','toTele','room_teleporter_room',    'toEntry'],
];

// ─────────────────────────────────────────────────────────────────────────────
// BUILD
// ─────────────────────────────────────────────────────────────────────────────

const byId = new Map(roomSpecs.map(s => [s.id, s]));
const errors = [];

// Validate connection table shape.
for (const [aId, aKey, bId, bKey] of connections) {
  const a = byId.get(aId), bR = byId.get(bId);
  if (!a) { errors.push(`unknown room ${aId}`); continue; }
  if (!bR) { errors.push(`unknown room ${bId}`); continue; }
  const da = a.doors[aKey], db = bR.doors[bKey];
  if (!da) { errors.push(`${aId} missing door ${aKey}`); continue; }
  if (!db) { errors.push(`${bId} missing door ${bKey}`); continue; }
  if (OPPOSITE[da.dir] !== db.dir) errors.push(`${aId}.${aKey} (${da.dir}) vs ${bId}.${bKey} (${db.dir}) not opposite`);
}

// Every door must be used exactly once.
const used = new Set();
for (const [aId, aKey, bId, bKey] of connections) { used.add(`${aId}.${aKey}`); used.add(`${bId}.${bKey}`); }
for (const s of roomSpecs) for (const k of Object.keys(s.doors))
  if (!used.has(`${s.id}.${k}`)) errors.push(`door ${s.id}.${k} unused`);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const savedRooms = [];
const buildersById = new Map();

for (const spec of roomSpecs) {
  const b = new B(spec);
  const ft = b.floorTop;

  // Floor with down-door gaps.
  const gaps = Object.values(spec.doors).filter(d => d.dir === 'down')
    .map(d => [d.pos, d.pos + d.size]).sort((x, y) => x[0] - y[0]);
  let cursor = 0;
  for (const [g0, g1] of gaps) {
    if (g0 > cursor) b.rect('__default__', cursor, ft, g0 - cursor, 3);
    cursor = g1;
  }
  if (cursor < spec.w) b.rect('__default__', cursor, ft, spec.w - cursor, 3);

  // Ledges + climb platforms for elevated left/right doors.
  for (const d of Object.values(spec.doors)) {
    if ((d.dir === 'left' || d.dir === 'right') && d.ledgeY !== undefined) {
      const lx = d.dir === 'left' ? 0 : spec.w - 8;
      b.rect('__default__', lx, d.ledgeY, 8, 3);
      const sx = d.dir === 'left' ? 9 : spec.w - 13;
      b.stack(sx, 4, d.ledgeY + 4, ft - 2);
    }
    // Climbable platform stack under each up door.
    if (d.dir === 'up' && !d.noStack) {
      b.stack(d.pos, Math.max(3, d.size - 1), 6, ft - 2);
    }
  }

  spec.extra?.(b);
  buildersById.set(spec.id, b);
}

// Transitions (need all builders first for target spawns).
for (const [aId, aKey, bId, bKey] of connections) {
  for (const [srcId, srcKey, dstId, dstKey] of [[aId, aKey, bId, bKey], [bId, bKey, aId, aKey]]) {
    const src = byId.get(srcId), dst = byId.get(dstId);
    const sb = buildersById.get(srcId);
    const d = src.doors[srcKey];
    const dd = dst.doors[dstKey];
    const pos = (d.dir === 'left' || d.dir === 'right') ? lrPos(src, d) : d.pos;
    const size = (d.dir === 'left' || d.dir === 'right') ? 7 : d.size;
    sb.transitions.push({ dir: d.dir, to: dstId, pos, size, spawn: spawnFor(dst, dd, buildersById.get(dstId)) });
  }
}

// Emit SavedRoomV2.
for (const spec of roomSpecs) {
  const b = buildersById.get(spec.id);

  // Safe room spawn: prefer center of floor, scan for a free 2-tall column.
  const sy = b.floorTop - 2;
  let sx = Math.floor(spec.w / 2);
  const free = (x) => !b.solidAt(x, sy) && !b.solidAt(x, sy + 1) && b.solidAt(x, b.floorTop);
  if (!free(sx)) {
    for (let off = 1; off < spec.w; off++) {
      if (free(sx - off)) { sx = sx - off; break; }
      if (free(sx + off)) { sx = sx + off; break; }
    }
  }
  const spawn = spec.spawn ?? [sx, sy];

  const byTheme = {};
  for (const [key, grid] of [...b.grids.entries()].sort((a, c) => a[0].localeCompare(c[0]))) {
    const rects = extractRects(grid, spec.w, spec.h);
    if (rects.length) byTheme[key] = { rects };
  }

  const room = {
    v: 3,
    id: spec.id,
    name: spec.name,
    world: 1,
    size: [spec.w, spec.h],
    spawn,
    solids: { byTheme },
    map: spec.map,
    theme: spec.theme,
    bg: 'brownRock',
    light: spec.light,
  };
  if (spec.ambientDir) room.ambientDir = spec.ambientDir;
  if (b.platforms.length) room.specialWalls = b.platforms.map(p => ({ r: p.r, plat: 1 }));
  if (b.enemies.length) room.enemies = b.enemies;
  if (b.transitions.length) room.transitions = b.transitions;
  if (b.saveTombs.length) room.saveTombs = b.saveTombs;
  if (b.skillTombs.length) room.skillTombs = b.skillTombs;
  if (b.dustContainers.length) room.dustContainers = b.dustContainers;
  if (b.spikes.length) room.spikes = b.spikes;
  if (b.springboards.length) room.springboards = b.springboards;
  if (b.water.length) room.waterLayer = { rects: b.water };
  if (b.lava.length) room.lavaLayer = { rects: b.lava };
  if (b.breakableBlocks.length) room.breakableBlocks = b.breakableBlocks;
  if (b.dustBoostJars.length) room.dustBoostJars = b.dustBoostJars;
  if (b.dustPiles.length) room.dustPiles = b.dustPiles;
  if (b.crumbles.length) room.crumbles = b.crumbles;
  if (b.bounces.length) room.bounces = b.bounces;
  if (b.ropes.length) room.ropes = b.ropes;
  if (b.lights.length) room.lights = b.lights;
  if (b.guidePaths.length) room.guidePaths = b.guidePaths;
  if (b.fallingBlocks.length) room.fallingBlocks = b.fallingBlocks;
  savedRooms.push(room);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

const ids = new Set(savedRooms.map(r => r.id));
for (const r of savedRooms) {
  const [w, h] = r.size;
  const [sx2, sy2] = r.spawn;
  if (sx2 < 0 || sy2 < 0 || sx2 >= w || sy2 >= h) errors.push(`${r.id}: spawn out of bounds`);
  for (const t of r.transitions ?? []) {
    if (!ids.has(t.to)) errors.push(`${r.id}: transition to unknown ${t.to}`);
    const span = t.dir === 'left' || t.dir === 'right' ? h : w;
    if (t.pos < 0 || t.pos + t.size > span) errors.push(`${r.id}: transition ${t.dir}→${t.to} strip out of range (pos ${t.pos} size ${t.size})`);
    const [tsx, tsy] = t.spawn;
    const target = savedRooms.find(rr => rr.id === t.to);
    if (tsx < 0 || tsy < 0 || tsx >= target.size[0] || tsy >= target.size[1])
      errors.push(`${r.id}: spawn into ${t.to} out of bounds [${tsx},${tsy}]`);
  }
}

// Reachability BFS over transitions.
const adj = new Map(savedRooms.map(r => [r.id, (r.transitions ?? []).map(t => t.to)]));
const seen = new Set(['room_desert_surface_start']);
const queue = ['room_desert_surface_start'];
while (queue.length) {
  const cur = queue.shift();
  for (const nxt of adj.get(cur)) if (!seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
}
for (const id of ids) if (!seen.has(id)) errors.push(`unreachable room: ${id}`);

// Spawn cells must not be inside solids of the target room.
for (const r of savedRooms) {
  const bb = buildersById.get(r.id);
  const [px, py] = r.spawn;
  if (bb.solidAt(px, py)) errors.push(`${r.id}: room spawn inside solid`);
  for (const t of r.transitions ?? []) {
    const tb = buildersById.get(t.to);
    if (tb.solidAt(t.spawn[0], t.spawn[1])) errors.push(`${r.id}→${t.to}: transition spawn inside solid at [${t.spawn}]`);
  }
}

if (errors.length) { console.error('VALIDATION ERRORS:\n' + errors.join('\n')); process.exit(1); }

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN ENVELOPE
// ─────────────────────────────────────────────────────────────────────────────

const startFloorTop = byId.get('room_desert_surface_start').h - 3;
const campaign = {
  v: 1,
  kind: 'DustWeaverCampaign',
  metadata: { version: 1, lastEditedAt: ISO },
  campaign: {
    id: 'hand_drawn_dustweaver_map',
    title: 'DustWeaver Hand-Drawn Map Prototype',
    creator: 'GravyThyme',
    description: 'Greybox prototype of the April 2026 hand-drawn "Dust, Wurm" overworld sketch: desert surface, void pyramid, sunken ship, speed check, ice zone, central hub, light/dark shaft, dark zone, golden dust, grapple vault, overgrowth, magma, and the teleporter pyramid.',
    initialRoomId: 'room_desert_surface_start',
    initialRoomImagePath: null,
    campaignSpawn: {
      roomId: 'room_desert_surface_start',
      xBlock: 8,
      yBlock: startFloorTop - 2,
      startingDustTypes: ['Physical'],
      startingDustContainerCount: 2,
    },
  },
  worldMap: {
    worlds: [{ id: 1, name: 'Dust, Wurm' }],
    rooms: roomSpecs.map(s => ({ id: s.id, name: s.name, worldId: 1, mapX: s.map[0], mapY: s.map[1] })),
  },
  rooms: savedRooms,
  editor: { createdWithBuild: 'script-greybox-1', lastEditedIso: ISO },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(campaign, null, 1) + '\n', 'utf8');
console.log(`wrote ${OUT} (${savedRooms.length} rooms, ${connections.length} connections, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
