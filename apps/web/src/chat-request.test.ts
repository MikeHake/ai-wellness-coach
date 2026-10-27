import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildChatRequestBody,
  proposalCards,
  toUIMessages,
} from "./chat-request.js";

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

const card = {
  kind: "events" as const,
  toolCallId: "call-1",
  status: "saved" as const,
  events: [
    {
      type: "activity",
      occurredOn: "2026-10-20",
      summary: "5-mile hike",
      feelScore: 5,
      feelWords: ["great"],
      tags: ["hike"],
    },
  ],
};

describe("proposalCards", () => {
  it("round-trips the cards on a saved reply", () => {
    const [ui] = toUIMessages([
      {
        id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
        role: "assistant",
        text: "Here's what I caught.",
        createdAt: "2026-10-20T20:00:00.000Z",
        proposals: [card],
      },
    ]);
    if (!ui) throw new Error("no message");
    expect(proposalCards(ui)).toEqual([card]);
  });

  it("round-trips events and name cards on the same reply", () => {
    const name = {
      kind: "profile" as const,
      toolCallId: "call-2",
      status: "pending" as const,
      firstName: "Mike",
    };
    const [ui] = toUIMessages([
      {
        id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
        role: "assistant",
        text: "Nice to meet you.",
        createdAt: "2026-10-20T20:00:00.000Z",
        proposals: [card, name],
      },
    ]);
    if (!ui) throw new Error("no message");
    expect(ui.parts.map((part) => part.type)).toEqual([
      "tool-propose_events",
      "tool-propose_profile",
      "text",
    ]);
    expect(proposalCards(ui)).toEqual([card, name]);
  });

  it("skips tool calls that failed, are still running, or are other tools", () => {
    const ui: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-propose_events",
          toolCallId: "bad",
          state: "output-error",
          input: {},
          errorText: "That date is in the future.",
        },
        {
          type: "tool-propose_events",
          toolCallId: "running",
          state: "input-available",
          input: {},
        },
        {
          type: "tool-list_event_types",
          toolCallId: "list",
          state: "output-available",
          input: {},
          output: { eventTypes: [] },
        },
        { type: "text", text: "Hi" },
      ],
    };
    expect(proposalCards(ui)).toEqual([]);
  });
});
