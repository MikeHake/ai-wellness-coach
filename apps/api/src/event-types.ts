import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { eventType } from "./db/schema.js";

/** Built-in types plus the user's own private types. */
function visibleTo(userId: string) {
  return or(isNull(eventType.userId), eq(eventType.userId, userId));
}

export interface VisibleEventType {
  name: string;
  description: string;
}

/** The types the user can log against: built-ins first, then their own, by name. */
export async function listVisibleEventTypes(
  db: Db,
  userId: string,
): Promise<VisibleEventType[]> {
  return db
    .select({ name: eventType.name, description: eventType.description })
    .from(eventType)
    .where(visibleTo(userId))
    .orderBy(sql`${eventType.userId} is not null`, asc(eventType.name));
}

/**
 * The ids of the named types the user can see, keyed by name. Every path that
 * sets `event_type_id` goes through here: a name missing from the result is
 * unknown or belongs to someone else, and callers treat both the same, so
 * nobody learns that another user's private type exists.
 */
export async function visibleEventTypeIds(
  db: Db,
  userId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const rows = await db
    .select({ id: eventType.id, name: eventType.name })
    .from(eventType)
    .where(and(visibleTo(userId), inArray(eventType.name, [...names])));
  return new Map(rows.map((row) => [row.name, row.id]));
}
