/**
 * WebGL-accelerated particle renderer.
 *
 * Renders all particles in a single draw call using GL point sprites.
 * Additive blending (SRC_ALPHA, ONE) gives natural bloom where particles
 * overlap without requiring a separate post-process pass.
 *
 * Falls back gracefully: if WebGL is unavailable `isAvailable` is false and
 * the caller should fall back to the Canvas 2D renderer.
 *
 * Performance notes:
 *  - GPU buffer is pre-allocated at MAX_PARTICLES capacity; each frame only
 *    uploads the alive-particle slice via gl.bufferSubData (no heap alloc).
 *  - CPU-side vertex packing uses a pre-allocated Float32Array — no per-frame
 *    allocations in the hot path.
 *  - isPlayer lookup uses a pre-allocated Uint8Array keyed by entityId.
 */

import { MAX_PARTICLES } from '../../sim/particles/state';
import { WorldSnapshot } from '../snapshot';
import { PARTICLE_VERTEX_SHADER_SRC, PARTICLE_FRAGMENT_SHADER_SRC } from './shaders';

/** [x, y, isPlayer] per vertex */
const FLOATS_PER_VERTEX = 3;
const BYTES_PER_FLOAT = 4;
/** Default visual radius in pixels for each particle's point sprite. */
const POINT_SIZE_PX = 12.0;
/** Maximum entityId value supported by the fast lookup table. */
const ENTITY_LOOKUP_SIZE = 256;
/** Dark background colour components (matches #0A0A12). */
const BG_R = 0.039;
const BG_G = 0.039;
const BG_B = 0.071;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tryGetWebGLContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  return (canvas.getContext('webgl') as WebGLRenderingContext | null)
      ?? (canvas.getContext('experimental-webgl' as 'webgl') as WebGLRenderingContext | null);
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[WebGLParticleRenderer] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (vert === null || frag === null) return null;

  const program = gl.createProgram();
  if (program === null) return null;

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  // Shaders are baked into the program; delete the intermediate objects.
  gl.detachShader(program, vert);
  gl.detachShader(program, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[WebGLParticleRenderer] Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

export class WebGLParticleRenderer {
  /** The WebGL canvas — insert into the DOM behind the 2D game canvas. */
  readonly canvas: HTMLCanvasElement;
  /** True when WebGL initialised successfully; false → fall back to Canvas 2D. */
  readonly isAvailable: boolean;

  private readonly gl: WebGLRenderingContext | null = null;
  private readonly program: WebGLProgram | null = null;
  private readonly vertexBuffer: WebGLBuffer | null = null;

  // Attribute / uniform locations (−1 / null = not found, handled gracefully)
  private readonly attrPositionScreen: number = -1;
  private readonly attrIsPlayer: number = -1;
  private readonly uResolution: WebGLUniformLocation | null = null;
  private readonly uPointSizePx: WebGLUniformLocation | null = null;

  /**
   * Pre-allocated CPU-side vertex data: [x, y, isPlayer] per particle.
   * Re-packed each frame; never reallocated.
   */
  private readonly packedVertexData: Float32Array =
    new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);

  /**
   * isPlayer flag indexed by entityId for O(1) lookup during particle packing.
   * Cleared and rebuilt each frame (trivial cost: 256 bytes).
   */
  private readonly isPlayerLookup: Uint8Array = new Uint8Array(ENTITY_LOOKUP_SIZE);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

    const gl = tryGetWebGLContext(this.canvas);
    if (gl === null) {
      this.isAvailable = false;
      return;
    }

    const program = createProgram(gl, PARTICLE_VERTEX_SHADER_SRC, PARTICLE_FRAGMENT_SHADER_SRC);
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

    // Pre-allocate GPU buffer at full max-particle capacity.
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      MAX_PARTICLES * FLOATS_PER_VERTEX * BYTES_PER_FLOAT,
      gl.DYNAMIC_DRAW,
    );

    this.gl = gl;
    this.program = program;
    this.vertexBuffer = vertexBuffer;

    this.attrPositionScreen = gl.getAttribLocation(program, 'a_positionScreen');
    this.attrIsPlayer = gl.getAttribLocation(program, 'a_isPlayer');
    this.uResolution = gl.getUniformLocation(program, 'u_resolution');
    this.uPointSizePx = gl.getUniformLocation(program, 'u_pointSizePx');

    // Additive blending: overlapping particles naturally accumulate into bloom.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    this.isAvailable = true;
  }

  /** Resize the WebGL canvas and viewport to match the display resolution. */
  resize(widthPx: number, heightPx: number): void {
    this.canvas.width = widthPx;
    this.canvas.height = heightPx;
    if (this.gl !== null) {
      this.gl.viewport(0, 0, widthPx, heightPx);
    }
  }

  /**
   * Clear the canvas and render all alive particles from `snapshot`.
   *
   * Hot-path notes:
   *  - No heap allocations inside this method.
   *  - `isPlayerLookup` is a Uint8Array reset via `fill(0)` (trivial).
   *  - Vertex data is packed into `packedVertexData` (pre-allocated).
   *  - Only the alive-particle slice is uploaded to the GPU via bufferSubData.
   *  - All alive particles are drawn in a single `gl.drawArrays` call.
   */
  render(
    snapshot: WorldSnapshot,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    if (
      !this.isAvailable ||
      this.gl === null ||
      this.program === null ||
      this.vertexBuffer === null
    ) return;

    const gl = this.gl;
    const { particles, clusters } = snapshot;
    const { particleCount, isAliveFlag, positionXWorld, positionYWorld, ownerEntityId } = particles;

    // --- Rebuild isPlayer lookup (allocation-free) --------------------------
    const lookup = this.isPlayerLookup;
    lookup.fill(0);
    for (let ci = 0; ci < clusters.length; ci++) {
      const c = clusters[ci];
      if (c.entityId >= 0 && c.entityId < ENTITY_LOOKUP_SIZE) {
        lookup[c.entityId] = c.isPlayerFlag;
      }
    }

    // --- Pack alive-particle vertex data ------------------------------------
    const packed = this.packedVertexData;
    let vertexCount = 0;
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      const base = vertexCount * FLOATS_PER_VERTEX;
      const eid = ownerEntityId[i];
      packed[base + 0] = positionXWorld[i] * scalePx + offsetXPx;
      packed[base + 1] = positionYWorld[i] * scalePx + offsetYPx;
      packed[base + 2] = (eid >= 0 && eid < ENTITY_LOOKUP_SIZE) ? lookup[eid] : 0;
      vertexCount++;
    }

    // --- Clear with dark background -----------------------------------------
    gl.clearColor(BG_R, BG_G, BG_B, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (vertexCount === 0) return;

    // --- Upload only the used vertex slice to the GPU -----------------------
    // bufferSubData avoids reallocating GPU memory; uploads vertexCount*12 bytes.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.subarray(0, vertexCount * FLOATS_PER_VERTEX));

    // --- Issue a single draw call -------------------------------------------
    gl.useProgram(this.program);

    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uPointSizePx, POINT_SIZE_PX);

    const stride = FLOATS_PER_VERTEX * BYTES_PER_FLOAT;
    gl.enableVertexAttribArray(this.attrPositionScreen);
    gl.vertexAttribPointer(this.attrPositionScreen, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.attrIsPlayer);
    gl.vertexAttribPointer(this.attrIsPlayer, 1, gl.FLOAT, false, stride, 2 * BYTES_PER_FLOAT);

    gl.drawArrays(gl.POINTS, 0, vertexCount);
  }

  /** Release GPU resources. Call when the game screen is torn down. */
  dispose(): void {
    if (this.gl === null) return;
    const gl = this.gl;
    if (this.program !== null) gl.deleteProgram(this.program);
    if (this.vertexBuffer !== null) gl.deleteBuffer(this.vertexBuffer);
    if (this.canvas.parentElement !== null) this.canvas.parentElement.removeChild(this.canvas);
  }
}
