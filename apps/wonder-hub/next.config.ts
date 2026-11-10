import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  skipTrailingSlashRedirect: true,
  output: "standalone",
  images: { unoptimized: true },
  async rewrites() {
    return [
      {
        source: "/fr",
        destination: "/fr/index.html",
      },
      {
        source: "/fr/",
        destination: "/fr/index.html",
      },
      {
        source: "/fr/internal",
        destination: "/fr/internal/index.html",
      },
      {
        source: "/fr/internal/",
        destination: "/fr/internal/index.html",
      },
      {
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
