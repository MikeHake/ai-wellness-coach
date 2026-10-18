import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Only needed by `migrate` and `studio`; `generate` never connects.
    url: process.env.DATABASE_URL ?? "",
  },
});
