import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import type { VerifyToken } from "./verify-token.js";

export type User = typeof users.$inferSelect;
export interface AuthVariables {
  authSubject: string;
}
export type UserVariables = AuthVariables & { user: User };

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

function unauthorized(c: Context, hadCredentials: boolean) {
  // Same body for every failure, so callers learn nothing about why.
  c.header(
    "WWW-Authenticate",
    hadCredentials ? 'Bearer error="invalid_token"' : "Bearer",
  );
  return c.json({ error: "unauthorized" }, 401);
}

/** Rejects requests without a valid access token and records the token's subject. */
export function requireAuth(verifyToken: VerifyToken) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header("Authorization");
    if (header === undefined) return unauthorized(c, false);

    const token = BEARER.exec(header)?.[1];
    if (token === undefined) return unauthorized(c, true);

    let subject: string;
    try {
      ({ subject } = await verifyToken(token));
    } catch {
      return unauthorized(c, true);
    }

    c.set("authSubject", subject);
    await next();
  });
}

/**
 * Loads the signed-in user's row. Must run after requireAuth. Handlers read the
 * user id only from `c.var.user`, never from the request.
 */
export function requireUser(db: Db) {
  return createMiddleware<{ Variables: UserVariables }>(async (c, next) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.authSubject, c.var.authSubject))
      .limit(1);
    if (!user) return c.json({ error: "profile_not_found" }, 403);

    c.set("user", user);
    await next();
  });
}
