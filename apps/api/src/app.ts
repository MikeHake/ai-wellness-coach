import type { HealthResponse } from "@ai-wellness-coach/shared";
import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createOriginMatcher } from "./cors.js";
import type { VerifyToken } from "./auth/verify-token.js";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { meRoutes } from "./routes/me.js";

export interface AppDeps {
  env: Pick<Env, "CORS_ORIGIN"> &
    Partial<Pick<Env, "CORS_PREVIEW_HOST_SUFFIX">>;
  db: Db;
  verifyToken: VerifyToken;
  /** The language model for chat and parsing (a mock in tests). */
  model: LanguageModel;
}

// `deps.model` is read by the chat and logging routes that come next.
export function createApp({ env, db, verifyToken }: AppDeps) {
  const app = new Hono();

  const matchOrigin = createOriginMatcher({
    origin: env.CORS_ORIGIN,
    previewHostSuffix: env.CORS_PREVIEW_HOST_SUFFIX,
  });
  app.use("*", cors({ origin: (origin) => matchOrigin(origin) }));

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
