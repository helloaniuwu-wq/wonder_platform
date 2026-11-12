import type { Metadata } from "next";
import "./globals.css";
import { TopNavWrapper } from "@/components/TopNavWrapper";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "WONDER | 专业财务规划与投资",
  description: "WONDER团队官方网站 - 专业的家族财富管理、投资诊断与组合分析系统。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="font-sans h-full antialiased light bg-background text-foreground"
    >
      <body className="min-h-full flex flex-col">
        <TopNavWrapper />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
