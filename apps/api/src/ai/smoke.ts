// Sends one short prompt to Claude using the key in apps/api/.env, so a bad key
// or model id shows up now instead of in the middle of a feature.
// Run it with: pnpm --filter @ai-wellness-coach/api ai:smoke
import { generateText } from "ai";
import { loadEnv } from "../env.js";
import { CLAUDE_MODEL_ID, createModel } from "./model.js";

const env = loadEnv();
try {
  const result = await generateText({
    model: createModel(env.ANTHROPIC_API_KEY),
    prompt: "Reply with one short, friendly sentence.",
    maxOutputTokens: 60,
  });
  console.log(`Model: ${CLAUDE_MODEL_ID}`);
  console.log(`Reply: ${result.text}`);
  console.log(
    `Tokens: ${String(result.usage.inputTokens)} in, ${String(result.usage.outputTokens)} out`,
  );
} catch (error) {
  console.error("Smoke test failed:", error);
  process.exitCode = 1;
}
