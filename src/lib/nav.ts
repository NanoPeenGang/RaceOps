/** Shared nav definitions for the desktop header and the mobile menu. */

export const NAV_LINKS = [
  { href: "/search", label: "Discover" },
  { href: "/teams", label: "Teams" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/strategy", label: "Pit Wall" },
] as const;

/** Signed-in-only destinations. */
export const ACCOUNT_LINKS = [
  { href: "/applications", label: "My applications" },
  { href: "/opportunities/mine", label: "My postings" },
  { href: "/notifications", label: "Notifications" },
  { href: "/billing", label: "Billing" },
  { href: "/profile", label: "My profile" },
] as const;
