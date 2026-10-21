import {
  type AnthropicProviderOptions,
  createAnthropic,
} from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** The one model used for chat and parsing. Change it here and nowhere else. */
export const CLAUDE_MODEL_ID = "claude-haiku-5-5";

/**
 * Options for every coach call. Haiku 5.5 thinks before answering, and its
 * thinking counts against the output cap. Low effort keeps that short, which
 * suits a chat reply.
 */
export const CLAUDE_PROVIDER_OPTIONS = {
  anthropic: { effort: "low" } satisfies AnthropicProviderOptions,
};

/** The real Claude model, authenticated with the app's API key. */
export function createModel(apiKey: string): LanguageModel {
  return createAnthropic({ apiKey })(CLAUDE_MODEL_ID);
}
