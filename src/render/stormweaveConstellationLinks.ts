/**
 * stormweaveConstellationLinks.ts — Pure, render-only helpers for the thin
 * "constellation" lines drawn between nearby canonical Stormweave life motes.
 *
 * Deliberately named away from the unrelated `DustConstellation` enemy AI
 * system (`src/sim/clusters/dustConstellationAi.ts`) — this module has
 * nothing to do with it.
 *
 * Everything here is pure and allocation-bounded: no canvas/DOM, no wall-clock
 * randomness, and no access to (or mutation of) simulation state beyond the
 * read-only mote positions the caller supplies. `ConstellationLinkTracker`
 * carries render-local frame-to-frame smoothing state only — it must never be
 * persisted to save data or treated as authoritative simulation state.
 */

export interface ConstellationLink {
  /** Lower mote index of the pair. */
  readonly a: number;
  /** Higher mote index of the pair. */
  readonly b: number;
  /** Current visual opacity for this link, already resolved from distance. */
  readonly opacity: number;
}

export interface ConstellationLinkQualityConfig {
  /** Maximum nearest-neighbor connections drawn per mote (bounds total link count to roughly n * this / 2). */
  readonly maxNeighborsPerMote: number;
  /** Distance at/inside which a link is at `maxOpacity`. */
  readonly innerDistanceWorld: number;
  /** Distance at/beyond which a link is fully transparent. */
  readonly outerDistanceWorld: number;
  /** Opacity cap approached near the inner threshold; kept subtle rather than fully opaque. */
  readonly maxOpacity: number;
}

/**
 * Ranking bias applied when sorting neighbor candidates: a pair that was
 * connected last frame gets its distance scaled down by this factor purely
 * for neighbor-cap ranking purposes (not for opacity), so it stays "sticky"
 * near the cap boundary instead of popping in and out as a marginally closer
 * candidate mote drifts by. Opacity itself is always derived from the real
 * distance, so this never lets a link render brighter than its true distance
 * warrants — it only stabilizes which pairs make the cut.
 */
export const CONSTELLATION_LINK_HYSTERESIS_FACTOR = 0.82;

/**
 * Smoothly maps distance to opacity: 0 at/beyond `outerDistanceWorld`,
 * `maxOpacity` at/inside `innerDistanceWorld`, smoothstep-interpolated
 * between. Degenerate `outer <= inner` configs fall back to a hard step.
 */
export function getConstellationLinkOpacity(
  distanceWorld: number,
  innerDistanceWorld: number,
  outerDistanceWorld: number,
  maxOpacity: number,
): number {
  if (outerDistanceWorld <= innerDistanceWorld) {
    return distanceWorld <= innerDistanceWorld ? maxOpacity : 0;
  }
  if (distanceWorld <= innerDistanceWorld) return maxOpacity;
  if (distanceWorld >= outerDistanceWorld) return 0;
  const t = 1 - (distanceWorld - innerDistanceWorld) / (outerDistanceWorld - innerDistanceWorld);
  const smoothT = t * t * (3 - 2 * t);
  return smoothT * maxOpacity;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Deterministic, bounded-neighbor pair selection over `count` motes, whose
 * positions are supplied via `xAt`/`yAt` accessors so callers never need to
 * materialize a positions array or object. For each mote, up to
 * `config.maxNeighborsPerMote` nearest motes within `outerDistanceWorld` are
 * selected (ties broken by ascending neighbor index for determinism); the
 * resulting pair set is deduplicated so each unordered pair appears at most
 * once, with `a < b` always.
 *
 * `previousPairKeys` (the pair-key set from the prior call, if any) makes
 * selection sticky at the neighbor-cap boundary — see
 * `CONSTELLATION_LINK_HYSTERESIS_FACTOR`. Omit it for a one-shot, fully
 * stateless selection.
 */
export function selectConstellationLinkPairs(
  count: number,
  xAt: (index: number) => number,
  yAt: (index: number) => number,
  config: ConstellationLinkQualityConfig,
  previousPairKeys?: ReadonlySet<string>,
): ConstellationLink[] {
  if (count < 2 || config.maxNeighborsPerMote <= 0) return [];
  const links: ConstellationLink[] = [];
  const seen = new Set<string>();
  const candidateIndex: number[] = [];
  const candidateDistance: number[] = [];
  const candidateSortKey: number[] = [];
  for (let i = 0; i < count; i++) {
    candidateIndex.length = 0;
    candidateDistance.length = 0;
    candidateSortKey.length = 0;
    const xi = xAt(i);
    const yi = yAt(i);
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      const dx = xi - xAt(j);
      const dy = yi - yAt(j);
      const distance = Math.hypot(dx, dy);
      if (distance >= config.outerDistanceWorld) continue;
      const sticky = previousPairKeys?.has(pairKey(i, j)) ?? false;
      candidateIndex.push(j);
      candidateDistance.push(distance);
      candidateSortKey.push(sticky ? distance * CONSTELLATION_LINK_HYSTERESIS_FACTOR : distance);
    }
    const order = candidateIndex.map((_, k) => k);
    order.sort((p, q) => {
      const diff = candidateSortKey[p] - candidateSortKey[q];
      if (diff !== 0) return diff;
      return candidateIndex[p] - candidateIndex[q];
    });
    const neighborCount = Math.min(config.maxNeighborsPerMote, order.length);
    for (let k = 0; k < neighborCount; k++) {
      const slot = order[k];
      const j = candidateIndex[slot];
      const key = pairKey(i, j);
      if (seen.has(key)) continue;
      seen.add(key);
      const opacity = getConstellationLinkOpacity(
        candidateDistance[slot],
        config.innerDistanceWorld,
        config.outerDistanceWorld,
        config.maxOpacity,
      );
      links.push({ a: Math.min(i, j), b: Math.max(i, j), opacity });
    }
  }
  return links;
}

/**
 * Render-local frame-to-frame tracker providing the hysteresis input to
 * `selectConstellationLinkPairs`. Holds no simulation data, only the set of
 * pair keys drawn last frame; safe to construct per canonical mote-cloud
 * instance and never persisted.
 */
export class ConstellationLinkTracker {
  private activePairKeys: ReadonlySet<string> = new Set();

  computeLinks(
    count: number,
    xAt: (index: number) => number,
    yAt: (index: number) => number,
    config: ConstellationLinkQualityConfig,
  ): ConstellationLink[] {
    const links = selectConstellationLinkPairs(count, xAt, yAt, config, this.activePairKeys);
    const next = new Set<string>();
    for (const link of links) next.add(pairKey(link.a, link.b));
    this.activePairKeys = next;
    return links;
  }

  /** Clears smoothing state; harmless to call on room transition/respawn since it only ever affects one frame's stickiness. */
  reset(): void {
    this.activePairKeys = new Set();
  }
}

/** Explicit per-quality-tier link behavior; `null` disables the effect entirely. */
export const CONSTELLATION_LINK_QUALITY: Readonly<Record<'low' | 'med' | 'high', ConstellationLinkQualityConfig | null>> = {
  high: { maxNeighborsPerMote: 3, innerDistanceWorld: 4, outerDistanceWorld: 11, maxOpacity: 0.18 },
  med: { maxNeighborsPerMote: 2, innerDistanceWorld: 3, outerDistanceWorld: 7, maxOpacity: 0.12 },
  low: null,
};
