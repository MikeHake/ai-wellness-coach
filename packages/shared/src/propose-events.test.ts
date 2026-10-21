import { describe, expect, it } from "vitest";
import {
  EVENTS_PER_PROPOSAL_MAX,
  ProposeEventsSchema,
  toEventsProposalView,
} from "./propose-events.js";

const hike = {
  type: "activity",
  when: { dayOffset: -1 },
  summary: "5-mile hike",
  feelScore: 5,
  feelWords: ["great"],
  tags: ["hike", "outdoor"],
  details: { miles: 5 },
};

const parse = (events: unknown[]) => ProposeEventsSchema.safeParse({ events });

describe("ProposeEventsSchema", () => {
  it("accepts a full event", () => {
    expect(parse([hike]).success).toBe(true);
  });

  it("fills in empty feel words and tags, and leaves score and details out", () => {
    const result = parse([
      { type: "stress", when: { dayOffset: 0 }, summary: "brutal work day" },
    ]);
    expect(result.data?.events[0]).toEqual({
      type: "stress",
      when: { dayOffset: 0 },
      summary: "brutal work day",
      feelWords: [],
      tags: [],
    });
  });

  it(`needs 1 to ${String(EVENTS_PER_PROPOSAL_MAX)} events`, () => {
    expect(parse([]).success).toBe(false);
    expect(parse(Array(EVENTS_PER_PROPOSAL_MAX).fill(hike)).success).toBe(true);
    expect(parse(Array(EVENTS_PER_PROPOSAL_MAX + 1).fill(hike)).success).toBe(
      false,
    );
  });

  it("rejects a feel score outside 1 to 5 or not a whole number", () => {
    for (const feelScore of [0, 6, 2.5]) {
      expect(parse([{ ...hike, feelScore }]).success).toBe(false);
    }
  });

  it("rejects a blank or overlong summary", () => {
    expect(parse([{ ...hike, summary: "  " }]).success).toBe(false);
    expect(parse([{ ...hike, summary: "a".repeat(81) }]).success).toBe(false);
  });

  it("rejects tags that aren't lowercase snake_case, and too many tags", () => {
    for (const tag of ["Running", "with friends", "_x", "9am"]) {
      expect(parse([{ ...hike, tags: [tag] }]).success).toBe(false);
    }
    expect(parse([{ ...hike, tags: Array(9).fill("run") }]).success).toBe(
      false,
    );
  });

  it("limits feel words", () => {
    expect(parse([{ ...hike, feelWords: Array(6).fill("ok") }]).success).toBe(
      false,
    );
    expect(parse([{ ...hike, feelWords: ["a".repeat(31)] }]).success).toBe(
      false,
    );
  });

  it("keeps details flat, with at most 10 keys", () => {
    expect(
      parse([{ ...hike, details: { bedtime: "23:00", nap: true } }]).success,
    ).toBe(true);
    expect(parse([{ ...hike, details: { route: { miles: 5 } } }]).success).toBe(
      false,
    );
    const eleven = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`k${String(i)}`, i]),
    );
    expect(parse([{ ...hike, details: eleven }]).success).toBe(false);
  });

  it("checks the when, too", () => {
    expect(parse([{ ...hike, when: { dayOffset: 1 } }]).success).toBe(false);
  });
});

describe("toEventsProposalView", () => {
  it("swaps each when for its day and local time", () => {
    const draft = ProposeEventsSchema.parse({
      events: [
        hike,
        { ...hike, when: { date: "2026-10-01", localTime: "06:00" } },
      ],
    });
    const view = toEventsProposalView(
      "call-1",
      "pending",
      draft,
      "America/Denver",
      new Date("2026-10-21T01:30:00Z"),
    );
    expect(view).toEqual({
      toolCallId: "call-1",
      status: "pending",
      events: [
        {
          type: "activity",
          occurredOn: "2026-10-19",
          summary: "5-mile hike",
          feelScore: 5,
          feelWords: ["great"],
          tags: ["hike", "outdoor"],
          details: { miles: 5 },
        },
        expect.objectContaining({
          occurredOn: "2026-10-01",
          localTime: "06:00",
        }),
      ],
    });
  });
});
