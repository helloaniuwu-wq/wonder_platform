"use client";
// 服务端 layout 不能直接用 usePathname，需要包一层 client wrapper
import { usePathname } from "next/navigation";
import { TopNav } from "./TopNav";

export function TopNavWrapper() {
  const pathname = usePathname();
  const current = pathname.startsWith("/blog") ? "blog" : undefined;
  return <TopNav currentPath={current} />;
}
