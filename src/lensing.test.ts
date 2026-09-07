import { describe, it, expect } from 'vitest';
import {
  trace, deflection, shadowAngle, accel, rayFromObserver, orbitalSpeed,
  v3, len, cross, dot, normalize, sub,
  HORIZON, PHOTON_SPHERE, ISCO, B_CRIT,
} from './lensing';

describe('the geometry it is built on', () => {
  it('puts the landmarks where Schwarzschild says', () => {
    expect(HORIZON).toBe(2);
    expect(PHOTON_SPHERE).toBe(3);
    expect(ISCO).toBe(6);
    expect(B_CRIT).toBeCloseTo(5.196152422706632, 12);
  });

  it('holds a photon on a circular orbit at r = 3', () => {
    // The photon sphere is the one radius where the force law exactly supplies
    // the centripetal acceleration a circular light path needs.
    const r = trace(v3(3, 0, 0), v3(0, 1, 0), { escape: 1e6, maxSteps: 4000, tolerance: 0.002 });
    expect(r.outcome).toBe('exhausted'); // neither swallowed nor escaped
    expect(len(r.pos)).toBeCloseTo(3, 5); // still there after more than an orbit
  });

  it('and eventually loses it, because that orbit is unstable', () => {
    // Light can circle the photon sphere but cannot stay: the orbit is a ridge,
    // not a valley, so the smallest nudge grows until the photon leaves. This
    // is why the shadow has a sharp edge rather than a bright permanent ring.
    const r = trace(v3(3, 0, 0), v3(0, 1, 0), { escape: 1e5, maxSteps: 40000, tolerance: 0.002 });
    expect(r.outcome).toBe('escaped');
    expect(r.bend / (2 * Math.PI)).toBeGreaterThan(2); // after several loops
  });

  it('leaves a radial ray perfectly straight', () => {
    // Aimed at the centre, the angular momentum is zero and so is the force.
    const r = trace(v3(-40, 0, 0), v3(1, 0, 0), { escape: 1e4 });
    expect(r.outcome).toBe('captured');
    expect(r.bend).toBeCloseTo(0, 12);
  });

  it('conserves angular momentum along a strongly bent path', () => {
    const p0 = v3(-60, 7, 0);
    const v0 = v3(1, 0, 0);
    const h0 = len(cross(p0, v0));
    const r = trace(p0, v0, { escape: 60, tolerance: 0.005 });
    const h1 = len(cross(r.pos, r.vel));
    expect(h0).toBeCloseTo(7, 12);
    // h is what the force law leans on, so the integrator must not let it drift.
    expect(h1 / h0).toBeCloseTo(1, 8);
    // And the path must stay in the plane it started in.
    expect(Math.abs(dot(normalize(cross(p0, v0)), normalize(cross(r.pos, r.vel))))).toBeCloseTo(1, 9);
  });
});

describe('deflection of starlight', () => {
  it('matches Einstein’s 4M/b in the weak field', () => {
    for (const b of [1e4, 1e5]) {
      const a = deflection(b, 1000 * b, 0.02)!;
      expect(a).not.toBeNull();
      expect(a / (4 / b)).toBeCloseTo(1, 3);
    }
  });

  it('matches the post-Newtonian expansion term by term closer in', () => {
    // α ≈ 4M/b + 15πM²/(4b²) + 128M³/(3b³)
    const series = (b: number) => 4 / b + (15 * Math.PI) / (4 * b * b) + 128 / (3 * b ** 3);
    expect(Math.abs(deflection(1000, 1e6, 0.01)! / series(1000) - 1)).toBeLessThan(1e-6);
    expect(Math.abs(deflection(100, 1e5, 0.01)! / series(100) - 1)).toBeLessThan(1e-4);
  });

  it('gives the same answer however finely it is stepped', () => {
    // The step is a fraction of the current radius; if the integration has
    // converged, shrinking it fourfold must not move the answer.
    const coarse = deflection(20, 1e5, 0.02)!;
    const fine = deflection(20, 1e5, 0.005)!;
    expect(Math.abs(coarse / fine - 1)).toBeLessThan(1e-6);
  });

  it('swallows anything inside the critical impact parameter', () => {
    expect(deflection(B_CRIT * 0.999, 1e4, 0.01)).toBeNull();
    expect(deflection(B_CRIT * 0.95, 1e4, 0.01)).toBeNull();
    expect(deflection(B_CRIT * 1.02, 1e4, 0.005)).not.toBeNull();
  });

  it('bends light right around the hole just outside that parameter', () => {
    // The deflection diverges logarithmically at b → 3√3, so a ray passing
    // just outside can come back at the observer or loop several times.
    const a = deflection(B_CRIT * 1.005, 1e4, 0.004)!;
    expect(a).toBeGreaterThan(Math.PI);
  });

  it('bends more the closer it passes', () => {
    const wide = deflection(50, 1e5, 0.01)!;
    const close = deflection(8, 1e5, 0.005)!;
    expect(close).toBeGreaterThan(wide);
  });
});

describe('what an observer sees', () => {
  it('reports a shadow of 3√3 M / r far away', () => {
    expect(shadowAngle(1e6)).toBeCloseTo(B_CRIT / 1e6, 9);
  });

  it('agrees with tracing rays at the shadow edge', () => {
    // Fire rays from a static observer at r = 30 at increasing angles from the
    // inward radial direction. The switch from swallowed to escaping should
    // land on the analytic shadow angle.
    const r = 30;
    const pos = v3(r, 0, 0);
    const outward = v3(1, 0, 0);
    const tangential = v3(0, 1, 0);
    const swallowed = (deg: number) => {
      const psi = Math.PI - (deg * Math.PI) / 180; // measured from the inward direction
      const v = rayFromObserver(pos, outward, tangential, Math.cos(psi), Math.sin(psi));
      return trace(pos, v, { escape: 400, tolerance: 0.004 }).outcome === 'captured';
    };
    const edge = (shadowAngle(r) * 180) / Math.PI;
    expect(edge).toBeCloseTo(9.6327, 3);
    expect(swallowed(edge - 0.05)).toBe(true);
    expect(swallowed(edge + 0.05)).toBe(false);
  });

  it('sees a shadow far larger than the horizon itself', () => {
    // The famous factor: the dark patch is √27/2 ≈ 2.6 times the horizon.
    expect(B_CRIT / HORIZON).toBeCloseTo(2.598, 3);
  });
});

describe('the disk', () => {
  it('orbits at half light speed at the innermost stable orbit', () => {
    expect(orbitalSpeed(ISCO)).toBeCloseTo(0.5, 12);
  });

  it('reaches light speed at the photon sphere', () => {
    expect(orbitalSpeed(PHOTON_SPHERE)).toBeCloseTo(1, 12);
  });

  it('falls off toward the Newtonian value far out', () => {
    expect(orbitalSpeed(1e6)).toBeCloseTo(1e-3, 6);
  });
});

describe('the force law', () => {
  it('vanishes with no angular momentum and falls off as r⁻⁴', () => {
    expect(len(accel(v3(10, 0, 0), 0))).toBe(0);
    const a1 = len(accel(v3(10, 0, 0), 1));
    const a2 = len(accel(v3(20, 0, 0), 1));
    expect(a1 / a2).toBeCloseTo(16, 9);
  });

  it('supplies exactly the centripetal pull a circular photon orbit needs', () => {
    const r = PHOTON_SPHERE;
    const vt = 1;
    const h2 = (r * vt) ** 2;
    const a = accel(v3(r, 0, 0), h2);
    expect(len(a)).toBeCloseTo((vt * vt) / r, 12);
    expect(dot(normalize(a), v3(-1, 0, 0))).toBeCloseTo(1, 12);
  });
});
