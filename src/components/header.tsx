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
import { AccountMenu } from "@/components/account-menu";
import { CommandTrigger } from "@/components/command-palette";
import { HeaderContext } from "@/components/context-switcher";

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
          {/* Either the directory links or the switcher for whatever you are
              inside. There is only room for one — see the component. */}
          <HeaderContext />
        </div>
        {/* The shortest path to any of the forty-five pages under the
            dashboard. Hidden on the narrowest screens, where it would crowd
            out the logo — the mobile menu carries its own. */}
        <CommandTrigger className="mx-2 hidden w-full max-w-[320px] flex-1 sm:flex lg:max-w-[190px]" />
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
            {/* Three of the ten account destinations used to be hardcoded
                here and the other seven were desktop-unreachable. They all
                live in one menu now, which also keeps the header readable. */}
            <AccountMenu />
            <NotificationBell />
            <UserButton />
          </Show>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
