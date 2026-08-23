/** Shared nav definitions for the desktop header and the mobile menu. */

/*
 * Nine destinations became six.
 *
 * Events, Series, Teams and Tracks were four index pages running the same
 * query with the filter nailed down, and somebody after "endurance racing in
 * Georgia next month" had to run that search four times and hold the answers
 * in their head. Explore does it once.
 *
 * The four pages are still there and still at their own URLs — each carries
 * things a search cannot, like creating a team or seeing your own entries —
 * they are simply no longer how you browse. Explore links into each of them,
 * and ⌘K finds any of them by name.
 */
export const NAV_LINKS = [
  { href: "/home", label: "Home" },
  { href: "/explore", label: "Explore" },
  { href: "/search", label: "Discover people" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/reports", label: "Reports" },
  { href: "/strategy", label: "Pit Wall" },
] as const;

/**
 * The directory pages Explore replaced as a browse surface.
 *
 * Named so the command palette can still offer them and so the mobile menu
 * can group them under Explore rather than dropping them entirely.
 */
export const DIRECTORY_LINKS = [
  { href: "/events", label: "Events" },
  { href: "/series", label: "Series" },
  { href: "/teams", label: "Teams" },
  { href: "/tracks", label: "Tracks" },
] as const;

/** Signed-in-only destinations. */
export const ACCOUNT_LINKS = [
  // Personal rather than a browse destination, and near the top because the
  // moment somebody needs it they are standing at a gate on a phone.
  { href: "/passes", label: "My passes" },
  { href: "/messages", label: "Messages" },
  { href: "/organizations", label: "My organizations" },
  { href: "/applications", label: "My applications" },
  // The seat-and-job applications above are a different thing from the
  // access application below, and the labels have to carry that difference —
  // "My applications" next to "Apply" with no distinction is a support ticket.
  { href: "/apply", label: "Apply to publish" },
  { href: "/sponsor", label: "Sponsor console" },
  { href: "/opportunities/mine", label: "My postings" },
  { href: "/notifications", label: "Notifications" },
  { href: "/billing", label: "Billing" },
  { href: "/profile", label: "My profile" },
] as const;

/**
 * Platform staff destinations.
 *
 * Kept out of ACCOUNT_LINKS so the menu does not offer everybody a page that
 * will refuse them. Rendered only when the caller can actually review — which
 * the client checks, and the router enforces regardless.
 */
export const ADMIN_LINKS = [
  { href: "/admin/access", label: "Access applications" },
] as const;

/* -------------------------------------------------------------------------
 * Consoles
 *
 * The tab strips of the three management consoles, named here so that things
 * which need to *talk about* those pages — the command palette, and anything
 * that comes after it — do not have to re-type the list and drift from it.
 *
 * The console pages still build their own tabs, because a tab carries content
 * and a visibility rule and a badge, none of which belong in a nav constant.
 * What is shared is the part that has to agree: the id in the query string
 * and the label a person reads. `tests/nav-consoles.test.ts` fails if the two
 * ever disagree.
 * ---------------------------------------------------------------------- */

export interface ConsoleTab {
  /** The `?tab=` value. Changing one breaks saved links, so treat as an id. */
  id: string;
  label: string;
}

export const TEAM_CONSOLE_TABS: readonly ConsoleTab[] = [
  { id: "roster", label: "Roster" },
  { id: "hiring", label: "Hiring" },
  { id: "money", label: "Money" },
  { id: "garage", label: "Garage" },
  { id: "racing", label: "Racing" },
  { id: "comms", label: "Comms" },
  { id: "settings", label: "Settings" },
] as const;

export const EVENT_CONSOLE_TABS: readonly ConsoleTab[] = [
  { id: "weekend", label: "Race weekend" },
  { id: "entries", label: "Entries" },
  { id: "paddock", label: "Paddock & tech" },
  { id: "control", label: "Race control" },
  { id: "results", label: "Results" },
  { id: "volunteers", label: "Volunteers" },
  { id: "comms", label: "Documents & notices" },
  { id: "settings", label: "Settings" },
] as const;

export const SERIES_CONSOLE_TABS: readonly ConsoleTab[] = [
  { id: "calendar", label: "Calendar" },
  { id: "regulations", label: "Regulations" },
  { id: "staff", label: "Staff & roles" },
  { id: "comms", label: "Notices & media" },
  { id: "settings", label: "Look and feel" },
] as const;

/**
 * Console pages that are not tabs.
 *
 * These are real routes sitting beside a console rather than inside it, and
 * they are exactly the pages that go missing: the gate screen is not linked
 * from the event console at all, and the scan station is reachable only from
 * inside the garage tab. Being addressable by name is the cheapest fix
 * available until the navigation itself changes.
 */
export interface ConsoleSubPage {
  /** Appended to the console's base path. */
  segment: string;
  label: string;
  /** Words somebody might type instead of the label. */
  keywords?: readonly string[];
}

export const TEAM_CONSOLE_PAGES: readonly ConsoleSubPage[] = [
  { segment: "scan", label: "Scan station", keywords: ["barcode", "qr", "inventory", "parts"] },
  { segment: "labels", label: "Part label sheet", keywords: ["qr", "print", "barcode", "stickers"] },
] as const;

export const EVENT_CONSOLE_PAGES: readonly ConsoleSubPage[] = [
  { segment: "timing", label: "Live timing", keywords: ["laps", "sectors", "leaderboard"] },
  { segment: "incidents", label: "Incidents", keywords: ["stewards", "contact", "report"] },
  { segment: "penalties", label: "Penalties", keywords: ["stewards", "sanctions"] },
  { segment: "bulletin", label: "Bulletins", keywords: ["notices", "announcements"] },
  { segment: "gate", label: "Gate check-in", keywords: ["credentials", "wristbands", "passes", "entry"] },
  { segment: "broadcast", label: "Broadcast overlay", keywords: ["commentary", "stream", "tv"] },
] as const;
