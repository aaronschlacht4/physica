# Physica

A plate of orbits, drawn as they happen. Throw a planet at the star and it inks its path onto the page.

![A plate showing two inked orbits around a star, with the predicted ellipse of a third drawn in blue](docs/screenshot.png)

Astronomers worked from photographic negatives, dark stars on pale plates, because the eye picks out fine detail better that way. So this is a plate rather than a night sky: the Sun is drawn as its own symbol, and every planet lays down a mark between where it was and where it is. The marks are never taken back, so a path travelled again and again darkens the way a long exposure does.

That turns the page into a record of time rather than position, and it makes something visible that is otherwise only an equation. A lopsided orbit comes out pale at the end nearest the star, where the planet whips through, and dark at the far end, where it dawdles. That is Kepler's second law, drawing itself. Orbits also come out as a band of fine lines rather than one, because the planets pull on each other and no orbit quite retraces itself. That band is precession.

**Black is what has happened. Blue is what has only been worked out.** The curve that appears while you aim is not the simulation run ahead in fast forward. Around a single mass a path is always a conic section with that mass at one focus, so the whole orbit follows in closed form from the position and velocity at the moment of release. The ellipse is drawn in one stroke, its major axis dashed through the star to show the star sits at a focus and not at the centre. It grows and turns as you aim, snaps open when you cross escape velocity, and the note beside it gives the period from Kepler's third law. Let go and count: the planet comes back when it said it would.

Underneath, it is honest N-body motion. Planets pull on each other and on the star, which is not nailed down, so a heavy throw makes the whole system wobble. Bodies that touch merge and conserve momentum. The reading along the bottom rule tracks total energy, which is the check on the integrator.

## Run it locally

```sh
npm install
npm run dev
```

`npm test` covers the physics: a circular orbit stays circular for a minute of simulated time, energy stays within a tiny band, momentum survives both stepping and merging, and the analytically drawn ellipse agrees with the numerical integrator after one full period.

## How it works

The write-up beneath the plate covers Newton's law and softening, why velocity Verlet keeps orbits stable where the obvious method does not, the orbital elements behind the predicted curve, what the ink density means, and collisions. It also lives in [docs/how-it-works.md](docs/how-it-works.md).

## Built with

TypeScript, Vite and the Canvas 2D API. No physics library and no framework. KaTeX and marked render the write-up.
