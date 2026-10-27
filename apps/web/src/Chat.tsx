import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatHistoryResponseSchema,
} from "@ai-wellness-coach/shared";
import { useChat } from "@ai-sdk/react";
import { useAuth0 } from "@auth0/auth0-react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Fragment,
  type SubmitEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApi } from "./api.js";
import {
  buildChatRequestBody,
  messageText,
  proposalCards,
  toUIMessages,
} from "./chat-request.js";
import { API_BASE_URL } from "./config.js";
import { ProposalCard } from "./ProposalCard.js";

const EMPTY_PROMPT =
  "Tell me about your day: what you ate, how you moved, how you slept, and how you felt.";
const REPLY_FAILED =
  "I couldn't reply just now. Your message is saved, so you can try again.";

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; messages: UIMessage[] }
  | { status: "error" };

/**
 * Loads the saved conversation, then shows it. `onNameSaved` runs when the
 * person saves a name card, so the page can show the new name.
 */
export function Chat({ onNameSaved }: { onNameSaved?: () => void } = {}) {
  const api = useApi();
  const [state, setState] = useState<HistoryState>({ status: "loading" });

  const loadHistory = useCallback(async () => {
    const res = await api("/chat/messages");
    if (!res.ok)
      throw new Error(`GET /chat/messages failed with ${String(res.status)}`);
    const { messages } = ChatHistoryResponseSchema.parse(await res.json());
    return toUIMessages(messages);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    loadHistory().then(
      (messages) => {
        if (!cancelled) setState({ status: "ready", messages });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  if (state.status === "loading") {
    return <p className="chat-status">Loading your conversation...</p>;
  }
  if (state.status === "error") {
    return (
      <p className="chat-status" role="alert">
        We couldn't load your conversation right now. Please try again in a
        moment.
      </p>
    );
  }
  return (
    <Conversation
      initialMessages={state.messages}
      loadHistory={loadHistory}
      onNameSaved={onNameSaved}
    />
  );
}

function Conversation({
  initialMessages,
  loadHistory,
  onNameSaved,
}: {
  initialMessages: UIMessage[];
  loadHistory: () => Promise<UIMessage[]>;
  onNameSaved?: () => void;
}) {
  const { getAccessTokenSilently } = useAuth0();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE_URL}/chat`,
        headers: async () => {
          const token = await getAccessTokenSilently();
          if (!token) throw new Error("No access token available");
          return { Authorization: `Bearer ${token}` };
        },
        // Only the new message goes to the API, never the conversation.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: buildChatRequestBody(messages),
        }),
      }),
    [getAccessTokenSilently],
  );

  const {
    messages,
    sendMessage,
    regenerate,
    status,
    error,
    setMessages,
    clearError,
  } = useChat({
    messages: initialMessages,
    transport,
    // Message ids are UUIDs, so a retry can resend the same id.
    generateId: () => crypto.randomUUID(),
    onError: () => {
      // If the coach did reply (for example, a retry from another tab got
      // there first), show the saved conversation instead of the error.
      void loadHistory().then(
        (saved) => {
          if (saved.at(-1)?.role === "assistant") {
            setMessages(saved);
            clearError();
          }
        },
        () => undefined,
      );
    },
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function send() {
    const text = draft.trim();
    if (text === "" || busy) return;
    setDraft("");
    void sendMessage({ text });
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  // A partial reply from a failed stream is not saved, so don't show it.
  const shown =
    error && messages.at(-1)?.role === "assistant"
      ? messages.slice(0, -1)
      : messages;
  // The last message has no saved reply: the reply failed, or it failed before
  // a reload (the error itself isn't kept). Either way, offer Try again.
  const needsRetry =
    error !== undefined || (!busy && shown.at(-1)?.role === "user");

  return (
    <section className="chat" aria-label="Chat with your coach">
      <div className="chat-messages">
        {shown.length === 0 && <p className="chat-empty">{EMPTY_PROMPT}</p>}
        {shown.map((message) => {
          const text = messageText(message);
          return (
            <Fragment key={message.id}>
              {text !== "" && (
                <p className={`chat-message chat-message-${message.role}`}>
                  <span className="visually-hidden">
                    {message.role === "user" ? "You: " : "Coach: "}
                  </span>
                  {text}
                </p>
              )}
              {proposalCards(message).map((card) => (
                <ProposalCard
                  key={card.toolCallId}
                  proposal={card}
                  onSaved={card.kind === "profile" ? onNameSaved : undefined}
                />
              ))}
            </Fragment>
          );
        })}
        {status === "submitted" && (
          <p className="chat-message chat-message-assistant chat-typing">
            Thinking...
          </p>
        )}
        {needsRetry && (
          <div className="chat-error" role="alert">
            <p>{REPLY_FAILED}</p>
            <button type="button" onClick={() => void regenerate()}>
              Try again
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="chat-draft">
          Message
        </label>
        <textarea
          id="chat-draft"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          rows={2}
          placeholder="How was your day?"
          disabled={busy}
        />
        <button type="submit" disabled={busy || draft.trim() === ""}>
          Send
        </button>
      </form>
    </section>
  );
}
