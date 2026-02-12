import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Sonner } from "@/components/ui/sonner";
import { AuthNav } from "@/components/auth-nav";
import { GuestLinker } from "@/components/guest-linker";

export const metadata: Metadata = {
  title: "Crypto Paper Trader",
  description: "Guest-mode crypto paper trading dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
          <nav className="mx-auto flex h-12 w-full max-w-[1400px] items-center justify-between gap-2 px-3 md:px-6">
            <div className="flex min-w-0 flex-1 items-center">
              <Link
                href="/"
                className="bg-gradient-to-r from-primary to-sky-400 bg-clip-text text-sm font-bold tracking-tight text-transparent"
              >
                Nierade
              </Link>
            </div>

            <div className="flex flex-none items-center justify-center gap-1 sm:gap-2">
              <Link
                href="/"
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                Home
              </Link>
              <Link
                href="/markets"
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                Markets
              </Link>
              <Link
                href="/trade"
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                Trade
              </Link>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end">
              <AuthNav />
            </div>
          </nav>
        </header>
        <GuestLinker />
        {children}
        <Sonner />
      </body>
    </html>
  );
}
