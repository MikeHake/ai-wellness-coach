import { useAuth0 } from "@auth0/auth0-react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

vi.mock("@auth0/auth0-react", () => ({ useAuth0: vi.fn() }));

const loginWithRedirect = vi.fn();
const logout = vi.fn();
const getAccessTokenSilently = vi.fn().mockResolvedValue("test-access-token");

function signedIn(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth0).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    error: undefined,
    // Email and password accounts carry the email as their Auth0 name.
    user: { name: "mike@example.com" },
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
    ...overrides,
  } as unknown as ReturnType<typeof useAuth0>);
}

function signedOut(overrides: Record<string, unknown> = {}) {
  signedIn({ isAuthenticated: false, user: undefined, ...overrides });
}

const profile = {
  id: "0b5f6c1e-8a3f-4b0e-9a57-2f1d4c3b2a10",
  timezone: "America/Denver",
  firstName: "Mike",
  createdAt: "2026-10-18T17:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signed out", () => {
  it("shows the landing page, and Sign in starts Universal Login", () => {
    signedOut();
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "AI Wellness Coach" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(loginWithRedirect).toHaveBeenCalledOnce();
  });

  it("shows a loading message while Auth0 checks the session", () => {
    signedOut({ isLoading: true });
    render(<App />);

    expect(screen.getByText(/getting things ready/i)).toBeInTheDocument();
  });

  it("offers to try again when sign-in fails", () => {
    signedOut({ error: new Error("login_required") });
    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent(/didn't work/i);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("signed in", () => {
  it("creates the profile with a bearer token and the browser time zone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(profile, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    signedIn();
    render(<App />);

    expect(
      await screen.findByText(/America\/Denver time zone/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Welcome, Mike!" }),
    ).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/me");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer test-access-token",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("shows the chat once the profile is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/chat/messages")
            ? Response.json({ messages: [] })
            : Response.json(profile),
        ),
      ),
    );
    signedIn();
    render(<App />);

    expect(
      await screen.findByText(/Tell me about your day/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Message" }),
    ).toBeInTheDocument();
  });

  it("signs out back to the landing page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(profile)));
    signedIn();
    render(<App />);
    await screen.findByText(/time zone/);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("shows a friendly message when the profile cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "unauthorized" }, { status: 401 }),
        ),
    );
    signedIn();
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your profile/i,
    );
  });

  it("shows the friendly message when a token cannot be obtained", async () => {
    vi.stubGlobal("fetch", vi.fn());
    signedIn({
      getAccessTokenSilently: vi
        .fn()
        .mockRejectedValue(new Error("login_required")),
    });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your profile/i,
    );
  });
});

describe("the welcome line", () => {
  it("never shows the email when no name is saved yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/chat/messages")
            ? Response.json({ messages: [] })
            : Response.json({ ...profile, firstName: null }),
        ),
      ),
    );
    signedIn();
    render(<App />);

    await screen.findByText(/time zone/);
    expect(
      screen.getByRole("heading", { name: "Welcome!" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mike@example\.com/)).not.toBeInTheDocument();
  });

  it("switches to the new name once a name card is saved", async () => {
    const card = {
      kind: "profile",
      toolCallId: "call-1",
      status: "pending",
      firstName: "Mike",
    };
    let saved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        if (url.endsWith("/me")) {
          return Promise.resolve(
            Response.json({ ...profile, firstName: saved ? "Mike" : null }),
          );
        }
        if (url.endsWith("/chat/messages")) {
          return Promise.resolve(
            Response.json({
              messages: [
                {
                  id: "1c6f7d2f-9b4a-4c1f-8b68-3a2e5d4c3b21",
                  role: "assistant",
                  text: "Nice to meet you.",
                  createdAt: "2026-10-21T15:58:48.000Z",
                  proposals: [card],
                },
              ],
            }),
          );
        }
        if (url.endsWith("/proposals/call-1/save") && init.method === "POST") {
          saved = true;
          return Promise.resolve(Response.json({ status: "saved" }));
        }
        throw new Error(`unexpected request to ${url}`);
      }),
    );
    signedIn();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome, Mike!" }),
    ).toBeInTheDocument();
  });
});

describe("switching views", () => {
  it("shows the day view, then the chat again, keeping the chat mounted", async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
      if (url.endsWith("/me")) return Promise.resolve(Response.json(profile));
      if (url.endsWith("/chat/messages")) {
        return Promise.resolve(Response.json({ messages: [] }));
      }
      if (url.includes("/days/") && init.method === undefined) {
        const date = url.split("/days/")[1];
        return Promise.resolve(Response.json({ date, entries: [] }));
      }
      throw new Error(`unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    signedIn();
    render(<App />);

    const chat = await screen.findByRole("region", {
      name: "Chat with your coach",
    });
    expect(chat).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "My day" }));
    expect(await screen.findByText(/Tell the coach how it went/)).toBeVisible();
    expect(chat).not.toBeVisible();
    expect(screen.getByRole("button", { name: "My day" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(chat).toBeVisible();
  });
});
