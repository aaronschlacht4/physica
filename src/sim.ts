/**
 * The sandbox: a star, and planets you throw at it. Owns the canvas, the frame
 * loop and pointer input; the maths lives in physics.ts.
 *
 * While you aim, the orbit you would get is drawn whole, solved from its
 * orbital elements rather than integrated forward, so the complete ellipse
 * appears at once and changes as you move.
 */

import {
  createSystem, addBody, removeBody, mergeBodies, accelerate, step, energy,
  radiusFor, orbitAround, G, type System, type Orbit,
} from './physics';

const STAR_MASS = 5e6;
const EPS2 = 6 * 6; // softening length of 6 px
const H = 1 / 240; // physics step, seconds
const LAUNCH_SCALE = 2; // px/s of speed per px of drag
const SKY = '#000';
const SKY_FADE = 'rgba(0, 0, 0, 0.05)'; // how fast trails fade
const STAR_COLOR = '#ffcf6e';
const INK = '#efe9dc';
const STARS = 260; // faint background stars

// Muted planetary tones: ice, rust, sand, sage, dust, copper. Nothing here is
// as bright as the star, so the star stays the only light in the picture.
const PLANET_COLORS = ['#a9c9e8', '#c8795a', '#d8c8a2', '#9db79b', '#a99ac3', '#d8a066'];

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
  trails = true;
  paused = false;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private sys: System = createSystem();
  private colors: string[] = [];
  private nextColor = 0;
  private E0 = 0;
  private accum = 0;
  private last = 0;
  private raf = 0;
  private layerDirty = true;

  private aiming = false;
  private sx = 0;
  private sy = 0;
  private px = 0;
  private py = 0;
  private orbit: Orbit | null = null;
  private note = '';
  private path = new Float64Array(PATH_STEPS * 2);
  private pathLen = 0;

  private stars = new Float32Array(STARS * 3);
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

  /** Remove every planet, leaving the star alone at the centre. */
  clear(): void {
    this.sys.n = 0;
    addBody(this.sys, 0, 0, 0, 0, STAR_MASS);
    this.colors = [STAR_COLOR];
    this.nextColor = 0;
    accelerate(this.sys, EPS2);
    this.E0 = energy(this.sys);
    this.layerDirty = true;
  }

  /** The system you arrive to: two planets already going round. */
  private seed(): void {
    this.clear();
    const circular = (r: number) => Math.sqrt((G * STAR_MASS) / r);
    // Sized against the smaller side of the canvas so both planets are on
    // screen on a phone as well as on a desktop.
    const R = Math.min(this.w, this.h);

    // A close circular orbit.
    const r1 = R * 0.22;
    this.spawn(0, -r1, circular(r1), 0, 2.2e4);

    // And a wider one, crossed at less than circular speed so it swings in and
    // back out. The two are kept well apart so the pair keeps running rather
    // than colliding while you read.
    const r2 = R * 0.44;
    const v2 = circular(r2) * 0.92;
    const ux = 0.94;
    const uy = 0.34; // a unit vector, so the planet starts a distance r2 out
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
    this.colors.push(PLANET_COLORS[this.nextColor++ % PLANET_COLORS.length]);
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
    // A fixed scatter of faint stars, the same every time for a given size.
    let seed = 20260906;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < STARS; i++) {
      this.stars[3 * i] = rand() * this.w;
      this.stars[3 * i + 1] = rand() * this.h;
      this.stars[3 * i + 2] = 0.06 + rand() * rand() * 0.44;
    }
    this.layerDirty = true;
  }

  /** World coordinates put the origin at the centre of the canvas. */
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
   * position and velocity. When it does not close, or the star is not clearly
   * in charge, fall back to integrating the path forward.
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

  /** Merge bodies that touch; drop bodies that have gone far off screen. */
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
          this.colors[drop] = this.colors[s.n];
          this.colors.length = s.n;
          changed = true;
          j--;
        }
      }
    }
    const far = 3 * Math.max(this.w, this.h);
    for (let i = s.n - 1; i >= 0; i--) {
      if (Math.abs(s.x[i]) > far || Math.abs(s.y[i]) > far) {
        removeBody(s, i);
        this.colors[i] = this.colors[s.n];
        this.colors.length = s.n;
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

    // Bodies and their trails live on a layer that is faded a little each
    // frame; pausing leaves it alone so the picture freezes.
    if (!this.paused || this.layerDirty) {
      const l = this.lctx;
      l.fillStyle = this.trails && !this.layerDirty ? SKY_FADE : SKY;
      l.fillRect(0, 0, w, h);
      this.layerDirty = false;
      // Redrawn every frame so the fade never dims them.
      for (let i = 0; i < STARS; i++) {
        l.fillStyle = `rgba(239, 233, 220, ${this.stars[3 * i + 2]})`;
        l.fillRect(this.stars[3 * i], this.stars[3 * i + 1], 1, 1);
      }
      for (let i = 0; i < s.n; i++) {
        const x = cx + s.x[i];
        const y = cy + s.y[i];
        const r = radiusFor(s.m[i]);
        if (i === this.primary()) {
          const glow = l.createRadialGradient(x, y, r * 0.7, x, y, r * 5);
          glow.addColorStop(0, 'rgba(255, 207, 110, 0.4)');
          glow.addColorStop(0.45, 'rgba(255, 175, 80, 0.09)');
          glow.addColorStop(1, 'rgba(255, 160, 70, 0)');
          l.fillStyle = glow;
          l.beginPath();
          l.arc(x, y, r * 5, 0, Math.PI * 2);
          l.fill();
        }
        l.fillStyle = this.colors[i];
        l.beginPath();
        l.arc(x, y, r, 0, Math.PI * 2);
        l.fill();
      }
    }

    const g = this.ctx;
    g.fillStyle = SKY;
    g.fillRect(0, 0, w, h);
    g.drawImage(this.layer, 0, 0, w, h);
    if (this.aiming) this.drawAim(g, cx, cy);
  }

  private drawAim(g: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = this.sys;
    const p = this.primary();

    // The orbit itself: one continuous curve, drawn whole.
    g.strokeStyle = 'rgba(239, 233, 220, 0.5)';
    g.lineWidth = 1;
    if (this.orbit) {
      const o = this.orbit;
      g.beginPath();
      g.ellipse(cx + s.x[p] + o.cx, cy + s.y[p] + o.cy, o.a, o.b, o.argp, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.beginPath();
      for (let k = 0; k < this.pathLen; k++) {
        const x = cx + this.path[2 * k];
        const y = cy + this.path[2 * k + 1];
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }

    // The aim: a hairline from the planet to the pointer.
    g.strokeStyle = 'rgba(239, 233, 220, 0.28)';
    g.beginPath();
    g.moveTo(cx + this.sx, cy + this.sy);
    g.lineTo(cx + this.px, cy + this.py);
    g.stroke();

    // The planet, waiting to be let go.
    g.fillStyle = INK;
    g.beginPath();
    g.arc(cx + this.sx, cy + this.sy, radiusFor(this.mass), 0, Math.PI * 2);
    g.fill();

    if (this.note) {
      g.font = '15px Newsreader, Georgia, serif';
      g.fillStyle = 'rgba(239, 233, 220, 0.75)';
      g.textBaseline = 'middle';
      const r = radiusFor(this.mass);
      const right = cx + this.sx + r + 10;
      const fits = right + g.measureText(this.note).width < this.w - 12;
      g.textAlign = fits ? 'left' : 'right';
      g.fillText(this.note, fits ? right : cx + this.sx - r - 10, cy + this.sy - r - 9);
    }
  }
}

/** "4.2 s", or minutes once an orbit gets long. */
function formatPeriod(t: number): string {
  if (t < 60) return `${t.toFixed(1)} s`;
  const m = Math.floor(t / 60);
  return `${m} min ${Math.round(t - m * 60)} s`;
}
