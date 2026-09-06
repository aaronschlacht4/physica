/**
 * The plate: a star, and planets you throw at it, each one inking its path
 * onto the page as it goes.
 *
 * Two kinds of mark are drawn, and the difference is the point. Ink is what
 * has happened: the traces the planets have actually laid down. The blue is a
 * construction line, what would happen if you let go now, solved from the
 * orbital elements rather than integrated forward, so the whole ellipse
 * appears at once and changes as you aim.
 */

import {
  createSystem, addBody, removeBody, mergeBodies, accelerate, step, energy,
  radiusFor, orbitAround, G, type System, type Orbit,
} from './physics';

const STAR_MASS = 5e6;
const EPS2 = 6 * 6; // softening length of 6 px
const H = 1 / 240; // physics step, seconds
const LAUNCH_SCALE = 2; // px/s of speed per px of drag

const PAPER = '#e9e6dc';
const INK = '#191712';
const BLUE = '#2c5aa0';
const INK_RGB = '25, 23, 18';
const BLUE_RGB = '44, 90, 160';

/**
 * How strongly a planet inks the page on each pass. The marks are never taken
 * back, so a path travelled again and again darkens the way a long exposure
 * does, and the densest part of the plate is where the planets spend most of
 * their time. Fading the page back instead would tint it: the correction
 * rounds differently in each colour channel, and the ink drifts green.
 */
const INK_ALPHA = 0.3;

const SPECKS = 190; // faint grain of background stars, dark as on a negative

// Fallback path drawn when the orbit does not close.
const PATH_STEPS = 1100;
const PATH_H = 1 / 60;

export interface Stats {
  planets: number;
  /** Relative change in total energy since the system last changed. */
  drift: number;
}

export class Sandbox {
  /** Mass given to the next planet thrown. */
  mass = 2e4;
  /** Whether the planets leave a trace behind them. */
  inking = true;
  paused = false;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private sys: System = createSystem();
  /** Where each body was drawn last frame, so its trace is a line, not a row of dots. */
  private lastX: number[] = [];
  private lastY: number[] = [];
  private E0 = 0;
  private accum = 0;
  private last = 0;
  private raf = 0;
  private wipe = true;

  private aiming = false;
  private sx = 0;
  private sy = 0;
  private px = 0;
  private py = 0;
  private orbit: Orbit | null = null;
  private note = '';
  private path = new Float64Array(PATH_STEPS * 2);
  private pathLen = 0;

  private specks = new Float32Array(SPECKS * 3);
  private observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d')!;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.seed();

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Wipe the plate: every planet and every mark, leaving the star alone. */
  clear(): void {
    this.sys.n = 0;
    this.lastX = [];
    this.lastY = [];
    addBody(this.sys, 0, 0, 0, 0, STAR_MASS);
    this.lastX.push(0);
    this.lastY.push(0);
    accelerate(this.sys, EPS2);
    this.E0 = energy(this.sys);
    this.wipe = true;
  }

  /** The system you arrive to: two planets already drawing. */
  private seed(): void {
    this.clear();
    const circular = (r: number) => Math.sqrt((G * STAR_MASS) / r);
    // Sized against the smaller side of the plate so both are on the page at
    // any shape of screen.
    const R = Math.min(this.w, this.h);

    const r1 = R * 0.2;
    this.spawn(0, -r1, circular(r1), 0, 2.2e4);

    // Crossed at less than circular speed, so this one swings in and back out.
    const r2 = R * 0.4;
    const v2 = circular(r2) * 0.92;
    const ux = 0.94;
    const uy = 0.34;
    this.spawn(r2 * ux, r2 * uy, -uy * v2, ux * v2, 3.4e4);

    // Take out the small net drift the planets give the system.
    let px = 0;
    let py = 0;
    let M = 0;
    for (let i = 0; i < this.sys.n; i++) {
      px += this.sys.m[i] * this.sys.vx[i];
      py += this.sys.m[i] * this.sys.vy[i];
      M += this.sys.m[i];
    }
    for (let i = 0; i < this.sys.n; i++) {
      this.sys.vx[i] -= px / M;
      this.sys.vy[i] -= py / M;
    }
    accelerate(this.sys, EPS2);
    this.E0 = energy(this.sys);
  }

  private spawn(x: number, y: number, vx: number, vy: number, m: number): void {
    addBody(this.sys, x, y, vx, vy, m);
    this.lastX.push(x);
    this.lastY.push(y);
  }

  /** Mirror the swap physics.removeBody makes, so the trace history follows its body. */
  private closeSlot(i: number): void {
    const last = this.sys.n; // already decremented by removeBody
    this.lastX[i] = this.lastX[last];
    this.lastY[i] = this.lastY[last];
    this.lastX.length = last;
    this.lastY.length = last;
  }

  stats(): Stats {
    const E = energy(this.sys);
    return { planets: this.sys.n - 1, drift: this.E0 === 0 ? 0 : (E - this.E0) / Math.abs(this.E0) };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
  }

  // ── size and coordinates ─────────────────────────────────────────────────

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A fixed scatter, the same every time for a given size.
    let seed = 20260906;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < SPECKS; i++) {
      this.specks[3 * i] = rand() * this.w;
      this.specks[3 * i + 1] = rand() * this.h;
      this.specks[3 * i + 2] = 0.05 + rand() * rand() * 0.3;
    }
    this.wipe = true;
  }

  /** Plate coordinates put the origin at the centre. */
  private toWorld(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left - this.w / 2, e.clientY - rect.top - this.h / 2];
  }

  /** The heaviest body, which the previewed orbit is drawn around. */
  private primary(): number {
    let best = 0;
    for (let i = 1; i < this.sys.n; i++) if (this.sys.m[i] > this.sys.m[best]) best = i;
    return best;
  }

  // ── input ────────────────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    [this.sx, this.sy] = this.toWorld(e);
    this.px = this.sx;
    this.py = this.sy;
    this.aiming = true;
    this.updateAim();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.aiming) return;
    [this.px, this.py] = this.toWorld(e);
    this.updateAim();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.aiming) return;
    this.aiming = false;
    [this.px, this.py] = this.toWorld(e);
    this.spawn(this.sx, this.sy, (this.px - this.sx) * LAUNCH_SCALE, (this.py - this.sy) * LAUNCH_SCALE, this.mass);
    accelerate(this.sys, EPS2);
    this.E0 = energy(this.sys);
  };

  private onCancel = (): void => {
    this.aiming = false;
  };

  /**
   * Work out the orbit the planet would follow. Around a single star the path
   * is a conic section, so the whole ellipse is known at once from the
   * position and velocity. When it does not close, integrate the path instead.
   */
  private updateAim(): void {
    const s = this.sys;
    const p = this.primary();
    const vx = (this.px - this.sx) * LAUNCH_SCALE;
    const vy = (this.py - this.sy) * LAUNCH_SCALE;
    const mu = G * (s.m[p] + this.mass);
    const o = orbitAround(mu, this.sx - s.x[p], this.sy - s.y[p], vx - s.vx[p], vy - s.vy[p]);

    const touching = radiusFor(s.m[p]) + radiusFor(this.mass);
    if (o && o.kind === 'ellipse' && o.a < 40000) {
      this.orbit = o;
      this.pathLen = 0;
      this.note = o.periapsis < touching ? 'falls into the star' : `goes round in ${formatPeriod(o.period)}`;
    } else {
      this.orbit = null;
      this.note = o ? 'escapes' : '';
      this.integratePath();
    }
  }

  /** A test particle run forward against the bodies as they stand now. */
  private integratePath(): void {
    const s = this.sys;
    let x = this.sx;
    let y = this.sy;
    let vx = (this.px - this.sx) * LAUNCH_SCALE;
    let vy = (this.py - this.sy) * LAUNCH_SCALE;
    let ax = 0;
    let ay = 0;
    const accel = () => {
      ax = 0;
      ay = 0;
      for (let i = 0; i < s.n; i++) {
        const dx = s.x[i] - x;
        const dy = s.y[i] - y;
        const r2 = dx * dx + dy * dy + EPS2;
        const inv3 = 1 / (r2 * Math.sqrt(r2));
        ax += G * s.m[i] * dx * inv3;
        ay += G * s.m[i] * dy * inv3;
      }
    };
    const hits = () => {
      for (let i = 0; i < s.n; i++) {
        const r = radiusFor(s.m[i]) + radiusFor(this.mass);
        if ((s.x[i] - x) ** 2 + (s.y[i] - y) ** 2 < r * r * 0.5) return true;
      }
      return false;
    };
    accel();
    let k = 0;
    for (; k < PATH_STEPS; k++) {
      vx += 0.5 * PATH_H * ax;
      vy += 0.5 * PATH_H * ay;
      x += PATH_H * vx;
      y += PATH_H * vy;
      accel();
      vx += 0.5 * PATH_H * ax;
      vy += 0.5 * PATH_H * ay;
      this.path[2 * k] = x;
      this.path[2 * k + 1] = y;
      if (hits()) {
        k++;
        break;
      }
    }
    this.pathLen = k;
  }

  // ── simulation ───────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 1 / 30) dt = 1 / 30; // a background tab must not produce a giant step
    if (!this.paused) this.update(dt);
    this.render();
  };

  private update(dt: number): void {
    this.accum += dt;
    let steps = 0;
    while (this.accum >= H && steps < 10) {
      step(this.sys, H, EPS2);
      this.accum -= H;
      steps++;
    }
    if (steps === 10) this.accum = 0;
    if (steps > 0) this.collide();
  }

  /** Merge bodies that touch; drop bodies that have gone far off the plate. */
  private collide(): void {
    const s = this.sys;
    let changed = false;
    for (let i = 0; i < s.n; i++) {
      for (let j = i + 1; j < s.n; j++) {
        const r = (radiusFor(s.m[i]) + radiusFor(s.m[j])) * 0.7;
        if ((s.x[i] - s.x[j]) ** 2 + (s.y[i] - s.y[j]) ** 2 < r * r) {
          const keep = s.m[i] >= s.m[j] ? i : j;
          const drop = keep === i ? j : i;
          mergeBodies(s, keep, drop);
          this.closeSlot(drop);
          changed = true;
          j--;
        }
      }
    }
    const far = 3 * Math.max(this.w, this.h);
    for (let i = s.n - 1; i >= 0; i--) {
      if (Math.abs(s.x[i]) > far || Math.abs(s.y[i]) > far) {
        removeBody(s, i);
        this.closeSlot(i);
        changed = true;
      }
    }
    if (changed) {
      accelerate(s, EPS2);
      this.E0 = energy(s);
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────────

  private render(): void {
    const { w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const s = this.sys;
    const l = this.lctx;

    // The plate holds the ink. Nothing is redrawn here, only added to, so the
    // traces build up the way a long exposure does. Pausing leaves it be.
    if (this.wipe) {
      l.fillStyle = PAPER;
      l.fillRect(0, 0, w, h);
      for (let i = 0; i < SPECKS; i++) {
        l.fillStyle = `rgba(${INK_RGB}, ${this.specks[3 * i + 2]})`;
        l.fillRect(this.specks[3 * i], this.specks[3 * i + 1], 1, 1);
      }
      this.wipe = false;
    } else if (!this.paused && this.inking) {
      l.strokeStyle = `rgba(${INK_RGB}, ${INK_ALPHA})`;
      l.lineWidth = 1;
      l.lineCap = 'round';
      l.beginPath();
      const star = this.primary();
      for (let i = 0; i < s.n; i++) {
        if (i === star) continue;
        l.moveTo(cx + this.lastX[i], cy + this.lastY[i]);
        l.lineTo(cx + s.x[i], cy + s.y[i]);
      }
      l.stroke();
    }
    // Kept current even while the pen is up, so switching the ink back on does
    // not draw a line across the gap.
    if (!this.paused) {
      for (let i = 0; i < s.n; i++) {
        this.lastX[i] = s.x[i];
        this.lastY[i] = s.y[i];
      }
    }

    const g = this.ctx;
    g.drawImage(this.layer, 0, 0, w, h);

    // The bodies sit on top of the ink rather than in it, so they stay crisp.
    for (let i = 0; i < s.n; i++) {
      const x = cx + s.x[i];
      const y = cy + s.y[i];
      const r = radiusFor(s.m[i]);
      if (i === this.primary()) {
        // The Sun, drawn as its own symbol: a circle about a point.
        g.strokeStyle = INK;
        g.lineWidth = 1.25;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = INK;
        g.beginPath();
        g.arc(x, y, Math.max(1.6, r * 0.28), 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = INK;
        g.beginPath();
        g.arc(x, y, Math.max(1.7, r), 0, Math.PI * 2);
        g.fill();
      }
    }

    if (this.aiming) this.drawAim(g, cx, cy);
  }

  private drawAim(g: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = this.sys;
    const p = this.primary();
    const fx = cx + s.x[p];
    const fy = cy + s.y[p];

    if (this.orbit) {
      const o = this.orbit;
      // The major axis, dashed through the star, which shows that the star
      // sits at a focus of the ellipse and not at its centre.
      g.save();
      g.setLineDash([4, 5]);
      g.strokeStyle = `rgba(${BLUE_RGB}, 0.42)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(fx + o.cx + o.a * Math.cos(o.argp), fy + o.cy + o.a * Math.sin(o.argp));
      g.lineTo(fx + o.cx - o.a * Math.cos(o.argp), fy + o.cy - o.a * Math.sin(o.argp));
      g.stroke();
      g.restore();

      g.strokeStyle = BLUE;
      g.lineWidth = 1.1;
      g.beginPath();
      g.ellipse(fx + o.cx, fy + o.cy, o.a, o.b, o.argp, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.strokeStyle = BLUE;
      g.lineWidth = 1.1;
      g.beginPath();
      for (let k = 0; k < this.pathLen; k++) {
        const x = cx + this.path[2 * k];
        const y = cy + this.path[2 * k + 1];
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }

    // The aim, and the planet not yet let go of: open, because it has not
    // drawn anything yet.
    g.strokeStyle = `rgba(${BLUE_RGB}, 0.55)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx + this.sx, cy + this.sy);
    g.lineTo(cx + this.px, cy + this.py);
    g.stroke();

    const r = Math.max(2.6, radiusFor(this.mass));
    g.fillStyle = PAPER;
    g.beginPath();
    g.arc(cx + this.sx, cy + this.sy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = BLUE;
    g.lineWidth = 1.25;
    g.stroke();

    if (this.note) {
      // Annotations on a plate are set in italic, as an engraver would.
      g.font = 'italic 15px "EB Garamond", Georgia, serif';
      g.fillStyle = BLUE;
      g.textBaseline = 'middle';
      const right = cx + this.sx + r + 9;
      const fits = right + g.measureText(this.note).width < this.w - 10;
      g.textAlign = fits ? 'left' : 'right';
      g.fillText(this.note, fits ? right : cx + this.sx - r - 9, cy + this.sy - r - 9);
    }
  }
}

/** "4.2 s", or minutes once an orbit gets long. */
function formatPeriod(t: number): string {
  if (t < 60) return `${t.toFixed(1)} s`;
  const m = Math.floor(t / 60);
  return `${m} min ${Math.round(t - m * 60)} s`;
}
