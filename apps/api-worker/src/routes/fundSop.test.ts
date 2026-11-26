import { beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { createAccessToken } from "../utils/auth";
import { clearQuantStoreCaches } from "../services/quantStore";
import type { Env } from "../types";

interface MockFundSopState {
  users: Record<string, { id: string; email: string; name: string; role: string; is_active: number; is_verified: number }>;
  wq_funds: Array<Record<string, any>>;
  wq_fund_sop_reports: Record<string, Record<string, any>>;
  wq_fund_research_queue: Record<string, Record<string, any>>;
  wq_admin_core_picks: Record<string, Record<string, any>>;
}

function createMockDb(state: MockFundSopState): D1Database {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        params = args;
        return stmt;
      },
      first: async <T = unknown>(): Promise<T | null> => {
        if (sql.includes("FROM users WHERE id = ?")) {
          const u = state.users[String(params[0])];
          return (u && u.is_active === 1 ? u : null) as T | null;
        }
        if (sql.includes("FROM wq_fund_sop_reports WHERE slug = ?")) {
          return (state.wq_fund_sop_reports[String(params[0])] || null) as T | null;
        }
        if (sql.includes("FROM wq_fund_research_queue WHERE slug = ?")) {
          return (state.wq_fund_research_queue[String(params[0])] || null) as T | null;
        }
        if (sql.includes("SELECT COUNT(*) as cnt FROM wq_funds")) {
          return { cnt: state.wq_funds.length } as T;
        }
        if (sql.includes("SELECT COUNT(*) as cnt FROM wq_fund_sop_reports")) {
          return { cnt: Object.keys(state.wq_fund_sop_reports).length } as T;
        }
        return null;
      },
      all: async <T = unknown>() => {
        if (sql.includes("FROM wq_funds f")) {
          const joined = state.wq_funds.map((f) => {
            const sr = state.wq_fund_sop_reports[f.slug];
            const rq = state.wq_fund_research_queue[f.slug];
            const acp = state.wq_admin_core_picks[f.slug];
            return {
              ...f,
              has_sop_report: sr ? 1 : 0,
              sop_medal: sr?.medal_rating || null,
              sop_pillar_score: sr?.pillar_score ?? null,
              sop_valuation_zone: sr?.valuation_zone || null,
              sop_report_date: sr?.report_date || null,
              research_queue_status: rq?.status || null,
              research_request_count: rq?.request_count || 0,
              research_requesters_json: rq?.requesters_json || null,
              is_admin_core_pick: acp ? 1 : 0,
              admin_core_reasons_json: acp?.reasons_json || null,
              admin_core_note: acp?.note || null,
              admin_core_updated_at: acp?.updated_at || null,
              admin_core_updated_by: acp?.updated_by || null,
            };
          });
          return { results: joined as T[], success: true, meta: {} as any };
        }
        if (sql.includes("FROM wq_fund_research_queue rq")) {
          const rows = Object.values(state.wq_fund_research_queue).map((rq) => {
            const sr = state.wq_fund_sop_reports[rq.slug];
            return {
              ...rq,
              has_sop_report: sr ? 1 : 0,
              sop_medal: sr?.medal_rating || null,
              sop_report_date: sr?.report_date || null,
            };
          });
          return { results: rows as T[], success: true, meta: {} as any };
        }
        if (sql.includes("FROM wq_fund_research_queue")) {
          const rows = Object.values(state.wq_fund_research_queue).filter((r) =>
            ["queued", "watching", "in_progress"].includes(r.status)
          );
          return { results: rows as T[], success: true, meta: {} as any };
        }
        return { results: [] as T[], success: true, meta: {} as any };
      },
      run: async () => {
        if (sql.includes("INSERT INTO wq_fund_research_queue")) {
          const slug = String(params[0]);
          state.wq_fund_research_queue[slug] = {
            slug,
            code: params[1],
            fund_name: params[2],
            asset_class: params[3],
            ilas_platform: params[4],
            status: params[5],
            priority: params[6],
            request_count: Number(params[7]),
            requesters_json: String(params[8]),
            first_requested_at: String(params[9]),
            last_requested_at: String(params[10]),
            admin_note: state.wq_fund_research_queue[slug]?.admin_note || null,
            assigned_to: state.wq_fund_research_queue[slug]?.assigned_to || null,
            started_at: state.wq_fund_research_queue[slug]?.started_at || null,
            completed_at: state.wq_fund_research_queue[slug]?.completed_at || null,
          };
        } else if (sql.includes("DELETE FROM wq_fund_research_queue WHERE slug = ?")) {
          delete state.wq_fund_research_queue[String(params[0])];
        } else if (sql.includes("UPDATE wq_fund_research_queue SET request_count = ?")) {
          const slug = String(params[2]);
          if (state.wq_fund_research_queue[slug]) {
            state.wq_fund_research_queue[slug].request_count = Number(params[0]);
            state.wq_fund_research_queue[slug].requesters_json = String(params[1]);
          }
        } else if (sql.includes("INSERT INTO wq_admin_core_picks")) {
          const slug = String(params[0]);
          state.wq_admin_core_picks[slug] = {
            slug,
            reasons_json: String(params[1]),
            note: params[2] ?? null,
            priority: Number(params[3] || 1),
            updated_by: params[4] ?? null,
            created_at: String(params[5]),
            updated_at: String(params[6]),
          };
        } else if (sql.includes("DELETE FROM wq_admin_core_picks WHERE slug = ?")) {
          const target = String(params[0]).toLowerCase();
          for (const k of Object.keys(state.wq_admin_core_picks)) {
            if (k.toLowerCase() === target) delete state.wq_admin_core_picks[k];
          }
        } else if (sql.includes("UPDATE wq_fund_research_queue")) {
          const slug = String(params[6]);
          const row = state.wq_fund_research_queue[slug];
          if (row) {
            row.status = params[0];
            row.priority = params[1];
            row.admin_note = params[2];
            row.assigned_to = params[3];
            row.started_at = params[4];
            row.completed_at = params[5];
          }
        }
        return { success: true, meta: { changes: 1, last_row_id: 1 } as any };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function makeEnv(state: MockFundSopState): Env {
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
  };
}

function makeState(): MockFundSopState {
  return {
    users: {
      "prem-1": { id: "prem-1", email: "p1@test.com", name: "Prem1", role: "premium", is_active: 1, is_verified: 1 },
      "adv-1": { id: "adv-1", email: "a1@test.com", name: "Adv1", role: "advisor", is_active: 1, is_verified: 1 },
      "admin-1": { id: "admin-1", email: "ad@test.com", name: "Admin", role: "admin", is_active: 1, is_verified: 1 },
    },
    wq_funds: [
      {
        slug: "CN_512890",
        code: "512890",
        name: "华泰柏瑞红利低波ETF",
        asset_class: "股票",
        ilas_platform: "非投连险-中国分红",
        currency: "CNY",
        fit_plans_json: "[]",
        tags_json: '["A股"]',
        is_distributing: 0,
        benchmark_code: "000300.SH",
        primary_source: "tencent",
        data_tier: "A",
        is_trackable: 1,
        status: "active",
      },
      {
        slug: "Z29_F",
        code: "Z29",
        aia_code: "Z29",
        name: "资本集团全球公司债基金",
        asset_class: "固定收益",
        ilas_platform: "AIA 卓达智悦2",
        currency: "USD",
        fit_plans_json: '["A","B"]',
        tags_json: '["投连险"]',
        is_distributing: 1,
        benchmark_code: "AGG",
        primary_source: "aia_fundinfo2",
        data_tier: "B",
        is_trackable: 1,
        status: "active",
      },
    ],
    wq_fund_sop_reports: {
      CN_512890: {
        slug: "CN_512890",
        code: "512890",
        fund_name: "华泰柏瑞红利低波ETF",
        sop_version: "2.0",
        report_date: "2026-11-26",
        data_as_of: "2026-11-25",
        fund_type: "ETF",
        val_route: "FV1",
        medal_rating: "Bronze",
        pillar_score: 0.72,
        g1_g5_pass: 1,
        uncertainty: "Medium",
        valuation_zone: "合理偏低",
        valuation_pct_5y: 34.5,
        dividend_yield_ttm: 4.45,
        dividend_spread_rf: 2.35,
        one_liner: "客观商业定位",
        red_flag_top: "行业集中",
        pillar_json: '{"weighted_score":0.72,"medal_rating":"Bronze"}',
        valuation_summary_json: '{"pe_5y_pct":34.5}',
        dividend_summary_json: '{"div_yield_pretax_pct":4.45}',
        masters_json: '[{"master":"John Bogle","stance":"支持"}]',
        commercial_tabs_json: '[{"id":"executive_memo","label":"⚡ 商业与策略速览","markdown":"客观内容"}]',
        decision_md: "# B稿内部决策\nPlan A 建仓线",
        one_pager_md: "# 一页纸",
      },
    },
    wq_fund_research_queue: {},
    wq_admin_core_picks: {},
  };
}

describe("Fund SOP & FIS Hub Research Queue API", () => {
  beforeEach(() => {
    clearQuantStoreCaches();
  });

  it("redacts internal decision_md for premium/advisor and exposes it to admin", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const premToken = await createAccessToken({ sub: "prem-1", role: "premium" }, env);
    const adminToken = await createAccessToken({ sub: "admin-1", role: "admin" }, env);

    const premRes = await app.fetch(
      new Request("http://localhost/api/quant/funds/CN_512890/sop-report", {
        headers: { Authorization: `Bearer ${premToken}` },
      }),
      env
    );
    expect(premRes.status).toBe(200);
    const premBody = (await premRes.json()) as any;
    expect(premBody.has_report).toBe(true);
    expect(premBody.can_view_internal_decision).toBe(false);
    expect(premBody.decision_md).toBeNull();
    expect(premBody.commercial_tabs.length).toBe(1);

    const adminRes = await app.fetch(
      new Request("http://localhost/api/quant/funds/CN_512890/sop-report", {
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env
    );
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as any;
    expect(adminBody.can_view_internal_decision).toBe(true);
    expect(adminBody.decision_md).toContain("Plan A");
  });

  it("deduplicates research queue votes per user and enforces admin-only queue management", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const premToken = await createAccessToken({ sub: "prem-1", role: "premium" }, env);
    const advToken = await createAccessToken({ sub: "adv-1", role: "advisor" }, env);
    const adminToken = await createAccessToken({ sub: "admin-1", role: "admin" }, env);

    // Premium user marks Z29_F twice -> request_count stays 1
    const r1 = await app.fetch(
      new Request("http://localhost/api/quant/funds/Z29_F/research-request", {
        method: "POST",
        headers: { Authorization: `Bearer ${premToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: "关注月派息与久期", priority_hint: "P1_high" }),
      }),
      env
    );
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as any).request_count).toBe(1);

    const r1Again = await app.fetch(
      new Request("http://localhost/api/quant/funds/Z29_F/research-request", {
        method: "POST",
        headers: { Authorization: `Bearer ${premToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: "更新关注点：久期风险" }),
      }),
      env
    );
    expect(((await r1Again.json()) as any).request_count).toBe(1);

    // Second user marks Z29_F -> request_count becomes 2
    const r2 = await app.fetch(
      new Request("http://localhost/api/quant/funds/Z29_F/research-request", {
        method: "POST",
        headers: { Authorization: `Bearer ${advToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: "客户方案50%核心债基核验" }),
      }),
      env
    );
    expect(((await r2.json()) as any).request_count).toBe(2);

    // Non-admin blocked from admin queue
    const forbidden = await app.fetch(
      new Request("http://localhost/api/admin/fund-research-queue", {
        headers: { Authorization: `Bearer ${premToken}` },
      }),
      env
    );
    expect(forbidden.status).toBe(403);

    // Admin reads & updates queue + exports markdown
    const qRes = await app.fetch(
      new Request("http://localhost/api/admin/fund-research-queue", {
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env
    );
    expect(qRes.status).toBe(200);
    const qBody = (await qRes.json()) as any;
    expect(qBody.summary.sop_covered_count).toBe(1);
    expect(qBody.summary.queued_count).toBe(1);
    expect(qBody.items[0].slug).toBe("Z29_F");
    expect(qBody.items[0].request_count).toBe(2);

    const updRes = await app.fetch(
      new Request("http://localhost/api/admin/fund-research-queue/Z29_F", {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress", priority: "P0_urgent", admin_note: "本周优先跑SOP" }),
      }),
      env
    );
    expect(updRes.status).toBe(200);
    expect(((await updRes.json()) as any).priority).toBe("P0_urgent");

    const expRes = await app.fetch(
      new Request("http://localhost/api/admin/fund-research-queue/export?format=markdown", {
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env
    );
    expect(expRes.status).toBe(200);
    const mdText = await expRes.text();
    expect(mdText).toContain("- [ ] Z29_F");
    expect(mdText).toContain("P0_urgent");

    // Premium cancels own vote -> count drops to 1
    const delRes = await app.fetch(
      new Request("http://localhost/api/quant/funds/Z29_F/research-request", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${premToken}` },
      }),
      env
    );
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as any).request_count).toBe(1);
  });

  it("enforces admin-only core pick favorite tagging and filters via GET /api/quant/funds", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const premToken = await createAccessToken({ sub: "prem-1", role: "premium" }, env);
    const adminToken = await createAccessToken({ sub: "admin-1", role: "admin" }, env);

    // Non-admin blocked from PUT and DELETE
    const premPut = await app.fetch(
      new Request("http://localhost/api/quant/funds/CN_512890/admin-core-pick", {
        method: "PUT",
        headers: { Authorization: `Bearer ${premToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reasons: ["低波动增强", "高股息现金流"] }),
      }),
      env
    );
    expect(premPut.status).toBe(403);

    const premDel = await app.fetch(
      new Request("http://localhost/api/quant/funds/CN_512890/admin-core-pick", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${premToken}` },
      }),
      env
    );
    expect(premDel.status).toBe(403);

    // Admin saves favorite with multi-select reasons & note
    const adminPut = await app.fetch(
      new Request("http://localhost/api/quant/funds/CN_512890/admin-core-pick", {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reasons: ["卫星国家", "低波动增强", "高股息现金流"],
          note: "高股息红利低波底仓代表",
        }),
      }),
      env
    );
    expect(adminPut.status).toBe(200);
    const putBody = (await adminPut.json()) as any;
    expect(putBody.is_admin_core_pick).toBe(true);
    expect(putBody.admin_core_reasons).toEqual(["卫星国家", "低波动增强", "高股息现金流"]);
    expect(putBody.admin_core_note).toBe("高股息红利低波底仓代表");

    // GET /api/quant/funds returns facet count and supports ?only_admin_core=true
    const listRes = await app.fetch(
      new Request("http://localhost/api/quant/funds?only_admin_core=true", {
        headers: { Authorization: `Bearer ${premToken}` },
      }),
      env
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.facets.admin_core_picks).toBe(1);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].slug).toBe("CN_512890");
    expect(listBody.items[0].is_admin_core_pick).toBe(true);
    expect(listBody.items[0].admin_core_reasons).toEqual(["卫星国家", "低波动增强", "高股息现金流"]);

    // Admin deletes core pick -> facet drops back to 0
    const adminDel = await app.fetch(
      new Request("http://localhost/api/quant/funds/CN_512890/admin-core-pick", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env
    );
    expect(adminDel.status).toBe(200);
    const afterRes = await app.fetch(
      new Request("http://localhost/api/quant/funds?only_admin_core=true", {
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env
    );
    const afterBody = (await afterRes.json()) as any;
    expect(afterBody.facets.admin_core_picks).toBe(0);
    expect(afterBody.items).toHaveLength(0);
  });
});
