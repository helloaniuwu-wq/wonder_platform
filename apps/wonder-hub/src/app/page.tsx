"use client"

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* Soft Solarized Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      <section className="container max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center space-y-10 z-10">
        <h1 className="text-6xl md:text-8xl font-semibold tracking-tight text-card-foreground">
          重塑您的私人财富体系
        </h1>
        <p className="text-xl md:text-2xl text-foreground font-light leading-relaxed max-w-3xl">
          WONDER 是专注于高净值个人与家庭的综合财富管理智库。我们提供深度的专业研究、香港分红保单兑现数据库与全球资产配置沙盘。
        </p>

        {/* Featured Post Banner */}
        <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm hover:bg-primary/10 transition-all duration-300">
          <span className="font-mono uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-md bg-primary text-primary-foreground font-semibold">NEW</span>
          <Link href="/blog" className="hover:underline flex items-center gap-1.5 font-light">
            最新内参：查阅全球宏观与家庭资产配置月度通讯 <span className="font-mono">→</span>
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-6 pt-10">
          <a
            href="/fr"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ size: "lg" }), "h-16 px-10 rounded-2xl bg-primary text-primary-foreground hover:opacity-90 text-lg font-medium shadow-sm flex items-center justify-center")}
          >
            查阅香港分红实现率数据库
          </a>
          <Link
            href="/blog"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-16 px-10 rounded-2xl border-border bg-card/50 hover:bg-card text-foreground backdrop-blur-md text-lg font-medium flex items-center justify-center")}
          >
            阅读专业洞察
          </Link>
        </div>
      </section>

      {/* Feature Navigation Grid */}
      <section className="w-full max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pb-32">
        {[
          { title: "分紅實現率", desc: "香港 12 家主流險企 GL16 分紅兌現數據庫與深度導讀。", link: "/fr", isExternal: true, highlight: true },
          { title: "專業研究", desc: "前沿的宏觀經濟與資產配置文章與客戶內參。", link: "/blog" },
          { title: "FIS 財富沙盤", desc: "全球資產配置組合追蹤、有效前沿回測與蒙特卡洛推演。", link: "https://fis.wonderwisdom.online", isExternal: true },
          { title: "企業行政系統", desc: "香港公司日常記帳、智能單據識別與稅務合規管理。", link: "https://company.wonderwisdom.online", isExternal: true },
        ].map((item, idx) => (
          item.isExternal ? (
            <a
              href={item.link}
              key={idx}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group relative p-6 rounded-[2rem] border border-border bg-card/40 backdrop-blur-sm hover:shadow-xl hover:bg-card transition-all duration-500 overflow-hidden flex flex-col justify-between",
                item.highlight && "border-primary/40 bg-primary/5"
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-semibold text-card-foreground">{item.title}</h3>
                  {item.highlight && (
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-primary/20 text-primary font-bold">LIVE</span>
                  )}
                </div>
                <p className="text-sm text-foreground/80 font-light leading-relaxed">{item.desc}</p>
              </div>
              <div className="mt-4 text-xs text-primary font-medium flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                <span>進入系統</span>
                <span>→</span>
              </div>
            </a>
          ) : (
            <Link
              href={item.link}
              key={idx}
              className="group relative p-6 rounded-[2rem] border border-border bg-card/40 backdrop-blur-sm hover:shadow-xl hover:bg-card transition-all duration-500 overflow-hidden flex flex-col justify-between"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div>
                <h3 className="text-xl font-semibold mb-2 text-card-foreground">{item.title}</h3>
                <p className="text-sm text-foreground/80 font-light leading-relaxed">{item.desc}</p>
              </div>
              <div className="mt-4 text-xs text-foreground/50 group-hover:text-foreground font-medium flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                <span>進入專欄</span>
                <span>→</span>
              </div>
            </Link>
          )
        ))}
      </section>
    </main>
  );
}
