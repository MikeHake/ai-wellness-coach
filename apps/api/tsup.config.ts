import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // shared is consumed as TypeScript source, so it must be bundled in.
  noExternal: ["@ai-wellness-coach/shared"],
});
