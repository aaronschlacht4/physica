/**
 * The physics: Newtonian gravity between every pair of bodies, stepped with
 * velocity Verlet. Units are pixels and seconds with G = 1; the star's mass
 * is chosen so that an orbit a couple of hundred pixels out takes a few seconds.
 */

export const G = 1;

export interface System {
  n: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  m: Float64Array;
  /** Gravitational potential felt by each body, filled in by accelerate(). */
  phi: Float64Array;
}

export function createSystem(capacity = 64): System {
  return {
    n: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    vx: new Float64Array(capacity),
    vy: new Float64Array(capacity),
    ax: new Float64Array(capacity),
    ay: new Float64Array(capacity),
    m: new Float64Array(capacity),
    phi: new Float64Array(capacity),
  };
}

function grow(s: System): void {
  const cap = s.x.length * 2;
  for (const k of ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'm', 'phi'] as const) {
    const next = new Float64Array(cap);
    next.set(s[k]);
    s[k] = next;
  }
}

export function addBody(s: System, x: number, y: number, vx: number, vy: number, m: number): number {
  if (s.n === s.x.length) grow(s);
  const i = s.n++;
  s.x[i] = x;
  s.y[i] = y;
  s.vx[i] = vx;
  s.vy[i] = vy;
  s.ax[i] = 0;
  s.ay[i] = 0;
  s.m[i] = m;
  s.phi[i] = 0;
  return i;
}

/** Remove body i by moving the last body into its slot. */
export function removeBody(s: System, i: number): void {
  const last = s.n - 1;
  if (i !== last) {
    s.x[i] = s.x[last];
    s.y[i] = s.y[last];
    s.vx[i] = s.vx[last];
    s.vy[i] = s.vy[last];
    s.ax[i] = s.ax[last];
    s.ay[i] = s.ay[last];
    s.m[i] = s.m[last];
    s.phi[i] = s.phi[last];
  }
  s.n--;
}

/** Merge body j into body i, keeping total mass and momentum. Body j is removed. */
export function mergeBodies(s: System, i: number, j: number): void {
  const mi = s.m[i];
  const mj = s.m[j];
  const M = mi + mj;
  s.x[i] = (mi * s.x[i] + mj * s.x[j]) / M;
  s.y[i] = (mi * s.y[i] + mj * s.y[j]) / M;
  s.vx[i] = (mi * s.vx[i] + mj * s.vx[j]) / M;
  s.vy[i] = (mi * s.vy[i] + mj * s.vy[j]) / M;
  s.m[i] = M;
  removeBody(s, j);
}

/**
 * Accelerations and potentials from every pair, with softening length ε:
 *   a_i = Σ_j G m_j (r_j − r_i) / (|r_j − r_i|² + ε²)^{3/2}
 */
export function accelerate(s: System, eps2: number): void {
  const { n, x, y, m, ax, ay, phi } = s;
  ax.fill(0, 0, n);
  ay.fill(0, 0, n);
  phi.fill(0, 0, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const r2 = dx * dx + dy * dy + eps2;
      const inv = 1 / Math.sqrt(r2);
      const inv3 = inv / r2;
      ax[i] += G * m[j] * dx * inv3;
      ay[i] += G * m[j] * dy * inv3;
      ax[j] -= G * m[i] * dx * inv3;
      ay[j] -= G * m[i] * dy * inv3;
      phi[i] -= G * m[j] * inv;
      phi[j] -= G * m[i] * inv;
    }
  }
}

/**
 * One velocity-Verlet step of size h. Expects ax/ay to hold the accelerations
 * for the current positions (true after the previous step or after accelerate()).
 */
export function step(s: System, h: number, eps2: number): void {
  const { n, x, y, vx, vy, ax, ay } = s;
  const hh = 0.5 * h;
  for (let i = 0; i < n; i++) {
    vx[i] += hh * ax[i];
    vy[i] += hh * ay[i];
    x[i] += h * vx[i];
    y[i] += h * vy[i];
  }
  accelerate(s, eps2);
  for (let i = 0; i < n; i++) {
    vx[i] += hh * ax[i];
    vy[i] += hh * ay[i];
  }
}

/** Kinetic plus potential energy. Uses the potentials from the last accelerate(). */
export function energy(s: System): number {
  let e = 0;
  for (let i = 0; i < s.n; i++) {
    e += 0.5 * s.m[i] * (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]) + 0.5 * s.m[i] * s.phi[i];
  }
  return e;
}

export function momentum(s: System): [number, number] {
  let px = 0;
  let py = 0;
  for (let i = 0; i < s.n; i++) {
    px += s.m[i] * s.vx[i];
    py += s.m[i] * s.vy[i];
  }
  return [px, py];
}

/** Drawn radius in pixels for a body of mass m. */
export function radiusFor(m: number): number {
  return 1.6 + 0.06 * Math.cbrt(m);
}

export interface Orbit {
  /** A closed ellipse, or a path that never comes back. */
  kind: 'ellipse' | 'escape';
  /** Semi-major and semi-minor axes, for an ellipse. */
  a: number;
  b: number;
  /** Eccentricity: 0 is a circle, approaching 1 is a long thin ellipse. */
  e: number;
  /** Direction of closest approach, as an angle. */
  argp: number;
  /** Centre of the ellipse relative to the body being orbited. */
  cx: number;
  cy: number;
  /** Time to go round once, in seconds. */
  period: number;
  /** Distance of closest approach. */
  periapsis: number;
}

/**
 * The orbit a body follows around a single mass, from its position and
 * velocity relative to that mass. This is the classical two-body solution:
 * the path is a conic section with the mass at one focus, so it can be drawn
 * whole and instantly rather than integrated forward step by step.
 *
 * `mu` is G times the combined mass. Returns null for a radial drop straight
 * at the centre, where the ellipse collapses to a line and there is nothing
 * useful to draw.
 */
export function orbitAround(mu: number, x: number, y: number, vx: number, vy: number): Orbit | null {
  const r = Math.hypot(x, y);
  if (r < 1e-6 || mu <= 0) return null;
  const v2 = vx * vx + vy * vy;

  // Specific orbital energy decides whether the path closes.
  const energy = v2 / 2 - mu / r;

  // Eccentricity vector points from the centre toward closest approach.
  const rv = x * vx + y * vy;
  const k = v2 - mu / r;
  const ex = (k * x - rv * vx) / mu;
  const ey = (k * y - rv * vy) / mu;
  const e = Math.hypot(ex, ey);

  // Nearly radial, or fast enough to leave: no ellipse to draw.
  const h = x * vy - y * vx;
  if (energy >= 0 || e >= 0.999 || Math.abs(h) < 1e-9) {
    return { kind: 'escape', a: 0, b: 0, e, argp: Math.atan2(ey, ex), cx: 0, cy: 0, period: 0, periapsis: 0 };
  }

  const a = -mu / (2 * energy);
  const b = a * Math.sqrt(1 - e * e);
  const argp = Math.atan2(ey, ex);
  // One focus sits at the centre of attraction, so the ellipse's own centre is
  // offset from it by a·e, away from the point of closest approach.
  return {
    kind: 'ellipse',
    a,
    b,
    e,
    argp,
    cx: -a * e * Math.cos(argp),
    cy: -a * e * Math.sin(argp),
    period: 2 * Math.PI * Math.sqrt((a * a * a) / mu),
    periapsis: a * (1 - e),
  };
}
