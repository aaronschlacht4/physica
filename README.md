# Physica

A gravity sandbox. Drag anywhere on the canvas to throw a planet at the star; a dotted line shows where it will go. Planets pull on each other and on the star, merge when they collide, and leave trails so you can see the orbits.

![Planets orbiting a star in Physica](docs/screenshot.png)

The page ends with a short write-up of the physics: Newton's gravity, velocity Verlet integration and why it keeps orbits stable, softening, how the preview line is computed, and collisions. The same notes are in [docs/how-it-works.md](docs/how-it-works.md).

## Run it locally

```sh
npm install
npm run dev
```

`npm test` runs a few checks on the physics: a circular orbit stays circular for a minute of simulated time, energy stays within a tiny band, and momentum is conserved through steps and merges.

## Built with

TypeScript, Vite and the Canvas 2D API. No physics library. KaTeX and marked render the notes.
