import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Upstash-backed sliding-window rate limiter.
 * Falls back to a permissive no-op in local dev when Upstash env vars are
 * absent, so the app runs without external services. Production deploys must
 * set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 */
type Limiter = {
  limit: (identifier: string) => Promise<{ success: boolean; remaining: number }>;
};

function buildLimiter(requests: number, windowSeconds: number): Limiter {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(requests, `${windowSeconds} s`),
      prefix: "raceops:rl",
    });
  }
  return {
    async limit() {
      return { success: true, remaining: requests };
    },
  };
}

/** AI endpoints are cost-sensitive: tight per-user limit. */
export const aiRateLimiter = buildLimiter(10, 60);

/** General public API limit per IP. */
export const apiRateLimiter = buildLimiter(120, 60);
