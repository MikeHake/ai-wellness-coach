import type { HealthResponse } from "@ai-wellness-coach/shared";
import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createOriginMatcher } from "./cors.js";
import type { VerifyToken } from "./auth/verify-token.js";
import type { Background } from "./background.js";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import { chatRoutes } from "./routes/chat.js";
import { meRoutes } from "./routes/me.js";
import { proposalRoutes } from "./routes/proposals.js";

export interface AppDeps {
  env: Pick<Env, "CORS_ORIGIN"> &
    Partial<Pick<Env, "CORS_PREVIEW_HOST_SUFFIX">>;
  db: Db;
  verifyToken: VerifyToken;
  /** The language model for chat and parsing (a mock in tests). */
  model: LanguageModel;
  /** Work to finish after the response is returned, such as saving a reply. */
  background: Background;
  /** The current time; a parameter so tests can fix it. */
  now?: () => Date;
}

export function createApp({
  env,
  db,
  verifyToken,
  model,
  background,
  now,
}: AppDeps) {
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
  app.route("/chat", chatRoutes({ db, verifyToken, model, background, now }));
  app.route("/proposals", proposalRoutes({ db, verifyToken, now }));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
