import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createModel } from "./ai/model.js";
import { createAuth0Verifier } from "./auth/verify-token.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const verifyToken = createAuth0Verifier(env.AUTH0_DOMAIN, env.AUTH0_AUDIENCE);
const model = createModel(env.ANTHROPIC_API_KEY);
// Node keeps running after a response, so background work just logs failures.
const app = createApp({
  env,
  db,
  verifyToken,
  model,
  background: (work) => {
    work.catch((error: unknown) => {
      console.error("Background work failed", error);
    });
  },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${String(info.port)}`);
  console.log(`Allowing requests from ${env.CORS_ORIGIN}`);
  console.log(
    `Accepting tokens from ${env.AUTH0_DOMAIN} for ${env.AUTH0_AUDIENCE}`,
  );
});

function shutdown() {
  server.close();
  void close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
