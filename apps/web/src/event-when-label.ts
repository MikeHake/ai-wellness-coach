import { addDays } from "@ai-wellness-coach/shared";

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Mon, Oct 19" for a date like "2026-10-19". */
export function shortDateLabel(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "6:00 AM" for a time like "06:00". */
export function timeLabel(time: string): string {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/**
 * "Today", "Yesterday", or "Mon, Oct 19" for a date, given today's date. The
 * caller says what today is, so it can be the person's day rather than the
 * browser's.
 */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return shortDateLabel(date);
}

/**
 * When an event happened, for a confirmation card: "Today", "Yesterday", or
 * "Mon, Oct 19", with the time when one was given ("Yesterday, 6:00 AM").
 * `occurredOn` and `localTime` are already in the person's timezone, so they
 * are formatted as they are; "today" is the browser's own date.
 */
export function eventWhenLabel(
  occurredOn: string,
  localTime: string | undefined,
  now: Date,
): string {
  const label = dayLabel(occurredOn, isoDate(now));
  return localTime === undefined ? label : `${label}, ${timeLabel(localTime)}`;
}
