import { DateSchema, DayResponseSchema } from "@ai-wellness-coach/shared";
import { Hono } from "hono";
import { requireAuth, requireUser } from "../auth/middleware.js";
import type { VerifyToken } from "../auth/verify-token.js";
import type { Db } from "../db/client.js";
import { loadDay } from "../days.js";

export function daysRoutes(deps: { db: Db; verifyToken: VerifyToken }) {
  const { db, verifyToken } = deps;
  const routes = new Hono();

  // One day of the signed-in user's entries and events, with the day's
  // boundaries in their stored timezone. Read-only: changes happen in chat.
  routes.get("/:date", requireAuth(verifyToken), requireUser(db), async (c) => {
    const date = DateSchema.safeParse(c.req.param("date"));
    if (!date.success) {
      return c.json(
        {
          error: "invalid_date",
          message: "date must be a real calendar date like 2026-10-21",
        },
        400,
      );
    }
    const day = await loadDay(db, c.var.user, date.data);
    return c.json(DayResponseSchema.parse(day));
  });

  return routes;
}
