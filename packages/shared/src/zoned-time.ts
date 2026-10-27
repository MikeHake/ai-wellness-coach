import { z } from "zod";

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function splitDate(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year ?? 0, month ?? 0, day ?? 0];
}

export function isRealDate(value: string): boolean {
  const [year, month, day] = splitDate(value);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function partsInZone(instant: Date, timeZone: string): ZonedParts {
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

export function formatDate(year: number, month: number, day: number): string {
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

export function addDays(date: string, days: number): string {
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
export function zonedTimeToInstant(
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

export function localToday(timeZone: string, now: Date): string {
  const p = partsInZone(now, timeZone);
  return formatDate(p.year, p.month, p.day);
}

/** A real calendar date as "YYYY-MM-DD". */
export const DateSchema = z
  .string()
  .regex(DATE_PATTERN, "date must look like YYYY-MM-DD")
  .refine(isRealDate, "date must be a real calendar date");

/**
 * The instants a local day starts and ends: `start` is inclusive and `end` is
 * the start of the next day, so a day is `start <= t < end`. Days with a clock
 * change are 23 or 25 hours long.
 */
export function dayBounds(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: zonedTimeToInstant(date, "00:00", timeZone),
    end: zonedTimeToInstant(addDays(date, 1), "00:00", timeZone),
  };
}

/** The local date ("YYYY-MM-DD") and time ("HH:MM") of an instant in a zone. */
export function localDateTime(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const p = partsInZone(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: formatDate(p.year, p.month, p.day),
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}
