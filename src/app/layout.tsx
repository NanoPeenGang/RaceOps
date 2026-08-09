import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Header } from "@/components/header";
import { TRPCProvider } from "@/lib/trpc/provider";
import { ToastProvider } from "@/components/ui/toast";
import { OfflineProvider } from "@/components/offline-provider";
import { OfflineIndicator } from "@/components/offline-indicator";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RaceOps — The Operating Platform for Motorsport",
    template: "%s | RaceOps",
  },
  description:
    "Run motorsport series, race weekends and teams. Find race seats, crew jobs, volunteer shifts and sponsorship. One platform for all of motorsport — sim racing and real world alike.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  // Installable so it opens from a home screen at a marshal post, where the
  // browser chrome costs screen the person does not have.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "RaceOps" },
  openGraph: {
    siteName: "RaceOps",
    type: "website",
    title: "RaceOps — The Operating Platform for Motorsport",
    description:
      "Series, events, teams, seats, crew jobs, volunteering and sponsorship — sim and real world, in one place.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tints the mobile browser chrome to the app background.
  themeColor: "#FAFAFA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ClerkProvider>
          {/* Outside the tRPC provider, which reads it to report every failed
              mutation — so the toast context has to exist first. */}
          <ToastProvider>
            <TRPCProvider>
              <OfflineProvider>
                <Header />
                {children}
                <OfflineIndicator />
                <ServiceWorkerRegistration />
              </OfflineProvider>
            </TRPCProvider>
          </ToastProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
