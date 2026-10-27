import { describe, expect, it } from "vitest";
import {
  dayLabel,
  eventWhenLabel,
  shortDateLabel,
  timeLabel,
} from "./event-when-label.js";

// Tuesday, October 21, 2026, mid-morning in the browser's own zone.
const now = new Date(2026, 9, 21, 10, 0);

describe("eventWhenLabel", () => {
  it("says Today and Yesterday for the last two days", () => {
    expect(eventWhenLabel("2026-10-21", undefined, now)).toBe("Today");
    expect(eventWhenLabel("2026-10-20", undefined, now)).toBe("Yesterday");
  });

  it("gives a short date for anything older", () => {
    expect(eventWhenLabel("2026-10-19", undefined, now)).toBe("Mon, Oct 19");
    expect(eventWhenLabel("2025-12-31", undefined, now)).toBe("Wed, Dec 31");
  });

  it("adds the time when one was given", () => {
    expect(eventWhenLabel("2026-10-20", "06:00", now)).toBe(
      "Yesterday, 6:00 AM",
    );
    expect(eventWhenLabel("2026-10-19", "18:45", now)).toBe(
      "Mon, Oct 19, 6:45 PM",
    );
  });

  it("counts Yesterday across a month boundary", () => {
    expect(eventWhenLabel("2026-09-30", undefined, new Date(2026, 9, 1))).toBe(
      "Yesterday",
    );
  });
});

describe("dayLabel", () => {
  it("compares against the day it is given, not the browser's", () => {
    expect(dayLabel("2026-10-21", "2026-10-21")).toBe("Today");
    expect(dayLabel("2026-10-20", "2026-10-21")).toBe("Yesterday");
    expect(dayLabel("2026-10-19", "2026-10-21")).toBe("Mon, Oct 19");
    expect(dayLabel("2026-10-22", "2026-10-21")).toBe("Thu, Oct 22");
  });
});

describe("shortDateLabel and timeLabel", () => {
  it("format a date and a time", () => {
    expect(shortDateLabel("2026-10-19")).toBe("Mon, Oct 19");
    expect(timeLabel("00:05")).toBe("12:05 AM");
    expect(timeLabel("13:30")).toBe("1:30 PM");
  });
});
