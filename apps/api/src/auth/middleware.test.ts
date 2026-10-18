import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestAuth, TEST_AUDIENCE, TEST_ISSUER } from "../test-support.js";
import { requireAuth } from "./middleware.js";

let auth: Awaited<ReturnType<typeof createTestAuth>>;
let app: Hono;

beforeAll(async () => {
  auth = await createTestAuth();
  app = new Hono().get("/private", requireAuth(auth.verifyToken), (c) =>
    c.json({ subject: c.var.authSubject }),
  );
});

function request(authorization?: string) {
  return app.request("/private", {
    headers:
      authorization === undefined ? {} : { Authorization: authorization },
  });
}

async function expectUnauthorized(res: Response, hadCredentials = true) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect(res.headers.get("www-authenticate")).toBe(
    hadCredentials ? 'Bearer error="invalid_token"' : "Bearer",
  );
}

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("requireAuth", () => {
  it("accepts a valid token and exposes its subject", async () => {
    const res = await request(
      `Bearer ${await auth.issueToken({ subject: "auth0|abc" })}`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subject: "auth0|abc" });
  });

  it("rejects a missing Authorization header", async () => {
    await expectUnauthorized(await request(), false);
  });

  it("rejects other schemes and malformed tokens", async () => {
    const token = await auth.issueToken();
    await expectUnauthorized(await request(`Basic ${token}`));
    await expectUnauthorized(await request("Bearer"));
    await expectUnauthorized(await request("Bearer not-a-jwt"));
    await expectUnauthorized(await request(`Bearer ${token} extra`));
  });

  it("rejects an expired token", async () => {
    const token = await auth.issueToken({ expiresAt: nowSeconds() - 60 });
    await expectUnauthorized(await request(`Bearer ${token}`));
  });

  it("rejects a token for another audience", async () => {
    const token = await auth.issueToken({ audience: "https://some-other-api" });
    await expectUnauthorized(await request(`Bearer ${token}`));
  });

  it("rejects a token from another issuer", async () => {
    const token = await auth.issueToken({
      issuer: "https://evil.example.com/",
    });
    await expectUnauthorized(await request(`Bearer ${token}`));
  });

  it("rejects a token signed with a different key", async () => {
    const other = await generateKeyPair("RS256");
    const token = await auth.issueToken({ signingKey: other.privateKey });
    await expectUnauthorized(await request(`Bearer ${token}`));
  });

  it("rejects HS256 tokens, even signed with the public key as the secret", async () => {
    const keys = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = await exportJWK(keys.publicKey);
    const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const token = await new SignJWT({
      sub: "auth0|abc",
      exp: nowSeconds() + 3600,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .sign(secret);
    await expectUnauthorized(await request(`Bearer ${token}`));
  });

  it('rejects unsigned tokens (alg "none")', async () => {
    const header = base64url({ alg: "none", typ: "JWT" });
    const payload = base64url({
      sub: "auth0|abc",
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      exp: nowSeconds() + 3600,
    });
    await expectUnauthorized(await request(`Bearer ${header}.${payload}.`));
  });

  it("rejects a token without an expiry", async () => {
    const token = await auth.issueToken({ expiresAt: null });
    await expectUnauthorized(await request(`Bearer ${token}`));
  });

  it("rejects a token without a subject", async () => {
    const token = await auth.issueToken({ subject: null });
    await expectUnauthorized(await request(`Bearer ${token}`));
  });
});
