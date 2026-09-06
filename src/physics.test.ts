import { describe, it, expect } from 'vitest';
import { createSystem, addBody, accelerate, step, energy, momentum, mergeBodies } from './physics';

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
