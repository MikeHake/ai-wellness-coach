import { describe, expect, it } from "vitest";
import { DayResponseSchema } from "./day.js";

const entry = {
  id: "e1",
  text: "Yesterday I hiked and felt great",
  createdOn: "2026-10-22",
  createdTime: "09:14",
  events: [
    {
      id: "v1",
      type: "activity",
      summary: "5-mile hike",
      feelScore: 5,
      feelWords: ["great"],
      tags: ["hiking"],
      localTime: "08:00",
    },
  ],
};

describe("DayResponseSchema", () => {
  it("accepts a day with entries and events", () => {
    const body = { date: "2026-10-21", entries: [entry] };
    expect(DayResponseSchema.parse(body)).toEqual(body);
  });

  it("accepts an empty day", () => {
    expect(
      DayResponseSchema.safeParse({ date: "2026-10-21", entries: [] }).success,
    ).toBe(true);
  });

  it("accepts an event without a score or a time", () => {
    const bare = {
      id: "v2",
      type: "stress",
      summary: "Brutal meeting",
      feelWords: [],
      tags: [],
    };
    const body = {
      date: "2026-10-21",
      entries: [{ ...entry, events: [bare] }],
    };
    expect(DayResponseSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a bad date or score", () => {
    expect(
      DayResponseSchema.safeParse({ date: "soon", entries: [] }).success,
    ).toBe(false);
    const badScore = {
      ...entry,
      events: [{ ...entry.events[0], feelScore: 6 }],
    };
    expect(
      DayResponseSchema.safeParse({ date: "2026-10-21", entries: [badScore] })
        .success,
    ).toBe(false);
  });
});
