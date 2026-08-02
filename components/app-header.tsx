import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

// The one app header, used by every shell.
//
// There used to be eight of these, one per layout, drifting apart: some carried
// a theme toggle and a sign-out button, some carried the operator's email, the
// client shell carried an All projects button and an Integrations link that
// existed nowhere else. Navigating from /home into a client changed the
// furniture around you, which made the app feel like several apps.
//
// What is left is what is genuinely operator-level and true wherever you are:
// the mark, which goes home, and Due, Time and Settings. Theme, the signed-in
// address and Sign out are content on /settings, not furniture on every screen.
//
// `children` is for the one thing that legitimately differs: inside a client the
// shell adds a client selector beside the mark.
export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/home"
          aria-label="Spotlight home"
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          <Wordmark textClassName="text-sm" />
        </Link>
        {children ? (
          <>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            {children}
          </>
        ) : null}
      </div>
      <nav className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" render={<Link href="/platform" />}>
          Platform
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/due" />}>
          Due
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/time" />}>
          Time
        </Button>
        <Button variant="ghost" size="sm" render={<Link href="/settings" />}>
          Settings
        </Button>
      </nav>
    </header>
  );
}
