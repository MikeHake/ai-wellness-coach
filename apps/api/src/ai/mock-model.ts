import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type LanguageModelV4StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 6, text: 6, reasoning: undefined },
};

/** The reply the default mock model gives. */
export const MOCK_REPLY = "Hello from the test coach.";

/** A tool call the mock model makes. */
export interface MockToolCall {
  toolName: string;
  input: unknown;
  /** Defaults to a fresh id, as a real model gives. */
  toolCallId?: string;
}

/**
 * A scripted reply: some text, then either a clean finish or an error.
 * A step with tool calls finishes with "tool-calls", so the SDK runs the
 * tools and calls the model again.
 */
export interface MockScript {
  /** Text the model streams, split into a few chunks. Steps with tool calls default to none. */
  text?: string;
  toolCalls?: MockToolCall[];
  /** Fail after streaming `text`, as a dropped connection would. */
  failMidStream?: boolean;
  /** Fail before streaming anything. */
  failAtStart?: boolean;
}

function streamParts(script: MockScript): LanguageModelV4StreamPart[] {
  const toolCalls = script.toolCalls ?? [];
  const text = script.text ?? (toolCalls.length > 0 ? "" : MOCK_REPLY);
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
  ];
  if (text !== "") {
    parts.push(
      { type: "text-start", id: "text-1" },
      ...text.split(/(?<= )/).map((delta): LanguageModelV4StreamPart => ({
        type: "text-delta",
        id: "text-1",
        delta,
      })),
    );
  }
  if (script.failMidStream) {
    parts.push({ type: "error", error: new Error("connection dropped") });
    return parts;
  }
  if (text !== "") parts.push({ type: "text-end", id: "text-1" });
  for (const call of toolCalls) {
    parts.push({
      type: "tool-call",
      toolCallId: call.toolCallId ?? crypto.randomUUID(),
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    });
  }
  const reason = toolCalls.length > 0 ? "tool-calls" : "stop";
  parts.push({
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage,
  });
  return parts;
}

/**
 * A language model for tests that never touches the network. By default it
 * replies with MOCK_REPLY; pass a script to stream other text or to fail.
 * Pass a list of scripts to script each step of a tool-calling turn: the
 * first model call uses the first, and so on, repeating the last.
 */
export function createMockModel(scripts: MockScript | MockScript[] = {}) {
  const steps = Array.isArray(scripts) ? scripts : [scripts];
  let calls = 0;
  const next = () => {
    const step = steps[Math.min(calls, steps.length - 1)] ?? {};
    calls += 1;
    return step;
  };
  const script = steps[0] ?? {};
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: script.text ?? MOCK_REPLY }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
    doStream: () => {
      const step = next();
      if (step.failAtStart) {
        return Promise.reject(new Error("model unavailable"));
      }
      return Promise.resolve({
        stream: simulateReadableStream({ chunks: streamParts(step) }),
      });
    },
  });
}

export type MockModel = ReturnType<typeof createMockModel>;
