import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file starts its own in-memory Postgres (PGlite) and runs every
    // migration in beforeAll. With all files starting at once, that can pass
    // the default 10 seconds on a busy machine, so allow more.
    hookTimeout: 30_000,
  },
});
