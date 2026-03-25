/**
 * GLSL shader sources for WebGL particle rendering.
 *
 * Vertex format (per particle): [x, y, kind, normalizedAge]  (4 floats)
 *
 * Design goals:
 *  - Single draw call for all particles via gl.POINTS / point sprites.
 *  - Per-element colour selected in the fragment shader from a_kind.
 *  - Alpha fades to 0 as normalizedAge → 1 (particle nearing end of life).
 *  - Point size shrinks slightly with age (visual decay cue).
 *  - Radial glow falloff via gl_PointCoord; no texture lookup.
 *  - Additive blending (SRC_ALPHA, ONE) produces natural bloom.
 *  - GLSL ES 1.00 for maximum device compatibility.
 */

/** Vertex shader: clip-space transform + per-element point-size modulation. */
export const PARTICLE_VERTEX_SHADER_SRC = `
  attribute vec2  a_positionScreen;
  attribute float a_kind;
  attribute float a_normalizedAge;

  uniform vec2  u_resolution;
  uniform float u_pointSizePx;

  varying float v_kind;
  varying float v_normalizedAge;

  void main() {
    vec2 clip = (a_positionScreen / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);

    // Particles shrink to ~60 % of their base size as they age out.
    float sizeFactor = 1.0 - a_normalizedAge * 0.40;
    gl_PointSize = u_pointSizePx * sizeFactor;

    v_kind          = a_kind;
    v_normalizedAge = a_normalizedAge;
  }
`.trim();

/**
 * Fragment shader:
 *   • Radial soft-glow disc with a bright white-hot core.
 *   • Element colour looked up via v_kind (integer-rounded float).
 *   • Alpha multiplied by (1 − normalizedAge) so particles fade out.
 */
export const PARTICLE_FRAGMENT_SHADER_SRC = `
  precision mediump float;

  varying float v_kind;
  varying float v_normalizedAge;

  // Returns the base RGB colour for the given element kind index.
  // Colours match STYLES in render/particles/styles.ts.
  vec3 kindColor(float k) {
    int ki = int(k + 0.5);
    if (ki == 1) return vec3(1.00, 0.33, 0.00);  // Fire      — hot orange
    if (ki == 2) return vec3(0.53, 0.87, 1.00);  // Ice       — cool blue
    if (ki == 3) return vec3(1.00, 1.00, 0.27);  // Lightning — electric yellow
    if (ki == 4) return vec3(0.27, 1.00, 0.27);  // Poison    — acid green
    if (ki == 5) return vec3(0.80, 0.27, 1.00);  // Arcane    — violet
    if (ki == 6) return vec3(0.53, 1.00, 0.93);  // Wind      — pale cyan
    if (ki == 7) return vec3(1.00, 0.93, 0.67);  // Holy      — warm gold
    if (ki == 8) return vec3(0.40, 0.20, 0.80);  // Shadow    — deep purple
    return vec3(0.47, 0.60, 0.67);               // Physical  — steel blue-grey
  }

  void main() {
    vec2  coord = gl_PointCoord - vec2(0.5);
    float dist  = length(coord) * 2.0;
    if (dist > 1.0) discard;

    // Smooth outer glow
    float glow = pow(1.0 - dist, 1.8);

    // Tight bright core
    float core = pow(max(0.0, 1.0 - dist * 3.0), 2.5);

    vec3 color = kindColor(v_kind);

    // Blend white into core for a glowing highlight
    color += vec3(core * 0.7);

    // Fade out as particle ages; keep minimum alpha so core always pops
    float ageFade = 1.0 - v_normalizedAge;
    float alpha   = glow * ageFade;

    gl_FragColor = vec4(color, alpha);
  }
`.trim();

