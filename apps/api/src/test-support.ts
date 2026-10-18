import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { createApp } from "./app.js";
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

/** The real app on an in-memory database with local test keys. */
export async function createTestApp() {
  const testDb = await createTestDb();
  const auth = await createTestAuth();
  const app = createApp({
    env: { CORS_ORIGIN: "http://localhost:5173" },
    db: testDb.db,
    verifyToken: auth.verifyToken,
  });
  return { app, db: testDb.db, close: testDb.close, ...auth };
}
