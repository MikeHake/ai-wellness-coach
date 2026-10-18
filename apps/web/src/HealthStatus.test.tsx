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
});
