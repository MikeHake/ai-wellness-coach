import { BUILT_IN_EVENT_TYPES } from "@ai-wellness-coach/shared";
import { describe, expect, it } from "vitest";
import { buildCoachSystemPrompt } from "./coach-prompt.js";

const eventTypes = [
  ...BUILT_IN_EVENT_TYPES,
  { name: "migraine", description: "A migraine headache." },
];

describe("buildCoachSystemPrompt", () => {
  // 11:30pm on Monday, Oct 19 in Denver; already Oct 20 in UTC.
  const now = new Date("2026-10-20T05:30:00Z");

  it("gives the person's local weekday, date, time, and zone", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "America/Denver",
      eventTypes,
      firstName: null,
    });
    expect(prompt).toContain("Monday, October 19, 2026");
    expect(prompt).toContain("11:30 PM");
    expect(prompt).toContain("America/Denver");
  });

  it("uses the person's zone, not the server's", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "Asia/Kolkata",
      eventTypes,
      firstName: null,
    });
    expect(prompt).toContain("Tuesday, October 20, 2026");
    expect(prompt).toContain("11:00 AM");
  });

  it("carries the guardrails and voice rules", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "UTC",
      eventTypes,
      firstName: null,
    });
    expect(prompt).toMatch(/two to four short sentences/);
    expect(prompt).toMatch(/at most one question/);
    expect(prompt).toMatch(/Never judge food choices/);
    expect(prompt).toMatch(/medical, diagnostic, or diet advice/);
    expect(prompt).toMatch(/Never say you have saved, logged, or recorded/);
    expect(prompt).not.toContain("\u2014");
  });

  it("lists every visible event type with its description", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "UTC",
      eventTypes,
      firstName: null,
    });
    for (const type of eventTypes) {
      expect(prompt).toContain(`- ${type.name}: ${type.description}`);
    }
  });

  it("explains logging, including the sleep rules and the worked examples", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "UTC",
      eventTypes,
      firstName: null,
    });
    expect(prompt).toMatch(/call propose_events once/);
    expect(prompt).toMatch(/Sleep is dated by the day they woke up/);
    expect(prompt).toMatch(/never bedtime/);
    expect(prompt).toContain("Yesterday I went on a 5-mile hike");
    expect(prompt).toContain("Work was brutal today.");
  });

  it("asks for a first name once, without holding up logging, until one is saved", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "UTC",
      eventTypes,
      firstName: null,
    });
    expect(prompt).toMatch(/You don't know their name yet/);
    expect(prompt).toMatch(/ask once, warmly/);
    expect(prompt).toMatch(/Don't hold up logging/);
    expect(prompt).toMatch(/call propose_profile/);
  });

  it("uses a saved name, quoted, and stops asking for it", () => {
    const prompt = buildCoachSystemPrompt({
      now,
      timeZone: "UTC",
      eventTypes,
      firstName: "Mike",
    });
    expect(prompt).toContain('Their first name is "Mike".');
    expect(prompt).not.toMatch(/You don't know their name yet/);
    // A different name later goes through the same tool and card.
    expect(prompt).toMatch(/a different name to use, call propose_profile/);
  });
});
