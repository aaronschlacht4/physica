/**
 * The sandbox: one star in the middle of the canvas, planets you throw at it.
 * Owns the canvas, the frame loop and pointer input; the maths lives in physics.ts.
 */

import { createSystem, addBody, removeBody, mergeBodies, accelerate, step, energy, radiusFor, G, type System } from './physics';

const STAR_MASS = 5e6;
const EPS2 = 6 * 6; // softening length of 6 px
const H = 1 / 240; // physics step, seconds
const LAUNCH_SCALE = 2; // px/s of speed per px of drag
const PREVIEW_STEPS = 900;
const PREVIEW_H = 1 / 60;
const STAR_COLOR = '#ffd27a';
const PLANET_COLORS = ['#8ecbff', '#ff9e8a', '#b6f2a1', '#f6c6ff', '#ffe28a', '#9af4e6'];
const SKY = '#111214'; // same as the page background, so the sky has no frame
const SKY_FADE = 'rgba(17, 18, 20, 0.07)'; // how fast trails fade
const STARS = 140; // faint background stars

export interface Stats {
  bodies: number;
  /** Relative change in total energy since the system last changed, as a fraction. */
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
  private dragging = false;
  private sx = 0;
  private sy = 0;
  private px = 0;
  private py = 0;
  private preview = new Float64Array(PREVIEW_STEPS * 2);
  private previewLen = 0;
  private stars = new Float32Array(STARS * 3); // x, y, brightness
  private observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d')!;
    this.clear();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Remove every planet, leaving the star at rest in the centre. */
  clear(): void {
    this.sys.n = 0;
    addBody(this.sys, 0, 0, 0, 0, STAR_MASS);
    this.colors = [STAR_COLOR];
    accelerate(this.sys, EPS2);
    this.E0 = energy(this.sys);
    this.layerDirty = true;
  }

  stats(): Stats {
    const E = energy(this.sys);
    return { bodies: this.sys.n, drift: this.E0 === 0 ? 0 : (E - this.E0) / Math.abs(this.E0) };
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
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < STARS; i++) {
      this.stars[3 * i] = rand() * this.w;
      this.stars[3 * i + 1] = rand() * this.h;
      this.stars[3 * i + 2] = 0.12 + rand() * rand() * 0.5;
    }
    this.layerDirty = true;
  }

  /** World coordinates have their origin at the centre of the canvas. */
  private toWorld(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left - this.w / 2, e.clientY - rect.top - this.h / 2];
  }

  // ── input ────────────────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    [this.sx, this.sy] = this.toWorld(e);
    this.px = this.sx;
    this.py = this.sy;
    this.dragging = true;
    this.computePreview();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    [this.px, this.py] = this.toWorld(e);
    this.computePreview();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    [this.px, this.py] = this.toWorld(e);
    this.launch(this.sx, this.sy, (this.px - this.sx) * LAUNCH_SCALE, (this.py - this.sy) * LAUNCH_SCALE);
  };

  private onCancel = (): void => {
    this.dragging = false;
  };

  private launch(x: number, y: number, vx: number, vy: number): void {
    addBody(this.sys, x, y, vx, vy, this.mass);
    this.colors.push(PLANET_COLORS[this.nextColor++ % PLANET_COLORS.length]);
    accelerate(this.sys, EPS2);
    this.E0 = energy(this.sys);
  }

  /**
   * Where would a planet thrown from the drag start with the drag velocity go?
   * Integrate a massless test particle against the current bodies, held still,
   * for a few seconds, and stop if it would hit one of them.
   */
  private computePreview(): void {
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
    for (; k < PREVIEW_STEPS; k++) {
      vx += 0.5 * PREVIEW_H * ax;
      vy += 0.5 * PREVIEW_H * ay;
      x += PREVIEW_H * vx;
      y += PREVIEW_H * vy;
      accel();
      vx += 0.5 * PREVIEW_H * ax;
      vy += 0.5 * PREVIEW_H * ay;
      this.preview[2 * k] = x;
      this.preview[2 * k + 1] = y;
      if (hits()) {
        k++;
        break;
      }
    }
    this.previewLen = k;
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

  /** Merge bodies that touch; drop bodies that have flown far off screen. */
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
    const far = 2.5 * Math.max(this.w, this.h);
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

    // Bodies and their trails live on a separate layer that is faded a little
    // each frame; pausing leaves it alone so the picture freezes.
    if (!this.paused || this.layerDirty) {
      const l = this.lctx;
      l.fillStyle = this.trails && !this.layerDirty ? SKY_FADE : SKY;
      l.fillRect(0, 0, w, h);
      this.layerDirty = false;
      // Background stars are redrawn every frame so the fade never dims them.
      for (let i = 0; i < STARS; i++) {
        l.fillStyle = `rgba(236, 230, 217, ${this.stars[3 * i + 2]})`;
        l.fillRect(this.stars[3 * i], this.stars[3 * i + 1], 1, 1);
      }
      for (let i = 0; i < s.n; i++) {
        const x = cx + s.x[i];
        const y = cy + s.y[i];
        const r = radiusFor(s.m[i]);
        if (i === 0) {
          const glow = l.createRadialGradient(x, y, r * 0.8, x, y, r * 2.6);
          glow.addColorStop(0, 'rgba(255, 210, 122, 0.45)');
          glow.addColorStop(1, 'rgba(255, 210, 122, 0)');
          l.fillStyle = glow;
          l.beginPath();
          l.arc(x, y, r * 2.6, 0, Math.PI * 2);
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

    if (this.dragging) {
      // the throw
      g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx + this.sx, cy + this.sy);
      g.lineTo(cx + this.px, cy + this.py);
      g.stroke();
      // where it will go
      g.fillStyle = 'rgba(255, 255, 255, 0.6)';
      for (let k = 0; k < this.previewLen; k += 3) {
        g.fillRect(cx + this.preview[2 * k] - 1, cy + this.preview[2 * k + 1] - 1, 2, 2);
      }
      // the planet, waiting to be let go
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      g.beginPath();
      g.arc(cx + this.sx, cy + this.sy, radiusFor(this.mass), 0, Math.PI * 2);
      g.fill();
    }
  }
}
