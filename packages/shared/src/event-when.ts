import { z } from "zod";
import { isValidTimeZone } from "./profile.js";

/** Events can be logged for today and up to this many days back. */
export const EVENT_MAX_DAYS_BACK = 365;

/** A time slightly ahead of now is allowed, to absorb rounding like "just now". */
export const EVENT_FUTURE_ALLOWANCE_MINUTES = 15;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function splitDate(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year ?? 0, month ?? 0, day ?? 0];
}

function isRealDate(value: string): boolean {
  const [year, month, day] = splitDate(value);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * When an event happened, as the model reports it. The model never does date
 * math or timezone conversion: `resolveEventWhen` turns this into dates.
 * The descriptions below become part of the model's tool definition.
 */
export const EventWhenSchema = z
  .object({
    dayOffset: z
      .number()
      .int()
      .min(-EVENT_MAX_DAYS_BACK)
      .max(0)
      .optional()
      .describe(
        "Days before today: 0 is today, -1 is yesterday. Sleep uses the day the person woke up, so 'last night' is 0. Give this or date, not both.",
      ),
    date: z
      .string()
      .regex(DATE_PATTERN, "date must look like YYYY-MM-DD")
      .refine(isRealDate, "date must be a real calendar date")
      .optional()
      .describe(
        "The calendar date (YYYY-MM-DD) when the person gave one. Give this or dayOffset, not both.",
      ),
    localTime: z
      .string()
      .regex(TIME_PATTERN, "localTime must look like HH:MM in 24-hour time")
      .optional()
      .describe(
        "The local time (HH:MM, 24-hour) only when the person said or clearly implied one. For a sleep event this is the time they woke up, never bedtime: put bedtime in details instead.",
      ),
  })
  .refine(
    (when) => (when.dayOffset === undefined) !== (when.date === undefined),
    { message: "Give exactly one of dayOffset or date." },
  );
export type EventWhen = z.infer<typeof EventWhenSchema>;

export type ResolvedEventWhen =
  | { ok: true; occurredOn: string; occurredAt: Date | null }
  | { ok: false; reason: "future" | "too_old"; message: string };

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function formatDate(year: number, month: number, day: number): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The zone's offset from UTC at an instant, in milliseconds (east is positive). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = splitDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * The instant for a wall-clock date and time in a zone, following the same
 * "compatible" rule as Temporal:
 * - A time that happens twice (clocks go back) uses the earlier instant.
 * - A time that doesn't exist (clocks go forward) moves ahead by the gap, so
 *   02:30 on a spring-forward morning becomes 03:30.
 */
function zonedTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = splitDate(date);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // The zone's offset a day before and after covers either side of a change.
  const before = offsetMs(new Date(wallAsUtc - DAY_MS), timeZone);
  const after = offsetMs(new Date(wallAsUtc + DAY_MS), timeZone);

  const valid = [before, after]
    .map((offset) => ({ offset, instant: wallAsUtc - offset }))
    .filter(
      ({ offset, instant }) => offsetMs(new Date(instant), timeZone) === offset,
    )
    .map(({ instant }) => instant);

  if (valid.length > 0) return new Date(Math.min(...valid));
  // In the gap: no offset fits, so apply the earlier offset to move forward.
  return new Date(wallAsUtc - before);
}

function localToday(timeZone: string, now: Date): string {
  const p = partsInZone(now, timeZone);
  return formatDate(p.year, p.month, p.day);
}

/**
 * The day (YYYY-MM-DD) a `when` falls on in the person's timezone, without
 * checking it. A confirmation card uses this to show a draft's date; saving
 * goes through `resolveEventWhen`, which also rejects future and old dates.
 */
export function eventDate(
  when: EventWhen,
  timeZone: string,
  now: Date,
): string {
  if (when.date !== undefined) return when.date;
  if (when.dayOffset !== undefined) {
    return addDays(localToday(timeZone, now), when.dayOffset);
  }
  throw new Error("EventWhen needs exactly one of dayOffset or date");
}

/**
 * Turns the model's `when` into the event's `occurred_on` (a date in the
 * person's timezone) and `occurred_at` (only when a time was given).
 *
 * Events must already have happened: a day after today, a time more than
 * EVENT_FUTURE_ALLOWANCE_MINUTES ahead of `now`, or a day more than
 * EVENT_MAX_DAYS_BACK ago comes back as `{ ok: false }` with a message
 * written for the model, so it can be returned as a fixable tool error.
 * An invalid timezone throws, because stored timezones are validated.
 */
export function resolveEventWhen(
  when: EventWhen,
  timeZone: string,
  now: Date,
): ResolvedEventWhen {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid time zone: ${timeZone}`);
  }

  const today = localToday(timeZone, now);
  const occurredOn = eventDate(when, timeZone, now);

  if (occurredOn > today) {
    return {
      ok: false,
      reason: "future",
      message:
        "That date is in the future. Only log things that have already happened, and do not propose an event for it.",
    };
  }
  if (occurredOn < addDays(today, -EVENT_MAX_DAYS_BACK)) {
    return {
      ok: false,
      reason: "too_old",
      message: `That date is more than ${String(EVENT_MAX_DAYS_BACK)} days ago, which is too far back to log. Check the date with the person.`,
    };
  }

  if (when.localTime === undefined) {
    return { ok: true, occurredOn, occurredAt: null };
  }

  const occurredAt = zonedTimeToInstant(occurredOn, when.localTime, timeZone);
  const latest = now.getTime() + EVENT_FUTURE_ALLOWANCE_MINUTES * 60 * 1000;
  if (occurredAt.getTime() > latest) {
    return {
      ok: false,
      reason: "future",
      message:
        "That time has not happened yet. Only log things that have already happened, and do not propose an event for it.",
    };
  }
  return { ok: true, occurredOn, occurredAt };
}
