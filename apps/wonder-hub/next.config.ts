import type { NextConfig } from "next";

// .env.local / .env.production 历史上用的是 NEXT_PUBLIC_BACKEND_URL，
// 而本文件此前只读 NEXT_PUBLIC_API_URL，导致 /api/* 一直落到 localhost:8000。
// 两个键名都兼容，最终兜底指向现役的 Cloudflare Worker。
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://wonder-api-worker.helloaniuwu.workers.dev";

// standalone = 自建 Node 服务；export = Cloudflare Pages 静态托管。
// 用 NEXT_STATIC_EXPORT=1 切换，默认保持原有 standalone 行为不变。
const STATIC_EXPORT = process.env.NEXT_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  skipTrailingSlashRedirect: true,
  output: STATIC_EXPORT ? "export" : "standalone",
  images: { unoptimized: true },
  ...(STATIC_EXPORT
    ? {}
    : {
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
      }),
};

export default nextConfig;
