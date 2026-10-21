import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = {
  HYPERDRIVE: { connectionString: "postgresql://user:pass@localhost:5432/db" },
  NODE_ENV: "production",
  CORS_ORIGIN: "https://ai-wellness-coach.pages.dev",
  CORS_PREVIEW_HOST_SUFFIX: ".ai-wellness-coach.pages.dev",
  AUTH0_DOMAIN: "tenant.us.auth0.com",
  AUTH0_AUDIENCE: "https://api.test",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
};
const ctx = { waitUntil: vi.fn() };

// The worker keeps state per isolate, so load a fresh copy for each test.
async function loadWorker() {
  vi.resetModules();
  return (await import("./worker.js")).default;
}

beforeEach(() => {
  ctx.waitUntil.mockClear();
});

describe("worker", () => {
  it("serves /health using settings from the bindings", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://api.test/health"),
      bindings,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("closes its database client after each request", async () => {
    const worker = await loadWorker();
    await worker.fetch(new Request("https://api.test/health"), bindings, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });

  it("allows the production and preview origins and refuses others", async () => {
    const worker = await loadWorker();
    const allowOrigin = async (origin: string) =>
      (
        await worker.fetch(
          new Request("https://api.test/health", {
            headers: { Origin: origin },
          }),
          bindings,
          ctx,
        )
      ).headers.get("access-control-allow-origin");

    expect(await allowOrigin("https://ai-wellness-coach.pages.dev")).toBe(
      "https://ai-wellness-coach.pages.dev",
    );
    expect(
      await allowOrigin("https://5-deploy.ai-wellness-coach.pages.dev"),
    ).toBe("https://5-deploy.ai-wellness-coach.pages.dev");
    expect(await allowOrigin("https://evil.com")).toBeNull();
  });

  it("requires a token for /me", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://api.test/me"),
      bindings,
      ctx,
    );

    expect(res.status).toBe(401);
  });

  it("fails loudly when a required setting is missing", async () => {
    const worker = await loadWorker();
    const incomplete = Object.fromEntries(
      Object.entries(bindings).filter(([name]) => name !== "AUTH0_AUDIENCE"),
    ) as typeof bindings;

    await expect(
      worker.fetch(new Request("https://api.test/health"), incomplete, ctx),
    ).rejects.toThrow(/AUTH0_AUDIENCE/);
  });

  it("fails loudly when the Anthropic key secret is missing", async () => {
    const worker = await loadWorker();
    const incomplete = Object.fromEntries(
      Object.entries(bindings).filter(([name]) => name !== "ANTHROPIC_API_KEY"),
    ) as typeof bindings;

    await expect(
      worker.fetch(new Request("https://api.test/health"), incomplete, ctx),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("takes the database URL from the Hyperdrive binding, not from vars", async () => {
    const worker = await loadWorker();
    const noHyperdrive = {
      ...bindings,
      HYPERDRIVE: { connectionString: "not-a-postgres-url" },
    };

    await expect(
      worker.fetch(new Request("https://api.test/health"), noHyperdrive, ctx),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("closes the database only after background work, such as saving a reply, settles", async () => {
    const order: string[] = [];
    let finishWork!: () => void;
    vi.resetModules();
    vi.doMock("./db/client.js", () => ({
      createDb: () => ({
        db: {},
        close: () => {
          order.push("database closed");
          return Promise.resolve();
        },
      }),
    }));
    vi.doMock("./app.js", () => ({
      createApp: ({
        background,
      }: {
        background: (work: Promise<unknown>) => void;
      }) => ({
        fetch: () => {
          background(
            new Promise<void>((resolve) => {
              finishWork = resolve;
            }).then(() => order.push("reply saved")),
          );
          return Promise.resolve(new Response("streaming"));
        },
      }),
    }));
    const worker = (await import("./worker.js")).default;

    await worker.fetch(new Request("https://api.test/chat"), bindings, ctx);
    const kept = ctx.waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
    await Promise.resolve();
    expect(order).toEqual([]);

    finishWork();
    await kept;
    expect(order).toEqual(["reply saved", "database closed"]);
    vi.doUnmock("./db/client.js");
    vi.doUnmock("./app.js");
  });
});
