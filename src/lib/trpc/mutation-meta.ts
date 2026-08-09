/**
 * The per-mutation feedback contract.
 *
 * Declared as a module augmentation so `meta` is checked rather than being a
 * bag of strings: a typo in `successMessage` would otherwise compile happily
 * and produce a mutation that silently says nothing, which is the exact bug
 * the toast work exists to remove.
 */
declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      /**
       * Suppresses the global "could not load" toast.
       *
       * For screens that already render the failure themselves — a review
       * queue that says "not your queue" rather than showing nothing is
       * handling its own error, and does not want it repeated in the corner.
       */
      silenceError?: boolean;
    };
    mutationMeta: {
      /**
       * Shown when the mutation succeeds. Write what happened in the words
       * somebody would use — "Offer sent", not "Success".
       *
       * Omit it for mutations whose result is obvious on screen. A row that
       * visibly disappears does not also need telling you it disappeared.
       */
      successMessage?: string;
      /**
       * Suppresses the global error toast.
       *
       * For forms that already print the failure next to the field that caused
       * it. Saying the same thing twice in two places reads as two problems.
       */
      silenceError?: boolean;
    };
  }
}

export {};
