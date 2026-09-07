import './styles.css';
import { Renderer, WebGLUnavailable } from './renderer';
import { renderDoc } from './doc';
import howItWorks from '../docs/how-it-works.md?raw';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

$('#how').innerHTML = renderDoc(howItWorks);

let renderer: Renderer | null = null;
try {
  renderer = new Renderer($('#view'), $<HTMLCanvasElement>('#gl'), $<HTMLCanvasElement>('#overlay'));
} catch (err) {
  const box = $('#fallback');
  box.hidden = false;
  box.innerHTML =
    `<p>This page traces light through curved spacetime on the graphics card, and this browser could not start WebGL2. ` +
    `The explanation below still stands on its own.</p>`;
  $('#view').style.cursor = 'default';
  if (!(err instanceof WebGLUnavailable)) console.error(err);
}

if (renderer) {
  const r = renderer;

  // ?quality=0.2&steps=150 forces a cheap render, which is how the headless
  // check gets a picture out of a software renderer in reasonable time.
  const params = new URLSearchParams(location.search);
  const forcedQuality = Number(params.get('quality'));
  const forcedSteps = Number(params.get('steps'));
  if (forcedQuality > 0) {
    r.quality = Math.min(1, forcedQuality);
    r.autoQuality = false;
  }
  if (forcedSteps > 0) r.steps = Math.round(forcedSteps);

  /** Wire a slider both ways: it drives the camera, and dragging drives it. */
  const dial = (id: string, format: (v: number) => string, apply: (v: number) => void, read: () => number) => {
    const input = $<HTMLInputElement>(`#${id}`);
    const out = $(`#${id}-out`);
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const show = (v: number) => {
      out.textContent = format(v);
      // The filled part of the track; a native range exposes no way to do this.
      input.style.setProperty('--t', `${((v - min) / (max - min)) * 100}%`);
    };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      apply(v);
      show(v);
    });
    show(parseFloat(input.value));
    apply(parseFloat(input.value));
    return () => {
      const v = read();
      input.value = String(v);
      show(v);
    };
  };

  const followers = [
    dial('incl', (v) => `${v.toFixed(0)}°`, (v) => (r.inclination = v), () => r.inclination),
    dial('dist', (v) => `${v.toFixed(0)} M`, (v) => (r.distance = v), () => r.distance),
    dial('router', (v) => `${v.toFixed(0)} M`, (v) => (r.diskOuter = v), () => r.diskOuter),
  ];
  // Dragging the picture moves the camera, so the dials have to keep up.
  r.onCameraChange = () => followers.forEach((f) => f());

  const toggle = (id: string, apply: (on: boolean) => void) => {
    const input = $<HTMLInputElement>(`#${id}`);
    input.addEventListener('change', () => apply(input.checked));
    apply(input.checked);
  };
  toggle('disk', (on) => (r.showDisk = on));
  toggle('beaming', (on) => (r.beaming = on));
  toggle('stars', (on) => (r.showStars = on));
  toggle('markers', (on) => (r.showMarkers = on));

  // Exposed so the headless check can turn the quality down and still get a
  // picture out of a software renderer.
  (window as unknown as { __bh: Renderer }).__bh = r;

  const shadowOut = $('#r-shadow');
  const ratioOut = $('#r-ratio');
  const perfOut = $('#r-perf');
  setInterval(() => {
    const s = r.stats();
    shadowOut.textContent = `${s.shadowDegrees.toFixed(2)}°`;
    ratioOut.textContent = `${s.ratio.toFixed(2)}×`;
    perfOut.textContent = `${s.fps.toFixed(0)} fps, ${(s.quality * 100).toFixed(0)}% res`;
  }, 400);
}
