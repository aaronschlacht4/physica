# How it works

Everything on the canvas is a body with a mass, a position and a velocity. The star sits in the middle with a large mass; each planet you throw is a smaller body. The only rule is Newton's law of gravitation, applied between every pair of bodies, 240 times per second.

## Gravity

The acceleration of body $i$ due to body $j$ is

$$
\mathbf{a}_i = G\,m_j\,\frac{\mathbf{r}_j - \mathbf{r}_i}{|\mathbf{r}_j - \mathbf{r}_i|^3}
$$

and each body feels the sum of these over all the others. The units are pixels and seconds with $G = 1$, and the star's mass is chosen so that a planet a couple of hundred pixels out takes a few seconds to go round. The star is not nailed down: it feels the planets too, so a heavy planet makes it wobble, and the whole system slowly drifts if you keep throwing things in one direction.

## Stepping time

The positions and velocities are advanced with velocity Verlet:

$$
\begin{aligned}
\mathbf{v}_{n+\frac12} &= \mathbf{v}_n + \tfrac{h}{2}\,\mathbf{a}(\mathbf{r}_n) \\
\mathbf{r}_{n+1} &= \mathbf{r}_n + h\,\mathbf{v}_{n+\frac12} \\
\mathbf{v}_{n+1} &= \mathbf{v}_{n+\frac12} + \tfrac{h}{2}\,\mathbf{a}(\mathbf{r}_{n+1})
\end{aligned}
$$

with a fixed step of $h = 1/240$ s. This is only slightly more work than the obvious method (move, then update the velocity with the old acceleration), but it makes a big difference. The obvious method adds a little energy every step, so orbits spiral outward. Verlet is symplectic: its energy error stays inside a small band forever instead of growing. That is why an orbit here stays the same size for minutes.

The number under the canvas is the check on this. It compares the total energy, kinetic plus potential, with what it was the last time you added or removed a body. With Verlet it wobbles in the fourth decimal place and comes back.

## Softening

Two point masses that pass very close feel an enormous force, and no fixed step can follow it. To keep that from throwing planets across the screen, the distance in the force law is replaced by $\sqrt{r^2 + \varepsilon^2}$ with $\varepsilon$ set to 6 pixels. Far apart, nothing changes; closer than a few pixels, the force stops growing. The energy readout uses the same softened potential, so it stays consistent.

## The curve you see while aiming

The curve drawn while you drag is not a guess, and it is not the simulation run ahead in fast forward. It is the orbit itself, solved in closed form.

Around a single mass, a body's path is always a conic section with that mass at one focus: a circle, an ellipse, a parabola or a hyperbola, and nothing else. So the entire orbit follows from where the planet is and how fast it is going at the moment of release. From the position $\mathbf{r}$ and velocity $\mathbf{v}$ relative to the star, with $\mu = G(M + m)$, the energy per unit mass is

$$
\varepsilon = \frac{v^2}{2} - \frac{\mu}{r}
$$

Its sign settles the question immediately. Negative and the orbit closes; zero or positive and the planet never comes back. When it does close, the size of the ellipse is

$$
a = -\frac{\mu}{2\varepsilon}
$$

which depends only on the speed and the distance, not on the direction. The shape and orientation come from the eccentricity vector, which points from the star toward the closest point of the orbit and has length equal to the eccentricity:

$$
\mathbf{e} = \frac{(v^2 - \mu/r)\,\mathbf{r} - (\mathbf{r}\cdot\mathbf{v})\,\mathbf{v}}{\mu}
$$

With $a$, $e$ and that direction, the ellipse is fully determined, so the whole thing is drawn in one stroke. The period follows from Kepler's third law,

$$
T = 2\pi\sqrt{\frac{a^3}{\mu}}
$$

and that is the number shown next to the planet as you aim. Throw it and count: the planet comes back when the label said it would.

This is exact when the star is the only thing pulling, which is the usual case, since a thrown planet is at most a fifth of the star's mass and the others are far lighter still. With several planets in play the drawn ellipse is a very good approximation rather than the truth, and you can watch the real path drift off it over a few orbits. When the throw escapes, there is no closed curve to draw, so the path is integrated forward instead and stops where it would hit something.

## Collisions

Two bodies that overlap merge into one. The new body gets the combined mass and the mass-weighted average velocity, so momentum is conserved. Energy is not, just as in a real inelastic collision, and the readout shows the drop. Anything that flies well off the canvas is removed.

## Things to try

- Aim sideways, at right angles to the star, and lengthen the drag slowly. The ellipse swells and its far end swings around until, at $\sqrt{2}$ times circular speed, it stops closing altogether.
- Watch the label rather than the curve. Find the throw that gives a five second orbit, let go, and count it out.
- Turn the mass up and throw a heavy planet. The star is not nailed down, so it starts to wobble, and with several planets in play the drawn ellipse stops matching what actually happens.
- Aim straight at the star. There is no orbit to draw, so you get the path instead, ending where it lands.

Reference: Feynman, *Lectures on Physics* Vol. I, chapter 9, which works out planetary motion numerically by hand, and the [Wikipedia article on Verlet integration](https://en.wikipedia.org/wiki/Verlet_integration).
