import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: {
      VITE_API_URL: "http://localhost:3000",
      VITE_AUTH0_DOMAIN: "test-tenant.example.com",
      VITE_AUTH0_CLIENT_ID: "test-client-id",
      VITE_AUTH0_AUDIENCE: "https://api.test",
    },
    setupFiles: ["./src/test-setup.ts"],
  },
});
