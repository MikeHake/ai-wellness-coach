import type { HealthResponse } from "@ai-wellness-coach/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { VerifyToken } from "./auth/verify-token.js";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { meRoutes } from "./routes/me.js";

export interface AppDeps {
  env: Pick<Env, "CORS_ORIGIN">;
  db: Db;
  verifyToken: VerifyToken;
}

export function createApp({ env, db, verifyToken }: AppDeps) {
  const app = new Hono();

  app.use("*", cors({ origin: env.CORS_ORIGIN }));

  app.get("/health", (c) => {
    const body = { status: "ok" } satisfies HealthResponse;
    return c.json(body);
  });

  app.route("/me", meRoutes({ db, verifyToken }));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
