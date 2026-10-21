import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { MockLanguageModelV4 } from "ai/test";
import { createMockModel, type MockModel } from "./ai/mock-model.js";
import { createApp } from "./app.js";
import { createBackgroundTracker } from "./background.js";
import { createTokenVerifier } from "./auth/verify-token.js";
import { createTestDb } from "./db/test-db.js";

export const TEST_ISSUER = "https://test-tenant.example.com/";
export const TEST_AUDIENCE = "https://api.test";
const KEY_ID = "test-key";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

export interface TokenOptions {
  /** null leaves the claim out. */
  subject?: string | null;
  audience?: string;
  issuer?: string;
  /** Seconds since the epoch; null leaves the claim out. */
  expiresAt?: number | null;
  signingKey?: KeyPair["privateKey"];
}

/** Local signing keys and a verifier that trusts only them. No network. */
export async function createTestAuth() {
  const keys = await generateKeyPair("RS256");
  const publicJwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: KEY_ID,
    alg: "RS256",
  };
  const verifyToken = createTokenVerifier({
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
  });

  async function issueToken(options: TokenOptions = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      iss: options.issuer ?? TEST_ISSUER,
      aud: options.audience ?? TEST_AUDIENCE,
      iat: now,
    };
    if (options.subject !== null)
      payload.sub = options.subject ?? "auth0|user-a";
    if (options.expiresAt !== null)
      payload.exp = options.expiresAt ?? now + 3600;
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .sign(options.signingKey ?? keys.privateKey);
  }

  return { verifyToken, issueToken };
}

/**
 * The real app on an in-memory database with local test keys and a mock
 * language model, so no test reaches the network.
 * - `useModel` swaps the scripted model for the next requests.
 * - `settle` waits for background work, such as saving a streamed reply.
 */
export async function createTestApp(options: { model?: MockModel } = {}) {
  const testDb = await createTestDb();
  const auth = await createTestAuth();
  let current = options.model ?? createMockModel();
  // The app keeps one model; it forwards to whichever mock is current.
  const model = new MockLanguageModelV4({
    doGenerate: (call) => current.doGenerate(call),
    doStream: (call) => current.doStream(call),
  });
  const tracker = createBackgroundTracker();
  const app = createApp({
    env: { CORS_ORIGIN: "http://localhost:5173" },
    db: testDb.db,
    verifyToken: auth.verifyToken,
    model,
    background: tracker.background,
  });
  return {
    app,
    db: testDb.db,
    /** The current mock, for checking what the model was sent. */
    get model() {
      return current;
    },
    useModel(next: MockModel) {
      current = next;
    },
    settle: tracker.settled,
    close: testDb.close,
    ...auth,
  };
}
