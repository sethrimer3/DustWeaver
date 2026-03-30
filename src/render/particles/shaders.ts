/**
 * GLSL shader sources for WebGL particle rendering.
 *
 * Vertex format (per particle): [x, y, kind, normalizedAge, disturbanceFactor]
 *                                (5 floats)
 *
 * Design goals:
 *  - Single draw call for all particles via gl.POINTS / point sprites.
 *  - Per-element colour selected in the fragment shader from a_kind.
 *  - Alpha fades to 0 as normalizedAge → 1 (particle nearing end of life).
 *  - Point size shrinks slightly with age (visual decay cue).
 *  - Shape clipping via gl_PointCoord — non-Physical kinds render as polygons.
 *  - Radial glow falloff for circle kinds; edge highlight for polygon kinds.
 *  - Additive blending (SRC_ALPHA, ONE) produces natural bloom.
 *  - Fluid particles (kind 14) are normally transparent; disturbanceFactor
 *    drives their alpha so they appear only when disturbed by nearby movement.
 *  - GLSL ES 1.00 for maximum device compatibility.
 */

/** Vertex shader: clip-space transform + per-element point-size modulation. */
export const PARTICLE_VERTEX_SHADER_SRC = `
  attribute vec2  a_positionScreen;
  attribute float a_kind;
  attribute float a_normalizedAge;
  attribute float a_disturbanceFactor;

  uniform vec2  u_resolution;
  uniform float u_pointSizePx;

  varying float v_kind;
  varying float v_normalizedAge;
  varying float v_disturbanceFactor;

  void main() {
    vec2 clip = (a_positionScreen / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);

    // Particles shrink to ~60 % of their base size as they age out.
    float sizeFactor = 1.0 - a_normalizedAge * 0.40;
    gl_PointSize = u_pointSizePx * sizeFactor;

    v_kind              = a_kind;
    v_normalizedAge     = a_normalizedAge;
    v_disturbanceFactor = a_disturbanceFactor;
  }
`.trim();

/**
 * Fragment shader:
 *   • Shape clipping: each kind maps to a geometric shape via kindShape().
 *   • Physical/Nature → circle (radial glow); all others → polygon outline.
 *   • Element colour looked up via v_kind (integer-rounded float).
 *   • Alpha multiplied by (1 − normalizedAge) so particles fade out.
 *
 * Shape index constants (matching ParticleShape enum in kinds.ts):
 *   0 = Circle   1 = Diamond   2 = Square   3 = Triangle
 *   4 = Hexagon  5 = Cross     6 = Star     7 = Ring
 */
export const PARTICLE_FRAGMENT_SHADER_SRC = `
  precision mediump float;

  varying float v_kind;
  varying float v_normalizedAge;
  varying float v_disturbanceFactor;

  const float PI = 3.14159265;

  // Shape geometry constants
  const float CROSS_ARM_HALF = 0.17;  // half-width of each arm of the cross shape
  const float STAR_INNER_R   = 0.18;  // inner (notch) radius of the 5-pointed star
  const float STAR_OUTER_R   = 0.46;  // outer (tip)   radius of the 5-pointed star
  // Ring: inner radius 0.18, outer radius 0.48; the visible band midpoint is
  // (0.18 + 0.48) / 2 = 0.33, used as the peak-brightness centre for glow.
  const float RING_INNER_R   = 0.18;  // inner boundary of the ring
  const float RING_OUTER_R   = 0.48;  // outer boundary of the ring
  const float RING_GLOW_MID  = 0.33;  // midpoint of the ring band (peak glow)

  // Returns the base RGB colour for the given element kind index.
  // Colours match STYLES in render/particles/styles.ts.
  vec3 kindColor(float k) {
    int ki = int(k + 0.5);
    if (ki == 1)  return vec3(1.00, 0.33, 0.00);  // Fire      — hot orange
    if (ki == 2)  return vec3(0.53, 0.87, 1.00);  // Ice       — cool blue
    if (ki == 3)  return vec3(1.00, 1.00, 0.27);  // Lightning — electric yellow
    if (ki == 4)  return vec3(0.27, 1.00, 0.27);  // Poison    — acid green
    if (ki == 5)  return vec3(0.80, 0.27, 1.00);  // Arcane    — violet
    if (ki == 6)  return vec3(0.53, 1.00, 0.93);  // Wind      — pale cyan
    if (ki == 7)  return vec3(1.00, 0.93, 0.67);  // Holy      — warm gold
    if (ki == 8)  return vec3(0.40, 0.20, 0.80);  // Shadow    — deep purple
    if (ki == 9)  return vec3(0.67, 0.73, 0.80);  // Metal     — silver
    if (ki == 10) return vec3(0.53, 0.40, 0.16);  // Earth     — warm brown
    if (ki == 11) return vec3(0.27, 0.80, 0.27);  // Nature    — vivid green
    if (ki == 12) return vec3(0.67, 0.93, 1.00);  // Crystal   — icy bright blue
    if (ki == 13) return vec3(0.13, 0.00, 0.20);  // Void      — near-black purple
    if (ki == 14) return vec3(0.55, 0.80, 1.00);  // Fluid     — pale aqua-blue
    if (ki == 15) return vec3(0.13, 0.60, 0.93);  // Water     — deep flowing blue
    if (ki == 16) return vec3(1.00, 0.13, 0.00);  // Lava      — deep molten red-orange
    if (ki == 17) return vec3(0.53, 0.53, 0.60);  // Stone     — cool grey
    if (ki == 18) return vec3(1.00, 0.84, 0.00);  // Gold      — bright golden yellow
    if (ki == 19) return vec3(1.00, 0.99, 0.88);  // Light     — radiant white-gold
    return vec3(0.47, 0.60, 0.67);                // Physical  — steel blue-grey
  }

  // Maps a ParticleKind to a shape index (0–7).
  // Matches KIND_SHAPE table in sim/particles/kinds.ts.
  float kindShape(float k) {
    int ki = int(k + 0.5);
    if (ki == 1)  return 3.0; // Fire      → Triangle
    if (ki == 2)  return 4.0; // Ice       → Hexagon
    if (ki == 3)  return 1.0; // Lightning → Diamond
    if (ki == 4)  return 6.0; // Poison    → Star
    if (ki == 5)  return 6.0; // Arcane    → Star
    if (ki == 6)  return 1.0; // Wind      → Diamond
    if (ki == 7)  return 5.0; // Holy      → Cross
    if (ki == 8)  return 2.0; // Shadow    → Square
    if (ki == 9)  return 2.0; // Metal     → Square
    if (ki == 10) return 3.0; // Earth     → Triangle
    if (ki == 11) return 0.0; // Nature    → Circle
    if (ki == 12) return 4.0; // Crystal   → Hexagon
    if (ki == 13) return 7.0; // Void      → Ring
    if (ki == 14) return 0.0; // Fluid     → Circle
    if (ki == 15) return 0.0; // Water     → Circle
    if (ki == 16) return 0.0; // Lava      → Circle (molten, fluid)
    if (ki == 17) return 3.0; // Stone     → Triangle (rocky, jagged)
    if (ki == 18) return 1.0; // Gold      → Diamond (sparkle)
    if (ki == 19) return 0.0; // Light     → Circle (radiant glow)
    return 0.0;               // Physical  → Circle (default)
  }

  // Returns true if the point coord (in [-0.5, 0.5] space) lies outside the
  // given shape boundary and should be discarded.
  bool outsideShape(vec2 c, int shape) {
    float dist = length(c);

    if (shape == 0) {
      // Circle
      return dist > 0.5;
    }

    if (shape == 1) {
      // Diamond
      return (abs(c.x) + abs(c.y)) > 0.45;
    }

    if (shape == 2) {
      // Square
      return max(abs(c.x), abs(c.y)) > 0.44;
    }

    if (shape == 3) {
      // Equilateral triangle, pointing up.
      // Vertices: (0, 0.5), (±0.433, -0.25).
      if (c.y < -0.25) return true;
      if (c.y > (-1.732 * c.x + 0.5)) return true;
      if (c.y > ( 1.732 * c.x + 0.5)) return true;
      return false;
    }

    if (shape == 4) {
      // Regular hexagon (flat-top orientation).
      vec2 ac = abs(c);
      return max(ac.x * 0.5 + ac.y * 0.866, ac.x) > 0.46;
    }

    if (shape == 5) {
      // Cross / plus — each arm extends to ±0.44, width is CROSS_ARM_HALF on each side.
      return (abs(c.x) > CROSS_ARM_HALF && abs(c.y) > CROSS_ARM_HALF);
    }

    if (shape == 6) {
      // 5-pointed star: boundary radius oscillates between STAR_OUTER_R and STAR_INNER_R
      // every PI/5 radians of polar angle.
      float a = atan(c.y, c.x);
      float sector = 2.0 * PI / 5.0;
      float fa = mod(a + PI / 10.0, sector);
      float t = abs(fa - sector * 0.5) / (sector * 0.5);
      float boundary = mix(STAR_INNER_R, STAR_OUTER_R, t);
      return dist > boundary;
    }

    if (shape == 7) {
      // Ring / torus — visible band between RING_INNER_R and RING_OUTER_R.
      return (dist < RING_INNER_R || dist > RING_OUTER_R);
    }

    // Fallback: circle
    return dist > 0.5;
  }

  void main() {
    // gl_PointCoord is in [0,1]; remap to [-0.5, 0.5].
    vec2 coord = gl_PointCoord - vec2(0.5);

    int ki = int(v_kind + 0.5);
    int shape = int(kindShape(v_kind) + 0.5);
    if (outsideShape(coord, shape)) discard;

    float dist = length(coord);

    vec3 color = kindColor(v_kind);

    float ageFade = 1.0 - v_normalizedAge;
    float alpha;

    if (ki == 14) {
      // Fluid background particle: completely transparent when undisturbed;
      // glows as a soft pale-aqua radial blur when disturbed by nearby motion.
      float glow = pow(max(0.0, 1.0 - dist * 2.0), 1.8);
      float core = pow(max(0.0, 1.0 - dist * 5.0), 3.0);
      color += vec3(core * 0.35);
      // disturbanceFactor drives visibility; ageFade prevents end-of-life flash.
      alpha = glow * v_disturbanceFactor * ageFade * 0.55;
    } else if (ki == 16) {
      // Lava: intense molten core with hot orange-white center and red outer glow.
      float glow = pow(max(0.0, 1.0 - dist * 2.0), 1.4);
      float core = pow(max(0.0, 1.0 - dist * 4.5), 2.5);
      // Add intense white-orange core highlight
      color += vec3(core * 1.0, core * 0.6, core * 0.1);
      alpha = glow * ageFade * 1.1;
    } else if (shape == 0) {
      // Circle: radial soft-glow with bright white-hot core (Physical, Nature).
      float glow = pow(1.0 - dist * 2.0, 1.8);
      float core = pow(max(0.0, 1.0 - dist * 6.0), 2.5);
      color += vec3(core * 0.7);
      alpha = glow * ageFade;
    } else if (shape == 7) {
      // Ring: brightest at the ring band midpoint (RING_GLOW_MID), fades toward inner/outer edges.
      float ringWidth = (RING_OUTER_R - RING_INNER_R) * 0.5;
      float ringDist = abs(dist - RING_GLOW_MID) / ringWidth;
      float glow = pow(max(0.0, 1.0 - ringDist), 1.5);
      color += vec3(glow * 0.4);
      alpha = glow * ageFade;
    } else {
      // Polygon: uniform fill with a faint inner glow towards the centroid.
      float innerGlow = pow(max(0.0, 1.0 - dist * 2.0), 1.2);
      color += vec3(innerGlow * 0.35);
      alpha = (0.7 + innerGlow * 0.3) * ageFade;
    }

    gl_FragColor = vec4(color, alpha);
  }
`.trim();


