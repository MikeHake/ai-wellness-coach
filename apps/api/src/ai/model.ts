import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** The one model used for chat and parsing. Change it here and nowhere else. */
export const CLAUDE_MODEL_ID = "claude-haiku-5-5";

/** The real Claude model, authenticated with the app's API key. */
export function createModel(apiKey: string): LanguageModel {
  return createAnthropic({ apiKey })(CLAUDE_MODEL_ID);
}
