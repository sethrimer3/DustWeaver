import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getConstellationLinkOpacity,
  selectConstellationLinkPairs,
  ConstellationLinkTracker,
  CONSTELLATION_LINK_QUALITY,
  type ConstellationLinkQualityConfig,
} from '../render/stormweaveConstellationLinks';

const CONFIG: ConstellationLinkQualityConfig = {
  maxNeighborsPerMote: 2,
  innerDistanceWorld: 2,
  outerDistanceWorld: 6,
  maxOpacity: 0.2,
};

function grid(count: number, spacing: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) points.push({ x: i * spacing, y: 0 });
  return points;
}

function accessors(points: { x: number; y: number }[]) {
  return {
    xAt: (i: number) => points[i].x,
    yAt: (i: number) => points[i].y,
  };
}

test('opacity is zero at and beyond the outer threshold', () => {
  assert.equal(getConstellationLinkOpacity(6, 2, 6, 0.2), 0);
  assert.equal(getConstellationLinkOpacity(10, 2, 6, 0.2), 0);
});

test('opacity is capped at maxOpacity at and inside the inner threshold', () => {
  assert.equal(getConstellationLinkOpacity(2, 2, 6, 0.2), 0.2);
  assert.equal(getConstellationLinkOpacity(0.5, 2, 6, 0.2), 0.2);
  assert.equal(getConstellationLinkOpacity(0, 2, 6, 0.2), 0.2);
});

test('opacity interpolates smoothly and monotonically between thresholds', () => {
  const samples = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6].map((d) => getConstellationLinkOpacity(d, 2, 6, 0.2));
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] <= samples[i - 1], `opacity must not increase as distance grows: ${samples}`);
  }
  assert.ok(samples[0] === 0.2 && samples[samples.length - 1] === 0);
  // Smoothstep interpolation must not be a hard linear cutoff: midpoint should sit near 0.5 of the range,
  // and the derivative should be shallower near the ends than a straight line would produce.
  const mid = getConstellationLinkOpacity(4, 2, 6, 0.2);
  const nearInner = getConstellationLinkOpacity(2.4, 2, 6, 0.2) - getConstellationLinkOpacity(2, 2, 6, 0.2);
  const nearMidStep = getConstellationLinkOpacity(4.2, 2, 6, 0.2) - getConstellationLinkOpacity(3.8, 2, 6, 0.2);
  assert.ok(mid > 0 && mid < 0.2);
  assert.ok(Math.abs(nearInner) < Math.abs(nearMidStep), 'slope near the inner threshold should be shallower (smoothstep, not linear)');
});

test('degenerate outer<=inner config falls back to a hard step instead of throwing', () => {
  assert.equal(getConstellationLinkOpacity(1, 3, 3, 0.2), 0.2);
  assert.equal(getConstellationLinkOpacity(5, 3, 3, 0.2), 0);
});

test('nearest-neighbor selection is deterministic and picks the closest motes', () => {
  const points = grid(5, 1.5);
  const { xAt, yAt } = accessors(points);
  const links = selectConstellationLinkPairs(points.length, xAt, yAt, CONFIG);
  // Mote 2 (middle) must connect to its two nearest neighbors, 1 and 3 (other
  // motes may also independently select 2 as one of their own neighbors,
  // which is a valid union-selected pair, not a violation).
  const involvingTwo = links.filter((l) => l.a === 2 || l.b === 2).map((l) => (l.a === 2 ? l.b : l.a)).sort();
  assert.ok(involvingTwo.includes(1) && involvingTwo.includes(3), `mote 2 must connect to its two nearest neighbors: got ${involvingTwo}`);
});

test('tie-breaking between equidistant candidates is stable (lower index wins first)', () => {
  // Mote 0 at origin; motes 1 and 2 equidistant on either side.
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 3, y: 0 }];
  const { xAt, yAt } = accessors(points);
  const config: ConstellationLinkQualityConfig = { maxNeighborsPerMote: 1, innerDistanceWorld: 0.5, outerDistanceWorld: 6, maxOpacity: 0.2 };
  const linksA = selectConstellationLinkPairs(points.length, xAt, yAt, config);
  const linksB = selectConstellationLinkPairs(points.length, xAt, yAt, config);
  assert.deepEqual(linksA, linksB, 'repeated calls with identical input must produce identical output');
  const zeroLink = linksA.find((l) => l.a === 0 || l.b === 0);
  assert.ok(zeroLink, 'mote 0 must select a nearest neighbor');
  assert.equal(zeroLink!.a === 0 ? zeroLink!.b : zeroLink!.a, 1, 'equidistant tie must resolve to the lower index');
});

test('per-mote connection cap is respected', () => {
  // A tight cluster where every mote is within range of every other mote.
  const points = [
    { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1.5, y: 0 }, { x: 2, y: 0 }, { x: 2.5, y: 0 },
  ];
  const { xAt, yAt } = accessors(points);
  const config: ConstellationLinkQualityConfig = { maxNeighborsPerMote: 2, innerDistanceWorld: 1, outerDistanceWorld: 10, maxOpacity: 0.2 };
  const links = selectConstellationLinkPairs(points.length, xAt, yAt, config);
  const degree = new Map<number, number>();
  for (const link of links) {
    degree.set(link.a, (degree.get(link.a) ?? 0) + 1);
    degree.set(link.b, (degree.get(link.b) ?? 0) + 1);
  }
  for (const [, count] of degree) {
    // Degree can exceed the per-mote cap because selection is a union over
    // both endpoints' independent top-K choices (mote i may pick j without j
    // picking i) — but it must stay small and bounded, never all-to-all.
    assert.ok(count <= config.maxNeighborsPerMote * 2, `degree ${count} must stay bounded by twice the cap`);
  }
});

test('no duplicate unordered pairs are produced', () => {
  const points = grid(8, 1);
  const { xAt, yAt } = accessors(points);
  const config: ConstellationLinkQualityConfig = { maxNeighborsPerMote: 3, innerDistanceWorld: 1, outerDistanceWorld: 10, maxOpacity: 0.2 };
  const links = selectConstellationLinkPairs(points.length, xAt, yAt, config);
  const keys = links.map((l) => `${l.a}:${l.b}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const link of links) assert.ok(link.a < link.b, 'pairs must be normalized with a < b');
});

test('behaves correctly as mote count grows and shrinks', () => {
  assert.deepEqual(selectConstellationLinkPairs(0, () => 0, () => 0, CONFIG), []);
  assert.deepEqual(selectConstellationLinkPairs(1, () => 0, () => 0, CONFIG), []);
  const grown = grid(10, 1.5);
  const shrunk = grown.slice(0, 3);
  const grownLinks = selectConstellationLinkPairs(grown.length, accessors(grown).xAt, accessors(grown).yAt, CONFIG);
  const shrunkLinks = selectConstellationLinkPairs(shrunk.length, accessors(shrunk).xAt, accessors(shrunk).yAt, CONFIG);
  assert.ok(grownLinks.length > 0);
  assert.ok(shrunkLinks.length > 0);
  for (const link of shrunkLinks) {
    assert.ok(link.a < shrunk.length && link.b < shrunk.length, 'no stale indices beyond the current mote count');
  }
});

test('quality gating: high has the full cap, med a smaller one, low is disabled', () => {
  assert.ok(CONSTELLATION_LINK_QUALITY.high);
  assert.ok(CONSTELLATION_LINK_QUALITY.med);
  assert.equal(CONSTELLATION_LINK_QUALITY.low, null);
  assert.ok(CONSTELLATION_LINK_QUALITY.high!.maxNeighborsPerMote >= CONSTELLATION_LINK_QUALITY.med!.maxNeighborsPerMote);
  assert.ok(CONSTELLATION_LINK_QUALITY.high!.outerDistanceWorld >= CONSTELLATION_LINK_QUALITY.med!.outerDistanceWorld);
});

test('ConstellationLinkTracker hysteresis keeps a boundary pair sticky across a small distance jitter', () => {
  const tracker = new ConstellationLinkTracker();
  const config: ConstellationLinkQualityConfig = { maxNeighborsPerMote: 1, innerDistanceWorld: 1, outerDistanceWorld: 5, maxOpacity: 0.2 };
  // Mote 0 has two candidates: 1 (closer) and 2 (just barely farther, near the cap boundary).
  const points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2.3, y: 0 }];
  const first = tracker.computeLinks(points.length, (i) => points[i].x, (i) => points[i].y, config);
  const firstPartner = first.find((l) => l.a === 0 || l.b === 0);
  assert.ok(firstPartner);
  // Now 1 and 2 swap to be nearly equidistant, with 2 marginally closer — without
  // hysteresis this would flip the selected neighbor every frame near the tie.
  points[1].x = 2.31;
  points[2].x = 2.3;
  const second = tracker.computeLinks(points.length, (i) => points[i].x, (i) => points[i].y, config);
  const secondPartner = second.find((l) => l.a === 0 || l.b === 0);
  assert.ok(secondPartner);
  const firstOther = firstPartner!.a === 0 ? firstPartner!.b : firstPartner!.a;
  const secondOther = secondPartner!.a === 0 ? secondPartner!.b : secondPartner!.a;
  assert.equal(firstOther, secondOther, 'hysteresis should keep the same neighbor selected across a marginal jitter');
});

test('ConstellationLinkTracker.reset clears smoothing state without throwing on subsequent use', () => {
  const tracker = new ConstellationLinkTracker();
  const points = grid(4, 1);
  tracker.computeLinks(points.length, (i) => points[i].x, (i) => points[i].y, CONFIG);
  tracker.reset();
  const after = tracker.computeLinks(points.length, (i) => points[i].x, (i) => points[i].y, CONFIG);
  assert.ok(Array.isArray(after));
});

test('Shield Weave-style tight ring positions do not corrupt or duplicate links', () => {
  const count = 12;
  const radius = 3;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  const tracker = new ConstellationLinkTracker();
  const links = tracker.computeLinks(count, (i) => points[i].x, (i) => points[i].y, CONFIG);
  const keys = links.map((l) => `${l.a}:${l.b}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const link of links) {
    assert.ok(link.a >= 0 && link.a < count && link.b >= 0 && link.b < count);
    assert.ok(link.opacity >= 0 && link.opacity <= CONFIG.maxOpacity);
  }
});

test('a large mote count keeps the rendered link count bounded, not O(n^2)', () => {
  const count = 48;
  const points: { x: number; y: number }[] = [];
  // Dense cluster: every mote within range of every other mote, worst case for an all-to-all web.
  for (let i = 0; i < count; i++) points.push({ x: (i % 8) * 0.4, y: Math.floor(i / 8) * 0.4 });
  const config: ConstellationLinkQualityConfig = { maxNeighborsPerMote: 3, innerDistanceWorld: 1, outerDistanceWorld: 20, maxOpacity: 0.2 };
  const links = selectConstellationLinkPairs(count, (i) => points[i].x, (i) => points[i].y, config);
  const allToAllCount = (count * (count - 1)) / 2;
  assert.ok(links.length < allToAllCount, 'must not degrade into an all-to-all web');
  assert.ok(links.length <= count * config.maxNeighborsPerMote, 'link count must stay bounded by n * cap');
});

test('helpers never mutate the positions supplied to them', () => {
  const points = grid(6, 1.2);
  const snapshot = points.map((p) => ({ ...p }));
  selectConstellationLinkPairs(points.length, (i) => points[i].x, (i) => points[i].y, CONFIG);
  assert.deepEqual(points, snapshot);
});
