/**
 * ParticleTrailRenderer — neon trail rendering for attack-mode particles.
 *
 * Architecture:
 *  - Maintains a render-layer-only ring buffer of recent world-space positions
 *    for every alive offensive particle (behaviorMode === 1).  No sim state is
 *    added; the trail history lives entirely in this renderer.
 *  - Sampling is distance-gated: a new point is pushed only when the particle
 *    has moved at least TRAIL_SAMPLE_DIST_WORLD units since the last sample.
 *    This prevents wasteful dense trails when particles move slowly or hover.
 *  - Renders trails as batched WebGL gl.TRIANGLES (6 vertices per segment quad)
 *    so all trails are drawn in a single draw call.
 *  - A per-vertex `crossT` attribute (−1 = left edge, +1 = right edge) lets
 *    the fragment shader compute a radial neon profile within each trail
 *    segment: bright sharp core + wide soft outer aura.
 *  - Additive blending (inherited from the parent WebGL canvas) produces
 *    natural luminous bloom where trails overlap.
 *
 * Vertex format: [x, y, trailT, crossT, r, g, b]  (7 floats)
 *   trailT  : 0 = tail (oldest/transparent) → 1 = head (newest/opaque)
 *   crossT  : −1 or +1 at edges; 0 at the geometric centreline (by interpolation)
 *
 * Performance:
 *  - CPU buffer pre-allocated at MAX_PARTICLES × MAX_TRAIL_SEGMENTS × 6 verts
 *    × 7 floats.  Never reallocated after construction.
 *  - GPU buffer pre-allocated at the same capacity; per-frame upload uses
 *    bufferSubData only (no GPU heap realloc).
 *  - In practice, only offensive particles (≤ 20 player mote slots) have trails,
 *    so the real uploaded slice is tiny (< 1 KB typical).
 *  - When no particles have active trails the upload and draw calls are skipped.
 *
 * Trail-enabled condition:  particle.isAliveFlag === 1 && particle.behaviorMode === 1
 *   (attack/offensive particles — the "special action" particles).
 */

import { MAX_PARTICLES } from '../../sim/particles/state';
import type { ParticleSnapshot } from '../snapshotTypes';
import { KIND_COLOR_R, KIND_COLOR_G, KIND_COLOR_B } from './styles';

const BYTES_PER_FLOAT = 4;

// ── Trail configuration ───────────────────────────────────────────────────────

/** Maximum number of past positions stored per particle. */
export const MAX_TRAIL_POINTS = 16;

/**
 * Minimum world-unit distance a particle must travel before a new trail
 * sample is recorded.  Increase to reduce trail density for fast particles;
 * decrease for smoother-looking trails.
 */
export const TRAIL_SAMPLE_DIST_WORLD = 1.2;

/**
 * Maximum half-width of the trail strip at the head end (world units).
 * Scaled by the current zoom (scalePx) before rendering.
 */
export const TRAIL_MAX_HALF_WIDTH_WORLD = 2.0;

/**
 * Taper exponent: controls how the strip narrows from head to tail.
 * 1.0 = linear taper; < 1.0 = stays wider longer before tapering to a point.
 */
export const TRAIL_TAPER_POWER = 0.55;

/**
 * Alpha fade exponent along the trail length.
 * Higher values concentrate opacity near the head and fade the tail faster.
 */
export const TRAIL_FADE_POWER = 1.4;

/** Overall alpha multiplier applied to every trail. */
export const TRAIL_ALPHA = 0.92;

// ── Internal buffer sizes ─────────────────────────────────────────────────────

/** Precomputed squared sample distance — avoids sqrt in the hot update loop. */
const TRAIL_SAMPLE_DIST_SQ = TRAIL_SAMPLE_DIST_WORLD * TRAIL_SAMPLE_DIST_WORLD;

/** Number of floats per trail vertex: [x, y, trailT, crossT, r, g, b]. */
const FLOATS_PER_TRAIL_VERTEX = 7;

/** Vertices emitted per quad segment (two triangles). */
const VERTS_PER_SEGMENT = 6;

/** Maximum segments a single particle's trail can produce. */
const MAX_TRAIL_SEGMENTS = MAX_TRAIL_POINTS - 1;

/** Maximum total trail vertices across all particles (worst case). */
const MAX_TRAIL_VERTEX_COUNT = MAX_PARTICLES * MAX_TRAIL_SEGMENTS * VERTS_PER_SEGMENT;

// ── GLSL shader sources ───────────────────────────────────────────────────────

const TRAIL_VERTEX_SHADER_SRC = `
  attribute vec2  a_pos;
  attribute float a_trailT;
  attribute float a_crossT;
  attribute vec3  a_color;

  uniform vec2 u_resolution;

  varying float v_trailT;
  varying float v_crossT;
  varying vec3  v_color;

  void main() {
    vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_trailT = a_trailT;
    v_crossT = a_crossT;
    v_color  = a_color;
  }
`.trim();

/**
 * Neon glow fragment shader.
 *
 * Within each trail quad the fragment shader computes a neon cross-section
 * profile from the interpolated crossT attribute:
 *   core  : sharp bright centre — pow(1 − |crossT|×3.2, 2.8)
 *   aura  : wide soft glow    — pow(1 − |crossT|,      1.4)
 *
 * Combined with gl.blendFuncSeparate(SRC_ALPHA, ONE) additive blending,
 * overlapping trails accumulate naturally into a luminous plasma effect.
 * The `core` term also bleaches the colour toward white-hot at the centre.
 */
const TRAIL_FRAGMENT_SHADER_SRC = `
  precision mediump float;

  varying float v_trailT;
  varying float v_crossT;
  varying vec3  v_color;

  uniform float u_alpha;
  uniform float u_fadePower;

  void main() {
    float d    = abs(v_crossT);          // 0 = centreline, 1 = outer edge

    // Neon profile: sharp bright core + wide soft aura.
    float core = pow(max(0.0, 1.0 - d * 3.2), 2.8);
    float aura = pow(max(0.0, 1.0 - d),        1.4);

    float brightness = core + aura * 0.28;

    // Alpha fades from 0 at the tail (trailT = 0) to full at the head (1).
    float ageFade = pow(v_trailT, u_fadePower);
    float alpha   = brightness * ageFade * u_alpha;

    // Core bleaches toward white-hot for a neon incandescence feel.
    vec3 finalColor = v_color + vec3(core * 0.85);

    gl_FragColor = vec4(finalColor, alpha);
  }
`.trim();

// ── Internal GL helpers (mirrors helpers in webglRenderer.ts) ─────────────────

function compileTrailShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[ParticleTrailRenderer] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createTrailProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null {
  const vert = compileTrailShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileTrailShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (vert === null || frag === null) return null;

  const prog = gl.createProgram();
  if (prog === null) return null;

  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);

  gl.detachShader(prog, vert);
  gl.detachShader(prog, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[ParticleTrailRenderer] Program link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// ── ParticleTrailRenderer ─────────────────────────────────────────────────────

export class ParticleTrailRenderer {
  /** False when GPU setup failed; trails are silently skipped. */
  readonly isAvailable: boolean;

  private readonly gl: WebGLRenderingContext | null             = null;
  private readonly program: WebGLProgram | null                 = null;
  private readonly vertexBuffer: WebGLBuffer | null             = null;

  // Attribute / uniform locations
  private readonly attrPos:      number                         = -1;
  private readonly attrTrailT:   number                         = -1;
  private readonly attrCrossT:   number                         = -1;
  private readonly attrColor:    number                         = -1;
  private readonly uResolution:  WebGLUniformLocation | null    = null;
  private readonly uAlpha:       WebGLUniformLocation | null    = null;
  private readonly uFadePower:   WebGLUniformLocation | null    = null;

  /**
   * Pre-allocated CPU vertex data.
   * Packed each frame with alive-trail geometry; never reallocated.
   */
  private readonly packedTrailData =
    new Float32Array(MAX_TRAIL_VERTEX_COUNT * FLOATS_PER_TRAIL_VERTEX);

  // ── Ring-buffer trail state (render-layer only) ───────────────────────────

  /**
   * Past world-X positions.
   * Layout: [particleIndex * MAX_TRAIL_POINTS + ringSlot]
   */
  private readonly trailXWorld     = new Float32Array(MAX_PARTICLES * MAX_TRAIL_POINTS);
  /** Past world-Y positions.  Same layout as trailXWorld. */
  private readonly trailYWorld     = new Float32Array(MAX_PARTICLES * MAX_TRAIL_POINTS);
  /**
   * Write head per particle: index of the NEXT slot to be overwritten.
   * Wraps modulo MAX_TRAIL_POINTS.
   */
  private readonly trailHead       = new Uint8Array(MAX_PARTICLES);
  /**
   * Number of valid trail entries currently stored per particle
   * (0 … MAX_TRAIL_POINTS).  Capped at MAX_TRAIL_POINTS once the buffer fills.
   */
  private readonly trailCount      = new Uint8Array(MAX_PARTICLES);
  /**
   * 1 when this particle had an active (attack-mode) trail last frame.
   * Used to detect entry/exit from behaviorMode === 1.
   */
  private readonly trailActiveFlag = new Uint8Array(MAX_PARTICLES);
  /** Last successfully sampled X world position — used for the distance gate. */
  private readonly trailPrevXWorld = new Float32Array(MAX_PARTICLES);
  /** Last successfully sampled Y world position — used for the distance gate. */
  private readonly trailPrevYWorld = new Float32Array(MAX_PARTICLES);

  // ── Scratch buffers (reused per-particle inside render; no per-frame alloc) ─

  /** Chronologically-ordered screen-X coords for the current particle's trail. */
  private readonly _orderedScreenX = new Float32Array(MAX_TRAIL_POINTS);
  /** Chronologically-ordered screen-Y coords for the current particle's trail. */
  private readonly _orderedScreenY = new Float32Array(MAX_TRAIL_POINTS);

  constructor(gl: WebGLRenderingContext) {
    const program = createTrailProgram(gl, TRAIL_VERTEX_SHADER_SRC, TRAIL_FRAGMENT_SHADER_SRC);
    if (program === null) {
      this.isAvailable = false;
      return;
    }

    const vertexBuffer = gl.createBuffer();
    if (vertexBuffer === null) {
      gl.deleteProgram(program);
      this.isAvailable = false;
      return;
    }

    // Pre-allocate GPU buffer at full worst-case capacity.
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      MAX_TRAIL_VERTEX_COUNT * FLOATS_PER_TRAIL_VERTEX * BYTES_PER_FLOAT,
      gl.DYNAMIC_DRAW,
    );

    this.gl           = gl;
    this.program      = program;
    this.vertexBuffer = vertexBuffer;

    this.attrPos      = gl.getAttribLocation(program, 'a_pos');
    this.attrTrailT   = gl.getAttribLocation(program, 'a_trailT');
    this.attrCrossT   = gl.getAttribLocation(program, 'a_crossT');
    this.attrColor    = gl.getAttribLocation(program, 'a_color');
    this.uResolution  = gl.getUniformLocation(program, 'u_resolution');
    this.uAlpha       = gl.getUniformLocation(program, 'u_alpha');
    this.uFadePower   = gl.getUniformLocation(program, 'u_fadePower');

    this.isAvailable = true;
  }

  // ── Trail sampling ──────────────────────────────────────────────────────────

  /**
   * Update ring buffers from the current particle snapshot.
   *
   * Must be called once per frame BEFORE render().
   * Hot-path: no heap allocations inside the per-particle loop.
   *
   * Sampling rules:
   *  - A trail is active only while behaviorMode === 1 (attack / offensive).
   *  - A new sample is pushed only when the particle has moved at least
   *    TRAIL_SAMPLE_DIST_WORLD units since the previous sample.
   *  - On entry to attack mode the ring buffer is seeded with the current
   *    position; on exit the ring buffer is cleared immediately.
   */
  update(snapshot: ParticleSnapshot): void {
    const { particleCount, isAliveFlag, behaviorMode, positionXWorld, positionYWorld } = snapshot;

    for (let i = 0; i < particleCount; i++) {
      const shouldHaveTrail = isAliveFlag[i] === 1 && behaviorMode[i] === 1;

      if (!shouldHaveTrail) {
        // Clear trail on transition out of attack mode.
        if (this.trailActiveFlag[i] !== 0) {
          this.trailCount[i]      = 0;
          this.trailHead[i]       = 0;
          this.trailActiveFlag[i] = 0;
        }
        continue;
      }

      const px = positionXWorld[i];
      const py = positionYWorld[i];

      if (this.trailActiveFlag[i] === 0) {
        // Particle just entered attack mode — seed ring buffer.
        const base = i * MAX_TRAIL_POINTS;
        this.trailXWorld[base]  = px;
        this.trailYWorld[base]  = py;
        this.trailHead[i]       = 1;  // next write slot
        this.trailCount[i]      = 1;
        this.trailPrevXWorld[i] = px;
        this.trailPrevYWorld[i] = py;
        this.trailActiveFlag[i] = 1;
        continue;
      }

      // Distance gate — only record when the particle has moved far enough.
      const dx = px - this.trailPrevXWorld[i];
      const dy = py - this.trailPrevYWorld[i];
      if (dx * dx + dy * dy < TRAIL_SAMPLE_DIST_SQ) continue;

      // Write new position into ring buffer.
      const head = this.trailHead[i];
      const base = i * MAX_TRAIL_POINTS;
      this.trailXWorld[base + head] = px;
      this.trailYWorld[base + head] = py;
      this.trailHead[i]             = (head + 1) % MAX_TRAIL_POINTS;
      if (this.trailCount[i] < MAX_TRAIL_POINTS) this.trailCount[i]++;
      this.trailPrevXWorld[i]       = px;
      this.trailPrevYWorld[i]       = py;
    }
  }

  // ── Trail rendering ─────────────────────────────────────────────────────────

  /**
   * Render all active particle trails to the WebGL canvas.
   *
   * Should be called BEFORE the particle draw call so trails appear behind
   * the particle sprites.
   *
   * Hot-path notes:
   *  - No heap allocations inside the vertex-packing loops.
   *  - Ring buffer is traversed into pre-allocated scratch arrays.
   *  - All alive trail quads are uploaded in a single bufferSubData call and
   *    drawn in a single gl.drawArrays(TRIANGLES) call.
   */
  render(
    snapshot: ParticleSnapshot,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    canvasWidthPx: number,
    canvasHeightPx: number,
  ): void {
    if (
      !this.isAvailable ||
      this.gl === null ||
      this.program === null ||
      this.vertexBuffer === null
    ) return;

    const { particleCount, isAliveFlag, behaviorMode, kindBuffer } = snapshot;
    const packed     = this.packedTrailData;
    const orderedX   = this._orderedScreenX;
    const orderedY   = this._orderedScreenY;
    let   totalVerts = 0;

    const maxHalfWidthPx = TRAIL_MAX_HALF_WIDTH_WORLD * scalePx;

    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0 || behaviorMode[i] !== 1) continue;

      const count = this.trailCount[i];
      if (count < 2) continue;

      // Unroll ring buffer into chronological scratch arrays (oldest → newest).
      const head   = this.trailHead[i];
      const base   = i * MAX_TRAIL_POINTS;
      const oldest = count < MAX_TRAIL_POINTS ? 0 : head;
      for (let j = 0; j < count; j++) {
        const slot     = (oldest + j) % MAX_TRAIL_POINTS;
        orderedX[j]    = this.trailXWorld[base + slot] * scalePx + offsetXPx;
        orderedY[j]    = this.trailYWorld[base + slot] * scalePx + offsetYPx;
      }

      // Determine neon colour from particle kind via shared KIND_COLOR_* tables
      // (mirrors kindColor() in shaders.ts; single source of truth in styles.ts).
      const kind = kindBuffer[i];
      const cr = KIND_COLOR_R[kind] ?? 1.00;
      const cg = KIND_COLOR_G[kind] ?? 0.84;
      const cb = KIND_COLOR_B[kind] ?? 0.00;

      const countM1 = count - 1;
      for (let seg = 0; seg < countM1; seg++) {
        const x0 = orderedX[seg];
        const y0 = orderedY[seg];
        const x1 = orderedX[seg + 1];
        const y1 = orderedY[seg + 1];

        const dx  = x1 - x0;
        const dy  = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) continue; // Degenerate segment — skip.

        // Perpendicular unit vector (rotated 90°).
        const nx = -dy / len;
        const ny =  dx / len;

        // Normalised positions along the trail: 0 = tail, 1 = head.
        const t0  = seg       / countM1;
        const t1  = (seg + 1) / countM1;

        // Half-width tapers from near-zero at the tail to maxHalfWidthPx at head.
        const hw0 = maxHalfWidthPx * Math.pow(t0, TRAIL_TAPER_POWER);
        const hw1 = maxHalfWidthPx * Math.pow(t1, TRAIL_TAPER_POWER);

        // Four quad corners:
        //   v0 (left  of seg start)  crossT = −1
        //   v1 (right of seg start)  crossT = +1
        //   v2 (left  of seg end  )  crossT = −1
        //   v3 (right of seg end  )  crossT = +1
        const v0x = x0 + nx * hw0;  const v0y = y0 + ny * hw0;
        const v1x = x0 - nx * hw0;  const v1y = y0 - ny * hw0;
        const v2x = x1 + nx * hw1;  const v2y = y1 + ny * hw1;
        const v3x = x1 - nx * hw1;  const v3y = y1 - ny * hw1;

        // Pack two triangles (v0,v1,v2) and (v1,v3,v2) into the flat array.
        let vb = totalVerts * FLOATS_PER_TRAIL_VERTEX;

        // Triangle 1 — v0
        packed[vb]   = v0x; packed[vb+1] = v0y;
        packed[vb+2] = t0;  packed[vb+3] = -1.0;
        packed[vb+4] = cr;  packed[vb+5] = cg; packed[vb+6] = cb;
        vb += FLOATS_PER_TRAIL_VERTEX;
        // Triangle 1 — v1
        packed[vb]   = v1x; packed[vb+1] = v1y;
        packed[vb+2] = t0;  packed[vb+3] =  1.0;
        packed[vb+4] = cr;  packed[vb+5] = cg; packed[vb+6] = cb;
        vb += FLOATS_PER_TRAIL_VERTEX;
        // Triangle 1 — v2
        packed[vb]   = v2x; packed[vb+1] = v2y;
        packed[vb+2] = t1;  packed[vb+3] = -1.0;
        packed[vb+4] = cr;  packed[vb+5] = cg; packed[vb+6] = cb;
        vb += FLOATS_PER_TRAIL_VERTEX;

        // Triangle 2 — v1
        packed[vb]   = v1x; packed[vb+1] = v1y;
        packed[vb+2] = t0;  packed[vb+3] =  1.0;
        packed[vb+4] = cr;  packed[vb+5] = cg; packed[vb+6] = cb;
        vb += FLOATS_PER_TRAIL_VERTEX;
        // Triangle 2 — v3
        packed[vb]   = v3x; packed[vb+1] = v3y;
        packed[vb+2] = t1;  packed[vb+3] =  1.0;
        packed[vb+4] = cr;  packed[vb+5] = cg; packed[vb+6] = cb;
        vb += FLOATS_PER_TRAIL_VERTEX;
        // Triangle 2 — v2
        packed[vb]   = v2x; packed[vb+1] = v2y;
        packed[vb+2] = t1;  packed[vb+3] = -1.0;
        packed[vb+4] = cr;  packed[vb+5] = cg; packed[vb+6] = cb;

        totalVerts += VERTS_PER_SEGMENT;
      }
    }

    if (totalVerts === 0) return;

    const gl = this.gl;

    // Upload only the used portion of the vertex array to the GPU.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0,
      packed.subarray(0, totalVerts * FLOATS_PER_TRAIL_VERTEX));

    // Set up the trail shader program and uniforms.
    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, canvasWidthPx, canvasHeightPx);
    gl.uniform1f(this.uAlpha,      TRAIL_ALPHA);
    gl.uniform1f(this.uFadePower,  TRAIL_FADE_POWER);

    // Vertex attribute pointers.
    const stride = FLOATS_PER_TRAIL_VERTEX * BYTES_PER_FLOAT;
    gl.enableVertexAttribArray(this.attrPos);
    gl.vertexAttribPointer(this.attrPos,    2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.attrTrailT);
    gl.vertexAttribPointer(this.attrTrailT, 1, gl.FLOAT, false, stride, 2 * BYTES_PER_FLOAT);
    gl.enableVertexAttribArray(this.attrCrossT);
    gl.vertexAttribPointer(this.attrCrossT, 1, gl.FLOAT, false, stride, 3 * BYTES_PER_FLOAT);
    gl.enableVertexAttribArray(this.attrColor);
    gl.vertexAttribPointer(this.attrColor,  3, gl.FLOAT, false, stride, 4 * BYTES_PER_FLOAT);

    // Single draw call for all trail geometry.
    gl.drawArrays(gl.TRIANGLES, 0, totalVerts);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Release GPU resources.  Call when the parent WebGLParticleRenderer is disposed. */
  dispose(): void {
    if (this.gl === null) return;
    const gl = this.gl;
    if (this.program      !== null) gl.deleteProgram(this.program);
    if (this.vertexBuffer !== null) gl.deleteBuffer(this.vertexBuffer);
  }
}
