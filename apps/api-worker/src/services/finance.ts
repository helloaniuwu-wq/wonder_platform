/**
 * 财务纯计算（无 I/O）：财年、利得税估算、佣金年度汇总、应收账款汇总、损益汇总。
 * 从 routes/financials.ts、routes/commissions.ts、routes/expenses.ts 中抽出，便于单元测试。
 */

/** 香港财年：4 月 1 日至次年 3 月 31 日，返回形如 "2024-25" */
export function calculateFiscalYear(d: Date): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export function getFiscalYearDates(fy: string): { start: string; end: string } {
  try {
    const startYr = parseInt(fy.split("-")[0], 10);
    return {
      start: `${startYr}-04-01`,
      end: `${startYr + 1}-03-31`,
    };
  } catch {
    const yr = new Date().getFullYear();
    return { start: `${yr}-04-01`, end: `${yr + 1}-03-31` };
  }
}

export function estimateProfitsTax(profit: number, isUnlimited: boolean) {
  if (profit <= 0) {
    return { rate_desc: "無須徵稅", estimated_tax: 0, effective_rate: 0 };
  }
  const tier1Limit = 2000000;
  if (!isUnlimited) {
    // 8.25% / 16.5%
    let tax = 0;
    let desc = "";
    if (profit <= tier1Limit) {
      tax = profit * 0.0825;
      desc = "8.25%（法團兩級制首級）";
    } else {
      tax = tier1Limit * 0.0825 + (profit - tier1Limit) * 0.165;
      desc = "8.25% / 16.5%（法團兩級制）";
    }
    return {
      rate_desc: desc,
      estimated_tax: Math.round(tax * 100) / 100,
      effective_rate: Math.round((tax / profit) * 10000) / 100,
    };
  } else {
    // 7.5% / 15%
    let tax = 0;
    let desc = "";
    if (profit <= tier1Limit) {
      tax = profit * 0.075;
      desc = "7.5%（非法團兩級制首級）";
    } else {
      tax = tier1Limit * 0.075 + (profit - tier1Limit) * 0.15;
      desc = "7.5% / 15%（非法團兩級制）";
    }
    return {
      rate_desc: desc,
      estimated_tax: Math.round(tax * 100) / 100,
      effective_rate: Math.round((tax / profit) * 10000) / 100,
    };
  }
}

/** 损益汇总：收入、支出、可扣税支出 → 毛利、应评税利润、估算利得税、净利 */
export function computeProfitAndLoss(input: {
  invoiceIncome: number;
  commissionIncome: number;
  totalExpense: number;
  totalTaxDeductible: number;
  companyLegalType: string | null | undefined;
}) {
  const totalIncome = input.invoiceIncome + input.commissionIncome;
  const grossProfit = totalIncome - input.totalExpense;
  const assessableProfit = Math.max(0, totalIncome - input.totalTaxDeductible);
  const isUnlimited = ["unlimited", "sole_prop"].includes(String(input.companyLegalType));
  const taxInfo = estimateProfitsTax(assessableProfit, isUnlimited);
  const netProfit = grossProfit - taxInfo.estimated_tax;
  return { totalIncome, grossProfit, assessableProfit, taxInfo, netProfit };
}

/** 佣金月结单年度汇总，并用最新一期的 YTD 校验合计是否平衡（容差 1.0） */
export function summarizeCommissionStatements(stmts: any[]) {
  const totalFyc = stmts.reduce((a, s) => a + Number(s.fyc_subtotal || 0), 0);
  const totalRenewal = stmts.reduce((a, s) => a + Number(s.renewal_subtotal || 0), 0);
  const totalOther = stmts.reduce((a, s) => a + Number(s.other_taxable_income || 0), 0);
  const totalTaxable = stmts.reduce((a, s) => a + Number(s.total_taxable_income || 0), 0);

  const latest = stmts.length > 0 ? stmts[stmts.length - 1] : null;
  const ytdCheck = latest && latest.ytd_total_taxable != null ? Number(latest.ytd_total_taxable) : null;

  return {
    statement_count: stmts.length,
    total_fyc: totalFyc,
    total_renewal: totalRenewal,
    total_other_income: totalOther,
    total_taxable_income: totalTaxable,
    ytd_check: ytdCheck,
    is_balanced: ytdCheck != null ? Math.abs(totalTaxable - ytdCheck) < 1.0 : true,
  };
}

/** 应收账款按客户汇总；today 为 YYYY-MM-DD，到期日早于 today 且有余额才算逾期 */
export function aggregateReceivables(
  invoices: Array<{ client_name?: string | null; total_amount?: any; paid_amount?: any; due_date?: string | null }>,
  today: string
) {
  const clientMap: Record<string, any> = {};

  for (const inv of invoices) {
    const cname = inv.client_name || "未知客戶";
    if (!clientMap[cname]) {
      clientMap[cname] = {
        client_name: cname,
        invoice_count: 0,
        total_billed: 0,
        total_paid: 0,
        balance_due: 0,
        overdue_amount: 0,
      };
    }
    const tot = Number(inv.total_amount || 0);
    const paid = Number(inv.paid_amount || 0);
    const bal = tot - paid;

    clientMap[cname].invoice_count++;
    clientMap[cname].total_billed += tot;
    clientMap[cname].total_paid += paid;
    clientMap[cname].balance_due += bal;

    if (inv.due_date && inv.due_date.slice(0, 10) < today && bal > 0) {
      clientMap[cname].overdue_amount += bal;
    }
  }

  return Object.values(clientMap).sort((a: any, b: any) => b.balance_due - a.balance_due);
}
