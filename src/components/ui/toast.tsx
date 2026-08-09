"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  DISMISS_AFTER_MS,
  MAX_VISIBLE_TOASTS,
  trimToasts,
  type ToastTone,
} from "@/lib/feedback";

/**
 * Telling somebody their action worked.
 *
 * The gap this fills: every mutation in the app showed a busy state and then
 * simply stopped. Save a pit stop plan, approve an application, record a
 * payroll run — the screen looked identical to a second before the click, so
 * people clicked again. A spinner that disappears is not confirmation.
 *
 * Deliberately not a general notification system. A toast is for the thing you
 * just did, it goes away on its own, and nothing that matters lives only here
 * — anything worth keeping is in the notification bell or on the page itself.
 *
 * The live region is the other half of the job. Async results were previously
 * invisible to a screen reader: it went quiet and stayed quiet. Errors are
 * `assertive` and confirmations `polite`, so a failure interrupts and a
 * success waits its turn.
 */

export type { ToastTone };

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  /** One action, e.g. Undo. More than one and it wants to be a dialog. */
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) =>
        trimToasts(current, { ...input, id }, MAX_VISIBLE_TOASTS),
      );

      const after = DISMISS_AFTER_MS[input.tone];
      if (after !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), after),
        );
      }
    },
    [dismiss],
  );

  // Captured by the query client at first render, so it has to be stable.
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  const pending = timers.current;
  useEffect(() => {
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [pending]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    /*
     * Loud rather than a no-op fallback. A toast that silently goes nowhere
     * reproduces the exact bug this component exists to fix, and it would only
     * be noticed by somebody wondering why their save seemed not to happen.
     */
    throw new Error("useToast must be used inside a ToastProvider.");
  }
  return context;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      // Above the offline indicator, which owns the very bottom of the screen.
      className="pointer-events-none fixed inset-x-0 bottom-14 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-16 sm:items-end print:hidden"
    >
      {/*
        Two regions, not one. A failure should interrupt whatever a screen
        reader is saying; a confirmation should not.
      */}
      <div aria-live="assertive" className="contents">
        {toasts
          .filter((entry) => entry.tone === "error")
          .map((entry) => (
            <ToastCard key={entry.id} toast={entry} onDismiss={onDismiss} />
          ))}
      </div>
      <div aria-live="polite" className="contents">
        {toasts
          .filter((entry) => entry.tone !== "error")
          .map((entry) => (
            <ToastCard key={entry.id} toast={entry} onDismiss={onDismiss} />
          ))}
      </div>
    </div>
  );
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-brand-black/15 bg-white",
  info: "border-brand-black/15 bg-white",
  error: "border-brand-red/40 bg-white",
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg",
        TONE_STYLES[toast.tone],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          toast.tone === "error" ? "bg-brand-red" : "bg-brand-black/40",
        )}
      />
      <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          className="shrink-0 text-sm font-semibold text-brand-red hover:underline"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 px-1 text-brand-black/40 hover:text-brand-black"
        onClick={() => onDismiss(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}
