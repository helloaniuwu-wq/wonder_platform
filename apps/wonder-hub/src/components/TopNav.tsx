"use client";

/**
 * 全局顶部导航栏 + 登录弹窗
 * - 与 fis-hub / company-admin 共用同一套后端用户体系（JWT）
 * - token 存储在 localStorage["token"]，与其他子系统共享
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";

// 静态部署（Cloudflare Pages）后不再有 next.config 的 /api rewrite，直连现役 Worker
const BACKEND = `${API_BASE}/api`;

// ─── 登录弹窗 ─────────────────────────────────────────────────────────────
function LoginModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (user: { name: string; email: string; role?: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BACKEND}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "登录失败");
      // 同时存 localStorage + cookie（cookie 让 SSR 可读）
      localStorage.setItem("token", data.access_token);
      document.cookie = `token=${data.access_token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
      onSuccess({
        name: data.name || email.split("@")[0],
        email,
        role: data.role,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-md bg-card border border-border rounded-3xl p-8 shadow-2xl"
      >
        {/* 关闭 */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-foreground/40 hover:text-foreground text-xl transition-colors"
        >
          ✕
        </button>

        <h2 className="text-2xl font-semibold text-card-foreground mb-1">
          客户登录
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          登录后可访问客户专属工具与数据
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              电子邮件
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="form-input"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground mt-4">
          尚未开通访问权限？
          <a
            href="mailto:hello@wonderwisdom.online"
            className="text-primary hover:underline ml-1"
          >
            联系顾问申请
          </a>
        </p>
      </div>
    </div>
  );
}

// ─── 顶部导航栏 ───────────────────────────────────────────────────────────
export function TopNav({ currentPath }: { currentPath?: string }) {
  const [user, setUser] = useState<{ name: string; email: string; role?: string } | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 初始化：检查 localStorage token
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${BACKEND}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const u = data.user || data;
        setUser({
          name: u.display_name || u.name || u.email?.split("@")[0] || "用户",
          email: u.email || "",
          role: u.role || "free",
        });
      })
      .catch(() => {
        localStorage.removeItem("token");
      });
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleLogout() {
    localStorage.removeItem("token");
    document.cookie = "token=; path=/; max-age=0; SameSite=Lax";
    setUser(null);
    setMenuOpen(false);
    // 刷新页面以清除受限内容
    window.location.reload();
  }

  return (
    <>
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={(u) => {
          setUser(u);
          // 登录成功后刷新，让受限内容正确显示
          setTimeout(() => window.location.reload(), 200);
        }}
      />

      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-card-foreground hover:text-primary transition-colors"
          >
            WONDER
          </Link>

          {/* 导航链接 */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground/70">
            <Link
              href="/blog"
              className={cn(
                "hover:text-foreground transition-colors",
                currentPath === "blog" && "text-foreground"
              )}
            >
              专业洞察
            </Link>
            <a
              href="/fr"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1 text-primary/90 font-medium"
            >
              <span>分红实现率</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-primary/10 text-primary rounded-full font-mono">GL16</span>
            </a>
            <Link
              href="/xhs-creator"
              className={cn(
                "hover:text-foreground transition-colors",
                currentPath === "xhs-creator" && "text-foreground"
              )}
            >
              小红书工坊
            </Link>
          </div>


          {/* 登录区 */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card/60 hover:bg-card transition-colors text-sm font-medium"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-foreground/80 max-w-[100px] truncate">
                    {user.name}
                  </span>
                  <span className="text-foreground/40 text-xs">▾</span>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-2xl shadow-xl py-2 text-sm">
                    <div className="px-4 py-2 border-b border-border/60">
                      <p className="font-medium text-card-foreground truncate">
                        {user.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </p>
                    </div>
                    <a
                      href="https://fis.wonderwisdom.online"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-4 py-2.5 text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      FIS 组合管理 →
                    </a>
                    <a
                      href="https://company.wonderwisdom.online"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-4 py-2.5 text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      企业行政系统 →
                    </a>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2.5 text-destructive/80 hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="px-5 py-2 rounded-full border border-border bg-card/60 hover:bg-card text-sm font-medium text-foreground/70 hover:text-foreground transition-all duration-200"
              >
                客户登录
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* 占位高度（避免内容被 fixed nav 遮住）*/}
      <div className="h-16" />
    </>
  );
}
