import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Header } from "@/components/header";
import { TRPCProvider } from "@/lib/trpc/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RaceOps — Motorsport Networking & Career Platform",
    template: "%s | RaceOps",
  },
  description:
    "RaceOps unifies sim racing, real-world racing careers, and motorsport industry professionals in one networking, opportunity, and strategy platform.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
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
