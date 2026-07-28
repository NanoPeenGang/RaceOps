import { describe, expect, it } from "vitest";
import {
  AI_MODELS,
  TASK_MAX_TOKENS,
  TASK_MODEL,
  type AiTask,
} from "@/server/services/ai/models";

describe("AI model routing (spec Section 9)", () => {
  it("uses the exact model strings from the spec", () => {
    expect(AI_MODELS.opus).toBe("claude-opus-4-8");
    expect(AI_MODELS.sonnet).toBe("claude-sonnet-5");
  });

  it("routes high-value reasoning tasks to Opus", () => {
    const opusTasks: AiTask[] = [
      "sponsor_fit",
      "resume_generation",
      "search_parsing",
    ];
    for (const task of opusTasks) {
      expect(TASK_MODEL[task]).toBe(AI_MODELS.opus);
    }
  });

  it("routes high-volume tasks to Sonnet", () => {
    const sonnetTasks: AiTask[] = [
      "moderation",
      "auto_tagging",
      "chat_summarization",
    ];
    for (const task of sonnetTasks) {
      expect(TASK_MODEL[task]).toBe(AI_MODELS.sonnet);
    }
  });

  it("defines a max-token budget for every task", () => {
    for (const task of Object.keys(TASK_MODEL) as AiTask[]) {
      expect(TASK_MAX_TOKENS[task]).toBeGreaterThan(0);
    }
  });
});
