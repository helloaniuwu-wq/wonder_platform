import { describe, expect, it, vi } from "vitest";
import app, { isAllowedOrigin } from "../index";
import { createAccessToken } from "../utils/auth";
import type { Env } from "../types";

interface MockState {
  users: Record<string, { id: string; email: string; name: string; role: string; is_active: number; is_verified: number }>;
  portfolios: Record<number, { id: number; name: string; user_id: string | null; is_public: number; base_currency: string; dividend_strategy: string; target_allocations: string; sort_order: number; created_at: string }>;
  transactions: Record<number, { id: number; portfolio_id: number }>;
  manual_dividends: Record<number, { id: number; portfolio_id: number }>;
  advisor_clients: Array<{ advisor_id: string; client_id: string; is_active: number }>;
}

function createMockDb(state: MockState): D1Database {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        params = args;
        return stmt;
      },
      first: async <T = unknown>(): Promise<T | null> => {
        if (sql.includes("FROM users WHERE id = ?")) {
          const user = state.users[String(params[0])];
          return (user && user.is_active === 1 ? user : null) as T | null;
        }
        if (sql.includes("FROM portfolios WHERE id = ?")) {
          const p = state.portfolios[Number(params[0])];
          return (p || null) as T | null;
        }
        if (sql.includes("FROM advisor_clients WHERE advisor_id = ? AND client_id = ?")) {
          const hit = state.advisor_clients.find(
            (ac) => ac.advisor_id === params[0] && ac.client_id === params[1] && ac.is_active === 1
          );
          return (hit ? { 1: 1 } : null) as T | null;
        }
        if (sql.includes("FROM transactions WHERE id = ?")) {
          const tx = state.transactions[Number(params[0])];
          return (tx || null) as T | null;
        }
        if (sql.includes("FROM manual_dividends WHERE id = ?")) {
          const div = state.manual_dividends[Number(params[0])];
          return (div || null) as T | null;
        }
        if (sql.includes("FROM portfolio_stats_cache WHERE portfolio_id = ?")) {
          return { total_nav: 1000, last_updated: "2026-01-01T00:00:00Z" } as T;
        }
        return null;
      },
      all: async <T = unknown>() => {
        if (sql.includes("FROM transactions WHERE portfolio_id = ?")) {
          const pid = Number(params[0]);
          const rows = Object.values(state.transactions).filter((t) => t.portfolio_id === pid);
          return { results: rows as T[], success: true, meta: {} as any };
        }
        return { results: [] as T[], success: true, meta: {} as any };
      },
      run: async () => ({ success: true, meta: { changes: 1, last_row_id: 1 } as any }),
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function makeEnv(state: MockState, overrides: Partial<Env> = {}): Env {
  return {
    DB: createMockDb(state),
    BUCKET: {} as R2Bucket,
    APP_NAME: "Test",
    ENVIRONMENT: "test",
    JWT_SECRET: "unit-test-secret-32-chars-minimum",
    ACCESS_TOKEN_EXPIRE_MINUTES: "60",
    OPENROUTER_API_KEY: "",
    OPENROUTER_BASE_URL: "",
    OPENROUTER_VISION_MODEL: "",
    OPENROUTER_DEEPSEEK_MODEL: "",
    DEEPSEEK_BASE_URL: "",
    DEEPSEEK_MODEL: "",
    CORS_ORIGINS: "https://fis.wonderwisdom.online",
    ...overrides,
  };
}

function makeState(): MockState {
  return {
    users: {
      "owner-1": { id: "owner-1", email: "o@test.com", name: "Owner", role: "free", is_active: 1, is_verified: 1 },
      "other-1": { id: "other-1", email: "x@test.com", name: "Other", role: "free", is_active: 1, is_verified: 1 },
      "adv-1": { id: "adv-1", email: "a1@test.com", name: "Adv1", role: "advisor", is_active: 1, is_verified: 1 },
      "adv-2": { id: "adv-2", email: "a2@test.com", name: "Adv2", role: "advisor", is_active: 1, is_verified: 1 },
      "admin-1": { id: "admin-1", email: "ad@test.com", name: "Admin", role: "admin", is_active: 1, is_verified: 1 },
    },
    portfolios: {
      1: {
        id: 1,
        name: "Public Demo",
        user_id: null,
        is_public: 1,
        base_currency: "USD",
        dividend_strategy: "CASH",
        target_allocations: "{}",
        sort_order: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
      10: {
        id: 10,
        name: "Private Portfolio",
        user_id: "owner-1",
        is_public: 0,
        base_currency: "USD",
        dividend_strategy: "CASH",
        target_allocations: "{}",
        sort_order: 2,
        created_at: "2026-01-01T00:00:00Z",
      },
    },
    transactions: { 100: { id: 100, portfolio_id: 10 } },
    manual_dividends: { 200: { id: 200, portfolio_id: 10 } },
    advisor_clients: [{ advisor_id: "adv-1", client_id: "owner-1", is_active: 1 }],
  };
}

describe("CORS origin whitelist", () => {
  it("allows expected domains and localhost", () => {
    expect(isAllowedOrigin("https://wonderwisdom.online")).toBe(true);
    expect(isAllowedOrigin("https://fis.wonderwisdom.online")).toBe(true);
    expect(isAllowedOrigin("https://preview-123.fis-hub.pages.dev")).toBe(true);
    expect(isAllowedOrigin("http://localhost:5175")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects spoofing and arbitrary origins", () => {
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
    expect(isAllowedOrigin("https://evilwonderwisdom.online")).toBe(false);
    expect(isAllowedOrigin("https://localhost.evil.com")).toBe(false);
    expect(isAllowedOrigin("not-a-url")).toBe(false);
  });
});

describe("JWT secret enforcement", () => {
  it("throws 500 when JWT_SECRET and SECRET_KEY are missing", async () => {
    const env = makeEnv(makeState(), { JWT_SECRET: undefined, SECRET_KEY: undefined });
    await expect(createAccessToken({ sub: "owner-1" }, env)).rejects.toThrow("伺服器未設定 JWT 密鑰");
  });
});

describe("FIP routes authorization & IDOR protection", () => {
  it("blocks unauthenticated access to private portfolio read endpoints", async () => {
    const env = makeEnv(makeState());
    for (const path of ["/api/portfolios/10", "/api/heartbeat/10", "/api/portfolios/transactions/10"]) {
      const res = await app.fetch(new Request(`http://localhost${path}`), env);
      expect(res.status).toBe(401);
    }
  });

  it("allows unauthenticated read of public portfolio but blocks write", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const readRes = await app.fetch(new Request("http://localhost/api/portfolios/1"), env);
    expect(readRes.status).toBe(200);

    const otherToken = await createAccessToken({ sub: "other-1" }, env);
    const writeRes = await app.fetch(
      new Request("http://localhost/api/portfolios/1", {
        method: "PUT",
        headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hacked" }),
      }),
      env
    );
    expect(writeRes.status).toBe(403);
  });

  it("enforces owner, assigned advisor, and admin access on private portfolios", async () => {
    const env = makeEnv(makeState());
    const ownerToken = await createAccessToken({ sub: "owner-1" }, env);
    const otherToken = await createAccessToken({ sub: "other-1" }, env);
    const adv1Token = await createAccessToken({ sub: "adv-1" }, env);
    const adv2Token = await createAccessToken({ sub: "adv-2" }, env);
    const adminToken = await createAccessToken({ sub: "admin-1" }, env);

    // Other user & unassigned advisor -> 403
    for (const tok of [otherToken, adv2Token]) {
      const getRes = await app.fetch(
        new Request("http://localhost/api/portfolios/10", { headers: { Authorization: `Bearer ${tok}` } }),
        env
      );
      expect(getRes.status).toBe(403);

      const putRes = await app.fetch(
        new Request("http://localhost/api/portfolios/10", {
          method: "PUT",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "X" }),
        }),
        env
      );
      expect(putRes.status).toBe(403);
    }

    // Owner, assigned advisor, admin -> 200
    for (const tok of [ownerToken, adv1Token, adminToken]) {
      const getRes = await app.fetch(
        new Request("http://localhost/api/portfolios/10", { headers: { Authorization: `Bearer ${tok}` } }),
        env
      );
      expect(getRes.status).toBe(200);

      const putRes = await app.fetch(
        new Request("http://localhost/api/portfolios/10", {
          method: "PUT",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated" }),
        }),
        env
      );
      expect(putRes.status).toBe(200);
    }
  });

  it("prevents IDOR on deleting transactions and manual dividends", async () => {
    const env = makeEnv(makeState());
    const otherToken = await createAccessToken({ sub: "other-1" }, env);

    const delTx = await app.fetch(
      new Request("http://localhost/api/portfolios/transactions/100", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${otherToken}` },
      }),
      env
    );
    expect(delTx.status).toBe(403);

    const delDiv = await app.fetch(
      new Request("http://localhost/api/dividends/manual/200", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${otherToken}` },
      }),
      env
    );
    expect(delDiv.status).toBe(403);
  });

  it("requires authentication for POST /lab/generate-report", async () => {
    const env = makeEnv(makeState());
    const res = await app.fetch(
      new Request("http://localhost/api/lab/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env
    );
    expect(res.status).toBe(401);
  });
});

describe("FIP input validation", () => {
  it("rejects non-numeric portfolio IDs with 400", async () => {
    const env = makeEnv(makeState());
    const res = await app.fetch(new Request("http://localhost/api/portfolios/abc"), env);
    expect(res.status).toBe(400);
  });

  it("rejects invalid portfolio creation payloads with 400", async () => {
    const env = makeEnv(makeState());
    const token = await createAccessToken({ sub: "owner-1" }, env);

    const emptyName = await app.fetch(
      new Request("http://localhost/api/portfolios/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      }),
      env
    );
    expect(emptyName.status).toBe(400);

    const badCurrency = await app.fetch(
      new Request("http://localhost/api/portfolios/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test", base_currency: "INVALID" }),
      }),
      env
    );
    expect(badCurrency.status).toBe(400);

    const reinvestOk = await app.fetch(
      new Request("http://localhost/api/portfolios/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Reinvest Test", base_currency: "USD", dividend_strategy: "REINVEST" }),
      }),
      env
    );
    expect(reinvestOk.status).toBe(200);
  });

  it("rejects invalid transaction payloads with 400", async () => {
    const env = makeEnv(makeState());
    const token = await createAccessToken({ sub: "owner-1" }, env);

    const badType = await app.fetch(
      new Request("http://localhost/api/portfolios/transactions/10", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isin: "SPY", type: "HACK", shares: 10, price: 100 }),
      }),
      env
    );
    expect(badType.status).toBe(400);

    const badShares = await app.fetch(
      new Request("http://localhost/api/portfolios/transactions/10", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isin: "SPY", type: "BUY", shares: -5, price: 100 }),
      }),
      env
    );
    expect(badShares.status).toBe(400);
  });
});

describe("Observability & Request ID", () => {
  it("attaches X-Request-Id header on responses and includes request_id on errors", async () => {
    const env = makeEnv(makeState());
    const okRes = await app.fetch(new Request("http://localhost/health"), env);
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("X-Request-Id")).toBeTruthy();

    const errRes = await app.fetch(
      new Request("http://localhost/api/portfolios/abc", { headers: { "X-Request-Id": "req-123" } }),
      env
    );
    expect(errRes.status).toBe(400);
    const body = (await errRes.json()) as { detail: string; request_id: string };
    expect(body.request_id).toBe("req-123");
  });

  it("preserves CORS headers on POST /api/quant/recommend/explain SSE responses", async () => {
    const env = makeEnv(makeState(), { DEEPSEEK_API_KEY: "ds-test-key" });
    const token = await createAccessToken({ sub: "adv-1" }, env);

    const enc = new TextEncoder();
    const upstreamSse = new ReadableStream({
      start(controller) {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { reasoning_content: "评估利率周期与核心卫星结构..." } }],
            })}\n\n`
          )
        );
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content:
                      '### 一、客观研判\n维持核心配置。\n<tactical_json>{"tactical_summary_zh":"维持核心","adjusted_holdings":[{"lab_id":"VOO","adjusted_weight_pct":100,"reason_zh":"核心保留"}],"lab_directives":{"cma_mode":"historical","capital":100000,"years":5}}</tactical_json>',
                  },
                },
              ],
            })}\n\n`
          )
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(upstreamSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      })
    );

    try {
      const preflightRes = await app.fetch(
        new Request("http://localhost/api/quant/recommend/explain", {
          method: "OPTIONS",
          headers: {
            Origin: "https://fis.wonderwisdom.online",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "accept,authorization,content-type",
          },
        }),
        env
      );
      expect(preflightRes.status).toBe(204);
      expect(preflightRes.headers.get("Access-Control-Allow-Origin")).toBe("https://fis.wonderwisdom.online");
      expect((preflightRes.headers.get("Access-Control-Allow-Headers") || "").toLowerCase()).toContain("accept");

      const res = await app.fetch(
        new Request("http://localhost/api/quant/recommend/explain", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: "https://fis.wonderwisdom.online",
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model: "deepseek-pro",
            stream: true,
            profile: { initial_capital: 100000, horizon_years: 5 },
            recommendation: {
              basket: [
                {
                  lab_id: "VOO",
                  code: "VOO",
                  name: "Vanguard S&P 500 ETF",
                  bucket: "CORE_EQUITY",
                  weight_pct: 100,
                },
              ],
            },
          }),
        }),
        env
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://fis.wonderwisdom.online");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: progress");
      expect(text).toContain("event: result");
      expect(text).toContain("维持核心配置");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
