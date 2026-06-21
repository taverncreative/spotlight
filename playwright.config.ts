import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Load .env.local so the test's admin setup client has its keys. The dev
// server started below loads the same file itself via Next.js.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2];
  }
}

export default defineConfig({
  testDir: "tests",
  // All suites share one dev server; parallel workers compiling cold routes
  // at the same time cause timeout flakes, so run files serially.
  workers: 1,
  // Retry a failed test up to twice. The dev server cold-compiles routes on
  // first hit and a just-started server can briefly refuse a connection, so a
  // transient startup race recovers on retry instead of failing the run. A
  // genuine failure is one that fails even on retry.
  retries: 2,
  // Dev-server cold compiles can take several seconds per route, so give
  // navigation assertions room before failing.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "npm run dev",
    // Block until the server actually answers before any test runs; the dev
    // server can take a few seconds to come up cold.
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
