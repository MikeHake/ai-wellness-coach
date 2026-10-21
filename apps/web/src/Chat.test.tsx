import { useAuth0 } from "@auth0/auth0-react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "./Chat.js";

vi.mock("@auth0/auth0-react", () => ({ useAuth0: vi.fn() }));

const getAccessTokenSilently = vi.fn().mockResolvedValue("test-access-token");
const REPLY_ID = "9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

/** A UI message stream body, the way POST /chat streams a reply. */
function streamBody(chunks: object[]): string {
  return [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
}

function replyStream(text: string) {
  return streamBody([
    { type: "start", messageId: REPLY_ID },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish" },
  ]);
}

function failedStream() {
  return streamBody([
    { type: "start", messageId: REPLY_ID },
    {
      type: "error",
      errorText:
        "I couldn't reply just now. Your message is saved, so you can try again.",
    },
  ]);
}

function sse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}

interface FakeApi {
  history: object[];
  /** Responses for successive POST /chat calls. */
  replies: (() => Response)[];
  /** Responses for successive Save or Discard calls. */
  decisions?: (() => Response)[];
}

function stubApi(api: FakeApi) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    if (url.endsWith("/chat/messages")) {
      return Promise.resolve(Response.json({ messages: api.history }));
    }
    if (url.endsWith("/chat") && init.method === "POST") {
      const next = api.replies.shift();
      if (!next) throw new Error("unexpected POST /chat");
      return Promise.resolve(next());
    }
    if (url.includes("/proposals/") && init.method === "POST") {
      const next = api.decisions?.shift();
      if (!next) throw new Error(`unexpected POST ${url}`);
      return Promise.resolve(next());
    }
    throw new Error(`unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const chatPosts = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.endsWith("/chat") && init?.method === "POST",
  ) as [string, RequestInit][];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth0).mockReturnValue({
    getAccessTokenSilently,
  } as unknown as ReturnType<typeof useAuth0>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Chat", () => {
  it("shows a friendly prompt when there are no messages yet", async () => {
    stubApi({ history: [], replies: [] });
    render(<Chat />);

    expect(
      await screen.findByText(/Tell me about your day/),
    ).toBeInTheDocument();
  });

  it("shows the saved conversation", async () => {
    stubApi({
      history: [
        {
          id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
          role: "user",
          text: "Hiked 5 miles",
          createdAt: "2026-10-20T20:00:00.000Z",
        },
        {
          id: "1c6f7d2f-9b4a-4c1f-8b68-3a2e5d4c3b21",
          role: "assistant",
          text: "That sounds lovely.",
          createdAt: "2026-10-20T20:00:01.000Z",
        },
      ],
      replies: [],
    });
    render(<Chat />);

    expect(await screen.findByText("Hiked 5 miles")).toBeInTheDocument();
    expect(screen.getByText("That sounds lovely.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Tell me about your day/),
    ).not.toBeInTheDocument();
  });

  it("sends only the new message with a bearer token, and shows the reply", async () => {
    const fetchMock = stubApi({
      history: [],
      replies: [() => sse(replyStream("Nice work getting outside."))],
    });
    render(<Chat />);

    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "  Hiked 5 miles  " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(
      await screen.findByText("Nice work getting outside."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hiked 5 miles")).toBeInTheDocument();

    const post = chatPosts(fetchMock)[0];
    if (!post) throw new Error("no POST /chat was sent");
    const [url, init] = post;
    expect(url).toBe("http://localhost:3000/chat");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-access-token",
    );
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["id", "text"]);
    expect(body.text).toBe("Hiked 5 miles");
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("adds a new line with Shift+Enter instead of sending", async () => {
    const fetchMock = stubApi({ history: [], replies: [] });
    render(<Chat />);

    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "first line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });

    expect(chatPosts(fetchMock)).toHaveLength(0);
  });

  it("offers Try again after a failed reply, and resends the same message id", async () => {
    const fetchMock = stubApi({
      history: [],
      replies: [
        () => sse(failedStream()),
        () => sse(replyStream("Glad you told me.")),
      ],
    });
    render(<Chat />);

    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Slept badly" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Your message is saved, so you can try again/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Glad you told me.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    const [first, second] = chatPosts(fetchMock).map(
      ([, init]) =>
        JSON.parse(init.body as string) as { id: string; text: string },
    );
    expect(second).toEqual(first);
    expect(screen.getAllByText("Slept badly")).toHaveLength(1);
  });

  it("offers Try again after a reload when the last message never got a reply", async () => {
    const id = "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10";
    const fetchMock = stubApi({
      history: [
        {
          id,
          role: "user",
          text: "Had a healthy dinner",
          createdAt: "2026-10-21T15:58:47.440Z",
        },
      ],
      replies: [() => sse(replyStream("That sounds nourishing."))],
    });
    render(<Chat />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Your message is saved, so you can try again/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("That sounds nourishing."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    const post = chatPosts(fetchMock)[0];
    if (!post) throw new Error("no POST /chat was sent");
    expect(JSON.parse(post[1].body as string)).toEqual({
      id,
      text: "Had a healthy dinner",
    });
  });

  it("shows no Try again when the conversation ends with a reply", async () => {
    stubApi({
      history: [
        {
          id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
          role: "user",
          text: "Hi",
          createdAt: "2026-10-21T15:58:47.440Z",
        },
        {
          id: "1c6f7d2f-9b4a-4c1f-8b68-3a2e5d4c3b21",
          role: "assistant",
          text: "Hello there.",
          createdAt: "2026-10-21T15:58:48.000Z",
        },
      ],
      replies: [],
    });
    render(<Chat />);

    expect(await screen.findByText("Hello there.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("shows a friendly message when the conversation can't be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    render(<Chat />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your conversation/,
    );
  });
});

describe("confirmation cards", () => {
  const card = {
    toolCallId: "call-1",
    status: "pending",
    events: [
      {
        type: "activity",
        occurredOn: "2026-10-01",
        localTime: "06:00",
        summary: "5-mile hike",
        feelScore: 5,
        feelWords: ["great"],
        tags: ["hike", "with_friends"],
      },
    ],
  };

  const reply = (proposals: object[], text = "Here's what I caught.") => ({
    id: "1c6f7d2f-9b4a-4c1f-8b68-3a2e5d4c3b21",
    role: "assistant",
    text,
    createdAt: "2026-10-21T15:58:48.000Z",
    proposals,
  });

  const decisionPosts = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls.filter(([url]) => url.includes("/proposals/")) as [
      string,
      RequestInit,
    ][];

  it("shows a streamed draft as a card with each event's details", async () => {
    stubApi({
      history: [],
      replies: [
        () =>
          sse(
            streamBody([
              { type: "start", messageId: REPLY_ID },
              { type: "start-step" },
              {
                type: "tool-input-available",
                toolCallId: "call-1",
                toolName: "propose_events",
                input: {},
              },
              {
                type: "tool-output-available",
                toolCallId: "call-1",
                output: card,
              },
              { type: "finish-step" },
              { type: "start-step" },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Here's what I caught." },
              { type: "text-end", id: "t1" },
              { type: "finish-step" },
              { type: "finish" },
            ]),
          ),
      ],
    });
    render(<Chat />);

    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Hiked at 6" } });
    fireEvent.keyDown(box, { key: "Enter" });

    const shown = await screen.findByRole("article", {
      name: "Drafted events",
    });
    expect(shown).toHaveTextContent("Activity");
    expect(shown).toHaveTextContent("Thu, Oct 1, 6:00 AM");
    expect(shown).toHaveTextContent("5-mile hike");
    expect(shown).toHaveTextContent("Feeling 5 of 5: great");
    expect(shown).toHaveTextContent("with friends");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("saves by reference, sending only the tool call id", async () => {
    const fetchMock = stubApi({
      history: [reply([card])],
      replies: [],
      decisions: [() => Response.json({ status: "saved" })],
    });
    render(<Chat />);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Saved to your journal"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    const [post] = decisionPosts(fetchMock);
    expect(post?.[0]).toBe("http://localhost:3000/proposals/call-1/save");
    expect(post?.[1].body).toBeUndefined();
  });

  it("shows Discarded after Discard", async () => {
    stubApi({
      history: [reply([card])],
      replies: [],
      decisions: [() => Response.json({ status: "discarded" })],
    });
    render(<Chat />);

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(await screen.findByText("Discarded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("shows each card's stored status after a reload", async () => {
    stubApi({
      history: [
        reply([
          { ...card, toolCallId: "a", status: "saved" },
          { ...card, toolCallId: "b", status: "discarded" },
        ]),
      ],
      replies: [],
    });
    render(<Chat />);

    expect(
      await screen.findByText("Saved to your journal"),
    ).toBeInTheDocument();
    expect(screen.getByText("Discarded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("asks the person to tell the coach what to change when Save fails validation, and keeps Discard", async () => {
    stubApi({
      history: [reply([card])],
      replies: [],
      decisions: [
        () => Response.json({ error: "invalid_proposal" }, { status: 422 }),
        () => Response.json({ status: "discarded" }),
      ],
    });
    render(<Chat />);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "I couldn't save this as it is. Tell me what to change and I'll draft it again.",
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Discarded")).toBeInTheDocument();
  });

  it("offers Save again after a network failure", async () => {
    stubApi({
      history: [reply([card])],
      replies: [],
      decisions: [
        () => new Response("oops", { status: 500 }),
        () => Response.json({ status: "saved" }),
      ],
    });
    render(<Chat />);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong saving this. Please try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Saved to your journal"),
    ).toBeInTheDocument();
  });

  it("shows the decision made elsewhere when Save gets a 409", async () => {
    stubApi({
      history: [reply([card])],
      replies: [],
      decisions: [
        () => Response.json({ status: "discarded" }, { status: 409 }),
      ],
    });
    render(<Chat />);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("Discarded")).toBeInTheDocument();
  });

  it("shows no card for a reply without drafts", async () => {
    stubApi({ history: [reply([], "Hello there.")], replies: [] });
    render(<Chat />);

    expect(await screen.findByText("Hello there.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});
