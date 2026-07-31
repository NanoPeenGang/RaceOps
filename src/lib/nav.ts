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
  { href: "/organizations", label: "My organizations" },
  { href: "/applications", label: "My applications" },
  { href: "/opportunities/mine", label: "My postings" },
  { href: "/notifications", label: "Notifications" },
  { href: "/billing", label: "Billing" },
  { href: "/profile", label: "My profile" },
] as const;
