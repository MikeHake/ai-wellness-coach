import {
  type ChatHistoryMessage,
  type ChatMessageRequest,
  type ProposalKind,
  type ProposalView,
  ProposalViewSchema,
} from "@ai-wellness-coach/shared";
import type { UIMessage } from "ai";

/** The UI part type for each propose_* tool call, by the kind of card it makes. */
const PROPOSE_PARTS = {
  events: "tool-propose_events",
  profile: "tool-propose_profile",
} as const satisfies Record<ProposalKind, string>;

const PROPOSE_PART_TYPES: readonly string[] = Object.values(PROPOSE_PARTS);

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
 * The confirmation cards in a message: its successful propose_* calls,
 * whether they just streamed in or came back with the saved conversation.
 */
export function proposalCards(message: UIMessage): ProposalView[] {
  return message.parts.flatMap((part) => {
    if (!PROPOSE_PART_TYPES.includes(part.type) || !("state" in part)) {
      return [];
    }
    if (part.state !== "output-available") return [];
    const card = ProposalViewSchema.safeParse(part.output);
    return card.success ? [card.data] : [];
  });
}

/**
 * Saved messages from GET /chat/messages, in the shape useChat expects. A
 * reply's cards become finished propose_* parts, as they were streamed.
 */
export function toUIMessages(history: ChatHistoryMessage[]): UIMessage[] {
  return history.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      ...(message.proposals ?? []).map((card): UIMessage["parts"][number] => ({
        type: PROPOSE_PARTS[card.kind],
        toolCallId: card.toolCallId,
        state: "output-available",
        input: undefined,
        output: card,
      })),
      { type: "text", text: message.text },
    ],
  }));
}
