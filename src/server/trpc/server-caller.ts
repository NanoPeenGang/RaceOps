import { headers } from "next/headers";
import { createCaller } from "@/server/trpc/root";
import { createTRPCContext } from "@/server/trpc/trpc";

/**
 * A tRPC caller for React Server Components.
 *
 * Landing pages are server-rendered so they can be shared and indexed — which
 * needs the data before the HTML is sent, not after a client fetch. This runs
 * the procedures in-process against the same context (auth included) rather
 * than making an HTTP round trip back to our own API.
 */
export async function serverApi() {
  return createCaller(
    await createTRPCContext({ headers: await headers() }),
  );
}
