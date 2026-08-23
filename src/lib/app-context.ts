/**
 * What you are currently operating.
 *
 * The app is organised around nouns — a directory of events, series, teams and
 * tracks — but nobody works that way. People work inside a thing: a team for a
 * season, a championship they help run, a race weekend they are standing at.
 * That thing never appeared in the navigation, so every console rebuilt its
 * own tab strip inside the page to say where you were.
 *
 * This file is the first half of fixing that: reading the current context out
 * of the URL, and working out where a switch should land. It is pure, and it
 * knows nothing about React or about who you are — the component pairs what is
 * here with the contexts the server says you belong to.
 */

import { EVENT_CONSOLE_TABS, SERIES_CONSOLE_TABS, TEAM_CONSOLE_TABS, type ConsoleTab } from "@/lib/nav";

export type ContextKind = "personal" | "team" | "series" | "organization" | "event";

export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  personal: "You",
  team: "Team",
  series: "Series",
  organization: "Organization",
  event: "Race weekend",
};

export interface RouteContext {
  kind: ContextKind;
  /** Slug for a team, series or organization; the id for an event. */
  key: string | null;
  /** Whether the URL is inside that thing's management console. */
  inConsole: boolean;
  /** The `?tab=` value, when there is one. */
  tab: string | null;
  /** A page beside the console rather than inside it: "scan", "gate", … */
  segment: string | null;
}

const PERSONAL: RouteContext = {
  kind: "personal",
  key: null,
  inConsole: false,
  tab: null,
  segment: null,
};

/** The console tabs belonging to each kind, for deciding what survives a switch. */
export const TABS_BY_KIND: Partial<Record<ContextKind, readonly ConsoleTab[]>> = {
  team: TEAM_CONSOLE_TABS,
  series: SERIES_CONSOLE_TABS,
  event: EVENT_CONSOLE_TABS,
};

/**
 * The base path of a context, from which every page inside it hangs.
 *
 * Events are addressed by id and everything else by slug, which is a wart of
 * the routing rather than a distinction worth preserving anywhere else.
 */
export function basePathOf(kind: ContextKind, key: string): string {
  switch (kind) {
    case "team":
      return `/teams/${key}`;
    case "series":
      return `/series/${key}`;
    case "organization":
      return `/organizations/${key}`;
    case "event":
      return `/events/${key}`;
    default:
      return "/home";
  }
}

const SECTION_KINDS: Record<string, ContextKind> = {
  teams: "team",
  series: "series",
  organizations: "organization",
  events: "event",
};

/**
 * Read the context out of a pathname.
 *
 * A bare directory — `/teams`, `/events` — is *not* a context: you are
 * browsing, not operating, and the switcher must not claim otherwise. Only a
 * path that names one thing counts.
 */
export function resolveRoute(pathname: string, tab: string | null = null): RouteContext {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return PERSONAL;

  const kind = SECTION_KINDS[parts[0]!];
  if (!kind) return PERSONAL;

  const key = parts[1]!;
  const rest = parts.slice(2);
  const inConsole = rest[0] === "manage";

  return {
    kind,
    key,
    inConsole,
    // A tab only means anything inside a console; carrying one off a public
    // page would move somebody to a tab they were never looking at.
    tab: inConsole ? tab : null,
    segment: inConsole ? null : (rest[0] ?? null),
  };
}

export interface SwitchTarget {
  kind: ContextKind;
  key: string;
  /** Whether this person may open that context's console. */
  canManage: boolean;
}

/**
 * Where switching context should land.
 *
 * The useful case is staying put: somebody comparing two teams' rosters, or
 * two weekends' entry lists, wants the same page for the other thing rather
 * than being dropped at its front door every time. That only holds when the
 * two consoles are the same shape and the tab exists in both — switching from
 * a team's Garage to a race weekend has no equivalent, so it goes home.
 */
export function switchTo(route: RouteContext, target: SwitchTarget): string {
  const base = basePathOf(target.kind, target.key);
  if (!target.canManage) return base;

  const sameKind = route.kind === target.kind;
  if (sameKind && route.inConsole) {
    const tabs = TABS_BY_KIND[target.kind] ?? [];
    if (route.tab && tabs.some((candidate) => candidate.id === route.tab)) {
      return `${base}/manage?tab=${route.tab}`;
    }
    return `${base}/manage`;
  }

  return base;
}

/* -------------------------------------------------------------------------
 * Matching the route against what you belong to
 * ---------------------------------------------------------------------- */

export interface ContextOption {
  kind: ContextKind;
  key: string;
  name: string;
  /** The role or date shown under the name. */
  detail: string;
  canManage: boolean;
  live?: boolean;
}

/**
 * The context the URL is in, but only if it is one of yours.
 *
 * Looking at a team you are not a member of is browsing, not operating, and
 * the switcher stays out of the way — showing "TEAM · Someone Else's Racing"
 * above a public page would suggest you are somewhere you are not.
 */
export function activeContext(
  route: RouteContext,
  options: ContextOption[],
): ContextOption | null {
  if (route.kind === "personal" || !route.key) return null;
  return (
    options.find((option) => option.kind === route.kind && option.key === route.key) ?? null
  );
}

/** The switcher's menu, grouped and in a fixed order. */
export const CONTEXT_GROUPS: { kinds: ContextKind[]; label: string }[] = [
  { kinds: ["team"], label: "Teams" },
  { kinds: ["series", "organization"], label: "Series and organizations" },
  { kinds: ["event"], label: "Race weekends" },
];

export function groupContexts(
  options: ContextOption[],
): { label: string; options: ContextOption[] }[] {
  const groups: { label: string; options: ContextOption[] }[] = [];
  for (const group of CONTEXT_GROUPS) {
    const matching = options.filter((option) => group.kinds.includes(option.kind));
    if (matching.length === 0) continue;
    // Anything running goes to the top of its group: at a race weekend, the
    // live one is the only one you are looking for.
    groups.push({
      label: group.label,
      options: [...matching].sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live))),
    });
  }
  return groups;
}
