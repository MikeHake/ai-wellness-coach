import {
  dayBounds,
  type DayEntry,
  type DayEvent,
  type DayResponse,
  localDateTime,
} from "@ai-wellness-coach/shared";
import { and, asc, eq, gte, inArray, lt, notExists, sql } from "drizzle-orm";
import type { User } from "./auth/middleware.js";
import type { Db } from "./db/client.js";
import { entry, event, eventType } from "./db/schema.js";

/**
 * Everything the person told the coach about one day, for the signed-in user
 * only. An entry follows its events: it appears on each day one of its events
 * happened (showing only that day's events), so "yesterday I hiked" belongs to
 * yesterday. An entry with no events at all stays on the day it was typed.
 * Entries run in the order they were told; events within one run by time,
 * with untimed events last.
 */
export async function loadDay(
  db: Db,
  user: Pick<User, "id" | "timezone">,
  date: string,
): Promise<DayResponse> {
  const timeZone = user.timezone;

  const events = await db
    .select({
      id: event.id,
      entryId: event.entryId,
      type: eventType.name,
      summary: event.summary,
      feelScore: event.feelScore,
      feelWords: event.feelWords,
      tags: event.tags,
      occurredAt: event.occurredAt,
    })
    .from(event)
    .innerJoin(eventType, eq(eventType.id, event.eventTypeId))
    .where(and(eq(event.userId, user.id), eq(event.occurredOn, date)))
    .orderBy(
      sql`${event.occurredAt} asc nulls last`,
      asc(event.createdAt),
      asc(event.id),
    );

  const { start, end } = dayBounds(date, timeZone);
  const journalEntries = await db
    .select({ id: entry.id })
    .from(entry)
    .where(
      and(
        eq(entry.userId, user.id),
        gte(entry.createdAt, start),
        lt(entry.createdAt, end),
        notExists(
          db
            .select({ one: sql`1` })
            .from(event)
            .where(
              and(eq(event.entryId, entry.id), eq(event.userId, entry.userId)),
            ),
        ),
      ),
    );

  const entryIds = [
    ...new Set([
      ...events.map((e) => e.entryId),
      ...journalEntries.map((e) => e.id),
    ]),
  ];
  if (entryIds.length === 0) return { date, entries: [] };

  const entries = await db
    .select({
      id: entry.id,
      text: entry.rawText,
      createdAt: entry.createdAt,
    })
    .from(entry)
    .where(and(eq(entry.userId, user.id), inArray(entry.id, entryIds)))
    .orderBy(asc(entry.createdAt), asc(entry.id));

  const eventsByEntry = new Map<string, DayEvent[]>();
  for (const row of events) {
    const dayEvent: DayEvent = {
      id: row.id,
      type: row.type,
      summary: row.summary,
      ...(row.feelScore === null ? {} : { feelScore: row.feelScore }),
      feelWords: row.feelWords,
      tags: row.tags,
      ...(row.occurredAt === null
        ? {}
        : { localTime: localDateTime(row.occurredAt, timeZone).time }),
    };
    eventsByEntry.set(row.entryId, [
      ...(eventsByEntry.get(row.entryId) ?? []),
      dayEvent,
    ]);
  }

  return {
    date,
    entries: entries.map((row): DayEntry => {
      const created = localDateTime(row.createdAt, timeZone);
      return {
        id: row.id,
        text: row.text,
        createdOn: created.date,
        createdTime: created.time,
        events: eventsByEntry.get(row.id) ?? [],
      };
    }),
  };
}
