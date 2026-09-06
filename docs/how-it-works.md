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

## The dotted line

While you drag, the dotted line shows where the planet would go. It runs the same integrator ahead for fifteen seconds on a test particle, with every existing body held still. That is exact when only the star is there and a good guess otherwise, since the planets are light and slow compared to the throw. The line stops if the path would hit a body.

## Collisions

Two bodies that overlap merge into one. The new body gets the combined mass and the mass-weighted average velocity, so momentum is conserved. Energy is not, just as in a real inelastic collision, and the readout shows the drop. Anything that flies well off the canvas is removed.

## Things to try

- Throw a planet sideways, at right angles to the star. A drag of about a third of the way to the star gives a nearly circular orbit; shorter dives in and swings out into an ellipse; longer escapes.
- Turn the mass up and throw a heavy planet. Watch the star move.
- Put two planets on nearby orbits and wait. They pull each other around and neither orbit stays put.
- Throw a planet straight at the star. The dotted line ends where it would hit.

Reference: Feynman, *Lectures on Physics* Vol. I, chapter 9, which works out planetary motion numerically by hand, and the [Wikipedia article on Verlet integration](https://en.wikipedia.org/wiki/Verlet_integration).
