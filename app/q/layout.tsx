import type { Metadata } from "next";

// The public quote page is the document a client's own customer opens. It is
// always a light document, regardless of the app's dark default and ignoring
// the theme cookie: the viewer is an unauthenticated recipient who never chose
// a theme, and there is no theme toggle here.
//
// The app's root layout may put .dark on <html> (from the cookie). This wrapper
// re-establishes the full light token set on the subtree via the .q-light class
// (shared with :root in globals.css, so they never drift), and paints the light
// canvas across the whole viewport so the dark body background never shows in
// the margins. The accept/decline confirm dialog portals to <body>, outside this
// wrapper, so it carries .q-light itself (see components/public-quote-actions).
//
// A neutral title keeps BSK View branding off the client's document.
export const metadata: Metadata = {
  title: "Quote",
};

export default function PublicQuoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="q-light min-h-screen bg-background text-foreground">
      {children}
    </div>
  );
}
