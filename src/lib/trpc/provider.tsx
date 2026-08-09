"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { api } from "@/lib/trpc/client";
import { useToast } from "@/components/ui/toast";
import "@/lib/trpc/mutation-meta";
import { describeFailure } from "@/lib/feedback";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Feedback is wired here rather than at 164 call sites.
 *
 * **Errors are global and unconditional.** A quarter of the app's mutations
 * never rendered their own error, so a permission failure or a clashing name
 * simply did nothing and left somebody clicking. Catching it in one place
 * means no mutation can fail silently again, including ones written later.
 *
 * **Confirmations are opt-in**, through `meta.successMessage`. A global "Saved"
 * on everything would fire on every keystroke-adjacent mutation in the app and
 * train people to ignore the corner of the screen the errors also live in — so
 * a mutation says what it did, in its own words, or says nothing.
 */
export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000 } },
        /*
         * A query that fails renders an empty list, and an empty list is a
         * statement: "there is nothing here". That is a silent lie, and the
         * worst kind — somebody concludes their entries did not save, or that
         * a queue is clear when it is not. Fires only after retries are spent.
         */
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (query.meta?.silenceError) return;
            toast({
              tone: "error",
              message: `Could not load that. ${describeFailure(error)}`,
            });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            /*
             * Skipped where the component is already showing the message
             * inline — a form that prints "that name is taken" under the field
             * should not also throw it into the corner of the screen.
             */
            if (mutation.meta?.silenceError) return;
            toast({ tone: "error", message: describeFailure(error) });
          },
          onSuccess: (_data, _variables, _context, mutation) => {
            const message = mutation.meta?.successMessage;
            if (typeof message === "string") {
              toast({ tone: "success", message });
            }
          },
        }),
      }),
  );
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchLink({
          transformer: superjson,
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
