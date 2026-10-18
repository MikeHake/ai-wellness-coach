import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthStatus } from "./HealthStatus.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HealthStatus", () => {
  it("shows a connected message when the API is healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status: "ok" })),
    );

    render(<HealthStatus />);

    expect(
      await screen.findByText(/connected to the api/i),
    ).toBeInTheDocument();
  });

  it("shows a friendly message when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    render(<HealthStatus />);

    expect(await screen.findByText(/can't reach the api/i)).toBeInTheDocument();
  });

  it("shows the friendly message when the API answers with an error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Bad gateway</html>", { status: 502 }),
        ),
    );

    render(<HealthStatus />);

    expect(await screen.findByText(/can't reach the api/i)).toBeInTheDocument();
  });

  it("shows the friendly message when the response has an unexpected shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status: "down" })),
    );

    render(<HealthStatus />);

    expect(await screen.findByText(/can't reach the api/i)).toBeInTheDocument();
  });

  it("calls the configured API URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<HealthStatus />);
    await screen.findByText(/connected to the api/i);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/health",
      expect.anything(),
    );
  });
});
