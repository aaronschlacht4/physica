import './styles.css';
import { Sandbox } from './sim';
import { renderDoc } from './doc';
import howItWorks from '../docs/how-it-works.md?raw';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const sandbox = new Sandbox($('#space'));

// Mass slider: a log scale from a speck up to a fifth of the star.
const STAR_MASS = 5e6;
const massInput = $<HTMLInputElement>('#mass');
const massValue = $('#mass-value');
const applyMass = () => {
  sandbox.mass = 2e3 * Math.pow(500, parseFloat(massInput.value));
  const pct = (sandbox.mass / STAR_MASS) * 100;
  massValue.textContent = `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}% of the star`;
};
massInput.addEventListener('input', applyMass);
applyMass();

const trails = $<HTMLInputElement>('#trails');
trails.addEventListener('change', () => (sandbox.trails = trails.checked));
sandbox.trails = trails.checked;

const pause = $<HTMLButtonElement>('#pause');
pause.addEventListener('click', () => {
  sandbox.paused = !sandbox.paused;
  pause.textContent = sandbox.paused ? 'Resume' : 'Pause';
});

$('#clear').addEventListener('click', () => sandbox.clear());

const status = $('#status');
setInterval(() => {
  const { planets, drift } = sandbox.stats();
  const pct = drift * 100;
  status.textContent = `${planets} ${planets === 1 ? 'planet' : 'planets'}, energy drift ${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%`;
}, 250);

$('#how').innerHTML = renderDoc(howItWorks);
