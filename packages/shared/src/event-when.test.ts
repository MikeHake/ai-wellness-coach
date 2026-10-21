import { describe, expect, it } from "vitest";
import {
  EVENT_FUTURE_ALLOWANCE_MINUTES,
  EVENT_MAX_DAYS_BACK,
  EventWhenSchema,
  resolveEventWhen,
  type EventWhen,
} from "./event-when.js";

const iso = (date: Date | null | undefined) => date?.toISOString();

describe("EventWhenSchema", () => {
  it("accepts a day offset or a date, with or without a time", () => {
    expect(EventWhenSchema.safeParse({ dayOffset: 0 }).success).toBe(true);
    expect(EventWhenSchema.safeParse({ dayOffset: -365 }).success).toBe(true);
    expect(EventWhenSchema.safeParse({ date: "2026-10-19" }).success).toBe(
      true,
    );
    expect(
      EventWhenSchema.safeParse({ dayOffset: -1, localTime: "06:00" }).success,
    ).toBe(true);
  });

  it("requires exactly one of dayOffset and date", () => {
    const both = EventWhenSchema.safeParse({
      dayOffset: 0,
      date: "2026-10-19",
    });
    const neither = EventWhenSchema.safeParse({ localTime: "06:00" });
    expect(both.success).toBe(false);
    expect(neither.success).toBe(false);
    expect(both.error?.issues[0]?.message).toContain("exactly one");
  });

  it("rejects offsets outside 0 to -365 and non-integers", () => {
    expect(EventWhenSchema.safeParse({ dayOffset: 1 }).success).toBe(false);
    expect(EventWhenSchema.safeParse({ dayOffset: -366 }).success).toBe(false);
    expect(EventWhenSchema.safeParse({ dayOffset: -0.5 }).success).toBe(false);
  });

  it("rejects malformed or impossible dates", () => {
    for (const date of ["2026-1-5", "10/19/2026", "2026-02-30", "2026-13-01"]) {
      expect(EventWhenSchema.safeParse({ date }).success).toBe(false);
    }
  });

  it("rejects malformed times", () => {
    for (const localTime of ["24:00", "7:5", "6am", "12:60", ""]) {
      expect(
        EventWhenSchema.safeParse({ dayOffset: 0, localTime }).success,
      ).toBe(false);
    }
  });
});

describe("resolveEventWhen: which day is today", () => {
  // 11:30pm on Oct 19 in Denver (MDT), already Oct 20 in UTC.
  const now = new Date("2026-10-20T05:30:00Z");

  it("uses the person's day, not UTC's", () => {
    expect(resolveEventWhen({ dayOffset: 0 }, "America/Denver", now)).toEqual({
      ok: true,
      occurredOn: "2026-10-19",
      occurredAt: null,
    });
    expect(resolveEventWhen({ dayOffset: 0 }, "UTC", now)).toMatchObject({
      occurredOn: "2026-10-20",
    });
  });

  it("counts days back from the person's today", () => {
    expect(
      resolveEventWhen({ dayOffset: -1 }, "America/Denver", now),
    ).toMatchObject({
      occurredOn: "2026-10-18",
    });
    expect(
      resolveEventWhen({ dayOffset: -20 }, "America/Denver", now),
    ).toMatchObject({
      occurredOn: "2026-09-29",
    });
  });

  it("passes an explicit date through", () => {
    expect(
      resolveEventWhen({ date: "2026-10-01" }, "America/Denver", now),
    ).toEqual({ ok: true, occurredOn: "2026-10-01", occurredAt: null });
  });

  it("sets occurredAt only when a time is given", () => {
    const without = resolveEventWhen({ dayOffset: -1 }, "UTC", now);
    const withTime = resolveEventWhen(
      { dayOffset: -1, localTime: "08:15" },
      "UTC",
      now,
    );
    expect(without).toMatchObject({ ok: true, occurredAt: null });
    expect(withTime).toMatchObject({ ok: true });
    expect(withTime.ok && iso(withTime.occurredAt)).toBe(
      "2026-10-19T08:15:00.000Z",
    );
  });
});

describe("resolveEventWhen: events must have happened", () => {
  const now = new Date("2026-10-20T20:00:00Z"); // 2:00pm in Denver

  it("rejects a date after today, with a message for the model", () => {
    const result = resolveEventWhen(
      { date: "2026-10-21" },
      "America/Denver",
      now,
    );
    expect(result).toMatchObject({ ok: false, reason: "future" });
    expect(!result.ok && result.message).toContain("already happened");
  });

  it("judges 'future' by the person's day, not UTC's", () => {
    // 8:00pm Oct 20 in Denver is Oct 21 in UTC, but still today for the person.
    const lateNow = new Date("2026-10-21T02:00:00Z");
    expect(
      resolveEventWhen({ date: "2026-10-20" }, "America/Denver", lateNow).ok,
    ).toBe(true);
    expect(
      resolveEventWhen({ date: "2026-10-21" }, "America/Denver", lateNow).ok,
    ).toBe(false);
  });

  it(`allows a time up to ${String(EVENT_FUTURE_ALLOWANCE_MINUTES)} minutes ahead, not beyond`, () => {
    const today = (localTime: string): EventWhen => ({
      dayOffset: 0,
      localTime,
    });
    expect(resolveEventWhen(today("14:10"), "America/Denver", now).ok).toBe(
      true,
    );
    expect(resolveEventWhen(today("14:15"), "America/Denver", now).ok).toBe(
      true,
    );
    const late = resolveEventWhen(today("14:20"), "America/Denver", now);
    expect(late).toMatchObject({ ok: false, reason: "future" });
    expect(resolveEventWhen(today("18:00"), "America/Denver", now).ok).toBe(
      false,
    );
  });

  it(`accepts ${String(EVENT_MAX_DAYS_BACK)} days back and rejects older, for both forms`, () => {
    expect(
      resolveEventWhen({ dayOffset: -365 }, "America/Denver", now),
    ).toMatchObject({ ok: true, occurredOn: "2025-10-20" });
    expect(
      resolveEventWhen({ date: "2025-10-20" }, "America/Denver", now).ok,
    ).toBe(true);
    const old = resolveEventWhen({ date: "2025-10-19" }, "America/Denver", now);
    expect(old).toMatchObject({ ok: false, reason: "too_old" });
    expect(!old.ok && old.message).toContain("365");
  });
});

describe("resolveEventWhen: different time zones", () => {
  // 2:00pm in Denver, 10:00pm in Berlin, 1:30am the next day in Kolkata.
  const now = new Date("2026-10-20T20:00:00Z");

  it("resolves yesterday at 6am in each zone", () => {
    const when: EventWhen = { dayOffset: -1, localTime: "06:00" };

    const denver = resolveEventWhen(when, "America/Denver", now);
    expect(denver).toMatchObject({ ok: true, occurredOn: "2026-10-19" });
    expect(denver.ok && iso(denver.occurredAt)).toBe(
      "2026-10-19T12:00:00.000Z",
    );

    const berlin = resolveEventWhen(when, "Europe/Berlin", now);
    expect(berlin).toMatchObject({ ok: true, occurredOn: "2026-10-19" });
    expect(berlin.ok && iso(berlin.occurredAt)).toBe(
      "2026-10-19T04:00:00.000Z",
    );

    // Kolkata is already on Oct 21, so "yesterday" is Oct 20, at UTC+5:30.
    const kolkata = resolveEventWhen(when, "Asia/Kolkata", now);
    expect(kolkata).toMatchObject({ ok: true, occurredOn: "2026-10-20" });
    expect(kolkata.ok && iso(kolkata.occurredAt)).toBe(
      "2026-10-20T00:30:00.000Z",
    );
  });
});

describe("resolveEventWhen: daylight saving time", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const at = (date: string, localTime: string, zone: string) => {
    const result = resolveEventWhen({ date, localTime }, zone, now);
    if (!result.ok) throw new Error(result.message);
    return iso(result.occurredAt);
  };

  it("moves a time that doesn't exist forward by the gap", () => {
    // Denver, Mar 8: clocks jump from 02:00 MST to 03:00 MDT.
    expect(at("2026-03-08", "02:30", "America/Denver")).toBe(
      "2026-03-08T09:30:00.000Z", // 03:30 MDT
    );
    // Berlin, Mar 29: clocks jump from 02:00 CET to 03:00 CEST.
    expect(at("2026-03-29", "02:30", "Europe/Berlin")).toBe(
      "2026-03-29T01:30:00.000Z", // 03:30 CEST
    );
  });

  it("uses the earlier instant for a time that happens twice", () => {
    // Denver, Nov 1: 01:30 happens as MDT, then again as MST.
    expect(at("2026-11-01", "01:30", "America/Denver")).toBe(
      "2026-11-01T07:30:00.000Z", // 01:30 MDT, the first one
    );
    // Berlin, Oct 25: 02:30 happens as CEST, then again as CET.
    expect(at("2026-10-25", "02:30", "Europe/Berlin")).toBe(
      "2026-10-25T00:30:00.000Z", // 02:30 CEST, the first one
    );
  });

  it("leaves times on either side of a change alone", () => {
    expect(at("2026-03-08", "01:59", "America/Denver")).toBe(
      "2026-03-08T08:59:00.000Z", // MST
    );
    expect(at("2026-03-08", "03:00", "America/Denver")).toBe(
      "2026-03-08T09:00:00.000Z", // MDT
    );
    expect(at("2026-11-01", "03:00", "America/Denver")).toBe(
      "2026-11-01T10:00:00.000Z", // MST
    );
  });
});

describe("resolveEventWhen: sleep events", () => {
  // 8:00am in Denver. Sleep is dated by the wake-up day, so offset 0.
  const now = new Date("2026-10-20T14:00:00Z");

  it("accepts the wake-up time", () => {
    const result = resolveEventWhen(
      { dayOffset: 0, localTime: "07:00" },
      "America/Denver",
      now,
    );
    expect(result).toMatchObject({ ok: true, occurredOn: "2026-10-20" });
    expect(result.ok && iso(result.occurredAt)).toBe(
      "2026-10-20T13:00:00.000Z",
    );
  });

  it("rejects a bedtime as localTime, because tonight hasn't happened", () => {
    const result = resolveEventWhen(
      { dayOffset: 0, localTime: "23:00" },
      "America/Denver",
      now,
    );
    expect(result).toMatchObject({ ok: false, reason: "future" });
  });
});

describe("resolveEventWhen: half-hour daylight saving", () => {
  // Lord Howe Island shifts its clocks by 30 minutes.
  const now = new Date("2026-10-20T00:00:00Z");
  const at = (date: string, localTime: string) => {
    const result = resolveEventWhen(
      { date, localTime },
      "Australia/Lord_Howe",
      now,
    );
    if (!result.ok) throw new Error(result.message);
    return iso(result.occurredAt);
  };

  it("moves a time in the half-hour spring gap forward by 30 minutes", () => {
    // Oct 4: clocks jump from 02:00 (UTC+10:30) to 02:30 (UTC+11).
    expect(at("2026-10-04", "02:15")).toBe("2026-10-03T15:45:00.000Z"); // 02:45
  });

  it("uses the earlier instant for a time repeated by the half-hour fall back", () => {
    // Apr 5: clocks go from 02:00 (UTC+11) back to 01:30 (UTC+10:30).
    expect(at("2026-04-05", "01:45")).toBe("2026-04-04T14:45:00.000Z"); // UTC+11, the first
  });
});

describe("resolveEventWhen: bad input", () => {
  const now = new Date("2026-10-20T20:00:00Z");

  it("throws on an invalid time zone", () => {
    expect(() =>
      resolveEventWhen({ dayOffset: 0 }, "Mars/Olympus", now),
    ).toThrow("Invalid time zone");
    expect(() => resolveEventWhen({ dayOffset: 0 }, "+02:00", now)).toThrow();
  });

  it("throws if given neither a day offset nor a date", () => {
    expect(() => resolveEventWhen({}, "UTC", now)).toThrow("exactly one");
  });
});
