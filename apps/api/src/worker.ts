import { createApp } from "./app.js";
import { createModel } from "./ai/model.js";
import { createAuth0Verifier } from "./auth/verify-token.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";

// The parts of Cloudflare's runtime we use. Kept minimal on purpose so the
// Cloudflare types do not clash with the Node types the rest of the API uses.
interface Bindings {
  /** Hyperdrive pools connections to Neon and hands us a connection string. */
  HYPERDRIVE: { connectionString: string };
  [name: string]: unknown;
}
interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Created once per isolate and reused across requests, so the verifier keeps
// its cached Auth0 signing keys instead of refetching them every time.
let shared: ReturnType<typeof initialize> | undefined;

function initialize(bindings: Bindings) {
  const vars = Object.fromEntries(
    Object.entries(bindings).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const env = loadEnv({
    ...vars,
    DATABASE_URL: bindings.HYPERDRIVE.connectionString,
  });
  return {
    env,
    verifyToken: createAuth0Verifier(env.AUTH0_DOMAIN, env.AUTH0_AUDIENCE),
    model: createModel(env.ANTHROPIC_API_KEY),
  };
}

export default {
  async fetch(
    request: Request,
    bindings: Bindings,
    ctx: WorkerContext,
  ): Promise<Response> {
    shared ??= initialize(bindings);
    const { env, verifyToken, model } = shared;

    // A database client belongs to one request in Workers. Hyperdrive does the
    // real pooling, so opening one per request is cheap.
    const { db, close } = createDb(env.DATABASE_URL, { fetch_types: false });
    try {
      return await createApp({ env, db, verifyToken, model }).fetch(request);
    } finally {
      ctx.waitUntil(close());
    }
  },
};
