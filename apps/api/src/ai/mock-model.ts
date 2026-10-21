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

/** A scripted reply: some text, then either a clean finish or an error. */
export interface MockScript {
  /** Text the model streams, split into a few chunks. */
  text?: string;
  /** Fail after streaming `text`, as a dropped connection would. */
  failMidStream?: boolean;
  /** Fail before streaming anything. */
  failAtStart?: boolean;
}

function streamParts(script: MockScript): LanguageModelV4StreamPart[] {
  const text = script.text ?? MOCK_REPLY;
  const words = text.split(/(?<= )/);
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    ...words.map((delta): LanguageModelV4StreamPart => ({
      type: "text-delta",
      id: "text-1",
      delta,
    })),
  ];
  if (script.failMidStream) {
    parts.push({ type: "error", error: new Error("connection dropped") });
    return parts;
  }
  parts.push(
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  );
  return parts;
}

/**
 * A language model for tests that never touches the network. By default it
 * replies with MOCK_REPLY; pass a script to stream other text or to fail.
 */
export function createMockModel(script: MockScript = {}) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: script.text ?? MOCK_REPLY }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
    doStream: () => {
      if (script.failAtStart) {
        return Promise.reject(new Error("model unavailable"));
      }
      return Promise.resolve({
        stream: simulateReadableStream({ chunks: streamParts(script) }),
      });
    },
  });
}

export type MockModel = ReturnType<typeof createMockModel>;
