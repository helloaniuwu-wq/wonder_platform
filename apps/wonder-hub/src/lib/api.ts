/**
 * 官网静态部署后的后端入口。
 *
 * Cloudflare Pages 是纯静态托管，无法再依赖 next.config 的 /api rewrite，
 * 因此所有浏览器请求直接指向现役的 api-worker。
 * 通过 NEXT_PUBLIC_API_URL 可在构建时切换（例如本地联调指向 workers.dev 预览版）。
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://wonder-api-worker.helloaniuwu.workers.dev";

/** 生成 /api/* 形式的完整后端地址 */
export function apiUrl(path: string): string {
  return `${API_BASE}/api${path.startsWith("/") ? path : `/${path}`}`;
}
