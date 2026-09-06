import { describe, it, expect } from 'vitest';
import { createSystem, addBody, accelerate, step, energy, momentum, mergeBodies, orbitAround } from './physics';

const EPS2 = 36;

function starAndPlanet() {
  const s = createSystem();
  addBody(s, 0, 0, 0, 0, 5e6);
  const r = 200;
  addBody(s, r, 0, 0, Math.sqrt(5e6 / r), 2e4); // circular speed
  accelerate(s, EPS2);
  return s;
}

describe('gravity', () => {
  it('pulls the planet toward the star and the star toward the planet', () => {
    const s = starAndPlanet();
    expect(s.ax[1]).toBeLessThan(0);
    expect(s.ax[0]).toBeGreaterThan(0);
    // Newton's third law: m_i a_i = -m_j a_j
    expect(s.m[0] * s.ax[0] + s.m[1] * s.ax[1]).toBeCloseTo(0, 6);
  });
});

describe('velocity Verlet', () => {
  it('keeps a circular orbit circular over many periods', () => {
    const s = starAndPlanet();
    const h = 1 / 240;
    for (let i = 0; i < 240 * 60; i++) step(s, h, EPS2); // one minute of simulated time
    const r = Math.hypot(s.x[1] - s.x[0], s.y[1] - s.y[0]);
    expect(Math.abs(r - 200)).toBeLessThan(1);
  });

  it('keeps energy within a tiny band', () => {
    const s = starAndPlanet();
    const E0 = energy(s);
    let worst = 0;
    for (let i = 0; i < 240 * 60; i++) {
      step(s, 1 / 240, EPS2);
      worst = Math.max(worst, Math.abs((energy(s) - E0) / E0));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('conserves momentum', () => {
    const s = starAndPlanet();
    addBody(s, -150, 80, 40, -120, 8e4);
    accelerate(s, EPS2);
    const [px0, py0] = momentum(s);
    for (let i = 0; i < 5000; i++) step(s, 1 / 240, EPS2);
    const [px, py] = momentum(s);
    expect(px).toBeCloseTo(px0, 6);
    expect(py).toBeCloseTo(py0, 6);
  });
});

describe('orbitAround', () => {
  const MU = 5e6;

  it('reads a circular orbit as a circle of the right size and period', () => {
    const r = 200;
    const o = orbitAround(MU, r, 0, 0, Math.sqrt(MU / r))!;
    expect(o.kind).toBe('ellipse');
    expect(o.e).toBeCloseTo(0, 9);
    expect(o.a).toBeCloseTo(r, 6);
    expect(o.b).toBeCloseTo(r, 6);
    expect(o.period).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / MU), 6);
  });

  it('calls anything at or above escape velocity an escape', () => {
    const r = 200;
    const vEsc = Math.sqrt((2 * MU) / r);
    expect(orbitAround(MU, r, 0, 0, vEsc)!.kind).toBe('escape');
    expect(orbitAround(MU, r, 0, 0, vEsc * 1.2)!.kind).toBe('escape');
    expect(orbitAround(MU, r, 0, 0, vEsc * 0.99)!.kind).toBe('ellipse');
  });

  it('puts closest approach opposite the launch point for a slow throw', () => {
    // Thrown from +x at less than circular speed, so it falls inward and
    // comes closest on the far side of the star.
    const r = 200;
    const o = orbitAround(MU, r, 0, 0, Math.sqrt(MU / r) * 0.7)!;
    expect(o.kind).toBe('ellipse');
    expect(o.e).toBeGreaterThan(0);
    expect(Math.abs(o.argp)).toBeCloseTo(Math.PI, 6); // periapsis at −x
    expect(o.periapsis).toBeLessThan(r);
    expect(o.a).toBeLessThan(r);
  });

  it('agrees with the integrator: the body returns after one period', () => {
    const r = 200;
    const v = Math.sqrt(MU / r) * 0.8; // a definite ellipse
    const o = orbitAround(MU, r, 0, 0, v)!;

    // A test particle around a star heavy enough to stay put.
    const s = createSystem();
    addBody(s, 0, 0, 0, 0, MU);
    addBody(s, r, 0, 0, v, 1e-6);
    accelerate(s, 0);
    const h = 1 / 2000;
    const steps = Math.round(o.period / h);
    for (let i = 0; i < steps; i++) step(s, h, 0);
    expect(Math.hypot(s.x[1] - r, s.y[1])).toBeLessThan(r * 0.01);
  });

  it('measures the predicted extremes correctly', () => {
    const r = 200;
    const o = orbitAround(MU, r, 0, 0, Math.sqrt(MU / r) * 0.8)!;
    // Launched at less than circular speed, the launch point is the far point.
    expect(o.a * (1 + o.e)).toBeCloseTo(r, 6);
    expect(o.periapsis).toBeCloseTo(o.a * (1 - o.e), 9);
  });

  it('returns null at the centre', () => {
    expect(orbitAround(MU, 0, 0, 10, 10)).toBeNull();
  });
});

describe('merging', () => {
  it('keeps mass and momentum', () => {
    const s = createSystem();
    addBody(s, 0, 0, 10, 0, 3);
    addBody(s, 1, 0, -5, 4, 1);
    const [px0, py0] = momentum(s);
    mergeBodies(s, 0, 1);
    expect(s.n).toBe(1);
    expect(s.m[0]).toBe(4);
    const [px, py] = momentum(s);
    expect(px).toBeCloseTo(px0, 10);
    expect(py).toBeCloseTo(py0, 10);
  });
});
