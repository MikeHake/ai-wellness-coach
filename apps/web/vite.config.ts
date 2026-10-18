import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: { VITE_API_URL: "http://localhost:3000" },
    setupFiles: ["./src/test-setup.ts"],
  },
});
