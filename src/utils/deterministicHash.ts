/**
 * deterministicHash.ts — Lightweight deterministic string and object hash.
 *
 * Uses the FNV-1a 32-bit algorithm for fast, stable hashing.  This is used
 * for detecting staleness in room cache files — NOT for cryptographic security.
 * Given the same input the function always produces the same output, making it
 * suitable for cache invalidation.
 *
 * Design constraints (from architecture guidelines):
 *   - No Date.now(), Math.random(), or browser/DOM APIs.
 *   - Pure TypeScript logic — safe to call from both sim and render layers.
 */

// ── FNV-1a 32-bit constants ───────────────────────────────────────────────────

const FNV1A_PRIME_32 = 0x01000193;
const FNV1A_OFFSET_32 = 0x811c9dc5;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Computes a deterministic FNV-1a 32-bit hash of a UTF-16 string.
 * Returns an 8-character lowercase hex string (e.g. "a3f2bc7e").
 *
 * Characters above U+00FF are split into two bytes (high byte first) to
 * avoid ignoring the upper byte of non-ASCII codepoints.
 */
export function hashString(input: string): string {
  let hash = FNV1A_OFFSET_32;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code > 0xff) {
      // Split multi-byte character into two bytes.
      hash ^= (code >>> 8) & 0xff;
      hash = (Math.imul(hash, FNV1A_PRIME_32) >>> 0);
    }
    hash ^= code & 0xff;
    hash = (Math.imul(hash, FNV1A_PRIME_32) >>> 0);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Serializes `value` to a deterministic JSON string (sorted object keys),
 * then returns its FNV-1a hash.
 *
 * Volatile fields (e.g. `exportedAt`, `lastEditedIso`) must be stripped from
 * the object BEFORE calling this function — never include time-stamps inside
 * a content hash.
 */
export function hashObject(value: unknown): string {
  return hashString(deterministicStringify(value));
}

/**
 * JSON.stringify with deterministically sorted object keys.
 *
 * - Object keys are sorted lexicographically before serialization.
 * - Arrays preserve their original order.
 * - Primitive values (number, string, boolean, null) are stringified as-is.
 * - `undefined` values are omitted (same as standard JSON.stringify).
 *
 * This is intentionally NOT a general-purpose stringify replacement — it is
 * only used for content-addressable hashing of room and campaign data.
 *
 * NOTE: This implementation is intentionally duplicated in
 * `electron/main.cjs` as `deterministicStringify()` because main.cjs runs in
 * Node.js (CommonJS) and cannot import TypeScript source directly.
 * Both implementations must produce IDENTICAL output for the same input so
 * that room-cache hashes stored in manifest.json are portable across the
 * renderer process (TypeScript) and the main process (main.cjs).
 * If the algorithm ever changes here, update main.cjs to match.
 * See docs/campaign-room-cache-architecture.md for details.
 */
export function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(deterministicStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue; // omit undefined, matching JSON.stringify
    parts.push(JSON.stringify(k) + ':' + deterministicStringify(v));
  }
  return '{' + parts.join(',') + '}';
}
