/**
 * Null geodesics around a Schwarzschild black hole.
 *
 * Everything is in geometric units with G = c = M = 1, so the horizon sits at
 * r = 2, the photon sphere at r = 3, the innermost stable circular orbit at
 * r = 6, and a photon is captured if its impact parameter is under 3√3.
 *
 * The textbook way to bend light is the orbit equation
 *
 *     d²u/dφ² + u = 3M u²,      u = 1/r
 *
 * which is compact but breaks down for a ray aimed straight at the hole: φ
 * never advances and du/dφ blows up. Writing the same geodesic as a central
 * force in Cartesian coordinates fixes that and is no more expensive.
 *
 * Comparing the Binet equation for a central force,
 *
 *     d²u/dφ² + u = −F(1/u) / (h² u²)
 *
 * against the orbit equation gives F = −3M h² u⁴, that is
 *
 *     a = −3 M h² r / |r|⁵,      h = |r × v|
 *
 * with h conserved along the path. A radial ray has h = 0, so it feels no
 * acceleration and travels straight, which is exactly right. The same
 * expression runs on the GPU for every pixel; see shader.ts.
 */

export const HORIZON = 2; // r_s = 2M
export const PHOTON_SPHERE = 3;
export const ISCO = 6;
/** Impact parameter below which a photon from far away is swallowed. */
export const B_CRIT = 3 * Math.sqrt(3); // 5.196152…

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : v3();
};

/**
 * The velocity a static observer at radius r must give a photon so that it
 * leaves at angle ψ from the outward radial direction, as that observer
 * measures it with their own rulers and clocks.
 *
 * The radial and tangential pieces are scaled differently because they are:
 * the Schwarzschild metric stretches radial distance by 1/√(1 − 2M/r), so a
 * ray that looks like it leaves at 45° is not on a 45° coordinate path. The
 * normalisation is chosen so that h = |r × v| comes out equal to the impact
 * parameter b, which is what the force law expects.
 */
export function rayFromObserver(pos: Vec3, radial: Vec3, tangential: Vec3, cosPsi: number, sinPsi: number): Vec3 {
  const r = len(pos);
  const f = Math.sqrt(Math.max(1e-12, 1 - HORIZON / r));
  return add(scale(radial, cosPsi), scale(tangential, sinPsi / f));
}

/** Acceleration of a photon: a = −3 h² r / r⁵, with M = 1. */
export function accel(p: Vec3, h2: number): Vec3 {
  const r = len(p);
  const k = (-3 * h2) / (r * r * r * r * r);
  return scale(p, k);
}

export type Outcome = 'captured' | 'escaped' | 'exhausted';

export interface TraceResult {
  outcome: Outcome;
  /** Where it ended up, and which way it was going. */
  pos: Vec3;
  dir: Vec3;
  /** The final velocity, unnormalised, so h = |r × v| can be checked. */
  vel: Vec3;
  /**
   * How far the ray turned in total, in radians, accumulated step by step.
   *
   * Two tempting shortcuts are both wrong. The angle between the first and
   * last direction saturates at π, so it cannot describe a ray that loops
   * right around the hole. The angle swept by the position vector is only
   * π plus the deflection when the ray starts and ends infinitely far away;
   * from a finite distance D it is short by about 2b/D, which for a gentle
   * ray is larger than the deflection being measured. Adding up the turning
   * as it happens has neither problem.
   */
  bend: number;
  /** Closest approach to the hole. */
  rMin: number;
  steps: number;
}

export interface TraceOptions {
  /** Beyond this radius, and heading outward, the photon has left. */
  escape?: number;
  maxSteps?: number;
  /** Step length as a fraction of the current radius. */
  tolerance?: number;
}

/**
 * Follow one photon. Position and velocity are integrated with fourth-order
 * Runge–Kutta, in steps proportional to the current radius so the path is
 * sampled finely where it curves and coarsely where it does not.
 */
export function trace(p0: Vec3, v0: Vec3, opts: TraceOptions = {}): TraceResult {
  const escape = opts.escape ?? 1e4;
  const maxSteps = opts.maxSteps ?? 20000;
  const tol = opts.tolerance ?? 0.02;

  const h = cross(p0, v0);
  const h2 = dot(h, h);

  let p = { ...p0 };
  let v = { ...v0 };
  let rMin = len(p);
  let bend = 0;
  let steps = 0;
  const done = (outcome: Outcome): TraceResult => ({ outcome, pos: p, dir: normalize(v), vel: v, bend, rMin, steps });

  for (; steps < maxSteps; steps++) {
    const r = len(p);
    if (r < rMin) rMin = r;
    if (r <= HORIZON) return done('captured');
    if (r > escape && dot(p, v) > 0) return done('escaped');

    const dl = Math.max(1e-4, (tol * r) / Math.max(1e-9, len(v)));

    // RK4 on (p, v) with a(p) only — h² is constant along the path.
    const a1 = accel(p, h2);
    const p2 = add(p, scale(v, dl / 2));
    const v2 = add(v, scale(a1, dl / 2));
    const a2 = accel(p2, h2);
    const p3 = add(p, scale(v2, dl / 2));
    const v3_ = add(v, scale(a2, dl / 2));
    const a3 = accel(p3, h2);
    const p4 = add(p, scale(v3_, dl));
    const v4 = add(v, scale(a3, dl));
    const a4 = accel(p4, h2);

    const vNext = add(v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), dl / 6));
    p = add(p, scale(add(add(v, scale(add(v2, v3_), 2)), v4), dl / 6));
    bend += angleBetween(v, vNext);
    v = vNext;
  }

  return done('exhausted');
}

/**
 * Angle between two vectors, by atan2 of the cross and dot products rather
 * than acos of the dot. Nearly parallel vectors are exactly the case here,
 * and acos throws away half its precision there.
 */
function angleBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(len(cross(a, b)), dot(a, b));
}

/**
 * Deflection of a ray that comes in from far away with impact parameter b.
 * Returns null if the hole swallows it.
 *
 * Starting far out along −x with velocity +x and offset b in y makes
 * h = |r × v| exactly b, which is the quantity the force law needs.
 */
export function deflection(b: number, start = 1e4, tolerance = 0.01): number | null {
  const p0 = v3(-start, b, 0);
  const v0 = v3(1, 0, 0);
  const r = trace(p0, v0, { escape: start, tolerance, maxSteps: 400000 });
  return r.outcome === 'escaped' ? r.bend : null;
}

/**
 * Angular radius of the black hole's shadow for an observer at rest at radius
 * r, in radians. The shadow is the set of directions whose rays fall in, and
 * its edge is the direction whose impact parameter is exactly 3√3.
 */
export function shadowAngle(r: number): number {
  const s = (B_CRIT / r) * Math.sqrt(Math.max(0, 1 - HORIZON / r));
  return Math.asin(Math.min(1, s));
}

/** Orbital speed of disk material on a circular geodesic at r, as a static observer measures it. */
export function orbitalSpeed(r: number): number {
  return Math.sqrt(1 / (r - HORIZON));
}
