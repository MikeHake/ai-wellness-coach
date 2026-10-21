import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildChatRequestBody, toUIMessages } from "./chat-request.js";

const message = (
  id: string,
  role: "user" | "assistant",
  ...texts: string[]
): UIMessage => ({
  id,
  role,
  parts: texts.map((text) => ({ type: "text", text })),
});

describe("buildChatRequestBody", () => {
  it("sends only the newest user message, never the history", () => {
    expect(
      buildChatRequestBody([
        message("u1", "user", "Older message"),
        message("a1", "assistant", "A reply"),
        message("u2", "user", "Rode with Sam, ", "felt awesome"),
      ]),
    ).toEqual({ id: "u2", text: "Rode with Sam, felt awesome" });
  });

  it("uses the last user message even when a partial reply follows it", () => {
    expect(
      buildChatRequestBody([
        message("u1", "user", "Hi"),
        message("a1", "assistant", "That sou"),
      ]),
    ).toEqual({ id: "u1", text: "Hi" });
  });

  it("refuses to send without a user message", () => {
    expect(() => buildChatRequestBody([])).toThrow();
  });
});

describe("toUIMessages", () => {
  it("turns saved messages into text parts", () => {
    expect(
      toUIMessages([
        {
          id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
          role: "assistant",
          text: "Welcome back",
          createdAt: "2026-10-20T20:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
        role: "assistant",
        parts: [{ type: "text", text: "Welcome back" }],
      },
    ]);
  });
});
