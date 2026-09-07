/**
 * Drives the shader: sets up WebGL2, keeps the camera pointed at the hole,
 * handles dragging, and draws the measured annotations on a layer above.
 */

import { VERTEX_SOURCE, FRAGMENT_SOURCE } from './shader';
import { shadowAngle, HORIZON, B_CRIT, ISCO, PHOTON_SPHERE } from './lensing';

export class WebGLUnavailable extends Error {}

const MIN_QUALITY = 0.4;
const MAX_QUALITY = 1;

export class Renderer {
  /** Camera, in units of M. Inclination is measured from the disk's plane. */
  distance = 42;
  inclination = 12; // degrees
  azimuth = 0; // degrees
  fov = 50; // degrees

  showDisk = true;
  showStars = true;
  beaming = true;
  showMarkers = false;

  diskInner = ISCO;
  diskOuter = 15;
  exposure = 0.6;
  steps = 700;

  /**
   * Fraction of the display resolution actually rendered. Starts low so the
   * first frame arrives quickly even on a weak or software renderer, then
   * climbs if the frame rate allows.
   */
  quality = 0.5;
  autoQuality = true;
  fps = 0;

  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  private w = 1;
  private h = 1;
  private raf = 0;
  private start = performance.now();
  private frames = 0;
  private lastFpsAt = performance.now();
  private frozen = false;
  private observer: ResizeObserver;
  private cleanup: Array<() => void> = [];

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.host = host;
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d')!;

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new WebGLUnavailable('This browser did not provide a WebGL2 context.');
    this.gl = gl;

    this.program = this.link(VERTEX_SOURCE, FRAGMENT_SOURCE);
    this.vao = gl.createVertexArray()!;
    for (const name of ['uRes', 'uCam', 'uBasis', 'uTanHalfFov', 'uDiskIn', 'uDiskOut', 'uShowDisk', 'uShowStars', 'uBeaming', 'uTime', 'uExposure', 'uSteps']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }

    this.frozen = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    for (const fn of this.cleanup) fn();
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new WebGLUnavailable(`Shader failed to compile: ${log}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    const a = compile(gl.VERTEX_SHADER, vs);
    const b = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a);
    gl.attachShader(p, b);
    gl.linkProgram(p);
    gl.deleteShader(a);
    gl.deleteShader(b);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new WebGLUnavailable(`Shader program failed to link: ${log}`);
    }
    return p;
  }

  // ── camera ───────────────────────────────────────────────────────────────

  /** Where the camera sits, and the frame it looks through. */
  private view() {
    const inc = (Math.max(-89, Math.min(89, this.inclination)) * Math.PI) / 180;
    const az = (this.azimuth * Math.PI) / 180;
    const pos: [number, number, number] = [
      this.distance * Math.cos(inc) * Math.cos(az),
      this.distance * Math.sin(inc),
      this.distance * Math.cos(inc) * Math.sin(az),
    ];
    // Look straight at the hole.
    const fwd = norm([-pos[0], -pos[1], -pos[2]]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { pos, right, up, fwd };
  }

  // ── input ────────────────────────────────────────────────────────────────

  private bindInput(): void {
    const el = this.host;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      this.azimuth += (e.clientX - lx) * 0.32;
      this.inclination = Math.max(-89, Math.min(89, this.inclination + (e.clientY - ly) * 0.22));
      lx = e.clientX;
      ly = e.clientY;
      this.onCameraChange?.();
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      el.classList.remove('is-dragging');
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };
    const wheel = (e: WheelEvent) => {
      this.distance = Math.max(8, Math.min(80, this.distance * Math.exp(e.deltaY * 0.0011)));
      this.onCameraChange?.();
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    });
  }

  /** Set by the page so the dials can follow a drag. */
  onCameraChange?: () => void;

  // ── frame ────────────────────────────────────────────────────────────────

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(this.w * dpr);
    this.overlay.height = Math.round(this.h * dpr);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);

    this.frames++;
    if (now - this.lastFpsAt >= 500) {
      this.fps = (this.frames * 1000) / (now - this.lastFpsAt);
      this.frames = 0;
      this.lastFpsAt = now;
      if (this.autoQuality) this.tuneQuality();
    }

    this.draw(this.frozen ? 0 : (now - this.start) / 1000);
    this.drawOverlay();
  };

  /** Trade resolution for frame rate, within limits, so slow GPUs stay usable. */
  private tuneQuality(): void {
    if (this.fps < 24 && this.quality > MIN_QUALITY) {
      this.quality = Math.max(MIN_QUALITY, this.quality - 0.12);
    } else if (this.fps > 52 && this.quality < MAX_QUALITY) {
      this.quality = Math.min(MAX_QUALITY, this.quality + 0.06);
    }
  }

  private draw(time: number): void {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rw = Math.max(1, Math.round(this.w * dpr * this.quality));
    const rh = Math.max(1, Math.round(this.h * dpr * this.quality));
    if (this.canvas.width !== rw || this.canvas.height !== rh) {
      this.canvas.width = rw;
      this.canvas.height = rh;
    }

    const { pos, right, up, fwd } = this.view();
    gl.viewport(0, 0, rw, rh);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const u = this.uniforms;
    gl.uniform2f(u.uRes, rw, rh);
    gl.uniform3f(u.uCam, pos[0], pos[1], pos[2]);
    // Column-major: the columns are right, up and forward.
    gl.uniformMatrix3fv(u.uBasis, false, [right[0], right[1], right[2], up[0], up[1], up[2], fwd[0], fwd[1], fwd[2]]);
    gl.uniform1f(u.uTanHalfFov, Math.tan(((this.fov * Math.PI) / 180) / 2));
    gl.uniform1f(u.uDiskIn, this.diskInner);
    gl.uniform1f(u.uDiskOut, this.diskOuter);
    gl.uniform1f(u.uShowDisk, this.showDisk ? 1 : 0);
    gl.uniform1f(u.uShowStars, this.showStars ? 1 : 0);
    gl.uniform1f(u.uBeaming, this.beaming ? 1 : 0);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uExposure, this.exposure);
    gl.uniform1i(u.uSteps, this.steps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * The measured circles. Both radii are computed, not drawn by eye: the
   * shadow edge from 3√3 M, and the horizon at the size it would appear if
   * light went straight, so the gap between them is the lensing.
   */
  private drawOverlay(): void {
    const g = this.octx;
    g.clearRect(0, 0, this.w, this.h);
    if (!this.showMarkers) return;

    const cx = this.w / 2;
    const cy = this.h / 2;
    const halfH = this.h / 2;
    const tanHalf = Math.tan(((this.fov * Math.PI) / 180) / 2);
    const toPixels = (angle: number) => (Math.tan(angle) / tanHalf) * halfH;

    const rShadow = toPixels(shadowAngle(this.distance));
    const rHorizon = toPixels(Math.asin(Math.min(1, HORIZON / this.distance)));

    g.save();
    g.lineWidth = 1;
    g.font = '500 12px "Archivo", system-ui, sans-serif';
    g.textBaseline = 'middle';

    // The horizon, drawn at its unlensed angular size for comparison.
    g.strokeStyle = 'rgba(233, 231, 226, 0.4)';
    g.setLineDash([3, 4]);
    g.beginPath();
    g.arc(cx, cy, rHorizon, 0, Math.PI * 2);
    g.stroke();

    g.setLineDash([]);
    g.strokeStyle = 'rgba(233, 231, 226, 0.85)';
    g.beginPath();
    g.arc(cx, cy, rShadow, 0, Math.PI * 2);
    g.stroke();

    // Leaders out to the right, clear of the disk.
    const label = (r: number, text: string, dim: boolean) => {
      const a = -Math.PI / 4;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      const tx = cx + rShadow + 46;
      g.strokeStyle = dim ? 'rgba(233, 231, 226, 0.3)' : 'rgba(233, 231, 226, 0.55)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(tx - 6, y);
      g.stroke();
      g.fillStyle = dim ? 'rgba(233, 231, 226, 0.6)' : 'rgba(233, 231, 226, 0.92)';
      g.fillText(text, tx, y);
    };
    label(rShadow, `shadow, b = 3√3 M = ${B_CRIT.toFixed(2)} M`, false);
    label(rHorizon, `horizon, 2 M, unlensed`, true);
    g.restore();
  }

  /** Facts the page reports alongside the picture. */
  stats() {
    return {
      shadowDegrees: (shadowAngle(this.distance) * 180) / Math.PI,
      ratio: B_CRIT / HORIZON,
      photonSphere: PHOTON_SPHERE,
      fps: this.fps,
      quality: this.quality,
    };
  }
}

/* Small vector helpers, kept local to the renderer. */
type V3 = [number, number, number];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
