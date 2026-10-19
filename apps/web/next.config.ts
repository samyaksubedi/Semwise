import { resolve } from "node:path";
import type { NextConfig } from "next";

// Docker builds (apps/web/Dockerfile) set NEXT_OUTPUT_STANDALONE=1 from apps/web: a self-contained
// server traced from the repo root, so the shared package is included. `next start` is used locally.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: resolve(process.cwd(), "../..") }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The microphone and camera are used by the CR entry screen only.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
