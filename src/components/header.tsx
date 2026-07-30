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
import { MobileNav } from "@/components/mobile-nav";
import { NAV_LINKS } from "@/lib/nav";

export function Header() {
  return (
    <header
      data-app-header
      className="sticky top-0 z-50 border-b border-brand-black/10 bg-brand-offwhite/90 backdrop-blur"
    >
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-8">
          {/* Canonical logo top-left on every page. Space-constrained mobile
              chrome uses the "R" mark alone (brand guidelines). */}
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/brand/raceops-mark.png"
              alt="RaceOps"
              width={40}
              height={40}
              priority
              className="h-9 w-9 sm:hidden"
            />
            <Image
              src="/brand/raceops-logo.png"
              alt="RaceOps"
              width={150}
              height={40}
              priority
              className="hidden h-8 w-auto sm:block md:h-9"
            />
          </Link>
          <nav className="hidden items-center gap-5 lg:flex">
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
        <div className="flex items-center gap-2 sm:gap-3">
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
              className="hidden text-sm font-medium text-brand-black/70 hover:text-brand-red lg:block"
            >
              Applications
            </Link>
            <Link
              href="/billing"
              className="hidden text-sm font-medium text-brand-black/70 hover:text-brand-red lg:block"
            >
              Billing
            </Link>
            <NotificationBell />
            <Link
              href="/profile"
              className="hidden text-sm font-medium text-brand-black/70 hover:text-brand-red lg:block"
            >
              My profile
            </Link>
            <UserButton />
          </Show>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
