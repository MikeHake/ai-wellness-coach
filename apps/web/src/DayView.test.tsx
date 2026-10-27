import { useAuth0 } from "@auth0/auth0-react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayView } from "./DayView.js";

vi.mock("@auth0/auth0-react", () => ({ useAuth0: vi.fn() }));

const getAccessTokenSilently = vi.fn().mockResolvedValue("test-access-token");

interface Entry {
  id: string;
  text: string;
  createdOn: string;
  createdTime: string;
  events: object[];
}

/** Answers GET /days/:date from a map of date to entries; other days are empty. */
function stubDays(days: Record<string, Entry[]>) {
  const fetchMock = vi.fn((url: string) => {
    const date = url.split("/days/")[1] ?? "";
    return Promise.resolve(Response.json({ date, entries: days[date] ?? [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const requestedDays = (fetchMock: ReturnType<typeof stubDays>) =>
  fetchMock.mock.calls.map(([url]) => url.split("/days/")[1]);

const oatmeal: Entry = {
  id: "e1",
  text: "Oatmeal for breakfast, felt steady",
  createdOn: "2026-10-21",
  createdTime: "08:15",
  events: [
    {
      id: "v1",
      type: "meal",
      summary: "Oatmeal",
      feelScore: 4,
      feelWords: ["steady"],
      tags: ["breakfast"],
      localTime: "08:00",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Noon on Wednesday, October 21, 2026 in Denver. Only Date is faked, so
  // waiting for the page to load still works.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
  vi.mocked(useAuth0).mockReturnValue({
    getAccessTokenSilently,
  } as unknown as ReturnType<typeof useAuth0>);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DayView", () => {
  it("opens on today in the person's time zone", async () => {
    // 03:00 UTC on Oct 22 is still the evening of Oct 21 in Denver.
    vi.setSystemTime(new Date("2026-10-22T03:00:00Z"));
    const fetchMock = stubDays({});
    render(<DayView timeZone="America/Denver" />);

    expect(
      await screen.findByRole("heading", { name: /^Today/ }),
    ).toBeInTheDocument();
    expect(requestedDays(fetchMock)).toEqual(["2026-10-21"]);
  });

  it("shows my words with each event's type, summary and feel", async () => {
    stubDays({ "2026-10-21": [oatmeal] });
    render(<DayView timeZone="America/Denver" />);

    expect(
      await screen.findByText("Oatmeal for breakfast, felt steady"),
    ).toBeInTheDocument();
    expect(screen.getByText("Meal")).toBeInTheDocument();
    expect(screen.getByText("Oatmeal")).toBeInTheDocument();
    expect(screen.getByText("8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Feeling 4 of 5: steady")).toBeInTheDocument();
    expect(screen.getByText("breakfast")).toBeInTheDocument();
    expect(screen.queryByText(/Told the coach/)).not.toBeInTheDocument();
  });

  it("keeps entries in the order the server sends them", async () => {
    stubDays({
      "2026-10-21": [
        { ...oatmeal, id: "e1", text: "First thing", events: [] },
        { ...oatmeal, id: "e2", text: "Second thing", events: [] },
      ],
    });
    render(<DayView timeZone="America/Denver" />);

    await screen.findByText("First thing");
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("First thing");
    expect(items[1]).toHaveTextContent("Second thing");
  });

  it("notes when an entry was told on another day", async () => {
    stubDays({
      "2026-10-20": [
        {
          id: "e2",
          text: "Yesterday I hiked 5 miles",
          createdOn: "2026-10-21",
          createdTime: "09:14",
          events: [],
        },
      ],
    });
    render(<DayView timeZone="America/Denver" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Previous day/ }),
    );

    expect(
      await screen.findByText("Told the coach today at 9:14 AM"),
    ).toBeInTheDocument();
  });

  it("moves to the previous and next days", async () => {
    const fetchMock = stubDays({});
    render(<DayView timeZone="America/Denver" />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Previous day/ }),
    );
    expect(
      await screen.findByRole("heading", { name: /^Yesterday/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Previous day/ }));
    expect(
      await screen.findByRole("heading", { name: /^Mon, Oct 19/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next day/ }));
    await waitFor(() => {
      expect(requestedDays(fetchMock)).toEqual([
        "2026-10-21",
        "2026-10-20",
        "2026-10-19",
        "2026-10-20",
      ]);
    });
  });

  it("can't go past today", async () => {
    stubDays({});
    render(<DayView timeZone="America/Denver" />);

    expect(
      await screen.findByRole("button", { name: /Next day/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Previous day/ }));
    await screen.findByRole("heading", { name: /^Yesterday/ });
    expect(screen.getByRole("button", { name: /Next day/ })).toBeEnabled();
  });

  it("points an empty day to the chat", async () => {
    stubDays({});
    render(<DayView timeZone="America/Denver" />);

    expect(
      await screen.findByText(/Tell the coach how it went/),
    ).toBeInTheDocument();
  });

  it("is read-only: no edit or delete buttons", async () => {
    stubDays({ "2026-10-21": [oatmeal] });
    render(<DayView timeZone="America/Denver" />);

    await screen.findByText("Oatmeal");
    expect(
      screen.queryByRole("button", { name: /edit|delete|add/i }),
    ).toBeNull();
  });

  it("shows a friendly message when the day can't load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "x" }, { status: 500 })),
    );
    render(<DayView timeZone="America/Denver" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load this day/,
    );
  });
});
