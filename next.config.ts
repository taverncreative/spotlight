import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory makes Next.js guess the wrong
  // workspace root; pin it to this project.
  turbopack: {
    root: path.join(__dirname),
  },
  // The route tests drive the dev server via 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  // The branding logo upload posts the image to a server action so its content
  // can be validated before it is stored. Logos are capped at 2 MiB
  // (lib/logo.ts MAX_LOGO_BYTES); allow headroom for the multipart overhead.
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
