import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    // Allow up to 10 minutes for proxied /api/* requests (e.g. long TTS generation).
    proxyTimeout: 600_000,
  },
  // Proxy all /api/* requests to the FastAPI backend so the browser never
  // has to know where the backend lives.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
