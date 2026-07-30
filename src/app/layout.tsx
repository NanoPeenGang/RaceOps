import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Header } from "@/components/header";
import { TRPCProvider } from "@/lib/trpc/provider";
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
          <TRPCProvider>
            <Header />
            {children}
          </TRPCProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
