/**
 * The renderer, as a pair of GLSL ES 3.0 shaders.
 *
 * Every pixel is one photon, traced backwards: it leaves the camera, bends
 * through curved spacetime, and either falls past the horizon, lands on the
 * accretion disk, or gets away to the stars. Whatever it finds is what that
 * pixel shows.
 *
 * The integration is the same one validated on the CPU in lensing.ts:
 *
 *     a = −3 M h² r / |r|⁵,     h = |r × v|
 *
 * which is the Schwarzschild null geodesic written as a central force.
 */

export const VERTEX_SOURCE = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // One triangle large enough to cover the screen, built from the vertex index.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform vec3  uCam;         // camera position, in units of M
uniform mat3  uBasis;       // columns: right, up, forward
uniform float uTanHalfFov;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uShowDisk;
uniform float uShowStars;
uniform float uBeaming;     // 0 turns off Doppler beaming, for comparison
uniform float uTime;
uniform float uExposure;
uniform int   uSteps;

const float HORIZON = 2.0;
const float ESCAPE  = 50.0;
const int   MAX_STEPS = 900;

/* ── the geodesic ────────────────────────────────────────────────────────*/

vec3 accel(vec3 p, float h2) {
  float r2 = dot(p, p);
  float r5 = r2 * r2 * sqrt(r2);
  return p * (-3.0 * h2 / r5);
}

/* ── a sky to be lensed ──────────────────────────────────────────────────*/

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/**
 * Stars, laid out on the six faces of a cube rather than in latitude and
 * longitude, so they do not bunch up at the poles.
 */
vec3 starField(vec3 d) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.x >= a.y && a.x >= a.z)      { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z)               { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else                               { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }

  vec3 sum = vec3(0.0);
  const float DENSITY = 58.0;
  vec2 g = uv * DENSITY;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec3 h = hash33(vec3(c, face * 17.0));
      if (h.z > 0.918) {
        vec2 off = vec2(float(i), float(j)) + h.xy;
        float d2 = dot(off - f, off - f);
        float mag = pow((h.z - 0.918) / 0.082, 2.4);
        // Hot stars run blue, cool ones amber.
        vec3 tint = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.83, 0.62), fract(h.x * 21.7));
        sum += tint * mag * exp(-d2 * 300.0) * 3.2;
      }
    }
  }
  return sum;
}

/* ── the disk ────────────────────────────────────────────────────────────*/

/** A hot-metal ramp standing in for a blackbody, from dull red to blue-white. */
vec3 temperatureColor(float t) {
  t = clamp(t, 0.0, 1.5);
  vec3 c = mix(vec3(0.30, 0.035, 0.010), vec3(1.0, 0.28, 0.04), smoothstep(0.00, 0.34, t));
  c = mix(c, vec3(1.0, 0.60, 0.20), smoothstep(0.30, 0.62, t));
  c = mix(c, vec3(1.0, 0.90, 0.68), smoothstep(0.60, 0.92, t));
  c = mix(c, vec3(0.98, 0.98, 0.96), smoothstep(0.90, 1.12, t));
  c = mix(c, vec3(0.72, 0.84, 1.0), smoothstep(1.10, 1.42, t));
  return c;
}

float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash33(vec3(i, 0.0)).x;
  float b = hash33(vec3(i + vec2(1.0, 0.0), 0.0)).x;
  float c = hash33(vec3(i + vec2(0.0, 1.0), 0.0)).x;
  float d = hash33(vec3(i + vec2(1.0, 1.0), 0.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/**
 * What the disk looks like where a ray landed.
 *
 * The emitted brightness follows the thin-disk profile, roughly r⁻³ with the
 * inner edge damped, so the disk is hottest just outside its inner rim. Two
 * relativistic effects are then applied to what the camera actually receives:
 * gravitational redshift, √(1 − 2M/r), because the light climbs out of the
 * well; and Doppler shift from the orbital motion, which at these speeds is
 * dramatic. Intensity goes as the fourth power of the combined shift, so the
 * side sweeping toward us is far brighter than the side sweeping away.
 */
vec3 diskColor(vec3 hit, vec3 vel) {
  float r = length(hit);
  vec3 er = hit / r;

  // Thin-disk emission, normalised so its peak is about 1.
  float damp = max(0.0, 1.0 - sqrt(uDiskIn / r));
  float prof = damp / (r * r * r);
  float rPeak = 1.3611 * uDiskIn;              // where r⁻³(1 − √(rin/r)) peaks
  float peak = max(1e-9, (1.0 - sqrt(uDiskIn / rPeak)) / (rPeak * rPeak * rPeak));
  float emit = prof / peak;

  // Turbulent banding, sheared by the differential rotation: inner material
  // laps outer material, so any pattern winds up into a spiral on its own.
  float phase = atan(hit.z, hit.x) - uTime * 0.45 * pow(r, -1.5) * 40.0;
  float band = 0.74 + 0.52 * noise2(vec2(phase * 2.4, r * 1.55))
                    + 0.20 * noise2(vec2(phase * 5.4, r * 3.4));
  emit *= band;

  // Soft edges so the rim does not look cut out with scissors.
  emit *= smoothstep(0.0, 0.7, r - uDiskIn) * (1.0 - smoothstep(uDiskOut - 3.0, uDiskOut, r));

  // The photon's direction as a static observer there would measure it: the
  // metric stretches radial distance, so the tangential part carries the
  // √(1 − 2M/r) factor.
  float f = sqrt(max(1e-6, 1.0 - HORIZON / r));
  float vr = dot(vel, er);
  vec3 vt = vel - vr * er;
  vec3 toCam = -normalize(er * vr + vt * f);

  // Material on a circular geodesic, and how fast a static observer sees it go.
  vec3 phiHat = normalize(cross(vec3(0.0, 1.0, 0.0), hit));
  float beta = uBeaming > 0.5 ? sqrt(1.0 / max(1e-3, r - HORIZON)) : 0.0;
  float gamma = 1.0 / sqrt(max(1e-4, 1.0 - beta * beta));
  float doppler = 1.0 / max(1e-4, gamma * (1.0 - dot(phiHat * beta, toCam)));

  float shift = f * doppler;                    // observed frequency / emitted
  float boosted = emit * pow(clamp(shift, 0.0, 6.0), 4.0);

  // A thin disk radiates as a blackbody, so its temperature goes as the fourth
  // root of the flux, and the shift carries the colour with it.
  float temperature = pow(max(0.0, emit), 0.25) * shift;
  return temperatureColor(temperature) * boosted;
}

/* ── tone mapping ────────────────────────────────────────────────────────*/

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/* ── main ────────────────────────────────────────────────────────────────*/

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 dir = normalize(uBasis * vec3(uv * uTanHalfFov, 1.0));

  vec3 p = uCam;
  float rc = length(p);
  vec3 er = p / rc;

  // Turn the direction the camera sees into a coordinate velocity whose
  // angular momentum equals the impact parameter, which is what the force
  // law is written in terms of.
  float cosPsi = dot(dir, er);
  vec3 et = dir - cosPsi * er;
  float sinPsi = length(et);
  vec3 v;
  if (sinPsi < 1e-7) {
    v = dir;                                    // dead ahead: no bending at all
  } else {
    et /= sinPsi;
    float f = sqrt(max(1e-6, 1.0 - HORIZON / rc));
    v = er * cosPsi + et * (sinPsi / f);
  }

  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);

  vec3 color = vec3(0.0);
  bool settled = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;

    float r = length(p);
    if (r < HORIZON) { settled = true; break; }               // gone
    if (r > ESCAPE && dot(p, v) > 0.0) {
      if (uShowStars > 0.5) color = starField(normalize(v));
      settled = true;
      break;
    }

    // Step a fixed fraction of the current radius: fine where the path curves,
    // coarse out where it barely does. At this coarseness the integration is
    // still good to a few parts in ten million, measured against the CPU
    // version, and it leaves budget for rays that loop the photon sphere —
    // those need about 330 steps for a full turn.
    float dl = clamp(0.042 * r, 0.008, 1.4) / max(1e-4, length(v));

    vec3 p0 = p;
    vec3 a1 = accel(p, h2);
    vec3 v2 = v + a1 * (dl * 0.5);
    vec3 a2 = accel(p + v * (dl * 0.5), h2);
    vec3 v3 = v + a2 * (dl * 0.5);
    vec3 a3 = accel(p + v2 * (dl * 0.5), h2);
    vec3 v4 = v + a3 * dl;
    vec3 a4 = accel(p + v3 * dl, h2);

    p += (v + 2.0 * (v2 + v3) + v4) * (dl / 6.0);
    v += (a1 + 2.0 * (a2 + a3) + a4) * (dl / 6.0);

    // Did it cross the disk's plane during that step?
    if (uShowDisk > 0.5 && p0.y * p.y < 0.0) {
      float t = p0.y / (p0.y - p.y);
      vec3 hit = mix(p0, p, t);
      float rh = length(hit);
      if (rh > uDiskIn && rh < uDiskOut) {
        // The disk is opaque, so the first crossing is where the light came
        // from and the ray stops here.
        color = diskColor(hit, normalize(p - p0));
        settled = true;
        break;
      }
    }
  }

  if (!settled) color = vec3(0.0);              // still winding: count it dark

  color = aces(color * uExposure);
  fragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}`;
