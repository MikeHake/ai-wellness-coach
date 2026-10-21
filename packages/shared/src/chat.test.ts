import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatHistoryResponseSchema,
  ChatMessageRequestSchema,
} from "./chat.js";

const id = "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10";

describe("ChatMessageRequestSchema", () => {
  it("trims the text and keeps the id", () => {
    expect(
      ChatMessageRequestSchema.parse({ id, text: "  Hiked 5 miles \n" }),
    ).toEqual({ id, text: "Hiked 5 miles" });
  });

  it("drops anything else the browser sends", () => {
    const parsed = ChatMessageRequestSchema.parse({
      id,
      text: "hi",
      userId: "someone-else",
      messages: [{ role: "user", text: "old" }],
    });
    expect(parsed).toEqual({ id, text: "hi" });
  });

  it("rejects blank, too long, and non-UUID ids", () => {
    expect(
      ChatMessageRequestSchema.safeParse({ id, text: "   " }).success,
    ).toBe(false);
    expect(
      ChatMessageRequestSchema.safeParse({
        id,
        text: "a".repeat(CHAT_MESSAGE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      ChatMessageRequestSchema.safeParse({
        id,
        text: "a".repeat(CHAT_MESSAGE_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      ChatMessageRequestSchema.safeParse({ id: "msg-1", text: "hi" }).success,
    ).toBe(false);
  });
});

describe("ChatHistoryResponseSchema", () => {
  it("accepts user and assistant messages only", () => {
    const message = {
      id,
      role: "user",
      text: "hi",
      createdAt: "2026-10-20T20:00:00.000Z",
    };
    expect(
      ChatHistoryResponseSchema.safeParse({ messages: [message] }).success,
    ).toBe(true);
    expect(
      ChatHistoryResponseSchema.safeParse({
        messages: [{ ...message, role: "tool" }],
      }).success,
    ).toBe(false);
  });
});
