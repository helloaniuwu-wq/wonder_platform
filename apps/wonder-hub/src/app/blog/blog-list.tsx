"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { BlogPostMeta } from "@/lib/blog";
import { RESTRICTED_CATEGORY } from "@/lib/constants";
import { cn } from "@/lib/utils";

const TERMINAL_URL = "https://terminal.wonderwisdom.online";

// ─── 分类颜色 ─────────────────────────────────────────────────────────────
const CATEGORY_STYLE: Record<string, string> = {
  投资理念: "bg-blue-50 text-blue-700 border-blue-200",
  保险理念: "bg-emerald-50 text-emerald-700 border-emerald-200",
  客户通讯: "bg-amber-50 text-amber-700 border-amber-200",
};

// ─── 双入口卡片：客户通讯 / 商业模式分析终端 ─────────────────────────────
function EntryCards({ onNewsletter }: { onNewsletter: () => void }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-14">
      <button
        type="button"
        onClick={onNewsletter}
        className="group text-left rounded-2xl border border-border bg-card/50 p-7 hover:border-primary/40 hover:bg-card transition-colors"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary mb-4">
          Newsletter
        </p>
        <h2 className="text-2xl font-semibold text-card-foreground mb-3">客户通讯</h2>
        <p className="text-sm text-foreground/60 leading-relaxed mb-6">
          每月写给客户的投资笔记与市场复盘，记录我们当时的判断与依据。
        </p>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          查看通讯
          <span className="group-hover:translate-x-1 transition-transform">→</span>
        </span>
      </button>

      <a
        href={TERMINAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="group text-left rounded-2xl border border-border bg-card/50 p-7 hover:border-primary/40 hover:bg-card transition-colors"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary mb-4">
          Terminal
        </p>
        <h2 className="text-2xl font-semibold text-card-foreground mb-3">商业模式分析终端</h2>
        <p className="text-sm text-foreground/60 leading-relaxed mb-6">
          以商业模式为起点看公司，与本站的投资研究互为补充。
        </p>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          进入 Terminal
          <span className="group-hover:translate-x-1 transition-transform">↗</span>
        </span>
      </a>
    </section>
  );
}

// ─── 客户通讯卡片（2026-11-12 起全文公开，仅保留视觉区分）──────────────
function NewsletterCard({ post }: { post: BlogPostMeta }) {
  return (
    <article className="group relative rounded-[1.75rem] border border-amber-200/60 bg-gradient-to-br from-amber-50/80 to-white overflow-hidden hover:shadow-lg transition-all duration-300">
      <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400" />
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
            客户通讯
          </span>
          <span className="text-xs text-muted-foreground">{String(post.date)}</span>
        </div>

        <h3 className="text-lg font-semibold text-card-foreground mb-2 leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {post.title}
        </h3>

        <p className="text-sm text-foreground/60 leading-relaxed line-clamp-3 mb-4">
          {post.summary}
        </p>

        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {post.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-foreground/5 text-foreground/50">
                {tag}
              </span>
            ))}
          </div>
        )}

        <Link
          href={`/blog/${post.slug}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-900 transition-colors"
        >
          阅读全文
          <span className="group-hover:translate-x-1 transition-transform">→</span>
        </Link>
      </div>
    </article>
  );
}

// ─── 普通文章卡片 ─────────────────────────────────────────────────────────
function ArticleCard({ post }: { post: BlogPostMeta }) {
  const styleClass = CATEGORY_STYLE[post.category] ?? "bg-muted text-foreground border-border";
  return (
    <article className="group relative rounded-[1.75rem] border border-border bg-card hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 overflow-hidden">
      <div className={cn("h-1", {
        "bg-gradient-to-r from-blue-400 to-blue-600": post.category === "投资理念",
        "bg-gradient-to-r from-emerald-400 to-green-500": post.category === "保险理念",
      })} />
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", styleClass)}>
            {post.category}
          </span>
          <span className="text-xs text-muted-foreground">{String(post.date)}</span>
        </div>
        <h3 className="text-lg font-semibold text-card-foreground mb-2 leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {post.title}
        </h3>
        <p className="text-sm text-foreground/60 leading-relaxed line-clamp-3 mb-4">
          {post.summary}
        </p>
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {post.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
        <Link
          href={`/blog/${post.slug}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:gap-2 transition-all duration-200"
        >
          阅读全文 <span className="group-hover:translate-x-1 transition-transform">→</span>
        </Link>
      </div>
    </article>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────
export function BlogList({ posts }: { posts: BlogPostMeta[] }) {
  const [activeCategory, setActiveCategory] = useState<string>("全部");

  const categories = useMemo(() => {
    const cats = new Set(posts.map((p) => p.category));
    return ["全部", ...Array.from(cats)];
  }, [posts]);

  const filteredPosts = useMemo(() => {
    if (activeCategory === "全部") return posts;
    return posts.filter((p) => p.category === activeCategory);
  }, [posts, activeCategory]);

  function goNewsletter() {
    setActiveCategory(RESTRICTED_CATEGORY);
    document.getElementById("article-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <EntryCards onNewsletter={goNewsletter} />

      <div id="article-list" className="scroll-mt-24">
        {/* 分类筛选条 */}
        <div className="flex flex-wrap gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border transition-all duration-200",
                activeCategory === cat
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "border-border text-foreground/60 hover:text-foreground hover:border-foreground/30 bg-card"
              )}
            >
              {cat}
              {cat !== "全部" && (
                <span className="ml-1.5 text-xs opacity-60">
                  ({posts.filter((p) => p.category === cat).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 文章网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPosts.map((post) =>
            post.category === RESTRICTED_CATEGORY ? (
              <NewsletterCard key={post.slug} post={post} />
            ) : (
              <ArticleCard key={post.slug} post={post} />
            )
          )}
        </div>

        {filteredPosts.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            该分类暂无文章
          </div>
        )}
      </div>
    </>
  );
}
