"use client";

/**
 * 客户通讯阅读门（静态导出版）
 *
 * 静态站点里只保留文章标题与前 300 字摘要，全文不进入 HTML / RSC payload。
 * 访客输入访问口令、持微信专属链接、或以有权限的账号登录时，
 * 才由 Worker（/api/articles/:slug）在鉴权通过后返回正文。
 * 口令本身不再硬编码在前端，由服务端校验。
 *
 * 2026-11-12 用户决定「客户通讯全文暂时放开」，本组件当前不再被 page.tsx 引用；
 * Worker 的 /api/articles/:slug 与数据表也一并保留，日后需要收紧可直接恢复。
 */
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { API_BASE } from "@/lib/api";

const PASSCODE_KEY = "wonder_passcode";

export function ArticleLoginGate({ slug, excerpt }: { slug: string; excerpt: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadArticle = useCallback(
    async (candidatePasscode?: string): Promise<boolean> => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        const wc = new URLSearchParams(window.location.search).get("wc");
        if (wc) params.set("wc", wc);
        if (candidatePasscode) params.set("passcode", candidatePasscode);

        const token = localStorage.getItem("token") || "";
        const qs = params.toString();
        const res = await fetch(
          `${API_BASE}/api/articles/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        const data = await res.json();
        if (res.ok && data.content) {
          setContent(data.content as string);
          return true;
        }
        if (res.status !== 401) setError(data.error || "讀取失敗，請稍後再試");
      } catch {
        setError("網絡異常，請稍後再試");
      } finally {
        setLoading(false);
      }
      return false;
    },
    [slug]
  );

  // 已有口令 / 登录态 / 微信专属链接时自动解锁
  useEffect(() => {
    const saved = localStorage.getItem(PASSCODE_KEY) || "";
    const hasToken = !!localStorage.getItem("token");
    const hasWc = new URLSearchParams(window.location.search).has("wc");
    if (saved || hasToken || hasWc) loadArticle(saved || undefined);
  }, [loadArticle]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    const value = passcode.trim();
    if (!value) return;
    localStorage.setItem(PASSCODE_KEY, value);
    const ok = await loadArticle(value);
    if (!ok) {
      localStorage.removeItem(PASSCODE_KEY);
      setError((prev) => prev || "訪問口令不正確，請重新輸入");
    }
  }

  if (content) {
    return (
      <div className="article-body prose prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <>
      <div className="article-body relative">
        <div className="text-lg leading-[1.9] text-foreground/85 mb-6 line-clamp-5">{excerpt}</div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="my-12 rounded-[2rem] border border-amber-200/60 bg-gradient-to-br from-amber-50/40 via-card to-card p-8 md:p-12 shadow-xl backdrop-blur-md max-w-xl mx-auto relative overflow-hidden">
        <div className="text-center mb-8 relative z-10">
          <div className="inline-flex w-16 h-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 text-3xl mb-5">
            🔒
          </div>
          <h3 className="text-2xl font-semibold text-card-foreground mb-3 tracking-tight">
            客户内参 · 受邀专属
          </h3>
          <p className="text-base text-foreground/60 max-w-sm mx-auto leading-relaxed font-light">
            此内容为 WONDER 客户专享。
            <br />
            请输入您的访问口令以解锁完整阅读权限。
          </p>
        </div>

        <form onSubmit={handleUnlock} className="max-w-md mx-auto space-y-4 relative z-10">
          <input
            type="text"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              if (error) setError("");
            }}
            placeholder="请输入您的专属访问口令"
            required
            disabled={loading}
            className="w-full h-14 px-5 rounded-2xl border border-border bg-background/80 text-foreground placeholder-foreground/30 focus:outline-none focus:border-primary/80 focus:ring-1 focus:ring-primary/40 transition-all duration-300 text-center text-lg tracking-wide"
          />

          {error && (
            <div className="text-sm text-destructive bg-destructive/5 border border-destructive/10 px-4 py-3 rounded-xl text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !passcode}
            className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-medium text-base hover:opacity-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {loading ? "正在验证并解锁..." : "解锁阅读全文"}
          </button>
        </form>

        <div className="text-center mt-8 space-y-2 text-xs text-foreground/40 font-light relative z-10 border-t border-border/50 pt-6">
          <p>从微信公众号点击阅读的朋友，直接使用公众号文章中的专属链接即可自动授权访问</p>
          <p>
            尚未获取口令？
            <a href="mailto:hello@wonderwisdom.online" className="text-primary hover:underline ml-1">
              联系您的财富顾问获取
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
