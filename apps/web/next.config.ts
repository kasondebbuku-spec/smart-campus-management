import type { NextConfig } from "next";

// The browser only ever talks to this app. Calls to /api/* are forwarded to the API,
// so the refresh-token cookie is first-party and no cross-origin setup is needed.
const API_URL = process.env.API_URL ?? "http://localhost:4100";

const config: NextConfig = {
  transpilePackages: ["@campus/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default config;
