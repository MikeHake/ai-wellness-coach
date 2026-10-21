import { generateText } from "ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../test-support.js";
import { createMockModel } from "./mock-model.js";
import { CLAUDE_MODEL_ID, createModel } from "./model.js";

describe("createModel", () => {
  it("builds the Claude model named in one place, without calling the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const model = createModel("sk-ant-test-key");

    expect(CLAUDE_MODEL_ID).toBe("claude-haiku-5-5");
    expect(model).toMatchObject({ modelId: CLAUDE_MODEL_ID });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("mock model", () => {
  it("replies with canned text and never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const model = createMockModel();

    const result = await generateText({ model, prompt: "Hi coach" });

    expect(result.text).toBe("Hello from the test coach.");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("createTestApp", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it("supplies the mock model, which nothing has called yet", () => {
    expect(t.model.doGenerateCalls).toHaveLength(0);
    expect(t.model.doStreamCalls).toHaveLength(0);
  });
});
