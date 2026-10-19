import { describe, expect, it } from "vitest";
import { createOriginMatcher } from "./cors.js";

const matcher = createOriginMatcher({
  origin: "https://ai-wellness-coach.pages.dev",
  previewHostSuffix: ".ai-wellness-coach.pages.dev",
});

describe("createOriginMatcher", () => {
  it("allows the production origin", () => {
    expect(matcher("https://ai-wellness-coach.pages.dev")).toBe(
      "https://ai-wellness-coach.pages.dev",
    );
  });

  it("allows preview sites one label below the suffix", () => {
    expect(matcher("https://6f3a2b1c.ai-wellness-coach.pages.dev")).toBe(
      "https://6f3a2b1c.ai-wellness-coach.pages.dev",
    );
    expect(matcher("https://5-deploy.ai-wellness-coach.pages.dev")).toBe(
      "https://5-deploy.ai-wellness-coach.pages.dev",
    );
  });

  it("refuses other origins", () => {
    for (const origin of [
      "https://evil.com",
      "http://localhost:5173",
      "http://ai-wellness-coach.pages.dev",
      "http://abc.ai-wellness-coach.pages.dev",
      "https://a.b.ai-wellness-coach.pages.dev",
      "https://ai-wellness-coach.pages.dev.evil.com",
      "https://evil.com/.ai-wellness-coach.pages.dev",
      "https://-abc.ai-wellness-coach.pages.dev",
      "https://abc-.ai-wellness-coach.pages.dev",
      "https://abc.ai-wellness-coach.pages.dev:8443",
      "https://abc.ai-wellness-coach.pages.dev/",
      "https://evil.aiXwellness-coach.pages.dev",
      "https://.ai-wellness-coach.pages.dev",
      "",
    ]) {
      expect(matcher(origin), origin).toBeNull();
    }
  });

  it("allows only the exact origin when no preview suffix is set", () => {
    const strict = createOriginMatcher({ origin: "http://localhost:5173" });

    expect(strict("http://localhost:5173")).toBe("http://localhost:5173");
    expect(strict("https://abc.ai-wellness-coach.pages.dev")).toBeNull();
  });
});
