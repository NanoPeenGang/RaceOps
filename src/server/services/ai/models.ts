/**
 * AI model routing per the RaceOps spec (Section 9).
 *
 * Claude Opus 4.8  — high-value reasoning: sponsor-fit matching, résumé
 *                    generation, natural-language search parsing.
 * Claude Sonnet 5  — high-volume/low-latency: moderation, auto-tagging,
 *                    chat summarization.
 *
 * All model selection lives here so features never hardcode model strings.
 */
export const AI_MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
} as const;

export type AiTask =
  | "sponsor_fit"
  | "resume_generation"
  | "search_parsing"
  | "moderation"
  | "auto_tagging"
  | "chat_summarization";

export const TASK_MODEL: Record<AiTask, (typeof AI_MODELS)[keyof typeof AI_MODELS]> = {
  sponsor_fit: AI_MODELS.opus,
  resume_generation: AI_MODELS.opus,
  search_parsing: AI_MODELS.opus,
  moderation: AI_MODELS.sonnet,
  auto_tagging: AI_MODELS.sonnet,
  chat_summarization: AI_MODELS.sonnet,
};

export const TASK_MAX_TOKENS: Record<AiTask, number> = {
  sponsor_fit: 4096,
  resume_generation: 8192,
  search_parsing: 1024,
  moderation: 512,
  auto_tagging: 512,
  chat_summarization: 2048,
};
