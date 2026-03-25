/**
 * GLSL shader sources for WebGL particle rendering.
 *
 * Design goals:
 *  - Single draw call for all particles via gl.POINTS / point sprites.
 *  - Radial glow falloff computed entirely on the GPU using gl_PointCoord.
 *  - Additive blending (SRC_ALPHA, ONE) produces natural bloom where
 *    particles overlap — no post-process pass required.
 *  - GLSL ES 1.00 for maximum device compatibility (WebGL1 / mobile).
 */

/** Vertex shader: transforms world-space positions to clip space and encodes
 *  per-particle colour channel (player vs. enemy). */
export const PARTICLE_VERTEX_SHADER_SRC = `
  attribute vec2 a_positionScreen;
  attribute float a_isPlayer;

  uniform vec2 u_resolution;
  uniform float u_pointSizePx;

  varying float v_isPlayer;

  void main() {
    vec2 clip = (a_positionScreen / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;
    gl_Position = vec4(clip, 0.0, 1.0);
    gl_PointSize = u_pointSizePx;
    v_isPlayer = a_isPlayer;
  }
`.trim();

/** Fragment shader: renders each point sprite as a soft glowing disc with a
 *  bright white-hot core.  The glow colour is cyan for player particles and
 *  red for enemy particles. */
export const PARTICLE_FRAGMENT_SHADER_SRC = `
  precision mediump float;
  varying float v_isPlayer;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord) * 2.0;
    if (dist > 1.0) discard;

    // Smooth outer glow falloff
    float alpha = pow(1.0 - dist, 1.8);

    // Tight bright core (white-hot centre)
    float core = pow(max(0.0, 1.0 - dist * 3.0), 2.5);

    // Player: #00CFFF  Enemy: #FF4444
    vec3 playerColor = vec3(0.0, 0.812, 1.0);
    vec3 enemyColor  = vec3(1.0, 0.267, 0.267);
    vec3 color = mix(enemyColor, playerColor, v_isPlayer);

    // Blend white into core for a glowing highlight
    color += vec3(core * 0.7);

    gl_FragColor = vec4(color, alpha);
  }
`.trim();
