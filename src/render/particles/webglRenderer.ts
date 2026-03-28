/**
 * WebGL-accelerated particle renderer.
 *
 * Vertex format per particle: [x, y, kind, normalizedAge, disturbanceFactor]
 *                              (5 floats = 20 bytes)
 *
 *  • kind              — ParticleKind enum value; fragment shader maps it to colour.
 *  • normalizedAge     — ageTicks / lifetimeTicks in [0, 1]; drives alpha fade
 *                        and point-size shrink in the vertex shader.
 *  • disturbanceFactor — [0, 1]; non-zero only for Fluid particles; drives their
 *                        alpha (0 = invisible, 1 = fully revealed).
 *
 * Performance notes:
 *  - GPU buffer pre-allocated at MAX_PARTICLES capacity; per-frame upload
 *    is bufferSubData only (no GPU heap realloc).
 *  - CPU vertex array (packedVertexData) is pre-allocated; no per-frame alloc.
 *  - All alive particles drawn in a single gl.drawArrays(POINTS) call.
 *  - Falls back gracefully: isAvailable=false → caller uses Canvas 2D.
 */

import { MAX_PARTICLES } from '../../sim/particles/state';
import { WorldSnapshot } from '../snapshot';
import { PARTICLE_VERTEX_SHADER_SRC, PARTICLE_FRAGMENT_SHADER_SRC } from './shaders';

/** [x, y, kind, normalizedAge, disturbanceFactor] per vertex */
const FLOATS_PER_VERTEX = 5;
const BYTES_PER_FLOAT   = 4;
/** Visual diameter for each particle's point sprite, in world units (= 1/6th player size).
 *  Multiplied by scalePx in the render call to get the gl_PointSize in screen pixels. */
const PARTICLE_DIAMETER_WORLD = 10.0 / 6.0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** WebGL context attributes: alpha channel enabled, non-premultiplied for correct canvas compositing. */
const WEBGL_CONTEXT_ATTRS: WebGLContextAttributes = { alpha: true, premultipliedAlpha: false };

function tryGetWebGLContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  return (canvas.getContext('webgl', WEBGL_CONTEXT_ATTRS) as WebGLRenderingContext | null)
      ?? (canvas.getContext('experimental-webgl' as 'webgl', WEBGL_CONTEXT_ATTRS) as WebGLRenderingContext | null);
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

  // Attribute / uniform locations
  private readonly attrPositionScreen:    number = -1;
  private readonly attrKind:              number = -1;
  private readonly attrNormalizedAge:     number = -1;
  private readonly attrDisturbanceFactor: number = -1;
  private readonly uResolution:    WebGLUniformLocation | null = null;
  private readonly uPointSizePx:   WebGLUniformLocation | null = null;

  /**
   * Pre-allocated CPU vertex data: [x, y, kind, normalizedAge] per particle.
   * Packed each frame; never reallocated.
   */
  private readonly packedVertexData: Float32Array =
    new Float32Array(MAX_PARTICLES * FLOATS_PER_VERTEX);

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

    this.attrPositionScreen    = gl.getAttribLocation(program, 'a_positionScreen');
    this.attrKind              = gl.getAttribLocation(program, 'a_kind');
    this.attrNormalizedAge     = gl.getAttribLocation(program, 'a_normalizedAge');
    this.attrDisturbanceFactor = gl.getAttribLocation(program, 'a_disturbanceFactor');
    this.uResolution           = gl.getUniformLocation(program, 'u_resolution');
    this.uPointSizePx          = gl.getUniformLocation(program, 'u_pointSizePx');

    // Additive blending for RGB (overlapping particles bloom) with standard
    // source-over alpha compositing so the transparent canvas composites
    // correctly over the 2D game canvas below it.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.isAvailable = true;
  }

  /**
   * Resize the WebGL canvas and viewport to match the display resolution.
   */
  resize(widthPx: number, heightPx: number): void {
    this.canvas.width  = widthPx;
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
   *  - Vertex data packed into pre-allocated packedVertexData Float32Array.
   *  - Only the alive-particle slice is uploaded via gl.bufferSubData.
   *  - All particles drawn in a single gl.drawArrays(POINTS) call.
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
    const { particles } = snapshot;
    const {
      particleCount, isAliveFlag,
      positionXWorld, positionYWorld,
      kindBuffer, ageTicks, lifetimeTicks,
      disturbanceFactor,
    } = particles;

    // ---- Pack alive-particle vertex data (no allocations) ---------------
    const packed = this.packedVertexData;
    let vertexCount = 0;
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      const base = vertexCount * FLOATS_PER_VERTEX;
      const lt = lifetimeTicks[i];
      const normAge = lt > 0 ? Math.min(1.0, ageTicks[i] / lt) : 0.0;
      packed[base + 0] = positionXWorld[i] * scalePx + offsetXPx;
      packed[base + 1] = positionYWorld[i] * scalePx + offsetYPx;
      packed[base + 2] = kindBuffer[i];
      packed[base + 3] = normAge;
      packed[base + 4] = disturbanceFactor[i];
      vertexCount++;
    }

    // ---- Clear to transparent so the 2D canvas below shows through ----------
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (vertexCount === 0) return;

    // ---- Upload only the used slice to the GPU -------------------------
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.subarray(0, vertexCount * FLOATS_PER_VERTEX));

    // ---- Single draw call ----------------------------------------------
    gl.useProgram(this.program);

    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uPointSizePx, PARTICLE_DIAMETER_WORLD * scalePx);

    const stride = FLOATS_PER_VERTEX * BYTES_PER_FLOAT;
    gl.enableVertexAttribArray(this.attrPositionScreen);
    gl.vertexAttribPointer(this.attrPositionScreen,    2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.attrKind);
    gl.vertexAttribPointer(this.attrKind,              1, gl.FLOAT, false, stride, 2 * BYTES_PER_FLOAT);
    gl.enableVertexAttribArray(this.attrNormalizedAge);
    gl.vertexAttribPointer(this.attrNormalizedAge,     1, gl.FLOAT, false, stride, 3 * BYTES_PER_FLOAT);
    gl.enableVertexAttribArray(this.attrDisturbanceFactor);
    gl.vertexAttribPointer(this.attrDisturbanceFactor, 1, gl.FLOAT, false, stride, 4 * BYTES_PER_FLOAT);

    gl.drawArrays(gl.POINTS, 0, vertexCount);
  }

  /** Release GPU resources. Call when the game screen is torn down. */
  dispose(): void {
    if (this.gl === null) return;
    const gl = this.gl;
    if (this.program      !== null) gl.deleteProgram(this.program);
    if (this.vertexBuffer !== null) gl.deleteBuffer(this.vertexBuffer);
    if (this.canvas.parentElement !== null) this.canvas.parentElement.removeChild(this.canvas);
  }
}
