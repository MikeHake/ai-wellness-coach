import { describe, expect, it } from "vitest";
import { buildCoachSystemPrompt } from "./coach-prompt.js";

describe("buildCoachSystemPrompt", () => {
  // 11:30pm on Monday, Oct 19 in Denver; already Oct 20 in UTC.
  const now = new Date("2026-10-20T05:30:00Z");

  it("gives the person's local weekday, date, time, and zone", () => {
    const prompt = buildCoachSystemPrompt({ now, timeZone: "America/Denver" });
    expect(prompt).toContain("Monday, October 19, 2026");
    expect(prompt).toContain("11:30 PM");
    expect(prompt).toContain("America/Denver");
  });

  it("uses the person's zone, not the server's", () => {
    const prompt = buildCoachSystemPrompt({ now, timeZone: "Asia/Kolkata" });
    expect(prompt).toContain("Tuesday, October 20, 2026");
    expect(prompt).toContain("11:00 AM");
  });

  it("carries the guardrails and voice rules", () => {
    const prompt = buildCoachSystemPrompt({ now, timeZone: "UTC" });
    expect(prompt).toMatch(/two to four short sentences/);
    expect(prompt).toMatch(/at most one question/);
    expect(prompt).toMatch(/Never judge food choices/);
    expect(prompt).toMatch(/medical, diagnostic, or diet advice/);
    expect(prompt).toMatch(/Don't say you have logged, saved, or recorded/);
    expect(prompt).not.toContain("—");
  });
});
