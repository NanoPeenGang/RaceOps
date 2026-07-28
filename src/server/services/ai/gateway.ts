import Anthropic from "@anthropic-ai/sdk";
import { TASK_MAX_TOKENS, TASK_MODEL, type AiTask } from "./models";

/**
 * Single internal gateway for every Claude API call (spec Section 5/9).
 * Centralizes model routing, logging, and fallback handling so feature code
 * never talks to the Anthropic API directly — and never from the client.
 */

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured — AI features are unavailable.",
    );
  }
  _client ??= new Anthropic();
  return _client;
}

export interface AiCallOptions {
  task: AiTask;
  system?: string;
  prompt: string;
  /** Correlation id for logging/cost attribution (e.g. user id). */
  requesterId: string;
}

export interface AiCallResult {
  task: AiTask;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function runAiTask(options: AiCallOptions): Promise<AiCallResult> {
  const model = TASK_MODEL[options.task];
  const client = getClient();
  const startedAt = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: TASK_MAX_TOKENS[options.task],
    ...(options.system ? { system: options.system } : {}),
    messages: [{ role: "user", content: options.prompt }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Structured log line for cost tracking (PostHog/Sentry pick this up later).
  console.info(
    JSON.stringify({
      event: "ai_call",
      task: options.task,
      model,
      requesterId: options.requesterId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      stopReason: response.stop_reason,
    }),
  );

  return {
    task: options.task,
    model,
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
