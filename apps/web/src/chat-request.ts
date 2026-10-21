import {
  type ChatHistoryMessage,
  type ChatMessageRequest,
} from "@ai-wellness-coach/shared";
import type { UIMessage } from "ai";

/** The plain text of a message, joined from its text parts. */
export function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * The body of POST /chat: only the newest user message. The API builds the
 * conversation from the database, so the browser never sends history.
 * A retry resends the same id, so the API reuses the saved entry.
 */
export function buildChatRequestBody(
  messages: UIMessage[],
): ChatMessageRequest {
  const latest = messages.findLast((message) => message.role === "user");
  if (!latest) throw new Error("There is no message to send");
  return { id: latest.id, text: messageText(latest) };
}

/** Saved messages from GET /chat/messages, in the shape useChat expects. */
export function toUIMessages(history: ChatHistoryMessage[]): UIMessage[] {
  return history.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.text }],
  }));
}
