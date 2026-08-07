"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { ADMIN_LINKS } from "@/lib/nav";

/**
 * Staff-only links in the desktop header.
 *
 * Rendered from the caller's own standing rather than hidden with CSS, so a
 * member never sees a link that would refuse them. The routers enforce it
 * regardless — this is signposting, not security.
 */
export function AdminNav() {
  const mine = api.access.mine.useQuery();
  if (!mine.data?.isStaff) return null;

  return (
    <>
      {ADMIN_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="hidden text-sm font-medium text-brand-red/80 hover:text-brand-red lg:block"
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
