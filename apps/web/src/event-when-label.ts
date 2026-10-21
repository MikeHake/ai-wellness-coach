function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const [year = 0, month = 1, day = 1] = occurredOn.split("-").map(Number);

  let label: string;
  if (occurredOn === isoDate(now)) {
    label = "Today";
  } else if (occurredOn === isoDate(yesterday)) {
    label = "Yesterday";
  } else {
    label = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  if (localTime === undefined) return label;

  const [hour = 0, minute = 0] = localTime.split(":").map(Number);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
  return `${label}, ${time}`;
}
