/** Shared nav definitions for the desktop header and the mobile menu. */

export const NAV_LINKS = [
  { href: "/home", label: "Home" },
  { href: "/search", label: "Discover" },
  { href: "/events", label: "Events" },
  { href: "/series", label: "Series" },
  { href: "/teams", label: "Teams" },
  { href: "/tracks", label: "Tracks" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/reports", label: "Reports" },
  { href: "/strategy", label: "Pit Wall" },
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
