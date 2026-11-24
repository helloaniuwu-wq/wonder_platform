import type { Env } from "../types";

export type ModelPreference =
  | "deepseek-pro"
  | "gemini-deep"
  | "qwen-deep"
  | "claude-sonnet"
  | "deepseek-flash"
  // 向后兼容旧参数
  | "auto"
  | "reasoner"
  | "deepseek"
  | "gemini-pro"
  | "gemini";

export type NormalizedModelPreference =
  | "deepseek-pro"
  | "gemini-deep"
  | "qwen-deep"
  | "claude-sonnet"
  | "deepseek-flash";

export function normalizeModelPreference(pref?: string): NormalizedModelPreference {
  switch (pref) {
    case "deepseek-pro":
    case "auto":
    case "reasoner":
      return "deepseek-pro";
    case "deepseek-flash":
    case "deepseek":
      return "deepseek-flash";
    case "gemini-deep":
    case "gemini-pro":
    case "gemini":
      return "gemini-deep";
    case "qwen-deep":
      return "qwen-deep";
    case "claude-sonnet":
      return "claude-sonnet";
    default:
      return "deepseek-pro";
  }
}

export interface LlmChatOptions {
  modelPreference?: ModelPreference;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LlmChatResult {
  text: string;
  modelUsed: string;
  provider: "deepseek" | "openrouter" | "fallback_rule";
  reasoning?: string;
  fallbackReason?: string;
}

export interface TacticalHoldingAdjustment {
  lab_id: string;
  slug?: string;
  name: string;
  asset_class?: string;
  base_weight_pct: number;
  adjusted_weight_pct: number;
  delta_pct: number;
  reason_zh: string;
  reason_en?: string;
}

export interface TacticalLabDirectives {
  cma_mode: "forward_looking" | "shrunk" | "ltcma" | "raw";
  capital: number;
  years: number;
  withdrawal: number;
  withdrawal_start: number;
  withdrawal_end: number;
  withdrawal_2: number;
  withdrawal_start_2: number;
  withdrawal_end_2: number;
  stress: boolean;
  directive_notes_zh: string;
  directive_notes_en?: string;
}

export interface TacticalAdjustmentPayload {
  tactical_summary_zh: string;
  tactical_summary_en?: string;
  adjusted_holdings: TacticalHoldingAdjustment[];
  lab_directives: TacticalLabDirectives;
}

/**
 * 结构化投资顾问与宏观量化分析 LLM 调用服务
 * 优先采用深度推理与高性价比模型矩阵（DeepSeek V4 Pro 官方直连 / OpenRouter Gemini 3.8 Flash / Qwen 3.7 Plus / Claude Sonnet 5.5）
 */
export async function callLlmChat(
  env: Env,
  userPrompt: string,
  options: LlmChatOptions = {}
): Promise<LlmChatResult> {
  const pref = normalizeModelPreference(options.modelPreference);
  const systemPrompt =
    options.systemPrompt ||
    "你是一位资深的买方量化投资顾问与财富规划专家。请基于客户画像、真实底层资产量化指标、当前宏观利率（高位维持）与权益估值（ERP压缩与估值中枢）环境，给出严谨、专业、结构清晰且具有实操性的配置归因与分析建议。";
  const temperature = options.temperature ?? 0.35;
  const maxTokens = options.maxTokens ?? 4096;

  const errors: string[] = [];

  // 1. 优先判定是否需要直连 OpenRouter（Gemini 3.8 Flash / Qwen 3.7 Plus / Claude Sonnet 5.5）
  const openrouterKey = (env.OPENROUTER_API_KEY || "").trim();
  const deepseekKey = (env.DEEPSEEK_API_KEY || "").trim();
  const openrouterFirst =
    pref === "gemini-deep" || pref === "qwen-deep" || pref === "claude-sonnet";

  const tryDeepseekDirect = async (): Promise<LlmChatResult | null> => {
    if (!deepseekKey) return null;
    try {
      const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
      const configuredModel = (env.DEEPSEEK_MODEL || "").trim();
      const isFlash = pref === "deepseek-flash";
      const modelName = isFlash
        ? "deepseek-flash"
        : configuredModel && !["deepseek-chat", "deepseek-reasoner"].includes(configuredModel)
          ? configuredModel
          : "deepseek-v4-pro";

      const isThinkingPro = modelName !== "deepseek-flash";
      const payload: Record<string, unknown> = {
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: isThinkingPro ? 1.0 : temperature,
        max_tokens: isThinkingPro ? Math.max(maxTokens, 6144) : Math.max(maxTokens, 4096),
      };
      if (isThinkingPro) {
        payload.thinking = { type: "enabled" };
        payload.reasoning_effort = "high";
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deepseekKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        const choice = json.choices?.[0];
        const text = choice?.message?.content || "";
        const reasoning = choice?.message?.reasoning_content || undefined;
        if (text) {
          return { text, modelUsed: modelName, provider: "deepseek", reasoning };
        }
      } else {
        const errText = await res.text().catch(() => "");
        errors.push(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 160)}`);
      }
    } catch (err: any) {
      errors.push(`DeepSeek fetch error: ${err.message || String(err)}`);
    }
    return null;
  };

  const tryOpenRouterChain = async (): Promise<LlmChatResult | null> => {
    if (!openrouterKey) return null;
    const candidateMap: Record<NormalizedModelPreference, string[]> = {
      "deepseek-pro": [
        "deepseek/deepseek-v4-pro-0813",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-r1-0528",
      ],
      "gemini-deep": [
        "google/gemini-3.8-flash",
        "google/gemini-3.7-flash",
        "google/gemini-2.5-pro",
      ],
      "qwen-deep": [
        "qwen/qwen3.7-plus",
        "qwen/qwen3.8-max-0902",
        "qwen/qwen3-235b-a22b-thinking-2507",
      ],
      "claude-sonnet": [
        "anthropic/claude-sonnet-5.5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-sonnet-4.6",
      ],
      "deepseek-flash": [
        "deepseek/deepseek-v4.1-flash",
        "deepseek/deepseek-v4-flash-0731",
        "deepseek/deepseek-v3.2",
      ],
    };
    const modelsToTry = (candidateMap[pref] || candidateMap["deepseek-pro"]).filter(
      (m, i, arr) => arr.indexOf(m) === i
    );
    const baseUrl = (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      ""
    );
    const effectiveMaxTokens =
      pref === "deepseek-flash" ? Math.max(maxTokens, 4096) : Math.max(maxTokens, 6144);

    for (const m of modelsToTry) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openrouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fis.wonderwisdom.online",
            "X-Title": "Wonder Quant Advisory",
          },
          body: JSON.stringify({
            model: m,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature,
            max_tokens: effectiveMaxTokens,
          }),
        });

        if (res.ok) {
          const json = (await res.json()) as any;
          const text = json.choices?.[0]?.message?.content || "";
          const reasoning =
            json.choices?.[0]?.message?.reasoning ||
            json.choices?.[0]?.message?.reasoning_content ||
            undefined;
          if (text) {
            return { text, modelUsed: m, provider: "openrouter", reasoning };
          }
        } else {
          const errText = await res.text().catch(() => "");
          errors.push(`OpenRouter [${m}] HTTP ${res.status}: ${errText.slice(0, 160)}`);
        }
      } catch (err: any) {
        errors.push(`OpenRouter [${m}] error: ${err.message || String(err)}`);
      }
    }
    return null;
  };

  if (openrouterFirst) {
    const orRes = await tryOpenRouterChain();
    if (orRes) return orRes;
    const dsRes = await tryDeepseekDirect();
    if (dsRes) return dsRes;
  } else {
    const dsRes = await tryDeepseekDirect();
    if (dsRes) return dsRes;
    const orRes = await tryOpenRouterChain();
    if (orRes) return orRes;
  }

  // 3. 兜底回退：若两边均未配置 Key 或网络异常，返回高精度结构化规则分析，绝不中断业务
  return {
    text: generateQuantitativeFallbackAnalysis(userPrompt),
    modelUsed: "Rule-Based Quant Advisory Fallback",
    provider: "fallback_rule",
    fallbackReason:
      errors.length > 0
        ? errors.slice(0, 3).join(" | ")
        : "未配置 DEEPSEEK_API_KEY 或 OPENROUTER_API_KEY",
  };
}

function classifyHoldingRole(h: any): "defensive" | "dividend" | "growth" {
  const id = String(h?.lab_id || h?.slug || "").toUpperCase();
  const name = String(h?.name || "").toUpperCase();
  const ac = String(h?.asset_class || "").toLowerCase();

  if (
    id.startsWith("CASH_") ||
    ["BIL", "SGOV", "SHV", "CSH2", "ICSH", "GBIL", "BND", "AGG", "TLT", "IEF", "SHY", "LQD", "HYG", "GLD", "IAU"].includes(id) ||
    ac.includes("cash") ||
    ac.includes("bond") ||
    ac.includes("fixed") ||
    name.includes("现金") ||
    name.includes("货币") ||
    name.includes("短债") ||
    name.includes("债券") ||
    name.includes("固收") ||
    name.includes("TREASURY") ||
    name.includes("BOND") ||
    name.includes("GOLD") ||
    name.includes("黄金")
  ) {
    return "defensive";
  }

  if (
    ["SCHD", "VYM", "VIG", "DGRO", "HDV", "515080", "JEPI", "JEPQ", "DIVO"].includes(id) ||
    name.includes("红利") ||
    name.includes("股息") ||
    name.includes("价值") ||
    name.includes("DIVIDEND") ||
    name.includes("VALUE") ||
    name.includes("INCOME") ||
    name.includes("收益及增长") ||
    ac.includes("dividend") ||
    ac.includes("hybrid")
  ) {
    return "dividend";
  }

  return "growth";
}

function normalizeIntegerWeights(rawWeights: number[]): number[] {
  const total = rawWeights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0 || rawWeights.length === 0) return rawWeights.map(() => 0);
  const scaled = rawWeights.map((w) => (Math.max(0, w) / total) * 100);
  const floored = scaled.map((w) => Math.floor(w));
  let remainder = 100 - floored.reduce((s, w) => s + w, 0);
  const indicesByFrac = scaled
    .map((w, idx) => ({ idx, frac: w - floored[idx] }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) {
    floored[indicesByFrac[i % indicesByFrac.length].idx] += 1;
  }
  return floored;
}

function parseExtraNotesSignals(extraNotes: string, capital: number, years: number) {
  const notes = String(extraNotes || "");
  let spendYear: number | null = null;
  let spendAmount: number | null = null;

  // Match Chinese pattern: "3年后支出15万" / "3年内需要20万留学"
  const zhMatch = notes.match(
    /(\d{1,2})\s*年[后内之]*[^。；;\n]{0,16}?(?:支出|提取|开销|用款|需要|支付|留学|购房|买房|首付)[^0-9]{0,8}(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?/
  );
  if (zhMatch) {
    const y = parseInt(zhMatch[1], 10);
    let amt = parseFloat(zhMatch[2]);
    const unit = zhMatch[3] || "";
    if (unit === "万" || unit.toLowerCase() === "w") amt *= 10000;
    else if (unit.toLowerCase() === "k") amt *= 1000;
    if (y >= 1 && y <= Math.max(years, 40) && amt > 0 && amt <= capital * 1.5) {
      spendYear = y;
      spendAmount = Math.round(amt);
    }
  } else {
    // Match English pattern: "$150k tuition in 3 years"
    const enMatch = notes.match(
      /\$?\s*(\d+(?:\.\d+)?)\s*(k|K|m|M)?[^.;\n]{0,24}?\bin\s+(\d{1,2})\s+years?/i
    );
    if (enMatch) {
      let amt = parseFloat(enMatch[1]);
      const unit = (enMatch[2] || "").toLowerCase();
      if (unit === "k") amt *= 1000;
      else if (unit === "m") amt *= 1000000;
      const y = parseInt(enMatch[3], 10);
      if (y >= 1 && y <= Math.max(years, 40) && amt > 0 && amt <= capital * 1.5) {
        spendYear = y;
        spendAmount = Math.round(amt);
      }
    }
  }

  const hasNearTermSpend =
    spendYear !== null ||
    /留学|购房|买房|首付|结婚|大额支出|刚性支出|保本|tuition|downpayment|near-term/i.test(notes);
  const hasValuationConcern =
    /高估值|估值|美股|科技股|erp|泡沫|回调|锁定|高息|短债|valuation|elevated|\bpe\b|yield/i.test(
      notes
    );
  const hasExistingIlliquid = /房产|分红险|保单|储蓄险|annuity|property|insurance/i.test(notes);
  const hasRetirementCashflow = /退休|养老|现金流|每月|生活费|派息|retire|monthly|cashflow/i.test(
    notes
  );

  return {
    spendYear,
    spendAmount,
    hasNearTermSpend,
    hasValuationConcern,
    hasExistingIlliquid,
    hasRetirementCashflow,
  };
}

/**
 * 基于客户画像、补充约束（extra_notes）与当前高利率/高估值宏观时钟的确定性战术调仓与实验室指令引擎。
 * 既作为未配置 API Key 或 LLM 未产出合规 JSON 时的 100% 可靠兜底，也提供实验室现金流参数默认校准。
 */
export function buildDeterministicTacticalAdjustment(
  profile: any,
  rec: any
): TacticalAdjustmentPayload {
  const holdings: any[] = Array.isArray(rec?.holdings) ? rec.holdings : [];
  const capital = Math.max(1000, Number(profile?.initial_capital) || 500000);
  const years = Math.min(40, Math.max(3, Number(profile?.horizon_years) || 10));
  const annualWithdrawal = Math.max(0, Number(profile?.annual_withdrawal) || 0);
  const signals = parseExtraNotesSignals(profile?.extra_notes || "", capital, years);

  const roles = holdings.map(classifyHoldingRole);
  const baseWeights = normalizeIntegerWeights(
    holdings.map((h) => Number(h?.weight_pct ?? h?.weight ?? 0))
  );
  const adjustedFloats = [...baseWeights];

  const growthIndices = roles
    .map((r, i) => (r === "growth" ? i : -1))
    .filter((i) => i >= 0);
  const defensiveIndices = roles
    .map((r, i) => (r === "defensive" ? i : -1))
    .filter((i) => i >= 0);
  const dividendIndices = roles
    .map((r, i) => (r === "dividend" ? i : -1))
    .filter((i) => i >= 0);

  // 计算战术偏离幅度：优先将高估值成长权益向高息短债与低估红利迁移
  let shiftBudget = 0;
  if (growthIndices.length > 0 && (defensiveIndices.length > 0 || dividendIndices.length > 0)) {
    // 基础宏观时钟偏离：高估值 + 高利率环境适度去泡沫 4%
    shiftBudget = 4;
    if (signals.hasNearTermSpend) shiftBudget += 6;
    if (signals.hasValuationConcern) shiftBudget += 4;
    if (signals.hasRetirementCashflow) shiftBudget += 2;
    if (signals.spendAmount && capital > 0) {
      const spendPct = Math.round((signals.spendAmount / capital) * 100);
      shiftBudget = Math.max(shiftBudget, Math.min(18, Math.round(spendPct * 0.5)));
    }

    const totalGrowth = growthIndices.reduce((s, i) => s + adjustedFloats[i], 0);
    const maxTransferable = Math.max(0, totalGrowth - growthIndices.length * 5);
    const actualShift = Math.min(shiftBudget, maxTransferable);

    if (actualShift > 0) {
      for (const idx of growthIndices) {
        const share = adjustedFloats[idx] / Math.max(1, totalGrowth);
        adjustedFloats[idx] -= actualShift * share;
      }
      // 分配权重至防御/固收与高股息
      const defWeightShare =
        defensiveIndices.length > 0 && dividendIndices.length > 0
          ? signals.hasNearTermSpend
            ? 0.7
            : 0.55
          : defensiveIndices.length > 0
            ? 1.0
            : 0.0;
      const divWeightShare = 1 - defWeightShare;

      if (defensiveIndices.length > 0 && defWeightShare > 0) {
        const perDef = (actualShift * defWeightShare) / defensiveIndices.length;
        for (const idx of defensiveIndices) adjustedFloats[idx] += perDef;
      }
      if (dividendIndices.length > 0 && divWeightShare > 0) {
        const perDiv = (actualShift * divWeightShare) / dividendIndices.length;
        for (const idx of dividendIndices) adjustedFloats[idx] += perDiv;
      }
    }
  } else if (dividendIndices.length > 0 && defensiveIndices.length > 0 && signals.hasNearTermSpend) {
    // 无成长股但有短期刚性支出时，从高股息微调 5% 至固收现金锁定专款
    const divTotal = dividendIndices.reduce((s, i) => s + adjustedFloats[i], 0);
    const actualShift = Math.min(5, Math.max(0, divTotal - dividendIndices.length * 5));
    if (actualShift > 0) {
      for (const idx of dividendIndices) {
        adjustedFloats[idx] -= actualShift * (adjustedFloats[idx] / Math.max(1, divTotal));
      }
      for (const idx of defensiveIndices) {
        adjustedFloats[idx] += actualShift / defensiveIndices.length;
      }
    }
  }

  const finalWeights = normalizeIntegerWeights(adjustedFloats);

  const adjusted_holdings: TacticalHoldingAdjustment[] = holdings.map((h, i) => {
    const baseW = baseWeights[i] ?? 0;
    const adjW = finalWeights[i] ?? baseW;
    const delta = adjW - baseW;
    const role = roles[i];

    let reason_zh = h.rationale_zh || "维持战略基准权重";
    let reason_en = h.rationale_en || "Maintain strategic core weight";

    if (role === "defensive") {
      if (delta > 0) {
        reason_zh = signals.hasNearTermSpend
          ? `上调 +${delta}%：锁定当前 4.5%+ 美元无风险高票息，隔离近期刚性用款免受权益回调冲击`
          : `上调 +${delta}%：顺应利率高位维持周期，提高高息固收底仓与回撤缓冲厚度`;
        reason_en = `Increased +${delta}%: Lock in 4.5%+ short-duration yield and buffer near-term liquidity needs.`;
      } else {
        reason_zh = "维持高确定性固收票息安全垫，提供流动性与波动缓冲";
      }
    } else if (role === "dividend") {
      if (delta > 0) {
        reason_zh = `上调 +${delta}%：承接高估值权益减仓资金，获取 3.5%~6% 真实股息现金流与低估值修复空间`;
        reason_en = `Increased +${delta}%: Capture attractive dividend yield & lower valuation multiple risk.`;
      } else if (delta < 0) {
        reason_zh = `微调 ${delta}%：配合短久期现金锁仓需求腾挪安全垫额度，保留核心生息仓位`;
      } else {
        reason_zh = "承担组合稳定派息与低估值防御核心职责";
      }
    } else {
      if (delta < 0) {
        reason_zh = signals.hasValuationConcern
          ? `下调 ${delta}%：应对美股高估值与低 ERP 约束，防范估值均值回归带来的尾部回撤`
          : `下调 ${delta}%：适度兑现高估值成长敞口，向高息防御资产再平衡`;
        reason_en = `Reduced ${delta}%: Trim elevated equity valuation exposure under compressed ERP.`;
      } else {
        reason_zh = "保留长期全球经济增长复利敞口，兼顾抗通胀增值";
      }
    }

    return {
      lab_id: String(h.lab_id || h.slug || ""),
      slug: h.slug,
      name: String(h.name || h.lab_id || ""),
      asset_class: h.asset_class,
      base_weight_pct: baseW,
      adjusted_weight_pct: adjW,
      delta_pct: delta,
      reason_zh,
      reason_en,
    };
  });

  // 组装实验室前瞻模拟参数指令
  let withdrawal = annualWithdrawal;
  let withdrawal_start = 1;
  let withdrawal_end = years;
  let withdrawal_2 = 0;
  let withdrawal_start_2 = Math.min(years, years + 1);
  let withdrawal_end_2 = Math.max(years, 30);
  const directivePartsZh: string[] = [
    "默认启用「宏观利率与估值时钟前瞻 (forward_looking)」校准模式",
  ];
  const directivePartsEn: string[] = ["Use Forward-Looking Yield & Valuation CMA mode"];

  if (signals.spendYear && signals.spendAmount) {
    const sy = Math.min(years, Math.max(1, signals.spendYear));
    if (annualWithdrawal > 0) {
      // 有常规提领时，通过第二段提领叠加该特定年份的一次性大额支出
      withdrawal_2 = signals.spendAmount;
      withdrawal_start_2 = sy;
      withdrawal_end_2 = sy;
      directivePartsZh.push(
        `第 1–${years} 年每年常规提领 ${annualWithdrawal.toLocaleString()}，并于第 ${sy} 年叠加一次性刚性支出 ${signals.spendAmount.toLocaleString()}`
      );
      directivePartsEn.push(
        `Annual withdrawal ${annualWithdrawal.toLocaleString()} + year-${sy} lump spend ${signals.spendAmount.toLocaleString()}`
      );
    } else {
      withdrawal = signals.spendAmount;
      withdrawal_start = sy;
      withdrawal_end = sy;
      directivePartsZh.push(
        `已自动注入第 ${sy} 年一次性大额支出 ${signals.spendAmount.toLocaleString()} 的现金流冲击`
      );
      directivePartsEn.push(`Injected year-${sy} lump-sum outflow of ${signals.spendAmount.toLocaleString()}`);
    }
  } else if (annualWithdrawal > 0) {
    directivePartsZh.push(
      `按第 1–${years} 年每年提领 ${annualWithdrawal.toLocaleString()} 检验不断流概率`
    );
  }

  if (signals.hasValuationConcern) {
    directivePartsZh.push("建议开启极端波动压力情景对比估值回调抗摔力");
  }

  const summaryPartsZh: string[] = [];
  if (signals.hasNearTermSpend) {
    summaryPartsZh.push("响应客户近期刚性用款与本金安全诉求，增配短久期美元高息固收专款隔离风险");
  }
  if (signals.hasValuationConcern || growthIndices.length > 0) {
    summaryPartsZh.push(
      "结合当前 4.5%+ 政策利率高位与美股低 ERP 环境，适度压降高估值权益敞口并向低估红利资产倾斜"
    );
  }
  if (signals.hasExistingIlliquid) {
    summaryPartsZh.push("考虑客户已有房产/保单底仓，重点保持本专户高流动性与现金流灵活度");
  }
  if (summaryPartsZh.length === 0) {
    summaryPartsZh.push(
      "基于当前宏观利率与权益估值分位数，微调固收安全垫与高股息防御权重，优化前瞻夏普比"
    );
  }

  return {
    tactical_summary_zh: summaryPartsZh.join("；") + "。",
    tactical_summary_en:
      "Tactically tilted toward 4.5%+ high-yield fixed income & value dividends while trimming elevated equity valuation exposure.",
    adjusted_holdings,
    lab_directives: {
      cma_mode: "forward_looking",
      capital,
      years,
      withdrawal,
      withdrawal_start,
      withdrawal_end,
      withdrawal_2,
      withdrawal_start_2,
      withdrawal_end_2,
      stress: signals.hasValuationConcern,
      directive_notes_zh: directivePartsZh.join("；") + "。",
      directive_notes_en: directivePartsEn.join("; "),
    },
  };
}

/**
 * 从 LLM 回复中提取并标准化结构化调仓指令 <tactical_json>...</tactical_json> 或尾部 ```json``` 块，
 * 剥离 JSON 标签返回纯净 Markdown，并对权重与标的进行严格白名单归一化（强制加和 = 100%）。
 */
export function extractAndNormalizeTacticalJson(
  rawText: string,
  profile: any,
  rec: any
): { cleanMarkdown: string; tacticalAdjustment: TacticalAdjustmentPayload } {
  const fallback = buildDeterministicTacticalAdjustment(profile, rec);
  let text = String(rawText || "").trim();

  // 如果模型把整份 Markdown 包在 ```markdown ... ``` 外壳里，剥掉外壳
  if (text.startsWith("```markdown")) {
    text = text.replace(/^```markdown\s*/i, "");
    if (text.endsWith("```") && !text.includes("<tactical_json>")) {
      text = text.replace(/\s*```$/, "");
    }
  }

  let jsonStr: string | null = null;
  let cleanMarkdown = text;

  const tagMatch = text.match(/<tactical_json>\s*([\s\S]*?)\s*<\/tactical_json>/i);
  if (tagMatch) {
    jsonStr = tagMatch[1].trim();
    cleanMarkdown = text.replace(tagMatch[0], "").trim();
  } else {
    const fencedJsonMatches = [...text.matchAll(/```json\s*([\s\S]*?)\s*```/gi)];
    if (fencedJsonMatches.length > 0) {
      const lastMatch = fencedJsonMatches[fencedJsonMatches.length - 1];
      jsonStr = lastMatch[1].trim();
      cleanMarkdown = text.replace(lastMatch[0], "").trim();
    }
  }

  // 再清理尾部可能残余的外层围栏
  cleanMarkdown = cleanMarkdown.replace(/\s*```$/, "").trim();

  if (!jsonStr) {
    return { cleanMarkdown, tacticalAdjustment: fallback };
  }

  try {
    // 去掉可能的 markdown 围栏包装
    jsonStr = jsonStr.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object") {
      return { cleanMarkdown, tacticalAdjustment: fallback };
    }

    const baseHoldings: any[] = Array.isArray(rec?.holdings) ? rec.holdings : [];
    if (baseHoldings.length === 0) {
      return { cleanMarkdown, tacticalAdjustment: fallback };
    }

    // 严格校验：只接受原始推荐篮子中存在的标的 lab_id，杜绝幻觉代码导致实验室查找失败
    const parsedByLabId = new Map<string, any>();
    if (Array.isArray(parsed.adjusted_holdings)) {
      for (const item of parsed.adjusted_holdings) {
        const key = String(item?.lab_id || "").toUpperCase().trim();
        if (key) parsedByLabId.set(key, item);
      }
    }

    if (parsedByLabId.size === 0) {
      return { cleanMarkdown, tacticalAdjustment: fallback };
    }

    const baseWeights = normalizeIntegerWeights(
      baseHoldings.map((h) => Number(h?.weight_pct ?? h?.weight ?? 0))
    );
    const rawAdjustedFloats = baseHoldings.map((h, i) => {
      const key = String(h?.lab_id || h?.slug || "").toUpperCase().trim();
      const match = parsedByLabId.get(key);
      if (match && typeof match.adjusted_weight_pct === "number" && Number.isFinite(match.adjusted_weight_pct)) {
        return Math.max(0, Math.min(100, match.adjusted_weight_pct));
      }
      return baseWeights[i];
    });

    const normalizedAdjusted = normalizeIntegerWeights(rawAdjustedFloats);

    const adjusted_holdings: TacticalHoldingAdjustment[] = baseHoldings.map((h, i) => {
      const key = String(h?.lab_id || h?.slug || "").toUpperCase().trim();
      const match = parsedByLabId.get(key);
      const fb = fallback.adjusted_holdings[i];
      const baseW = baseWeights[i];
      const adjW = normalizedAdjusted[i];
      const delta = adjW - baseW;
      const fallbackReasonEn =
        fb && fb.delta_pct === delta && fb.reason_en
          ? fb.reason_en
          : delta > 0
            ? `Increased +${delta}%: Tactical overweight aligned with macro rate & valuation regime.`
            : delta < 0
              ? `Reduced ${delta}%: Tactical trim to manage valuation or currency risk.`
              : h.rationale_en || "Maintain strategic core weight.";
      return {
        lab_id: String(h.lab_id || h.slug || ""),
        slug: h.slug,
        name: String(h.name || h.lab_id || ""),
        asset_class: h.asset_class,
        base_weight_pct: baseW,
        adjusted_weight_pct: adjW,
        delta_pct: delta,
        reason_zh:
          typeof match?.reason_zh === "string" && match.reason_zh.trim()
            ? match.reason_zh.trim()
            : fb?.reason_zh || h.rationale_zh || "核心配置",
        reason_en:
          typeof match?.reason_en === "string" && match.reason_en.trim()
            ? match.reason_en.trim()
            : fallbackReasonEn,
      };
    });

    const d = parsed.lab_directives && typeof parsed.lab_directives === "object" ? parsed.lab_directives : {};
    const fbDir = fallback.lab_directives;
    const allowedCma = new Set(["forward_looking", "shrunk", "ltcma", "raw"]);
    const yearsVal =
      typeof d.years === "number" && Number.isFinite(d.years)
        ? Math.min(40, Math.max(3, Math.round(d.years)))
        : fbDir.years;

    const lab_directives: TacticalLabDirectives = {
      cma_mode: allowedCma.has(d.cma_mode) ? d.cma_mode : "forward_looking",
      capital:
        typeof d.capital === "number" && d.capital > 0 ? Math.round(d.capital) : fbDir.capital,
      years: yearsVal,
      withdrawal:
        typeof d.withdrawal === "number" && d.withdrawal >= 0
          ? Math.round(d.withdrawal)
          : fbDir.withdrawal,
      withdrawal_start:
        typeof d.withdrawal_start === "number" && d.withdrawal_start >= 1
          ? Math.min(yearsVal, Math.round(d.withdrawal_start))
          : fbDir.withdrawal_start,
      withdrawal_end:
        typeof d.withdrawal_end === "number" && d.withdrawal_end >= 1
          ? Math.min(40, Math.round(d.withdrawal_end))
          : fbDir.withdrawal_end,
      withdrawal_2:
        typeof d.withdrawal_2 === "number" && d.withdrawal_2 >= 0
          ? Math.round(d.withdrawal_2)
          : fbDir.withdrawal_2,
      withdrawal_start_2:
        typeof d.withdrawal_start_2 === "number" && d.withdrawal_start_2 >= 1
          ? Math.min(40, Math.round(d.withdrawal_start_2))
          : fbDir.withdrawal_start_2,
      withdrawal_end_2:
        typeof d.withdrawal_end_2 === "number" && d.withdrawal_end_2 >= 1
          ? Math.min(40, Math.round(d.withdrawal_end_2))
          : fbDir.withdrawal_end_2,
      stress: typeof d.stress === "boolean" ? d.stress : fbDir.stress,
      directive_notes_zh:
        typeof d.directive_notes_zh === "string" && d.directive_notes_zh.trim()
          ? d.directive_notes_zh.trim()
          : fbDir.directive_notes_zh,
      directive_notes_en:
        typeof d.directive_notes_en === "string" && d.directive_notes_en.trim()
          ? d.directive_notes_en.trim()
          : fbDir.directive_notes_en,
    };

    return {
      cleanMarkdown,
      tacticalAdjustment: {
        tactical_summary_zh:
          typeof parsed.tactical_summary_zh === "string" && parsed.tactical_summary_zh.trim()
            ? parsed.tactical_summary_zh.trim()
            : fallback.tactical_summary_zh,
        tactical_summary_en:
          typeof parsed.tactical_summary_en === "string" && parsed.tactical_summary_en.trim()
            ? parsed.tactical_summary_en.trim()
            : fallback.tactical_summary_en,
        adjusted_holdings,
        lab_directives,
      },
    };
  } catch {
    return { cleanMarkdown, tacticalAdjustment: fallback };
  }
}

/**
 * 当未配置 API Key 或外部网络超时时的专业量化配置分析兜底生成器
 */
function generateQuantitativeFallbackAnalysis(_userPrompt: string): string {
  return `### 【宏观利率与估值时钟研判】
1. **利率高位维持（Higher for Longer）的安全垫效应**：
   当前美元联邦基金利率处于 4.50%~4.75% 高位区间，短债（如 BIL）与货币型资产静态年化到期收益率可达 4.3%~4.6%。与过去十余年的零利率时期不同，当前持有高质量固收资产不仅能提供稳定的当期票息现金流，更可在未来降息周期开启时捕捉潜在的久期资本利得。
2. **权益估值分位数与股权风险溢价（ERP）约束**：
   美股核心指数（S&P 500 / Nasdaq 100）市盈率处于历史 80% 以上偏高分位数，股权风险溢价压缩至历史低点，单纯追逐历史高收益面临估值均值回归（Multiple Contraction）的拖累；相形之下，中港通红利低波与全球价值股具有 5%~7% 股息率保护，兼顾防御与再投资复利。

### 【组合底层资产角色分工与配置逻辑】
- **现金流与流动性锚**：配置高确定性短期固收标的，锁定当前高票息，作为应对潜在现金提领及市场波动的安全气垫；
- **核心稳健压舱石**：配置优质红利及投资级债券，平滑净值波动，提供内生派息资金，无需在市场下挫时被迫折价抛售股票资产；
- **长期成长增益舱**：适度配置全球核心宽基指数资产，确保投资组合具备抵抗通胀并参与全球生产力长期扩张的能力。

### 【操作指引与再平衡纪律】
- **再平衡触发**：建议设定资产权重漂移阈值（±5%）或半年度定期再平衡，在权益上涨时锁利反哺固收，在市场非理性回调时低位补仓；
- **分红策略**：无短期刚性支取需求时，建议开启分红再投资（DRIP），最大化长周期复利雪球效应。

> *(提示：当前分析基于量化规则库自动归因。若需启用 DeepSeek / Gemini 大模型深度定制推理，请在 \`apps/api-worker/.dev.vars\` 中配置 DEEPSEEK_API_KEY 或 OPENROUTER_API_KEY)*`;
}
