import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { runAiTask } from "@/server/services/ai/gateway";
import { aiRateLimiter } from "@/server/services/ratelimit";
import type { AiTask } from "@/server/services/ai/models";

const VALID_TASKS: AiTask[] = [
  "sponsor_fit",
  "resume_generation",
  "search_parsing",
  "moderation",
  "auto_tagging",
  "chat_summarization",
];

const bodySchema = z.object({
  prompt: z.string().min(1).max(20_000),
  system: z.string().max(10_000).optional(),
});

/**
 * The single HTTP surface for AI features. Authenticated + rate limited
 * (cost control). Client components call this — never the Anthropic API.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ task: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await aiRateLimiter.limit(`ai:${userId}`);
  if (!success) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429 },
    );
  }

  const { task } = await params;
  if (!VALID_TASKS.includes(task as AiTask)) {
    return NextResponse.json({ error: "Unknown AI task" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await runAiTask({
      task: task as AiTask,
      prompt: parsed.data.prompt,
      system: parsed.data.system,
      requesterId: userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("AI gateway error:", error);
    return NextResponse.json(
      { error: "AI request failed" },
      { status: 502 },
    );
  }
}
