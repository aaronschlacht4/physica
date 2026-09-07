# The Shadow of a Black Hole

A real-time renderer for gravitational lensing around a Schwarzschild black hole. Every pixel is a photon traced backwards along a null geodesic until it falls past the horizon, lands on the accretion disk, or escapes to the stars. Drag to move around it.

![A black hole with its accretion disk lensed over the top and beneath, one side brightened by Doppler beaming](docs/screenshot.png)

Nothing in the image is drawn as a shape. There is no ring model and no texture. There is one rule for how light moves in curved spacetime, applied about a million times per frame, and the shadow, the Einstein ring, the disk wrapped over the top of the hole and the bright side sweeping toward you all fall out of it.

## The rule

For null geodesics in Schwarzschild spacetime the textbook orbit equation is $d^2u/d\varphi^2 + u = 3Mu^2$ with $u = 1/r$. It is compact, but it is written in the angle swept around the hole, so it blows up for a ray aimed straight at the centre — a column of broken pixels through the middle of the picture. Comparing it with the Binet equation for a central force gives an equivalent Cartesian form that has no such problem:

$$a = -3M\,h^2\,\mathbf{r}\,/\,|\mathbf{r}|^5, \qquad h = |\mathbf{r} \times \mathbf{v}|$$

A radial ray has $h = 0$, feels no force, and travels straight into the horizon, which is exactly right. This one expression runs in the fragment shader and, identically, in the test suite.

## Checked against general relativity, not against a screenshot

`npm test` holds the integrator to results derived long before anyone could render them:

- **Einstein's deflection** $4M/b$ in the weak field, and the next two terms of the post-Newtonian expansion. It matches the three-term series to seven digits at $b = 1000M$, and the answer does not shift when the step size is quartered.
- **The photon sphere.** A photon is held on a circular orbit at exactly $r = 3M$ to six decimal places — and then loses it, because that orbit is unstable, which is why a black hole has a sharp-edged shadow rather than a permanent halo.
- **The capture threshold** at $b = 3\sqrt{3}\,M$, confirmed both from the analytic shadow angle and by firing rays and finding where they start to fall in.
- **The shadow is 2.6× the horizon**, since light need not hit the hole to be lost.

## The accretion disk

A thin disk from the innermost stable circular orbit at $r = 6M$ outward, radiating as a blackbody with the standard thin-disk profile. What reaches the camera is not what left the gas: light is redshifted climbing out of the well by $\sqrt{1 - 2M/r}$, and Doppler shifted by orbital motion that reaches half the speed of light at the inner edge. Observed brightness goes as the **fourth power** of the combined shift, which is why one side floods and the other sinks.

Toggle **Beaming** off to see the disk as it would look if the gas sat still. That asymmetry is the clearest signature that you are looking at something orbiting a black hole.

## Running it

```sh
npm install
npm run dev
```

`?quality=0.2&steps=200` forces a cheap render, which is how the headless check gets a picture out of a software renderer.

Needs WebGL2; the page says so plainly and keeps its explanation readable if the context cannot be created. It starts at half resolution, measures its own frame rate, and adjusts to stay smooth.

## Built with

TypeScript, Vite, and one WebGL2 fragment shader. No renderer, no physics library, no framework. KaTeX and marked set the write-up.
