import { describe, expect, it } from "vitest";
import {
  addDays,
  dayBounds,
  DateSchema,
  localDateTime,
  localToday,
} from "./zoned-time.js";

const DENVER = "America/Denver";

describe("localToday", () => {
  it("uses the zone's date, not UTC's", () => {
    // 03:00 UTC on Oct 22 is still the evening of Oct 21 in Denver.
    const now = new Date("2026-10-22T03:00:00Z");
    expect(localToday(DENVER, now)).toBe("2026-10-21");
    expect(localToday("UTC", now)).toBe("2026-10-22");
  });
});

describe("addDays", () => {
  it("moves across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("dayBounds", () => {
  it("starts and ends at local midnight", () => {
    const { start, end } = dayBounds("2026-10-21", DENVER);
    expect(start.toISOString()).toBe("2026-10-21T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-22T06:00:00.000Z");
  });

  it("is 23 hours long when clocks go forward", () => {
    const { start, end } = dayBounds("2026-03-08", DENVER);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it("is 25 hours long when clocks go back", () => {
    const { start, end } = dayBounds("2026-11-01", DENVER);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });
});

describe("localDateTime", () => {
  it("gives the local date and time of an instant", () => {
    expect(localDateTime(new Date("2026-10-22T05:30:00Z"), DENVER)).toEqual({
      date: "2026-10-21",
      time: "23:30",
    });
  });

  it("shows midnight as 00:00", () => {
    expect(localDateTime(new Date("2026-10-21T06:00:00Z"), DENVER)).toEqual({
      date: "2026-10-21",
      time: "00:00",
    });
  });
});

describe("DateSchema", () => {
  it("accepts real dates", () => {
    expect(DateSchema.safeParse("2026-02-28").success).toBe(true);
  });

  it("rejects bad shapes and impossible dates", () => {
    expect(DateSchema.safeParse("2026-2-8").success).toBe(false);
    expect(DateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(DateSchema.safeParse("tomorrow").success).toBe(false);
  });
});
