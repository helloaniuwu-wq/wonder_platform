import { describe, it, expect } from "vitest";
import {
  aggregateReceivables,
  calculateFiscalYear,
  computeProfitAndLoss,
  estimateProfitsTax,
  getFiscalYearDates,
  summarizeCommissionStatements,
} from "./finance";

describe("calculateFiscalYear（4 月起算）", () => {
  it("3 月仍属上一财年，4 月进入新财年", () => {
    expect(calculateFiscalYear(new Date(2025, 2, 31))).toBe("2024-25"); // 3/31
    expect(calculateFiscalYear(new Date(2025, 3, 1))).toBe("2025-26"); // 4/1
  });

  it("跨世纪年份后缀取末两位", () => {
    expect(calculateFiscalYear(new Date(2099, 5, 1))).toBe("2099-00");
  });
});

describe("getFiscalYearDates", () => {
  it("2024-25 对应 2024-04-01 至 2025-03-31", () => {
    expect(getFiscalYearDates("2024-25")).toEqual({ start: "2024-04-01", end: "2025-03-31" });
  });
});

describe("estimateProfitsTax 两级制利得税", () => {
  it("亏损或零利润无须缴税", () => {
    expect(estimateProfitsTax(0, false)).toEqual({ rate_desc: "無須徵稅", estimated_tax: 0, effective_rate: 0 });
    expect(estimateProfitsTax(-500, true).estimated_tax).toBe(0);
  });

  it("法团：首 200 万按 8.25%", () => {
    const r = estimateProfitsTax(1_000_000, false);
    expect(r.estimated_tax).toBe(82_500);
    expect(r.effective_rate).toBe(8.25);
  });

  it("法团：恰好 200 万仍是首级税率", () => {
    expect(estimateProfitsTax(2_000_000, false).estimated_tax).toBe(165_000);
  });

  it("法团：超出 200 万的部分按 16.5%", () => {
    const r = estimateProfitsTax(3_000_000, false);
    expect(r.estimated_tax).toBe(165_000 + 165_000); // 2M*8.25% + 1M*16.5%
    expect(r.effective_rate).toBe(11);
  });

  it("非法团（无限公司/独资）：首 200 万 7.5%，其后 15%", () => {
    expect(estimateProfitsTax(1_000_000, true).estimated_tax).toBe(75_000);
    expect(estimateProfitsTax(3_000_000, true).estimated_tax).toBe(150_000 + 150_000);
  });

  it("税额四舍五入到分", () => {
    expect(estimateProfitsTax(1.01, false).estimated_tax).toBe(0.08); // 0.083325
  });
});

describe("computeProfitAndLoss", () => {
  const base = { invoiceIncome: 600_000, commissionIncome: 400_000, totalExpense: 300_000, totalTaxDeductible: 250_000 };

  it("毛利=总收入-全部支出；应评税利润=总收入-可扣税支出", () => {
    const r = computeProfitAndLoss({ ...base, companyLegalType: "limited" });
    expect(r.totalIncome).toBe(1_000_000);
    expect(r.grossProfit).toBe(700_000);
    expect(r.assessableProfit).toBe(750_000);
  });

  it("净利 = 毛利 - 估算利得税", () => {
    const r = computeProfitAndLoss({ ...base, companyLegalType: "limited" });
    expect(r.taxInfo.estimated_tax).toBe(61_875); // 750000 * 8.25%
    expect(r.netProfit).toBe(700_000 - 61_875);
  });

  it("unlimited 与 sole_prop 使用非法团税率，其他类型/缺失按法团", () => {
    const tax = (t: string | null | undefined) =>
      computeProfitAndLoss({ ...base, companyLegalType: t }).taxInfo.estimated_tax;
    expect(tax("unlimited")).toBe(56_250); // 750000 * 7.5%
    expect(tax("sole_prop")).toBe(56_250);
    expect(tax("limited")).toBe(61_875);
    expect(tax(undefined)).toBe(61_875);
  });

  it("可扣税支出大于收入时，应评税利润不为负、税为 0", () => {
    const r = computeProfitAndLoss({
      invoiceIncome: 100,
      commissionIncome: 0,
      totalExpense: 500,
      totalTaxDeductible: 500,
      companyLegalType: "limited",
    });
    expect(r.assessableProfit).toBe(0);
    expect(r.taxInfo.estimated_tax).toBe(0);
    expect(r.netProfit).toBe(-400); // 亏损保留在净利中
  });
});

describe("summarizeCommissionStatements", () => {
  const stmt = (o: Record<string, unknown>) => ({
    fyc_subtotal: 0,
    renewal_subtotal: 0,
    other_taxable_income: 0,
    total_taxable_income: 0,
    ...o,
  });

  it("无月结单时全部为 0 且视为平衡", () => {
    const r = summarizeCommissionStatements([]);
    expect(r).toMatchObject({ statement_count: 0, total_taxable_income: 0, ytd_check: null, is_balanced: true });
  });

  it("分项逐月累加，null 按 0 处理", () => {
    const r = summarizeCommissionStatements([
      stmt({ fyc_subtotal: 100, renewal_subtotal: 10, total_taxable_income: 110 }),
      stmt({ fyc_subtotal: 200, other_taxable_income: 5, total_taxable_income: 205 }),
      stmt({ fyc_subtotal: null, total_taxable_income: null }),
    ]);
    expect(r.total_fyc).toBe(300);
    expect(r.total_renewal).toBe(10);
    expect(r.total_other_income).toBe(5);
    expect(r.total_taxable_income).toBe(315);
  });

  it("用最后一期的 YTD 校验：差额 < 1 算平衡", () => {
    const r = summarizeCommissionStatements([
      stmt({ total_taxable_income: 100 }),
      stmt({ total_taxable_income: 200.5, ytd_total_taxable: 300 }),
    ]);
    expect(r.ytd_check).toBe(300);
    expect(r.is_balanced).toBe(true);
  });

  it("差额恰好为 1 属于不平衡（严格小于 1 才平衡）", () => {
    expect(
      summarizeCommissionStatements([stmt({ total_taxable_income: 100, ytd_total_taxable: 101 })]).is_balanced
    ).toBe(false);
  });

  it("差额 ≥ 1 不平衡；最后一期无 YTD 则不校验", () => {
    expect(
      summarizeCommissionStatements([stmt({ total_taxable_income: 100, ytd_total_taxable: 102 })]).is_balanced
    ).toBe(false);
    expect(
      summarizeCommissionStatements([
        stmt({ total_taxable_income: 100, ytd_total_taxable: 999 }),
        stmt({ total_taxable_income: 100 }), // 最新一期没有 ytd
      ]).is_balanced
    ).toBe(true);
  });
});

describe("aggregateReceivables", () => {
  const today = "2025-06-01";

  it("按客户汇总已开票、已收、余额，并按余额从大到小排序", () => {
    const r = aggregateReceivables(
      [
        { client_name: "A", total_amount: 100, paid_amount: 40 },
        { client_name: "A", total_amount: 50, paid_amount: 50 },
        { client_name: "B", total_amount: 500, paid_amount: 0 },
      ],
      today
    );
    expect(r.map((c: any) => c.client_name)).toEqual(["B", "A"]);
    expect(r[1]).toMatchObject({ invoice_count: 2, total_billed: 150, total_paid: 90, balance_due: 60 });
  });

  it("逾期：到期日早于今天且有余额；当天到期、已付清、无到期日都不算", () => {
    const r = aggregateReceivables(
      [
        { client_name: "A", total_amount: 100, paid_amount: 0, due_date: "2025-05-31" }, // 逾期 100
        { client_name: "A", total_amount: 100, paid_amount: 0, due_date: "2025-06-01" }, // 当天，不算
        { client_name: "A", total_amount: 100, paid_amount: 100, due_date: "2025-01-01" }, // 已付清
        { client_name: "A", total_amount: 100, paid_amount: 30 }, // 无到期日
        { client_name: "A", total_amount: 100, paid_amount: 20, due_date: "2025-04-01T00:00:00Z" }, // 逾期余额 80
      ],
      today
    );
    expect(r[0].overdue_amount).toBe(180);
  });

  it("缺失客户名归入「未知客戶」，字符串金额按数字处理", () => {
    const r = aggregateReceivables([{ client_name: null, total_amount: "120.5", paid_amount: "20" }], today);
    expect(r[0]).toMatchObject({ client_name: "未知客戶", balance_due: 100.5 });
  });
});
