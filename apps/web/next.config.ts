import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
