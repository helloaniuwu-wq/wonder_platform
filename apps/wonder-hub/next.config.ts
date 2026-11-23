import type { NextConfig } from "next";

// .env.local / .env.production 历史上用的是 NEXT_PUBLIC_BACKEND_URL，
// 而本文件此前只读 NEXT_PUBLIC_API_URL，导致 /api/* 一直落到 localhost:8000。
// 两个键名都兼容，最终兜底指向现役的 Cloudflare Worker。
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

// standalone = 自建 Node 服务；export = Cloudflare Pages 静态托管。
// 用 NEXT_STATIC_EXPORT=1 切换，默认保持原有 standalone 行为不变。
// 注意：Cloudflare Pages 原生集成（wonder-hub 项目）的构建命令里已写死
// NEXT_STATIC_EXPORT=1，否则 next build 走 standalone、不产生 out/，Pages 找不到产物。
const STATIC_EXPORT = process.env.NEXT_STATIC_EXPORT === "1";

// 静态导出（Cloudflare Pages）必须显式提供 API 地址（Pages 项目的 Variables and secrets），
// 缺失时让构建失败：Pages 不会用失败的构建替换线上版本，比悄悄连错后端安全。
if (STATIC_EXPORT && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("缺少环境变量 NEXT_PUBLIC_API_URL（静态导出构建必须设置，见 .env.example）");
}

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
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
