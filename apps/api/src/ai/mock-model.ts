import { MockLanguageModelV4 } from "ai/test";

/**
 * A language model for tests that replies with fixed text and never touches
 * the network. Pass `doGenerate` or `doStream` to script other behavior.
 */
export function createMockModel(
  options: ConstructorParameters<typeof MockLanguageModelV4>[0] = {},
) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "Hello from the test coach." }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 6, text: 6, reasoning: undefined },
      },
      warnings: [],
    },
    ...options,
  });
}
