import Image from "next/image";
import Link from "next/link";
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";

const NAV_LINKS = [
  { href: "/search", label: "Discover" },
  { href: "/teams", label: "Teams" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/strategy", label: "Pit Wall" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-brand-black/10 bg-brand-offwhite/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          {/* Canonical logo lockup — top-left on every page (brand guidelines) */}
          <Link href="/" className="flex items-center">
            <Image
              src="/brand/raceops-logo.png"
              alt="RaceOps"
              width={150}
              height={40}
              priority
              className="h-9 w-auto"
            />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-brand-black/70 transition-colors hover:text-brand-red"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button variant="primary" size="sm">
                Join RaceOps
              </Button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link
              href="/applications"
              className="hidden text-sm font-medium text-brand-black/70 hover:text-brand-red sm:block"
            >
              Applications
            </Link>
            <Link
              href="/billing"
              className="hidden text-sm font-medium text-brand-black/70 hover:text-brand-red sm:block"
            >
              Billing
            </Link>
            <NotificationBell />
            <Link
              href="/profile"
              className="text-sm font-medium text-brand-black/70 hover:text-brand-red"
            >
              My profile
            </Link>
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
