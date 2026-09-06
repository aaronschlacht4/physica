import { defineConfig } from 'vite';

// Relative base so the build works at a domain root and under a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
