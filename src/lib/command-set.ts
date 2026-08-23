/**
 * Building the palette's command set from what a person can actually reach.
 *
 * Kept apart from the matching in `command-palette.ts` on purpose: that file
 * answers "what does this query mean", this one answers "what is there". They
 * change for different reasons and break in different ways.
 *
 * Nothing here invents a destination. Every command points at a route that
 * exists, which is why there is no "create an invoice" entry — creating one
 * happens inside a panel and has no address of its own, and an action that
 * silently means "go to the Garage tab and look around" is worse than no
 * action at all.
 */

import {
  ACCOUNT_LINKS,
  ADMIN_LINKS,
  EVENT_CONSOLE_PAGES,
  EVENT_CONSOLE_TABS,
  NAV_LINKS,
  SERIES_CONSOLE_TABS,
  TEAM_CONSOLE_PAGES,
  TEAM_CONSOLE_TABS,
  type ConsoleSubPage,
  type ConsoleTab,
} from "@/lib/nav";
import type { Command, CommandIcon } from "@/lib/command-palette";

/* -------------------------------------------------------------------------
 * What the server tells us
 * ---------------------------------------------------------------------- */

export interface PaletteTeam {
  name: string;
  slug: string;
  /** Shown as the subtitle so two teams with similar names stay apart. */
  role: string;
  /** Console entries are only offered to people the console will let in. */
  canManage: boolean;
}

export interface PaletteSeries {
  name: string;
  slug: string;
  role: string;
  canManage: boolean;
}

export interface PaletteOrganization {
  name: string;
  slug: string;
  role: string;
}

export interface PaletteEvent {
  id: string;
  name: string;
  /** Pre-formatted on the server; this file does no date work. */
  when: string;
  seriesName: string | null;
  live: boolean;
  canManage: boolean;
}

export interface PaletteContexts {
  teams: PaletteTeam[];
  series: PaletteSeries[];
  organizations: PaletteOrganization[];
  events: PaletteEvent[];
  isPlatformStaff: boolean;
}

export const EMPTY_CONTEXTS: PaletteContexts = {
  teams: [],
  series: [],
  organizations: [],
  events: [],
  isPlatformStaff: false,
};

/* -------------------------------------------------------------------------
 * Icons and vocabulary
 * ---------------------------------------------------------------------- */

/*
 * Keyed by label rather than href so that a route move does not silently drop
 * an icon. A missing entry falls back to a neutral one; it is decoration, and
 * decoration must never be the thing that breaks a build.
 */
const NAV_ICONS: Record<string, CommandIcon> = {
  Home: "home",
  Discover: "users",
  Events: "calendar",
  Series: "flag",
  Teams: "users",
  Tracks: "flag",
  Opportunities: "inbox",
  Reports: "doc",
  "Pit Wall": "clock",
  "My passes": "ticket",
  Messages: "message",
  "My organizations": "users",
  "My applications": "inbox",
  "Apply to publish": "doc",
  "Sponsor console": "money",
  "My postings": "inbox",
  Notifications: "inbox",
  Billing: "money",
  "My profile": "users",
  "Access applications": "settings",
};

const TAB_ICONS: Record<string, CommandIcon> = {
  roster: "users",
  hiring: "inbox",
  money: "money",
  garage: "wrench",
  racing: "flag",
  comms: "message",
  settings: "settings",
  weekend: "calendar",
  entries: "ticket",
  paddock: "box",
  control: "flag",
  results: "clock",
  volunteers: "users",
  calendar: "calendar",
  regulations: "doc",
  staff: "users",
};

/*
 * The words people type that are not the words on screen.
 *
 * This is the difference between a palette that answers "payroll" and one
 * that shrugs at it because the tab is called Money. Every entry here came
 * from a real name for the thing rather than a guess at a synonym.
 */
const TAB_KEYWORDS: Record<string, string[]> = {
  roster: ["drivers", "crew", "members", "people", "line-up", "lineup", "seat time"],
  hiring: ["applications", "applicants", "interviews", "offers", "recruiting", "jobs", "seats"],
  money: ["payroll", "pay", "wages", "sponsorship", "sponsors", "budget"],
  garage: ["inventory", "parts", "stock", "invoices", "telemetry", "setups", "services", "cars"],
  racing: ["results", "entries", "championship", "standings"],
  comms: ["chat", "channels", "messages", "paddock"],
  entries: ["registrations", "entry list", "grid"],
  paddock: ["tech", "scrutineering", "credentials", "passes", "garages"],
  control: ["stewards", "flags", "incidents", "penalties", "timing", "race control"],
  volunteers: ["marshals", "shifts", "corner workers", "officials"],
  regulations: ["rules", "rulebook", "regs", "supplementary"],
  staff: ["officials", "roles", "permissions"],
};

function iconFor(map: Record<string, CommandIcon>, key: string): CommandIcon {
  return map[key] ?? "grid";
}

/* -------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------- */

function tabCommands(
  tabs: readonly ConsoleTab[],
  options: { idPrefix: string; basePath: string; trail: string[] },
): Command[] {
  return tabs.map((tab) => ({
    id: `${options.idPrefix}:tab:${tab.id}`,
    title: tab.label,
    trail: options.trail,
    href: `${options.basePath}?tab=${tab.id}`,
    group: "page" as const,
    icon: iconFor(TAB_ICONS, tab.id),
    keywords: TAB_KEYWORDS[tab.id],
  }));
}

function subPageCommands(
  pages: readonly ConsoleSubPage[],
  options: { idPrefix: string; basePath: string; trail: string[]; icon?: CommandIcon },
): Command[] {
  return pages.map((page) => ({
    id: `${options.idPrefix}:page:${page.segment}`,
    title: page.label,
    trail: options.trail,
    href: `${options.basePath}/${page.segment}`,
    group: "page" as const,
    icon: options.icon ?? "grid",
    keywords: page.keywords ? [...page.keywords] : undefined,
  }));
}

/**
 * Every command available to this person, in resting order.
 *
 * Resting order matters: with an empty query the palette shows this list as
 * given, so contexts come before the pages inside them and the global
 * directory comes last. Once somebody types, ranking takes over entirely.
 */
export function buildCommands(contexts: PaletteContexts): Command[] {
  const commands: Command[] = [];

  // --- the things you are part of -----------------------------------------
  for (const team of contexts.teams) {
    const base = `/teams/${team.slug}`;
    commands.push({
      id: `team:${team.slug}`,
      title: team.name,
      hint: team.role,
      href: team.canManage ? `${base}/manage` : base,
      group: "context",
      icon: "wrench",
      keywords: ["team"],
    });
    if (!team.canManage) continue;
    commands.push(
      ...tabCommands(TEAM_CONSOLE_TABS, {
        idPrefix: `team:${team.slug}`,
        basePath: `${base}/manage`,
        trail: [team.name],
      }),
      ...subPageCommands(TEAM_CONSOLE_PAGES, {
        idPrefix: `team:${team.slug}`,
        basePath: base,
        trail: [team.name],
        icon: "scan",
      }),
    );
  }

  for (const series of contexts.series) {
    const base = `/series/${series.slug}`;
    commands.push({
      id: `series:${series.slug}`,
      title: series.name,
      hint: series.role,
      href: series.canManage ? `${base}/manage` : base,
      group: "context",
      icon: "flag",
      keywords: ["series", "championship"],
    });
    commands.push({
      id: `series:${series.slug}:standings`,
      title: "Standings",
      trail: [series.name],
      href: `${base}/standings`,
      group: "page",
      icon: "clock",
      keywords: ["championship", "points", "table"],
    });
    if (!series.canManage) continue;
    commands.push(
      ...tabCommands(SERIES_CONSOLE_TABS, {
        idPrefix: `series:${series.slug}`,
        basePath: `${base}/manage`,
        trail: [series.name],
      }),
    );
  }

  for (const organization of contexts.organizations) {
    commands.push({
      id: `org:${organization.slug}`,
      title: organization.name,
      hint: organization.role,
      href: `/organizations/${organization.slug}`,
      group: "context",
      icon: "users",
      keywords: ["organization", "org", "club"],
    });
  }

  for (const event of contexts.events) {
    const base = `/events/${event.id}`;
    const where = event.seriesName ? `${event.seriesName} · ${event.when}` : event.when;
    commands.push({
      id: `event:${event.id}`,
      title: event.name,
      hint: event.live ? "Running now" : where,
      href: event.canManage ? `${base}/manage` : base,
      group: "context",
      icon: "calendar",
      keywords: ["event", "race", "weekend", "round"],
    });
    if (!event.canManage) continue;
    commands.push(
      ...tabCommands(EVENT_CONSOLE_TABS, {
        idPrefix: `event:${event.id}`,
        basePath: `${base}/manage`,
        trail: [event.name],
      }),
      ...subPageCommands(EVENT_CONSOLE_PAGES, {
        idPrefix: `event:${event.id}`,
        basePath: base,
        trail: [event.name],
        icon: "flag",
      }),
    );
  }

  // --- things you can do, that have somewhere to go -----------------------
  commands.push(
    {
      id: "action:post-opportunity",
      title: "Post a job or a seat",
      href: "/opportunities/new",
      group: "action",
      icon: "plus",
      keywords: ["hire", "recruit", "vacancy", "drive", "crew", "advertise"],
    },
    {
      id: "action:new-report",
      title: "Write a report",
      href: "/reports/new",
      group: "action",
      icon: "doc",
      keywords: ["race report", "write-up", "debrief"],
    },
    {
      id: "action:apply",
      title: "Apply to publish",
      href: "/apply",
      group: "action",
      icon: "plus",
      keywords: ["create a team", "create a series", "organization", "sponsor", "permission"],
    },
  );

  // --- everywhere else ----------------------------------------------------
  const globalLinks = [
    ...NAV_LINKS,
    ...ACCOUNT_LINKS,
    ...(contexts.isPlatformStaff ? ADMIN_LINKS : []),
  ];
  for (const link of globalLinks) {
    commands.push({
      id: `nav:${link.href}`,
      title: link.label,
      href: link.href,
      group: "page",
      icon: iconFor(NAV_ICONS, link.label),
    });
  }

  return commands;
}
