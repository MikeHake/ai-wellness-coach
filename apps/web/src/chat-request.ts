import {
  type ChatHistoryMessage,
  type ChatMessageRequest,
  type EventsProposalView,
  EventsProposalViewSchema,
} from "@ai-wellness-coach/shared";
import type { UIMessage } from "ai";

/** The UI part type for a propose_events tool call. */
const PROPOSE_EVENTS_PART = "tool-propose_events";

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

/**
 * The confirmation cards in a message: its successful propose_events calls,
 * whether they just streamed in or came back with the saved conversation.
 */
export function proposalCards(message: UIMessage): EventsProposalView[] {
  return message.parts.flatMap((part) => {
    if (part.type !== PROPOSE_EVENTS_PART || !("state" in part)) return [];
    if (part.state !== "output-available") return [];
    const card = EventsProposalViewSchema.safeParse(part.output);
    return card.success ? [card.data] : [];
  });
}

/**
 * Saved messages from GET /chat/messages, in the shape useChat expects. A
 * reply's cards become finished propose_events parts, as they were streamed.
 */
export function toUIMessages(history: ChatHistoryMessage[]): UIMessage[] {
  return history.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      ...(message.proposals ?? []).map((card): UIMessage["parts"][number] => ({
        type: PROPOSE_EVENTS_PART,
        toolCallId: card.toolCallId,
        state: "output-available",
        input: undefined,
        output: card,
      })),
      { type: "text", text: message.text },
    ],
  }));
}
