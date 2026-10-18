import type { HealthResponse } from "@ai-wellness-coach/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env.js";

export function createApp(env: Pick<Env, "CORS_ORIGIN">) {
  const app = new Hono();

  app.use("*", cors({ origin: env.CORS_ORIGIN }));

  app.get("/health", (c) => {
    const body = { status: "ok" } satisfies HealthResponse;
    return c.json(body);
  });

  return app;
}
