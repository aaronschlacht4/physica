# How it works

There is no model of a black hole in this page, and no texture of a glowing ring. There is a rule for how light moves when spacetime is curved, applied to about a million photons, thirty times a second. Everything you see above falls out of that rule.

Each pixel asks one question: if a photon arrived here, where did it come from? So a ray is fired from the camera and followed **backwards** until it does one of three things. It crosses the horizon and is never seen again, which paints the pixel black. It lands on the accretion disk, which paints the pixel the colour of the gas at that spot. Or it escapes, and the pixel shows whatever star lies in the direction the ray was finally travelling. Nothing is drawn in front of anything else; the picture is assembled entirely out of where light comes from.

## The rule light obeys

Outside a non-rotating black hole of mass $M$, spacetime is Schwarzschild's. Photons travel along null geodesics, and for these the textbook result is the orbit equation

$$
\frac{d^2u}{d\varphi^2} + u = 3M u^2, \qquad u = \frac{1}{r}
$$

It is compact and it is where the physics lives: drop the term on the right and you have a straight line in polar coordinates, so that one term is the whole of gravitational lensing. But it is written in the photon's own orbital plane, in terms of the angle swept around the hole, and that makes it useless for a ray aimed straight at the centre. Such a ray sweeps no angle at all, and $du/d\varphi$ runs away to infinity. In a renderer that is a column of broken pixels through the middle of the image.

So the same geodesic is rewritten as a central force in ordinary Cartesian coordinates. Comparing the orbit equation with the Binet equation for a central force gives

$$
\mathbf{a} = -\,3M\,\frac{h^2\,\mathbf{r}}{|\mathbf{r}|^5}, \qquad h = |\mathbf{r} \times \mathbf{v}|
$$

with $h$, the angular momentum, constant along the path. This is exact, not an approximation of the orbit equation. It is also better behaved: a ray fired straight at the hole has $h = 0$, feels no force at all, and travels in a perfectly straight line into the horizon, which is precisely right.

Both the page and its tests use this one expression. On the graphics card it is four lines of shader; in the test suite the same law is integrated on the processor and checked against results that were known long before anybody could render them.

## Checking it against known answers

A pretty picture is not evidence. The integrator is held against four things general relativity says independently.

| what | expected | 
| --- | --- |
| weak-field deflection | $4M/b$, Einstein's 1915 result |
| next two orders | $+\,15\pi M^2/4b^2 + 128M^3/3b^3$ |
| photon sphere | a circular light orbit at exactly $r = 3M$ |
| capture threshold | $b = 3\sqrt{3}\,M$ |

It passes all four. The deflection agrees with the three-term expansion to seven digits at $b = 1000M$, and the answer does not move when the step size is cut fourfold, so the integration has genuinely converged rather than landing on the right number by luck.

The photon sphere test is the one worth watching. Light really can circle a black hole at $r = 3M$, and the integrator holds a photon there to six decimal places for more than a full orbit. Then it loses it, and that is correct too: the orbit is a ridge, not a valley, so any disturbance grows until the photon spirals away. If it were stable, a black hole would wear a permanent bright halo.

## Why the shadow is bigger than the hole

The dark patch is not the horizon. Turn on **Measure** and you get two circles: the shadow, and the horizon drawn at the angle it would cover if light travelled in straight lines. The shadow is larger by a factor of

$$
\frac{3\sqrt{3}M}{2M} = \frac{\sqrt{27}}{2} \approx 2.6
$$

The reason is that a photon does not have to hit the horizon to be lost. Anything aimed inside an impact parameter of $3\sqrt{3}M$ spirals in, even though a straight line would have missed. The hole captures a disc of sky far wider than itself, and the edge of that disc is what you see.

The edge is sharp because of the unstable orbit. Rays passing just outside the critical parameter loop the hole once, twice, more, before struggling free, so the brightness piles up into an exceedingly thin ring right at the boundary. Rays just inside never come back.

## The disk

The accretion disk is a ring of gas between the innermost stable circular orbit at $r = 6M$ and an outer edge you can move. Below $6M$ there is no stable orbit for matter, so that is where the disk must stop.

Emission follows the standard thin-disk profile, falling roughly as $r^{-3}$ with the inner rim damped, so the disk is brightest just outside its inner edge. Being a blackbody, its temperature goes as the fourth root of the flux, which is why the inside runs white and the outside runs orange.

What reaches the camera is not what was emitted. Two shifts are applied, and between them they account for almost everything odd about the picture.

**Gravitational redshift.** Light climbing out of the well loses energy, by a factor $\sqrt{1 - 2M/r}$. Close in, this is severe.

**Doppler shift.** The gas is not drifting; it is orbiting at a serious fraction of light speed. A static observer at radius $r$ measures the orbital speed as

$$
v = \sqrt{\frac{M}{r - 2M}}
$$

which is half the speed of light at the innermost stable orbit and reaches light speed at the photon sphere. Material sweeping toward you is blueshifted and beamed forward; material sweeping away is reddened and dimmed.

Specific intensity is not invariant, but $I_\nu/\nu^3$ is, so the observed brightness goes as the **fourth power** of the combined shift. A modest velocity therefore produces a violent difference in brightness. Switch **Beaming** off and the disk turns evenly bright, which is what it would look like if the gas sat still. Switch it back on and one side floods while the other sinks. That asymmetry is the single most reliable sign that you are looking at something orbiting a black hole rather than a picture of a ring.

## What you are looking at when you look above the shadow

At a shallow angle the disk appears to pass over the top of the hole. It does not. You are seeing the **far side of the disk**, behind the black hole, with its light bent up and over toward you. The underside arc beneath the shadow is the same trick the other way round. A flat disk, viewed nearly edge-on, appears wrapped around the hole in both directions, because there is no longer any such thing as a straight line between it and your eye.

Look closer to the shadow's edge and there is a second, thinner copy of the whole disk, squeezed against the boundary. That is light that went around once before leaving. In principle there is an infinite stack of these, each thinner and fainter than the last.

## Running it

Every pixel integrates its own path, which is far too much work for a processor and almost nothing for a graphics card, since each pixel is independent. The whole thing is one fragment shader: a full-screen triangle, and a loop of fourth-order Runge–Kutta per fragment with the step scaled to the current radius, fine where the path bends and coarse where it does not.

The page starts at half resolution, measures its own frame rate, and moves the resolution up or down to stay smooth, which is reported at the bottom of the console. On a slow machine the picture softens rather than stalling.

## What this leaves out

The hole does not rotate. A real one almost certainly does, which drags spacetime around with it, makes the shadow asymmetric, and moves the innermost stable orbit; that is the Kerr metric and a considerably harder problem. The disk is infinitely thin, perfectly opaque, and does not emit from within its own volume. The colour ramp stands in for a blackbody spectrum rather than integrating one. Light is not followed after it strikes the disk, so there is no returning radiation. And the star field is invented rather than a real catalogue, though it is lensed exactly as a real one would be.

Reference: J.-P. Luminet, "Image of a spherical black hole with thin accretion disk", *Astronomy and Astrophysics* **75**, 228 (1979), which produced the first such picture by hand; and the Event Horizon Telescope Collaboration's 2019 image of M87\*.
