import {
  CreateProfileRequestSchema,
  type Profile,
  ProfileSchema,
} from "@ai-wellness-coach/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth, requireUser, type User } from "../auth/middleware.js";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

// Only these fields leave the API; auth_subject never does.
function toProfile(user: User): Profile {
  return ProfileSchema.parse({
    id: user.id,
    timezone: user.timezone,
    firstName: user.firstName,
    createdAt: user.createdAt.toISOString(),
  });
}

export function meRoutes(deps: { db: Db; verifyToken: VerifyToken }) {
  const { db, verifyToken } = deps;
  const routes = new Hono();

  // Creates the profile on first sign-in. Later calls return it unchanged,
  // so the stored time zone is never overwritten by a travelling browser.
  routes.post("/", requireAuth(verifyToken), async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = CreateProfileRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: "timezone must be an IANA time zone name",
        },
        400,
      );
    }

    const subject = c.var.authSubject;
    const [created] = await db
      .insert(users)
      .values({ authSubject: subject, timezone: parsed.data.timezone })
      .onConflictDoNothing({ target: users.authSubject })
      .returning();
    if (created) return c.json(toProfile(created), 201);

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.authSubject, subject))
      .limit(1);
    if (!existing)
      throw new Error("Profile vanished between insert and select");
    return c.json(toProfile(existing), 200);
  });

  routes.get("/", requireAuth(verifyToken), requireUser(db), (c) =>
    c.json(toProfile(c.var.user)),
  );

  return routes;
}
