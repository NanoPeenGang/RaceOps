"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useDebounced } from "@/lib/use-debounced";
import {
  flatten,
  parseRecents,
  pushRecent,
  rankCommands,
  recentCommands,
  RECENTS_KEY,
  sectionsOf,
  type Command,
  type CommandIcon,
  type MatchRange,
} from "@/lib/command-palette";
import { buildCommands, EMPTY_CONTEXTS } from "@/lib/command-set";

/* -------------------------------------------------------------------------
 * Opening it from anywhere
 * ---------------------------------------------------------------------- */

interface CommandPaletteValue {
  open: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteValue | null>(null);

/**
 * The hook the header's search box uses.
 *
 * Returns a no-op rather than throwing when the provider is absent. A button
 * that quietly does nothing is a bad day; a page that white-screens because a
 * palette was not mounted is a worse one, and this is chrome, not a feature
 * anything depends on.
 */
export function useCommandPalette(): CommandPaletteValue {
  return useContext(CommandPaletteContext) ?? { open: () => {} };
}

/* -------------------------------------------------------------------------
 * Icons
 * ---------------------------------------------------------------------- */

const ICON_PATHS: Record<CommandIcon, React.ReactNode> = {
  home: <path d="M3 10.2 12 3.2l9 7v9.1a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.3z" />,
  users: (
    <>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3.2" />
    </>
  ),
  inbox: (
    <>
      <path d="M5.6 4.5h12.8l2.1 8.6v4.4a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17.5v-4.4z" />
      <path d="M3.5 13.1h4.2l1.2 2.2h6.2l1.2-2.2h4.2" />
    </>
  ),
  money: (
    <>
      <path d="M12 3.2v17.6" />
      <path d="M16.3 7.3a3.5 3.5 0 0 0-3.3-2h-1.7a3.05 3.05 0 0 0 0 6.1h1.4a3.05 3.05 0 0 1 0 6.1h-1.8a3.5 3.5 0 0 1-3.3-2.2" />
    </>
  ),
  wrench: <path d="M15.6 3.6a4.6 4.6 0 0 0-5.3 6.2l-6.4 6.4a2.05 2.05 0 0 0 2.9 2.9l6.4-6.4a4.6 4.6 0 0 0 6.2-5.3l-2.9 2.9-3-.8-.8-3z" />,
  flag: (
    <>
      <path d="M5.5 21V3.6" />
      <path d="M5.5 4.5c4-1.6 7 1.6 11 0v8.7c-4 1.6-7-1.6-11 0z" />
    </>
  ),
  message: <path d="M20.5 11.8c0 3.9-3.8 7-8.5 7-1 0-2-.1-2.9-.4L4 20.2l1.4-4.1a6.7 6.7 0 0 1-1.9-4.3c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z" />,
  settings: (
    <>
      <path d="M4 7.2h8.6M17.4 7.2H20M4 16.8h2.6M11.4 16.8H20" />
      <circle cx="15" cy="7.2" r="2.4" />
      <circle cx="9" cy="16.8" r="2.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.2" width="17" height="15.3" rx="2" />
      <path d="M3.5 10.2h17M8 3v4.2M16 3v4.2" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="6.6" />
      <path d="m20 20-4.7-4.7" />
    </>
  ),
  scan: (
    <>
      <path d="M3.5 8.2V5.6a2.1 2.1 0 0 1 2.1-2.1h2.6M15.8 3.5h2.6a2.1 2.1 0 0 1 2.1 2.1v2.6M20.5 15.8v2.6a2.1 2.1 0 0 1-2.1 2.1h-2.6M8.2 20.5H5.6a2.1 2.1 0 0 1-2.1-2.1v-2.6" />
      <path d="M3.5 12h17" />
    </>
  ),
  box: (
    <>
      <path d="M20.5 8.4v7.2L12 20.1 3.5 15.6V8.4L12 3.9z" />
      <path d="m3.5 8.4 8.5 4.5 8.5-4.5M12 12.9v7.2" />
    </>
  ),
  ticket: (
    <>
      <path d="M3.5 8.4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v1.4a2.2 2.2 0 0 0 0 4.4v1.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-1.4a2.2 2.2 0 0 0 0-4.4z" />
      <path d="M14.2 6.4v11.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
};

function Icon({ name, className }: { name: CommandIcon; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/** The matched characters, marked. Everything else renders untouched. */
function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={index} className="bg-transparent font-semibold text-brand-red">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/* -------------------------------------------------------------------------
 * The palette
 * ---------------------------------------------------------------------- */

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);

  /*
   * The shortcut is registered here rather than inside the dialog so that it
   * works when the dialog is closed, which is the only time anybody presses
   * it. Both modifiers, because half the paddock is on Windows.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {open && <CommandPaletteDialog onClose={() => setOpen(false)} />}
    </CommandPaletteContext.Provider>
  );
}

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { isSignedIn } = useUser();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  /*
   * Where focus goes on the way out. Closing a dialog and dropping focus on
   * the body strands anybody navigating by keyboard at the top of the
   * document, which is exactly the person most likely to have opened this.
   */
  const returnFocusTo = useRef<Element | null>(null);
  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const target = returnFocusTo.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, []);

  // The page behind must not scroll under the dialog.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    try {
      setRecents(parseRecents(window.localStorage.getItem(RECENTS_KEY)));
    } catch {
      // Private mode, blocked storage, a browser with site data off. Recents
      // are a nicety; the palette works without them.
    }
  }, []);

  const contexts = api.command.contexts.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
    meta: { silenceError: true },
    staleTime: 60_000,
  });

  const settled = useDebounced(query);
  const remote = api.command.search.useQuery(
    { query: settled.trim() },
    { enabled: settled.trim().length >= 2, meta: { silenceError: true }, staleTime: 30_000 },
  );

  const commands = useMemo(
    () => buildCommands(contexts.data ?? EMPTY_CONTEXTS),
    [contexts.data],
  );

  /*
   * Remote hits are folded in as ordinary commands so ranking treats them the
   * same as everything else. They are appended rather than prepended: a page
   * you can already reach beats a search result with the same name.
   */
  const withResults = useMemo(() => {
    if (!remote.data) return commands;
    const found: Command[] = [
      ...remote.data.events.map((event) => ({
        id: `found:event:${event.id}`,
        title: event.name,
        hint: event.hint,
        href: `/events/${event.id}`,
        group: "result" as const,
        icon: "calendar" as const,
      })),
      ...remote.data.series.map((entry) => ({
        id: `found:series:${entry.slug}`,
        title: entry.name,
        hint: entry.hint,
        href: `/series/${entry.slug}`,
        group: "result" as const,
        icon: "flag" as const,
      })),
      ...remote.data.teams.map((team) => ({
        id: `found:team:${team.slug}`,
        title: team.name,
        hint: team.hint,
        href: `/teams/${team.slug}`,
        group: "result" as const,
        icon: "wrench" as const,
      })),
      ...remote.data.tracks.map((track) => ({
        id: `found:track:${track.slug}`,
        title: track.name,
        hint: track.hint,
        href: `/tracks/${track.slug}`,
        group: "result" as const,
        icon: "flag" as const,
      })),
    ];
    // A team you are in is already in `commands`; the same team coming back
    // from search would render twice under two headings.
    const seen = new Set(commands.map((command) => command.href));
    return [...commands, ...found.filter((command) => !seen.has(command.href))];
  }, [commands, remote.data]);

  const sections = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      const recent = recentCommands(recents, withResults);
      const recentIds = new Set(recent.map((command) => command.id));
      const rest = withResults.filter(
        (command) => command.group === "context" && !recentIds.has(command.id),
      );
      return sectionsOf(rankCommands("", [...recent, ...rest], { perGroup: 8, limit: 16 }));
    }
    return sectionsOf(rankCommands(trimmed, withResults));
  }, [query, recents, withResults]);

  const rows = useMemo(() => flatten(sections), [sections]);

  // Any change to the list puts the cursor back on the best row. Leaving it
  // where it was means the highlight lands on whatever slid into that slot.
  useEffect(() => setActive(0), [query, rows.length]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      try {
        const next = pushRecent(recents, command.id);
        window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        // See above: storage is optional.
      }
      onClose();
      router.push(command.href);
    },
    [onClose, recents, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, rows.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(rows[active]?.command);
    }
  };

  let rowIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-center overflow-y-auto bg-brand-black/40 p-4 pt-[10vh] backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search RaceOps"
        className="h-fit w-full max-w-[640px] overflow-hidden rounded-xl border border-brand-black/10 bg-surface shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-brand-black/10 px-4 py-3.5">
          <Icon name="search" className="h-5 w-5 shrink-0 text-brand-black/50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, teams, events and tracks…"
            aria-label="Search RaceOps"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={rows[active] ? `${listboxId}-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-base text-brand-black outline-none placeholder:text-brand-black/40"
          />
          <kbd className="hidden shrink-0 rounded border border-brand-black/10 bg-brand-black/5 px-1.5 py-0.5 text-[11px] font-semibold text-brand-black/50 sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain py-2">
          <div role="listbox" id={listboxId} aria-label="Results">
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-brand-black/60">
                {contexts.isLoading || remote.isLoading
                  ? "Searching…"
                  : `Nothing matches “${query.trim()}”.`}
              </p>
            ) : (
              sections.map((section) => (
                <div key={section.group}>
                  <div className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-black/50">
                    {section.label}
                  </div>
                  {section.commands.map((ranked) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    const isActive = index === active;
                    return (
                      <div
                        key={ranked.command.id}
                        id={`${listboxId}-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(index)}
                        onClick={() => run(ranked.command)}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-3 px-4 py-2",
                          isActive && "bg-brand-black/5",
                        )}
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-red"
                          />
                        )}
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            isActive
                              ? "bg-brand-red text-on-red"
                              : "bg-brand-black/10 text-brand-black/60",
                          )}
                        >
                          <Icon name={ranked.command.icon ?? "grid"} className="h-[15px] w-[15px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-sm text-brand-black",
                              isActive && "font-semibold",
                            )}
                          >
                            <Highlight text={ranked.command.title} ranges={ranked.ranges} />
                          </span>
                          {(ranked.command.trail || ranked.command.hint) && (
                            <span className="mt-0.5 block truncate text-xs text-brand-black/60">
                              {ranked.command.trail?.join(" › ")}
                              {ranked.command.trail && ranked.command.hint ? " · " : ""}
                              {ranked.command.hint}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 border-t border-brand-black/10 bg-brand-black/5 px-4 py-2 text-[11px] text-brand-black/60">
          <span>↵ open</span>
          <span>↑↓ move</span>
          <span className="ml-auto hidden sm:block">
            {isSignedIn ? "Everything you can reach" : "Sign in to jump into your teams"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The header's search box. Looks like an input; opens the palette. */
export function CommandTrigger({ className }: { className?: string }) {
  const { open } = useCommandPalette();
  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-brand-black/10 bg-surface px-3 text-left transition-colors hover:border-brand-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red",
        className,
      )}
    >
      <Icon name="search" className="h-4 w-4 shrink-0 text-brand-black/50" />
      <span className="flex-1 truncate text-sm text-brand-black/50">Search or jump to…</span>
      <kbd className="hidden shrink-0 rounded border border-brand-black/10 bg-brand-black/5 px-1.5 py-0.5 text-[11px] font-semibold text-brand-black/50 lg:block">
        ⌘K
      </kbd>
    </button>
  );
}
