import React, { useMemo, useState } from 'react';
import MarkdownReport from './MarkdownReport';
import {
  Compass,
  Sliders,
  Sparkles,
  FlaskConical,
  PlusCircle,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  Layers,
  AlertCircle,
  MessageSquare,
  Save,
  FolderOpen,
  Copy,
  Check,
  Trash2,
  X,
  Clock,
  ArrowRight,
  Zap,
  RefreshCw,
  Star,
} from 'lucide-react';
import { authHeaders } from '../utils/auth';
import { gradeMeta } from '../utils/fundQuantUtils';
import { useLang } from '../i18n/langCore';

const RISK_QUESTIONS = [
  {
    key: 'drawdown',
    zh: '1. 未来 1 年内，客户账户最多能接受多大幅度的账面回调？',
    en: '1. Max acceptable 1-year drawdown tolerance?',
    options: [
      { value: 12, zh: '严格防守（≤ 8%）', en: 'Strict (≤ 8%)' },
      { value: 38, zh: '温和波动（8% – 15%）', en: 'Mild (8–15%)' },
      { value: 64, zh: '中等均衡（15% – 25%）', en: 'Moderate (15–25%)' },
      { value: 88, zh: '长期承受（> 25% 可忍受）', en: 'High (> 25%)' },
    ],
  },
  {
    key: 'experience',
    zh: '2. 客户过往核心投资与配置经验属于？',
    en: '2. Primary prior investment experience?',
    options: [
      { value: 15, zh: '存款 / 货基 / 保本理财为主', en: 'Deposits / Money Market' },
      { value: 42, zh: '债券基金 / 分红收息产品', en: 'Bonds & Income Funds' },
      { value: 66, zh: '全球股债指数 ETF / ILP', en: 'Global ETF / ILP' },
      { value: 90, zh: '主动权益 / 多策略进阶配置', en: 'Active Equity / Multi-Asset' },
    ],
  },
  {
    key: 'liquidity',
    zh: '3. 未来 2–3 年内，该笔资金被临时大额抽调的概率？',
    en: '3. Probability of unexpected near-term withdrawal (2–3Y)?',
    options: [
      { value: 18, zh: '较高（可能随时取用）', en: 'High (flexible cash)' },
      { value: 44, zh: '中等（需预留部分派息）', en: 'Medium (partial income)' },
      { value: 70, zh: '较低（中长期专款专用）', en: 'Low (earmarked)' },
      { value: 88, zh: '极低（可跨周期锁定增值）', en: 'Very low (long lockup)' },
    ],
  },
  {
    key: 'cushion',
    zh: '4. 客户现金流安全垫与抗风险缓冲能力？',
    en: '4. Cashflow buffer & financial cushion?',
    options: [
      { value: 20, zh: '已退休 / 依赖本账户提供生活费', en: 'Retired / Income dependent' },
      { value: 48, zh: '稳定薪金收入 / 收支稳健', en: 'Stable salary' },
      { value: 72, zh: '多元收入 / 资产充裕', en: 'Multiple income streams' },
      { value: 92, zh: '高净值企业主 / 强流动性储备', en: 'HNW / Strong reserves' },
    ],
  },
];

const RISK_TIERS = [
  { id: 'conservative', zh: '保守防御', en: 'Conservative', score: 20 },
  { id: 'moderate_conservative', zh: '稳健收息', en: 'Mod. Conservative', score: 38 },
  { id: 'balanced', zh: '均衡配置', en: 'Balanced', score: 55 },
  { id: 'growth', zh: '积极成长', en: 'Growth', score: 75 },
  { id: 'aggressive', zh: '进取增值', en: 'Aggressive', score: 90 },
];

const GOALS = [
  { id: 'income', zh: '现金流收息', en: 'Cashflow Income', hintZh: '月/季派息，支持提领', hintEn: 'Regular dividend distributions' },
  { id: 'preservation', zh: '稳健保值', en: 'Capital Preservation', hintZh: '低回撤，跑赢通胀', hintEn: 'Low drawdown & stability' },
  { id: 'balanced', zh: '平衡增值', en: 'Balanced Growth', hintZh: '股债分散，攻守兼备', hintEn: 'Diversified equity/bond core' },
  { id: 'growth', zh: '长期成长', en: 'Long-Term Growth', hintZh: '追求较高复利回报', hintEn: 'Compound total return' },
  { id: 'retirement', zh: '退休规划', en: 'Retirement', hintZh: '前期积累 + 退休期提取', hintEn: 'Accumulation & decumulation' },
  { id: 'education', zh: '子女教育', en: 'Education Fund', hintZh: '确定期限专款配置', hintEn: 'Horizon-matched goal' },
];

const SCOPES = [
  { id: 'all', zh: '非投连险全市场基金 / ETF（纯平台外）', en: 'All Non-ILAS Funds & ETFs (Off-Platform)' },
  { id: 'aia_tmp2', zh: 'AIA 卓达智悦2 投连险池（纯投连险）', en: 'AIA TMP2 ILAS Pool (Pure ILAS)' },
  { id: 'eu_ucits', zh: '非投连险 · 欧洲基金（爱尔兰/卢森堡 UCITS，免美遗产税）', en: 'Non-ILAS · European UCITS (IE/LU, US Estate-Tax Exempt)' },
  { id: 'global_etf', zh: '非投连险 · 全球 / 美日低费 ETF', en: 'Non-ILAS · Global ETFs' },
  { id: 'cn_hk_dividend', zh: '非投连险 · 中港通红利与 A 股 ETF', en: 'Non-ILAS · CN / HK Dividend ETFs' },
  { id: 'bonds_income', zh: '债券与高息防御专场（按投连险开关隔离）', en: 'Bonds & Income (Isolated by ILP toggle)' },
];

const QUICK_NOTES_TAGS = [
  { zh: '关注美国遗产税风险（非美居民6万美元免税额上限），倾向采用卢森堡或爱尔兰欧洲UCITS基金', en: 'Concerned about US estate tax ($60k NRA exemption); prefer Luxembourg or Ireland European UCITS funds' },
  { zh: '3年内有刚性大额支出（子女海外留学/购房首付）', en: 'Large planned expense in 3 years (tuition/property downpayment)' },
  { zh: '已有足额保单/分红险，本专户聚焦纯流动性资产', en: 'Already holds annuity/insurance, focus on liquid assets' },
  { zh: '担忧美股估值高企，倾向锁定当前美元高息固收', en: 'Concerned with elevated US PE, prefer locking in current USD yields' },
  { zh: '临近退休，需每月产生稳健确定现金流抗通胀', en: 'Retiring soon, requires monthly inflation-hedged cashflow' },
  { zh: '香港/海外税收居民，注重全球多元化与低管理费', en: 'HK/overseas tax resident, focus on global diversification and low fees' },
];

function scoreToTier(score) {
  if (score < 28) return 'conservative';
  if (score < 46) return 'moderate_conservative';
  if (score < 66) return 'balanced';
  if (score < 82) return 'growth';
  return 'aggressive';
}

function fmtCurrency(val, currency = 'USD') {
  const num = Number(val || 0);
  const sym = currency === 'HKD' ? 'HK$' : currency === 'CNY' ? '¥' : currency === 'SGD' ? 'S$' : '$';
  return `${sym}${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const AdvisoryView = ({
  onSendToLab,
  onCreatePortfolio,
  onOpenPortfolio,
  onActiveClientChange,
}) => {
  const { lang } = useLang();
  const isEn = lang === 'en';

  const [step, setStep] = useState(1); // 1 = Profile Intake, 2 = Recommendations
  const [clientName, setClientName] = useState('');
  const [age, setAge] = useState('42');
  const [horizonYears, setHorizonYears] = useState(10);
  const [initialCapital, setInitialCapital] = useState(500000);
  const [currency, setCurrency] = useState('USD');
  const [primaryGoal, setPrimaryGoal] = useState('balanced');
  const [productScope, setProductScope] = useState('all');
  const [targetYieldPct, setTargetYieldPct] = useState('');
  const [annualWithdrawal, setAnnualWithdrawal] = useState('');
  const [ilpPlanned, setIlpPlanned] = useState(false);
  const [extraNotes, setExtraNotes] = useState('');

  const [answers, setAnswers] = useState({
    drawdown: 64,
    experience: 66,
    liquidity: 70,
    cushion: 48,
  });
  const [manualRiskTier, setManualRiskTier] = useState('auto');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // ── AI 归因分析状态 ────────────────────────────────────────────────────────
  const [aiModel, setAiModel] = useState('deepseek-pro');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);
  const [aiError, setAiError] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [selectedBasketIndex, setSelectedBasketIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [tacticalAppliedSuccess, setTacticalAppliedSuccess] = useState(false);

  // ── 方案留存与调取历史（localStorage） ────────────────────────────────────
  const [savedProfiles, setSavedProfiles] = useState(() => {
    try {
      const raw = localStorage.getItem('ww_advisory_saved_profiles');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeSavedId, setActiveSavedId] = useState(null);

  const computedScore = useMemo(() => {
    const vals = Object.values(answers);
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }, [answers]);

  const effectiveTier = manualRiskTier === 'auto' ? scoreToTier(computedScore) : manualRiskTier;
  const effectiveScore =
    manualRiskTier === 'auto'
      ? computedScore
      : RISK_TIERS.find((t) => t.id === manualRiskTier)?.score ?? computedScore;
  const tierMeta = RISK_TIERS.find((t) => t.id === effectiveTier) || RISK_TIERS[2];

  const handleScopeChange = (nextScope) => {
    setProductScope(nextScope);
    if (nextScope === 'aia_tmp2') {
      setIlpPlanned(true);
    } else if (nextScope === 'all' || nextScope === 'eu_ucits' || nextScope === 'global_etf' || nextScope === 'cn_hk_dividend') {
      setIlpPlanned(false);
    }
  };

  const handleIlpToggle = (checked) => {
    setIlpPlanned(checked);
    if (checked && (productScope === 'all' || productScope === 'eu_ucits' || productScope === 'global_etf' || productScope === 'cn_hk_dividend')) {
      setProductScope('aia_tmp2');
    } else if (!checked && productScope === 'aia_tmp2') {
      setProductScope('all');
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        client_name: clientName.trim(),
        age: age ? parseInt(age, 10) : null,
        horizon_years: Number(horizonYears) || 10,
        initial_capital: Number(initialCapital) || 500000,
        currency,
        primary_goal: primaryGoal,
        risk_score: effectiveScore,
        risk_level: effectiveTier,
        target_annual_yield_pct: targetYieldPct ? parseFloat(targetYieldPct) : null,
        annual_withdrawal: annualWithdrawal ? parseFloat(annualWithdrawal) : null,
        product_scope: productScope,
        ilp_planned: ilpPlanned,
        extra_notes: extraNotes.trim(),
      };
      const res = await fetch('/api/quant/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      setResult(json);
      setAiAnalysis(null);
      setSelectedBasketIndex(0);
      setStep(2);
      if (onActiveClientChange) {
        onActiveClientChange({
          clientName: clientName.trim() || (isEn ? 'Client' : '客户'),
          goal: primaryGoal,
        });
      }
    } catch (err) {
      setError(err.message || 'Recommendation request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = () => {
    const nameToSave = clientName.trim() || `${isEn ? 'Scenario' : '客户配置方案'}-${new Date().toLocaleDateString()}`;
    const recordId = activeSavedId || `adv_${Date.now()}`;
    const record = {
      id: recordId,
      savedAt: new Date().toISOString(),
      clientName: nameToSave,
      formData: {
        clientName,
        age,
        horizonYears,
        initialCapital,
        currency,
        primaryGoal,
        productScope,
        targetYieldPct,
        annualWithdrawal,
        ilpPlanned,
        answers,
        manualRiskTier,
        extraNotes,
      },
      result,
      aiAnalysis,
    };
    const list = savedProfiles.filter((x) => x.id !== recordId);
    const updated = [record, ...list].slice(0, 30);
    localStorage.setItem('ww_advisory_saved_profiles', JSON.stringify(updated));
    setSavedProfiles(updated);
    setActiveSavedId(recordId);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2200);
  };

  const handleLoadProfile = (record) => {
    if (!record || !record.formData) return;
    const f = record.formData;
    setClientName(f.clientName || '');
    setAge(f.age || '42');
    setHorizonYears(f.horizonYears || 10);
    setInitialCapital(f.initialCapital || 500000);
    setCurrency(f.currency || 'USD');
    setPrimaryGoal(f.primaryGoal || 'balanced');
    setProductScope(f.productScope || 'all');
    setTargetYieldPct(f.targetYieldPct || '');
    setAnnualWithdrawal(f.annualWithdrawal || '');
    setIlpPlanned(Boolean(f.ilpPlanned));
    if (f.answers) setAnswers(f.answers);
    if (f.manualRiskTier) setManualRiskTier(f.manualRiskTier);
    setExtraNotes(f.extraNotes || '');
    setResult(record.result || null);
    setAiAnalysis(record.aiAnalysis || null);
    setActiveSavedId(record.id);
    setStep(record.result ? 2 : 1);
    setSavedDrawerOpen(false);
    if (onActiveClientChange) {
      onActiveClientChange({
        clientName: f.clientName || record.clientName || '客户',
        goal: f.primaryGoal || 'balanced',
      });
    }
  };

  const handleDeleteSavedProfile = (id, e) => {
    e.stopPropagation();
    if (!window.confirm(isEn ? 'Remove this saved client scenario?' : '确定删除此保存方案？')) return;
    const updated = savedProfiles.filter((x) => x.id !== id);
    localStorage.setItem('ww_advisory_saved_profiles', JSON.stringify(updated));
    setSavedProfiles(updated);
    if (activeSavedId === id) setActiveSavedId(null);
  };

  const handleGenerateAiAnalysis = async () => {
    const basket = (result?.custom_fund_baskets || [])[selectedBasketIndex] || result?.custom_fund_baskets?.[0];
    if (!basket) return;

    setAiLoading(true);
    setAiProgress({ elapsed: 0, stage: 'connecting', model: aiModel, reasoning_chars: 0, content_chars: 0 });
    setAiError('');
    const startedAt = Date.now();

    const buildPayload = (useStream) => ({
      profile: {
        client_name: clientName.trim() || (isEn ? 'Client' : '客户'),
        age: age ? parseInt(age, 10) : null,
        horizon_years: Number(horizonYears),
        initial_capital: Number(initialCapital),
        currency,
        primary_goal: primaryGoal,
        risk_score: effectiveScore,
        risk_level: effectiveTier,
        target_annual_yield_pct: targetYieldPct ? parseFloat(targetYieldPct) : null,
        annual_withdrawal: annualWithdrawal ? parseFloat(annualWithdrawal) : null,
        product_scope: productScope,
        ilp_planned: ilpPlanned,
        extra_notes: extraNotes.trim(),
      },
      recommendation: basket,
      model: aiModel,
      stream: useStream,
    });

    const requestExplain = async (useStream) => {
      let connected = false;
      const res = await fetch('/api/quant/recommend/explain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(buildPayload(useStream)),
      });
      connected = true;

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (useStream && res.ok && contentType.includes('text/event-stream') && res.body?.getReader) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamJson = null;

        const processBlock = (block) => {
          if (!block.trim()) return;
          let eventName = 'message';
          const dataLines = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) return;
          const rawData = dataLines.join('\n');
          let parsed = null;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            return;
          }
          if (eventName === 'progress') {
            setAiProgress(parsed);
          } else if (eventName === 'result') {
            streamJson = parsed;
          } else if (eventName === 'error') {
            const appErr = new Error(parsed?.detail || 'AI generation failed');
            appErr.isAppError = true;
            throw appErr;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            processBlock(part);
          }
        }
        if (buffer.trim()) {
          processBlock(buffer);
        }
        if (!streamJson) {
          throw new Error(isEn ? 'Stream ended without final AI result' : '流式连接已结束但未收到完整研判结果');
        }
        return streamJson;
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const httpErr = new Error(json.detail || json.error || `HTTP ${res.status}`);
        httpErr.isAppError = true;
        throw httpErr;
      }
      return { ...json, connected };
    };

    try {
      let json = null;
      try {
        json = await requestExplain(true);
      } catch (streamErr) {
        if (streamErr?.isAppError) {
          throw streamErr;
        }
        setAiProgress({
          elapsed: Math.round((Date.now() - startedAt) / 1000),
          stage: 'fallback_retry',
          model: aiModel,
          reasoning_chars: 0,
          content_chars: 0,
        });
        json = await requestExplain(false);
      }

      setAiAnalysis(json);
      if (activeSavedId) {
        setSavedProfiles((prev) => {
          const updated = prev.map((item) =>
            item.id === activeSavedId
              ? { ...item, aiAnalysis: json, savedAt: new Date().toISOString() }
              : item
          );
          localStorage.setItem('ww_advisory_saved_profiles', JSON.stringify(updated));
          return updated;
        });
      }
    } catch (err) {
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      const rawMsg = err?.message || 'AI generation failed';
      if (/load failed|failed to fetch|networkerror/i.test(rawMsg)) {
        setAiError(
          isEn
            ? `Network/CORS interruption after ${elapsedSec}s (${rawMsg}). Please refresh once or switch to DeepSeek V4 Pro fast mode.`
            : `请求在 ${elapsedSec}s 时被网络/代理中断（${rawMsg}）。建议刷新页面清除旧缓存后重试，或选用默认极速旗舰版。`
        );
      } else {
        setAiError(rawMsg);
      }
    } finally {
      setAiLoading(false);
      setAiProgress(null);
    }
  };

  const handleCopyAiReport = () => {
    if (!aiAnalysis?.analysis) return;
    navigator.clipboard.writeText(aiAnalysis.analysis).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const mergeTacticalHoldingsIntoBasket = (basketHoldings = [], adjustedHoldings = []) => {
    const baseById = new Map(
      (basketHoldings || []).map((h) => [String(h.lab_id || h.slug || '').toUpperCase(), h])
    );
    return (adjustedHoldings || [])
      .filter((adj) => Number(adj.adjusted_weight_pct || 0) > 0)
      .map((adj) => {
        const key = String(adj.lab_id || adj.slug || '').toUpperCase();
        const orig = baseById.get(key);
        if (orig) {
          return {
            ...orig,
            core_role: adj.core_role || orig.core_role,
            ilas_platform: orig.ilas_platform ?? adj.ilas_platform ?? null,
            weight_pct: adj.adjusted_weight_pct,
            rationale_zh: adj.reason_zh || orig.rationale_zh,
            rationale_en: adj.reason_en || orig.rationale_en,
          };
        }
        return {
          slug: adj.slug || adj.lab_id,
          code: adj.lab_id,
          lab_id: adj.lab_id,
          name: adj.name || adj.lab_id,
          asset_class: adj.asset_class || '基金',
          core_role: adj.core_role || 'satellite',
          ilas_platform: adj.ilas_platform ?? null,
          fee_pct: adj.fee_pct ?? null,
          data_tier: 'A',
          quant_grade: null,
          weight_pct: adj.adjusted_weight_pct,
          rationale_zh: adj.reason_zh || 'AI 候补白名单增配标的',
          rationale_en: adj.reason_en || 'Added from AI whitelist pool',
        };
      });
  };

  const handleApplyTacticalToBasket = () => {
    const tactical = aiAnalysis?.tactical_adjustment;
    if (!tactical || !Array.isArray(tactical.adjusted_holdings) || !result?.custom_fund_baskets) return;
    setResult((prev) => {
      if (!prev || !Array.isArray(prev.custom_fund_baskets)) return prev;
      const updatedBaskets = prev.custom_fund_baskets.map((b, idx) => {
        if (idx !== selectedBasketIndex) return b;
        const merged = mergeTacticalHoldingsIntoBasket(b.holdings, tactical.adjusted_holdings);
        const corePct = merged.filter((x) => x.core_role !== 'satellite').reduce((s, x) => s + Number(x.weight_pct || 0), 0);
        const satPct = Math.max(0, 100 - corePct);
        return {
          ...b,
          ai_adjusted: true,
          holdings: merged,
          metrics: b.metrics ? { ...b.metrics, core_pct: corePct, satellite_pct: satPct } : b.metrics,
        };
      });
      return { ...prev, custom_fund_baskets: updatedBaskets };
    });
    setTacticalAppliedSuccess(true);
    setTimeout(() => setTacticalAppliedSuccess(false), 2400);
  };

  const buildAdvisoryHandoffProfile = (title, holdingsList = [], extraDirectives = null) => {
    const rationaleMap = {};
    (holdingsList || []).forEach((h) => {
      const id = h.lab_id || h.isin || h.id;
      const r = h.reason_zh || h.rationale_zh || h.label_zh;
      if (id && r) rationaleMap[id] = r;
    });
    return {
      ...(prof || {}),
      client_name: clientName.trim() || prof?.client_name || '',
      age: age ? parseInt(age, 10) : prof?.age || null,
      initial_capital: Number(initialCapital) || prof?.initial_capital || 500000,
      horizon_years: Number(horizonYears) || prof?.horizon_years || 10,
      annual_withdrawal: annualWithdrawal ? parseFloat(annualWithdrawal) : prof?.annual_withdrawal || 0,
      currency: currency || prof?.currency || 'USD',
      primary_goal: primaryGoal || prof?.primary_goal || 'balanced',
      ilp_planned: ilpPlanned,
      extra_notes: extraNotes.trim() || prof?.extra_notes || '',
      risk_level: effectiveTier,
      risk_label_zh: envelope?.risk_label_zh || tierMeta.zh,
      risk_score: effectiveScore,
      target_envelope: envelope || null,
      basket_title: title || '',
      holdings_rationale: rationaleMap,
      ai_analysis_text: aiAnalysis?.analysis || '',
      tactical_summary_zh: aiAnalysis?.tactical_adjustment?.tactical_summary_zh || '',
      ...(extraDirectives ? { lab_directives: extraDirectives } : {}),
    };
  };

  const handleSendTacticalToLab = () => {
    const tactical = aiAnalysis?.tactical_adjustment;
    const basket = (result?.custom_fund_baskets || [])[selectedBasketIndex] || result?.custom_fund_baskets?.[0];
    if (!tactical || !Array.isArray(tactical.adjusted_holdings) || tactical.adjusted_holdings.length === 0) return;
    const activeAdj = tactical.adjusted_holdings.filter((h) => Number(h.adjusted_weight_pct || 0) > 0);
    if (activeAdj.length === 0) return;
    const title = isEn
      ? `${basket?.title_en || 'AI Tactical Basket'} · AI Adjusted`
      : `${basket?.title_zh || 'AI 战术修正组合'} · AI战术修正`;
    onSendToLab(
      activeAdj.map((h) => ({ id: h.lab_id, weight: h.adjusted_weight_pct })),
      title,
      buildAdvisoryHandoffProfile(title, activeAdj, tactical.lab_directives)
    );
  };

  const handleCreateTacticalPortfolio = () => {
    const tactical = aiAnalysis?.tactical_adjustment;
    const basket = (result?.custom_fund_baskets || [])[selectedBasketIndex] || result?.custom_fund_baskets?.[0];
    if (!tactical || !basket) return;
    const adjustedBasket = {
      ...basket,
      title_zh: `${basket.title_zh || '优选组合'} (AI调仓)`,
      title_en: `${basket.title_en || 'Quant Basket'} (AI Adjusted)`,
      holdings: mergeTacticalHoldingsIntoBasket(basket.holdings, tactical.adjusted_holdings),
    };
    onCreatePortfolio(adjustedBasket, prof);
  };

  const envelope = result?.target_envelope;
  const prof = result?.normalized_profile;

  return (
    <div style={{ maxWidth: '1280px' }}>
      {/* Hero Header */}
      <header className="portfolio-hero-header" style={{ marginBottom: '20px' }}>
        <div className="portfolio-hero-title-group">
          <div className="stat-label" style={{ marginBottom: '4px', fontSize: '0.72rem' }}>
            {isEn ? 'CLIENT ADVISORY & PORTFOLIO MATCHING' : '客户画像与智能配置向导'}
          </div>
          <h1 className="portfolio-hero-title" style={{ marginBottom: '6px' }}>
            {isEn ? 'Client Profile & Recommendation Studio' : '客户画像录入与智能组合推荐'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
            {isEn
              ? 'Capture client profile, horizon, cashflow needs and risk tolerance — match existing live portfolios, classic archetypes, and custom 306-fund baskets.'
              : '系统采集客户本金、期限、现金流目标与风险承受度，双轨匹配「平台现有实盘/经典策略」与「306 只基金量化优选定制方案」。'}
          </p>
        </div>

        {/* Stepper Pill & Saved Scenarios Button */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSavedDrawerOpen(true)}
            className="action-btn-secondary"
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            <FolderOpen size={14} /> {isEn ? `Saved Profiles (${savedProfiles.length})` : `已存客户方案 (${savedProfiles.length})`}
          </button>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="action-btn-secondary"
            style={{
              background: step === 1 ? 'rgba(var(--accent-color-rgb), 0.12)' : 'var(--surface-card)',
              borderColor: step === 1 ? 'var(--accent-color)' : 'var(--border-subtle)',
              color: step === 1 ? 'var(--accent-color)' : 'var(--text-secondary)',
              fontWeight: step === 1 ? 700 : 500,
            }}
          >
            <Sliders size={14} /> 01 · {isEn ? 'Profile & Needs' : '画像与需求录入'}
          </button>
          <button
            type="button"
            disabled={!result}
            onClick={() => result && setStep(2)}
            className="action-btn-secondary"
            style={{
              background: step === 2 ? 'rgba(var(--accent-color-rgb), 0.12)' : 'var(--surface-card)',
              borderColor: step === 2 ? 'var(--accent-color)' : 'var(--border-subtle)',
              color: step === 2 ? 'var(--accent-color)' : 'var(--text-secondary)',
              fontWeight: step === 2 ? 700 : 500,
              opacity: result ? 1 : 0.45,
            }}
          >
            <Compass size={14} /> 02 · {isEn ? 'Recommendations' : '双轨配置推荐'}
          </button>
        </div>
      </header>

      {error && (
        <div
          className="glass-card"
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderLeft: '3px solid var(--danger)',
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.86rem',
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ── STEP 1: CLIENT PROFILE & NEEDS INTAKE ─────────────────────────────── */}
      {step === 1 && (
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>
            {/* Left Card: Demographics, Capital & Objectives */}
            <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                <Layers size={17} style={{ color: 'var(--accent-color)' }} />
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
                  {isEn ? 'A. Client Profile, Capital & Goals' : '一 · 客户基本画像与资金目标'}
                </h2>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>{isEn ? 'Client Name / Alias' : '客户姓名 / 称呼（选填）'}</label>
                  <input
                    type="text"
                    placeholder={isEn ? 'e.g. Mr. Chen' : '例：陈先生 / 家族信托 A'}
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{isEn ? 'Age' : '年龄'}</label>
                  <input
                    type="number"
                    min={18}
                    max={95}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>{isEn ? 'Initial Capital' : '初始可配置资金'}</label>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    required
                    value={initialCapital}
                    onChange={(e) => setInitialCapital(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{isEn ? 'Base Currency' : '基准货币'}</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="USD">USD 美元</option>
                    <option value="HKD">HKD 港元</option>
                    <option value="CNY">CNY 人民币</option>
                    <option value="SGD">SGD 新元</option>
                    <option value="EUR">EUR 欧元</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>{isEn ? 'Investment Horizon' : '核心投资期限'}</label>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-color)' }}>
                    {horizonYears} {isEn ? 'Years' : '年'}
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={horizonYears}
                  onChange={(e) => setHorizonYears(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-color)' }}
                />
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{isEn ? 'Target Annual Yield % (opt)' : '期望年化派息率 %（选填）'}</label>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    placeholder="e.g. 4.5"
                    value={targetYieldPct}
                    onChange={(e) => setTargetYieldPct(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{isEn ? 'Annual Withdrawal (opt)' : '年提取金额（选填）'}</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    placeholder="0"
                    value={annualWithdrawal}
                    onChange={(e) => setAnnualWithdrawal(e.target.value)}
                  />
                </div>
              </div>

              {/* Primary Goals */}
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  {isEn ? 'Primary Objective' : '主要财务目标'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '8px' }}>
                  {GOALS.map((g) => {
                    const active = primaryGoal === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setPrimaryGoal(g.id)}
                        style={{
                          textAlign: 'left',
                          padding: '9px 11px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-subtle)',
                          background: active ? 'rgba(var(--accent-color-rgb), 0.10)' : 'var(--surface-subtle)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: active ? 'var(--accent-color)' : 'var(--text-primary)' }}>
                          {isEn ? g.en : g.zh}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {isEn ? g.hintEn : g.hintZh}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Product Scope & ILP wrapper */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>{isEn ? 'Product Universe' : '产品库选择范围'}</label>
                  <select value={productScope} onChange={(e) => handleScopeChange(e.target.value)}>
                    {SCOPES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {isEn ? s.en : s.zh}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      width: '100%',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: ilpPlanned ? 'rgba(var(--accent-secondary-rgb), 0.10)' : 'var(--surface-subtle)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      marginBottom: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={ilpPlanned}
                      onChange={(e) => handleIlpToggle(e.target.checked)}
                    />
                    {isEn ? 'Pure ILAS Mode (AIA)' : '纯投连险保单架构 (ILP)'}
                  </label>
                </div>
              </div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '-6px' }}>
                {isEn
                  ? 'Strict Isolation: ILAS platform funds and off-platform funds never mix within the same portfolio.'
                  : '硬约束：投连险平台基金与平台外基金严格隔离，同一组合内不混配（要么纯血投连险，要么纯非投连险）。'}
              </div>
            </section>

            {/* Right Card: 4-Question Risk Tolerance Assessment */}
            <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={17} style={{ color: 'var(--accent-secondary)' }} />
                  <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
                    {isEn ? 'B. Risk Tolerance Assessment' : '二 · 客户风险承受度测评'}
                  </h2>
                </div>
                <div
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    background: 'rgba(var(--accent-color-rgb), 0.12)',
                    color: 'var(--accent-color)',
                    border: '1px solid var(--accent-color)',
                  }}
                >
                  {isEn ? tierMeta.en : tierMeta.zh} · {effectiveScore}/100
                </div>
              </div>

              {RISK_QUESTIONS.map((q) => (
                <div key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {isEn ? q.en : q.zh}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
                    {q.options.map((opt) => {
                      const selected = answers[q.key] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setAnswers((prev) => ({ ...prev, [q.key]: opt.value }));
                            setManualRiskTier('auto');
                          }}
                          style={{
                            padding: '7px 10px',
                            borderRadius: '5px',
                            textAlign: 'left',
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                            border: selected ? '1px solid var(--accent-color)' : '1px solid var(--border-subtle)',
                            background: selected ? 'rgba(var(--accent-color-rgb), 0.11)' : 'var(--surface-subtle)',
                            color: selected ? 'var(--accent-color)' : 'var(--text-secondary)',
                            fontWeight: selected ? 700 : 500,
                          }}
                        >
                          {isEn ? opt.en : opt.zh}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Advisor Risk Override */}
              <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '10px' }}>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  {isEn ? 'Advisor Risk Tier Override (optional)' : '顾问风险档位定档（默认由上方测评自动识别，可手动微调）'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setManualRiskTier('auto')}
                    className="action-btn-secondary"
                    style={{
                      fontSize: '0.72rem',
                      padding: '4px 9px',
                      borderColor: manualRiskTier === 'auto' ? 'var(--accent-color)' : undefined,
                      color: manualRiskTier === 'auto' ? 'var(--accent-color)' : undefined,
                    }}
                  >
                    {isEn ? `Auto (${computedScore})` : `自动识别 (${computedScore})`}
                  </button>
                  {RISK_TIERS.map((rt) => (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => setManualRiskTier(rt.id)}
                      className="action-btn-secondary"
                      style={{
                        fontSize: '0.72rem',
                        padding: '4px 9px',
                        borderColor: manualRiskTier === rt.id ? 'var(--accent-secondary)' : undefined,
                        color: manualRiskTier === rt.id ? 'var(--accent-secondary)' : undefined,
                        fontWeight: manualRiskTier === rt.id ? 700 : 500,
                      }}
                    >
                      {isEn ? rt.en : rt.zh}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Third Card: Extra Client Circumstances & Special Constraints */}
          <section className="glass-card" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '3px solid var(--accent-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={17} style={{ color: 'var(--accent-secondary)' }} />
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
                  {isEn ? 'C. Extra Circumstances & Specific Client Needs (AI Input)' : '三 · 客户补充情况与特定诉求（AI 深度分析上下文）'}
                </h2>
              </div>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {isEn ? 'Informs AI on macro rate regime, equity valuation ERP, and family constraints' : '辅助 AI 结合当前宏观利率、权益估值与客户真实家庭背景输出定制化研判'}
              </span>
            </div>

            <textarea
              rows={3}
              placeholder={isEn
                ? "e.g., Client is an overseas tax resident with paid-off properties; holds $200k dividend annuity; plans $150k tuition in 3 years; concerned with high US equity valuation, favors USD high-yield fixed income."
                : "例：客户为香港税收居民，内地房产已供清；持有 20 万美元分红险；计划 3 年后支出 15 万美元用于子女海外留学，要求该部分资金保本且能产生定期现金流；对美股高估值有担忧，倾向锁定当前美元高息固收与低费率防御标的。"}
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                lineHeight: '1.5',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            {/* Quick tags */}
            <div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                {isEn ? 'Quick Tags (Click to append):' : '快捷标签（点击自动填入）:'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {QUICK_NOTES_TAGS.map((tag, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const textToAdd = isEn ? tag.en : tag.zh;
                      setExtraNotes((prev) => (prev ? `${prev}；\n${textToAdd}` : textToAdd));
                    }}
                    className="action-btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '4px' }}
                  >
                    ＋ {isEn ? tag.en : tag.zh}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleSaveProfile}
                className="action-btn-secondary"
                style={{ padding: '10px 16px' }}
              >
                <Save size={15} /> {saveSuccess ? (isEn ? 'Saved!' : '已保存！') : (isEn ? 'Save Profile Draft' : '保存当前画像草稿')}
              </button>
              <button
                type="submit"
                className="create-btn"
                disabled={loading}
                style={{ padding: '10px 22px', fontSize: '0.92rem' }}
              >
                <Sparkles size={16} />
                {loading
                  ? (isEn ? 'Generating Dual-Track Recommendations...' : '正在测算匹配现有组合与 306 基金库...')
                  : (isEn ? 'Generate Client Recommendations →' : '生成智能配置推荐方案 →')}
              </button>
            </div>
          </section>
        </form>
      )}

      {/* ── STEP 2: DUAL-TRACK RECOMMENDATIONS ─────────────────────────────────── */}
      {step === 2 && result && envelope && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Client Summary & Target Envelope Strip */}
          <section className="glass-card" style={{ borderTop: '3px solid var(--accent-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.15rem', fontFamily: 'var(--font-display)' }}>
                    {prof?.client_name ? `${prof.client_name} · ` : ''}
                    {isEn ? envelope.risk_label_en : envelope.risk_label_zh}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', padding: '2px 8px', borderRadius: '999px', background: 'rgba(var(--accent-color-rgb), 0.12)', color: 'var(--accent-color)', fontWeight: 700 }}>
                    Score {envelope.risk_score}/100
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    {fmtCurrency(prof?.initial_capital, prof?.currency)} · {prof?.horizon_years}{isEn ? 'Y' : '年'}
                  </span>
                  {prof?.ilp_planned && (
                    <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(var(--accent-secondary-rgb), 0.14)', color: 'var(--accent-secondary)', fontWeight: 700 }}>
                      ILP
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  {isEn ? envelope.summary_en : envelope.summary_zh}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="action-btn-secondary"
                  style={{
                    fontSize: '0.8rem',
                    padding: '6px 12px',
                    borderColor: saveSuccess ? 'var(--success)' : undefined,
                    color: saveSuccess ? 'var(--success)' : undefined,
                  }}
                >
                  <Save size={14} /> {saveSuccess ? (isEn ? 'Saved!' : '方案已保存！') : (isEn ? 'Save Recommendation' : '保存此配置方案')}
                </button>
                <button type="button" onClick={() => setStep(1)} className="action-btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
                  <RotateCcw size={14} /> {isEn ? 'Edit Client Profile' : '返回修改画像'}
                </button>
              </div>
            </div>

            {/* Target Asset-Class Stacked Bar */}
            <div style={{ height: '10px', borderRadius: '999px', overflow: 'hidden', display: 'flex', background: 'var(--surface-inset)', marginBottom: '10px' }}>
              <div style={{ width: `${envelope.target_equity_pct}%`, background: 'var(--accent-color)' }} title={`Equity ${envelope.target_equity_pct}%`} />
              <div style={{ width: `${envelope.target_bond_pct}%`, background: 'var(--info)' }} title={`Bond ${envelope.target_bond_pct}%`} />
              <div style={{ width: `${envelope.target_other_pct}%`, background: 'var(--accent-secondary)' }} title={`Multi/Alt ${envelope.target_other_pct}%`} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.76rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              <span>● {isEn ? 'Equity Target' : '权益目标'}: <strong>{envelope.target_equity_pct}%</strong></span>
              <span>● {isEn ? 'Fixed Income Target' : '固收目标'}: <strong>{envelope.target_bond_pct}%</strong></span>
              <span>● {isEn ? 'Multi/Alt' : '多元/另类'}: <strong>{envelope.target_other_pct}%</strong></span>
              <span>| {isEn ? 'Max Drawdown Tolerance' : '回撤容忍上限'}: <strong>≤ {envelope.max_drawdown_pct}%</strong></span>
              <span>| {isEn ? 'Rebalance' : '建议再平衡'}: <strong>{envelope.suggested_rebalance_freq}</strong></span>
            </div>
          </section>

          {/* TRACK A: Custom 306-Fund Quantitative Baskets */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} style={{ color: 'var(--accent-secondary)' }} />
                {isEn ? 'Track A · Custom Quant Fund Baskets (from 306-Fund Library)' : '轨道一 · 基于 306 只基金量化库的定制组合方案'}
              </h2>
              <span style={{ fontSize: '0.76rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {isEn
                  ? `Pool: ${result.catalog_stats?.scoped_funds || 0} eligible (${result.catalog_stats?.series_backed_funds || 0} Tier A/B)`
                  : `筛选池：${result.catalog_stats?.scoped_funds || 0} 只合规基金（含 ${result.catalog_stats?.series_backed_funds || 0} 只历史序列标）`}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '18px' }}>
              {(result.custom_fund_baskets || []).map((basket, bIdx) => (
                <div key={basket.key} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: bIdx === selectedBasketIndex ? '2px solid var(--accent-color)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.08rem', color: 'var(--accent-color)' }}>
                        {isEn ? basket.title_en : basket.title_zh}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {isEn ? basket.subtitle_en : basket.subtitle_zh}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: basket.universe_mode === 'ilas' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(59, 130, 246, 0.12)',
                          color: basket.universe_mode === 'ilas' ? '#d97706' : 'var(--info)',
                          fontWeight: 700,
                        }}
                      >
                        {basket.universe_mode === 'ilas'
                          ? (isEn ? 'Pure ILAS' : '纯投连险 · AIA')
                          : (isEn ? 'Pure Non-ILAS' : '纯非投连险')}
                      </span>
                      {basket.us_estate_tax_shield && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(16, 185, 129, 0.14)',
                            color: 'var(--success)',
                            fontWeight: 700,
                          }}
                        >
                          {isEn ? 'IE/LU UCITS · Estate-Tax Exempt' : '爱尔兰/卢森堡 UCITS · 免美遗产税'}
                        </span>
                      )}
                      {basket.metrics?.core_pct != null && (
                        <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {isEn ? `Core ${basket.metrics.core_pct}% / Sat ${basket.metrics.satellite_pct}%` : `核心 ${basket.metrics.core_pct}% / 卫星 ${basket.metrics.satellite_pct}%`}
                        </span>
                      )}
                      {basket.ai_adjusted && (
                        <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.14)', color: 'var(--success)', fontWeight: 700 }}>
                          ⚡ {isEn ? 'AI Tilted' : 'AI 已调仓'}
                        </span>
                      )}
                      {selectedBasketIndex === bIdx && (
                        <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(var(--accent-color-rgb), 0.15)', color: 'var(--accent-color)', fontWeight: 700 }}>
                          {isEn ? 'AI Target' : '当前AI分析标的'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Portfolio KPI Strip */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px', background: 'var(--surface-subtle)', padding: '10px', borderRadius: '6px' }}>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isEn ? 'Est. 3Y CAGR' : '参考3Y年化'}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.86rem', color: (basket.metrics.est_cagr_pct || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {basket.metrics.est_cagr_pct != null ? `${basket.metrics.est_cagr_pct >= 0 ? '+' : ''}${basket.metrics.est_cagr_pct}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isEn ? 'Est. Vol' : '组合波动率'}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.86rem' }}>
                        {basket.metrics.est_vol_pct != null ? `${basket.metrics.est_vol_pct}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Sharpe</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.86rem', color: 'var(--accent-color)' }}>
                        {basket.metrics.est_sharpe != null ? basket.metrics.est_sharpe.toFixed(2) : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isEn ? 'Yield' : '参考派息'}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.86rem', color: 'var(--info)' }}>
                        {basket.metrics.est_div_yield_pct != null ? `${basket.metrics.est_div_yield_pct}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isEn ? 'Wtd Fee' : '加权费率'}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.86rem' }}>
                        {basket.metrics.weighted_fee_pct != null ? `${basket.metrics.weighted_fee_pct}%` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Holdings Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 4px' }}>{isEn ? 'Fund' : '标的代码 / 名称'}</th>
                          <th style={{ textAlign: 'center', padding: '6px 8px', whiteSpace: 'nowrap', width: '56px' }}>{isEn ? 'Grade' : '量化'}</th>
                          <th style={{ textAlign: 'right', padding: '6px 4px', whiteSpace: 'nowrap', width: '56px' }}>{isEn ? 'Weight' : '权重'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {basket.holdings.map((h) => {
                          const gm = gradeMeta(h.quant_grade);
                          return (
                            <tr key={h.slug} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '7px 4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-color)' }}>
                                    {h.lab_id}
                                  </span>
                                  {h.core_role && (
                                    <span
                                      style={{
                                        fontSize: '0.64rem',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        fontWeight: 700,
                                        background: h.core_role === 'core' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)',
                                        color: h.core_role === 'core' ? 'var(--info)' : 'var(--accent-secondary)',
                                      }}
                                    >
                                      {h.core_role === 'core' ? (isEn ? 'Core' : '核心') : (isEn ? 'Sat' : '卫星')}
                                    </span>
                                  )}
                                  {h.is_admin_core_pick && (
                                    <span
                                      style={{
                                        fontSize: '0.64rem',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        fontWeight: 700,
                                        background: 'rgba(245, 158, 11, 0.16)',
                                        border: '1px solid rgba(245, 158, 11, 0.42)',
                                        color: '#d97706',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                      }}
                                      title={
                                        Array.isArray(h.admin_core_reasons) && h.admin_core_reasons.length > 0
                                          ? `管理员核心推荐：${h.admin_core_reasons.join(' / ')}`
                                          : '管理员核心推荐标的（高优先级高权重）'
                                      }
                                    >
                                      <Star size={10} style={{ fill: '#f59e0b', color: '#f59e0b' }} />
                                      {isEn ? 'Core Pick' : '核心推荐'}
                                    </span>
                                  )}
                                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{h.name}</span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {isEn ? h.rationale_en : h.rationale_zh}
                                </div>
                              </td>
                              <td style={{ textAlign: 'center', padding: '7px 4px', whiteSpace: 'nowrap' }}>
                                <span style={{ padding: '1px 6px', borderRadius: '3px', background: gm.bg, color: gm.color, fontWeight: 700, fontSize: '0.7rem' }}>
                                  {gm.label}
                                </span>
                                <span style={{ marginLeft: '4px', fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  {h.data_tier}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', padding: '7px 4px', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.84rem' }}>
                                {h.weight_pct}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Handoff Actions */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '4px' }}>
                    <button
                      type="button"
                      className="create-btn"
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => {
                        const title = isEn ? basket.title_en : basket.title_zh;
                        onSendToLab(
                          basket.holdings.map((h) => ({ id: h.lab_id, weight: h.weight_pct })),
                          title,
                          buildAdvisoryHandoffProfile(title, basket.holdings)
                        );
                      }}
                    >
                      <FlaskConical size={15} /> {isEn ? 'Simulate in Strategy Lab' : '送入策略实验室深度模拟'}
                    </button>
                    <button
                      type="button"
                      className="action-btn-secondary"
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={() => onCreatePortfolio(basket, prof)}
                    >
                      <PlusCircle size={15} /> {isEn ? 'Create Live Portfolio' : '一键创建实盘跟踪组合'}
                    </button>
                    <button
                      type="button"
                      className="action-btn-secondary"
                      onClick={() => {
                        setSelectedBasketIndex(bIdx);
                        const aiCard = document.getElementById('advisory-ai-analysis-card');
                        if (aiCard) aiCard.scrollIntoView({ behavior: 'smooth' });
                      }}
                      style={{
                        padding: '6px 10px',
                        fontSize: '0.76rem',
                        borderColor: selectedBasketIndex === bIdx ? 'var(--accent-color)' : undefined,
                        color: selectedBasketIndex === bIdx ? 'var(--accent-color)' : undefined,
                      }}
                    >
                      <Sparkles size={13} /> {isEn ? 'Analyze with AI' : 'AI分析此方案'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── AI 深度配置分析与宏观归因报告卡片 ──────────────────────────────── */}
          <section id="advisory-ai-analysis-card" className="glass-card" style={{ borderTop: '3px solid var(--accent-secondary)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} style={{ color: 'var(--accent-secondary)' }} />
                <h2 style={{ margin: 0, fontSize: '1.18rem' }}>
                  {isEn ? 'AI Wealth Advisor · Forward-Looking Portfolio Attribution & Macro Regime' : 'AI 首席投顾 · 前瞻宏观利率与估值归因建议报告'}
                </h2>
              </div>

              {/* Model & Options Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {isEn ? 'Model:' : '调用模型:'}
                </span>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="atelier-select"
                  style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
                >
                  <option value="deepseek-pro">
                    {isEn
                      ? 'DeepSeek V4 Pro (Default · Fast Flagship ~30s)'
                      : 'DeepSeek V4 Pro (默认首选 · 深度研判极速版 ~30s)'}
                  </option>
                  <option value="deepseek-pro-thinking">
                    {isEn
                      ? 'DeepSeek V4 Pro Thinking (Deep CoT ~90s)'
                      : 'DeepSeek V4 Pro 思考链 (深度 CoT 推演 ~90s)'}
                  </option>
                  <option value="gemini-deep">
                    {isEn
                      ? 'Gemini 3.8 Flash (OpenRouter · Macro Deep Analysis)'
                      : 'Gemini 3.8 Flash (OpenRouter · 深度宏观研判高性价比)'}
                  </option>
                  <option value="qwen-deep">
                    {isEn
                      ? 'Qwen 3.7 Plus (OpenRouter · CN/HK Finance Value)'
                      : 'Qwen 3.7 Plus (OpenRouter · 中文金融/投连险超值深度)'}
                  </option>
                  <option value="claude-sonnet">
                    {isEn
                      ? 'Claude Sonnet 5.5 (OpenRouter · Private Bank Flagship)'
                      : 'Claude Sonnet 5.5 (OpenRouter · 私行级报告文风旗舰)'}
                  </option>
                  <option value="deepseek-flash">
                    {isEn
                      ? 'DeepSeek V4.1 Flash (Fast Thinking · Ultra-Low Cost)'
                      : 'DeepSeek V4.1 Flash (极速思考 · 极致省成本)'}
                  </option>
                </select>

                <button
                  type="button"
                  onClick={handleGenerateAiAnalysis}
                  disabled={aiLoading}
                  className="create-btn"
                  style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                >
                  <Sparkles size={14} />
                  {aiLoading
                    ? (aiProgress
                        ? (isEn
                            ? `Thinking (${aiProgress.elapsed || 0}s)...`
                            : `AI 深度推理中 (${aiProgress.elapsed || 0}s)...`)
                        : (isEn ? 'Analyzing Macro & Valuation...' : 'AI 研判测算中...'))
                    : (aiAnalysis ? (isEn ? 'Regenerate Analysis' : '重新生成 AI 报告') : (isEn ? 'Generate AI Attribution' : '生成 AI 配置研判报告'))}
                </button>
              </div>
            </div>

            {aiError && (
              <div style={{ color: 'var(--danger)', background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: '4px', fontSize: '0.82rem' }}>
                {aiError}
              </div>
            )}

            {aiLoading && aiProgress && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: 'rgba(var(--accent-secondary-rgb), 0.08)',
                  border: '1px solid rgba(var(--accent-secondary-rgb), 0.28)',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <span>
                  {isEn
                    ? `Streaming deep analysis (${aiProgress.model || aiModel}) · Stage: ${aiProgress.stage || 'thinking'}`
                    : `正在实时流式推理（${aiProgress.model || aiModel}）· 阶段：${
                        aiProgress.stage === 'writing'
                          ? '撰写正式报告'
                          : aiProgress.stage === 'thinking'
                            ? '深度思维推演'
                            : aiProgress.stage === 'fallback_retry'
                              ? '流式连接中断，正在切换标准模式重试'
                              : '连接模型'
                      }`}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--accent-secondary)' }}>
                  {aiProgress.elapsed || 0}s
                  {aiProgress.reasoning_chars > 0 ? ` · ${isEn ? 'Reasoning' : '思考'} ${aiProgress.reasoning_chars.toLocaleString()} ${isEn ? 'chars' : '字'}` : ''}
                  {aiProgress.content_chars > 0 ? ` · ${isEn ? 'Report' : '正文'} ${aiProgress.content_chars.toLocaleString()} ${isEn ? 'chars' : '字'}` : ''}
                </span>
              </div>
            )}

            {aiAnalysis ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(var(--accent-secondary-rgb), 0.12)', color: 'var(--accent-secondary)', fontWeight: 700 }}>
                      {aiAnalysis.model_used || 'AI Advisor'}
                    </span>
                    <span>来源: {aiAnalysis.provider === 'deepseek' ? 'DeepSeek 官方 API' : aiAnalysis.provider === 'openrouter' ? 'OpenRouter 聚合' : '量化规则库'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAiReport}
                    className="action-btn-secondary"
                    style={{ fontSize: '0.74rem', padding: '3px 9px' }}
                  >
                    {copied ? <><Check size={13} style={{ color: 'var(--success)' }} /> {isEn ? 'Copied' : '已复制'}</> : <><Copy size={13} /> {isEn ? 'Copy Full Report' : '复制完整研判'}</>}
                  </button>
                </div>

                {/* 兜底规则引擎提示条（未配置 Key 或上游异常时提醒） */}
                {aiAnalysis.provider === 'fallback_rule' && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      color: 'var(--warning, #d97706)',
                      fontSize: '0.78rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AlertCircle size={15} style={{ flexShrink: 0 }} />
                    <span>
                      {isEn
                        ? `Running deterministic fallback (${aiAnalysis.fallback_reason || 'API key not configured'}).`
                        : `当前已回退至量化规则引擎（原因：${aiAnalysis.fallback_reason || '未配置大模型 API Key'}）。`}
                    </span>
                  </div>
                )}

                {/* 可折叠 AI 深度思考推理过程 (Chain-of-Thought) */}
                {aiAnalysis.reasoning && (
                  <details
                    style={{
                      background: 'var(--bg-elevated, rgba(148, 163, 184, 0.06))',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      fontSize: '0.78rem',
                    }}
                  >
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        userSelect: 'none',
                      }}
                    >
                      {isEn
                        ? 'View AI Deep Reasoning Trace (Chain-of-Thought)'
                        : '查看 AI 深度推理思考过程（Chain-of-Thought）'}
                    </summary>
                    <pre
                      style={{
                        marginTop: '8px',
                        marginBottom: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.74rem',
                        lineHeight: 1.55,
                        color: 'var(--text-muted)',
                        maxHeight: '320px',
                        overflowY: 'auto',
                      }}
                    >
                      {aiAnalysis.reasoning}
                    </pre>
                  </details>
                )}

                {/* Render Markdown cleanly */}
                <MarkdownReport content={aiAnalysis.analysis} />

                {/* ── AI 战术调仓指令与实验室参数闭环面板 ───────────────────────── */}
                {aiAnalysis.tactical_adjustment && (() => {
                  const tac = aiAnalysis.tactical_adjustment;
                  const adjHoldings = tac.adjusted_holdings || [];
                  const dir = tac.lab_directives || {};
                  const barColors = [
                    'var(--accent-color)',
                    'var(--info)',
                    'var(--accent-secondary)',
                    'var(--success)',
                    '#8b5cf6',
                    '#ec4899',
                  ];

                  return (
                    <div
                      style={{
                        border: '1px solid var(--accent-color)',
                        background: 'rgba(var(--accent-color-rgb), 0.04)',
                        borderRadius: '8px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                      }}
                    >
                      {/* Title & Summary */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '1.02rem', color: 'var(--accent-color)' }}>
                            <Zap size={16} />
                            {isEn ? 'AI Tactical Portfolio Tilt & Lab Directives' : 'AI 战术调仓指令与实验室验证闭环'}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {isEn ? (tac.tactical_summary_en || tac.tactical_summary_zh) : tac.tactical_summary_zh}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: '4px', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                          CMA: {dir.cma_mode === 'forward_looking' ? (isEn ? 'Forward-Looking' : '宏观利率估值前瞻') : dir.cma_mode}
                        </span>
                      </div>

                      {/* Side-by-side Allocation Bars: Base vs AI Adjusted */}
                      {adjHoldings.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--surface-card)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.72rem' }}>
                            <span style={{ width: '92px', color: 'var(--text-muted)', flexShrink: 0 }}>{isEn ? 'Base Weights' : '量化基准权重'}</span>
                            <div style={{ flex: 1, height: '8px', borderRadius: '999px', overflow: 'hidden', display: 'flex', background: 'var(--surface-inset)' }}>
                              {adjHoldings.map((h, i) => (
                                <div
                                  key={`base-${h.lab_id}`}
                                  style={{ width: `${h.base_weight_pct}%`, background: barColors[i % barColors.length], opacity: 0.6 }}
                                  title={`${h.lab_id}: ${h.base_weight_pct}%`}
                                />
                              ))}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.72rem' }}>
                            <span style={{ width: '92px', color: 'var(--accent-color)', fontWeight: 700, flexShrink: 0 }}>{isEn ? 'AI Tactical' : 'AI 修正权重'}</span>
                            <div style={{ flex: 1, height: '10px', borderRadius: '999px', overflow: 'hidden', display: 'flex', background: 'var(--surface-inset)' }}>
                              {adjHoldings.map((h, i) => (
                                <div
                                  key={`adj-${h.lab_id}`}
                                  style={{ width: `${h.adjusted_weight_pct}%`, background: barColors[i % barColors.length] }}
                                  title={`${h.lab_id}: ${h.adjusted_weight_pct}%`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Holdings Weight Delta Table */}
                      <div style={{ overflowX: 'auto', background: 'var(--surface-card)', borderRadius: '6px', border: '1px solid var(--border-subtle)', padding: '6px 12px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                              <th style={{ textAlign: 'left', padding: '7px 4px' }}>{isEn ? 'Holding' : '标的资产'}</th>
                              <th style={{ textAlign: 'right', padding: '7px 6px' }}>{isEn ? 'Base' : '基准'}</th>
                              <th style={{ textAlign: 'right', padding: '7px 6px' }}>{isEn ? 'AI Adjusted' : 'AI 修正'}</th>
                              <th style={{ textAlign: 'center', padding: '7px 6px' }}>{isEn ? 'Tilt' : '调仓幅度'}</th>
                              <th style={{ textAlign: 'left', padding: '7px 6px' }}>{isEn ? 'Tactical Rationale' : 'AI 调仓逻辑'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adjHoldings.map((h) => {
                              const delta = Number(h.delta_pct || 0);
                              const isAdded = h.action === 'ADD';
                              const isRemoved = h.action === 'REMOVE' || Number(h.adjusted_weight_pct || 0) === 0;
                              const deltaColor = isAdded || delta > 0 ? 'var(--success)' : isRemoved ? 'var(--text-muted)' : delta < 0 ? 'var(--warning)' : 'var(--text-muted)';
                              const deltaBg = isAdded || delta > 0 ? 'rgba(16, 185, 129, 0.12)' : isRemoved ? 'var(--surface-subtle)' : delta < 0 ? 'rgba(245, 158, 11, 0.14)' : 'var(--surface-subtle)';
                              return (
                                <tr key={h.lab_id} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: isRemoved ? 0.6 : 1 }}>
                                  <td style={{ padding: '7px 4px', whiteSpace: 'nowrap' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-color)', textDecoration: isRemoved ? 'line-through' : 'none' }}>{h.lab_id}</span>
                                    {h.core_role && (
                                      <span style={{ marginLeft: '5px', fontSize: '0.62rem', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, background: h.core_role === 'core' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)', color: h.core_role === 'core' ? 'var(--info)' : 'var(--accent-secondary)' }}>
                                        {h.core_role === 'core' ? (isEn ? 'Core' : '核心') : (isEn ? 'Sat' : '卫星')}
                                      </span>
                                    )}
                                    {isAdded && (
                                      <span style={{ marginLeft: '5px', fontSize: '0.62rem', padding: '1px 5px', borderRadius: '3px', fontWeight: 700, background: 'rgba(16, 185, 129, 0.14)', color: 'var(--success)' }}>
                                        {isEn ? 'NEW' : '新增/替换'}
                                      </span>
                                    )}
                                    {isRemoved && (
                                      <span style={{ marginLeft: '5px', fontSize: '0.62rem', padding: '1px 5px', borderRadius: '3px', fontWeight: 700, background: 'var(--surface-inset)', color: 'var(--text-muted)' }}>
                                        {isEn ? 'REMOVED' : '已剔除'}
                                      </span>
                                    )}
                                    <span style={{ marginLeft: '6px', color: 'var(--text-primary)', fontWeight: 600, textDecoration: isRemoved ? 'line-through' : 'none' }}>{h.name}</span>
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '7px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                    {h.base_weight_pct}%
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '7px 6px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {h.adjusted_weight_pct}%
                                  </td>
                                  <td style={{ textAlign: 'center', padding: '7px 6px', whiteSpace: 'nowrap' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.72rem', padding: '2px 7px', borderRadius: '999px', background: deltaBg, color: deltaColor }}>
                                      {isAdded ? `+${h.adjusted_weight_pct}% NEW` : isRemoved ? `${delta}% OUT` : delta > 0 ? `+${delta}% ↑` : delta < 0 ? `${delta}% ↓` : '0%'}
                                    </span>
                                  </td>
                                  <td style={{ padding: '7px 6px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                    {isEn ? (h.reason_en || h.reason_zh) : h.reason_zh}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Extracted Lab & Cashflow Directives Strip */}
                      <div style={{ background: 'var(--surface-subtle)', borderRadius: '6px', padding: '10px 12px', fontSize: '0.76rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          <span>
                            {isEn ? 'Capital' : '本金'}: <strong>{fmtCurrency(dir.capital, prof?.currency)}</strong>
                          </span>
                          <span>
                            {isEn ? 'Horizon' : '模拟年限'}: <strong>{dir.years}{isEn ? 'Y' : '年'}</strong>
                          </span>
                          {dir.withdrawal > 0 && (
                            <span>
                              {isEn ? 'Draw 1' : '第一段提领'}: <strong>{fmtCurrency(dir.withdrawal, prof?.currency)}</strong> ({isEn ? `Y${dir.withdrawal_start}–${dir.withdrawal_end}` : `第${dir.withdrawal_start}–${dir.withdrawal_end}年`})
                            </span>
                          )}
                          {dir.withdrawal_2 > 0 && (
                            <span style={{ color: 'var(--accent-secondary)' }}>
                              {isEn ? 'Draw 2 (Event)' : '第二段/专项支出'}: <strong>{fmtCurrency(dir.withdrawal_2, prof?.currency)}</strong> ({isEn ? `Y${dir.withdrawal_start_2}–${dir.withdrawal_end_2}` : `第${dir.withdrawal_start_2}–${dir.withdrawal_end_2}年`})
                            </span>
                          )}
                          <span>
                            {isEn ? 'Stress' : '极端波动压力'}: <strong>{dir.stress ? (isEn ? 'ON' : '开启') : (isEn ? 'OFF' : '常规')}</strong>
                          </span>
                        </div>
                        {dir.directive_notes_zh && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem' }}>
                            📌 {isEn ? (dir.directive_notes_en || dir.directive_notes_zh) : dir.directive_notes_zh}
                          </div>
                        )}
                      </div>

                      {/* Closed-Loop Handoff Buttons */}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={handleSendTacticalToLab}
                          className="create-btn"
                          style={{ flex: '1 1 240px', justifyContent: 'center', fontSize: '0.84rem', padding: '9px 14px' }}
                        >
                          <Zap size={15} /> {isEn ? 'Apply AI Tilt & Simulate in Lab →' : '一键采用 AI 修正方案并送入实验室验证 →'}
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyTacticalToBasket}
                          className="action-btn-secondary"
                          style={{
                            flex: '1 1 200px',
                            justifyContent: 'center',
                            fontSize: '0.8rem',
                            padding: '8px 12px',
                            borderColor: tacticalAppliedSuccess ? 'var(--success)' : undefined,
                            color: tacticalAppliedSuccess ? 'var(--success)' : undefined,
                          }}
                        >
                          {tacticalAppliedSuccess
                            ? <><Check size={14} /> {isEn ? 'Applied to Basket Card!' : '已更新上方推荐卡片权重！'}</>
                            : <><RefreshCw size={14} /> {isEn ? 'Update Current Basket Card' : '应用 AI 权重到当前推荐卡片'}</>}
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateTacticalPortfolio}
                          className="action-btn-secondary"
                          style={{ flex: '1 1 200px', justifyContent: 'center', fontSize: '0.8rem', padding: '8px 12px' }}
                        >
                          <PlusCircle size={14} /> {isEn ? 'Create Live Portfolio (AI Tilt)' : '按 AI 修正权重直接创建实盘组合'}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  background: 'var(--surface-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-secondary)',
                  fontSize: '0.86rem',
                }}
              >
                <div style={{ marginBottom: '8px', fontWeight: 600 }}>
                  {isEn
                    ? 'AI Wealth Advisor evaluates real-time macro yields, equity valuation percentiles, core-satellite roles, and client constraints.'
                    : 'AI 首席投顾将结合当期实时宏观利率与估值分位数据、核心—卫星选基纪律及客户特定诉求与久期，出具买方机构视角的深度归因与换基建议。'}
                </div>
                <button
                  type="button"
                  onClick={handleGenerateAiAnalysis}
                  disabled={aiLoading}
                  className="action-btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '6px 16px', borderColor: 'var(--accent-secondary)', color: 'var(--accent-secondary)' }}
                >
                  <Sparkles size={14} /> {isEn ? 'Click to Generate Forward-Looking Report' : '点击生成前瞻研判与归因报告'}
                </button>
              </div>
            )}
          </section>

          {/* TRACK B: Matching Existing Portfolios & Classic Strategy Archetypes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '18px' }}>
            {/* Existing Portfolios */}
            <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '1.12rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={17} style={{ color: 'var(--accent-color)' }} />
                {isEn ? 'Track B1 · Matching Live Platform Portfolios' : '轨道二 · 匹配平台现有实盘策略'}
              </h2>
              {(result.existing_portfolio_matches || []).length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                  {isEn ? 'No existing portfolio target allocations matched.' : '暂无带目标权重的现有实盘组合可供匹配。'}
                </div>
              ) : (
                result.existing_portfolio_matches.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.96rem' }}>
                        {m.name}
                        <span style={{ marginLeft: '8px', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {m.base_currency} · {m.dividend_strategy}
                        </span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem', padding: '2px 8px', borderRadius: '999px', background: 'rgba(var(--accent-color-rgb), 0.12)', color: 'var(--accent-color)' }}>
                        {isEn ? `Match ${m.match_score}%` : `匹配度 ${m.match_score}%`}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {m.fit_reasons.map((r, i) => (
                        <div key={i}>✓ {r}</div>
                      ))}
                      {m.watchouts.map((w, i) => (
                        <div key={i} style={{ color: 'var(--warning)' }}>! {w}</div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {m.stats.annualized_return_pct != null && (
                        <span>CAGR: {m.stats.annualized_return_pct}%</span>
                      )}
                      {m.stats.total_return_pct != null && (
                        <span>ROI: {m.stats.total_return_pct}%</span>
                      )}
                      {Object.entries(m.allocations).map(([k, pct]) => (
                        <span key={k} style={{ color: 'var(--text-primary)' }}>{k}: {pct}%</span>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
                      <button
                        type="button"
                        className="action-btn-secondary"
                        style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                        onClick={() => onOpenPortfolio(m.id)}
                      >
                        <ExternalLink size={13} /> {isEn ? 'Open Portfolio' : '查看实盘组合'}
                      </button>
                      <button
                        type="button"
                        className="action-btn-secondary"
                        style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                        onClick={() =>
                          onSendToLab(
                            Object.entries(m.allocations).map(([id, weight]) => ({ id, weight })),
                            m.name,
                            buildAdvisoryHandoffProfile(m.name)
                          )
                        }
                      >
                        <FlaskConical size={13} /> {isEn ? 'Test in Lab' : '导入实验室模拟'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>

            {/* Classic Strategy Templates */}
            <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '1.12rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Compass size={17} style={{ color: 'var(--accent-secondary)' }} />
                {isEn ? 'Track B2 · Classic Strategy Archetypes' : '轨道三 · 匹配经典大类配置模板'}
              </h2>
              {(result.classic_template_matches || []).map((tpl) => (
                <div
                  key={tpl.id}
                  style={{
                    background: 'var(--surface-subtle)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.96rem' }}>{isEn ? tpl.name_en : tpl.name_zh}</span>
                      <span style={{ marginLeft: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>({tpl.origin})</span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem', padding: '2px 8px', borderRadius: '999px', background: 'rgba(var(--accent-secondary-rgb), 0.14)', color: 'var(--accent-secondary)' }}>
                      {isEn ? `Match ${tpl.match_score}%` : `匹配度 ${tpl.match_score}%`}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    {isEn ? tpl.idea_en : tpl.idea_zh}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                    {tpl.holdings.map((h) => (
                      <span
                        key={h.isin}
                        style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          background: 'var(--surface-card)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {h.isin} {h.weight_pct}%
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                    <button
                      type="button"
                      className="action-btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                      onClick={() => {
                        const title = isEn ? tpl.name_en : tpl.name_zh;
                        onSendToLab(
                          tpl.holdings.map((h) => ({ id: h.isin, weight: h.weight_pct })),
                          title,
                          buildAdvisoryHandoffProfile(title, tpl.holdings)
                        );
                      }}
                    >
                      <FlaskConical size={13} /> {isEn ? 'Apply to Strategy Lab' : '一键套用到实验室'}
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}

      {/* ── SAVED SCENARIOS MODAL/DRAWER ───────────────────────────────────── */}
      {savedDrawerOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setSavedDrawerOpen(false)}
        >
          <div
            className="glass-card"
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderOpen size={18} style={{ color: 'var(--accent-color)' }} />
                <h3 style={{ margin: 0, fontSize: '1.18rem' }}>
                  {isEn ? 'Saved Client Scenarios' : '已保存的客户画像与配置档案'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSavedDrawerOpen(false)}
                className="action-icon"
                style={{ background: 'transparent', border: 'none' }}
              >
                <X size={18} />
              </button>
            </div>

            {savedProfiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                {isEn ? 'No saved profiles yet. Click "Save Profile Draft" or "Save Recommendation" to store client cases.' : '暂无已存客户档案。在画像输入或推荐页面点击「保存方案」即可留存客户档案。'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {savedProfiles.map((p) => {
                  const f = p.formData || {};
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleLoadProfile(p)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '6px',
                        background: 'var(--surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-color)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{p.clientName}</span>
                          <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(var(--accent-color-rgb), 0.12)', color: 'var(--accent-color)', fontFamily: 'var(--font-mono)' }}>
                            {f.currency} {Number(f.initialCapital || 0).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                          {f.horizonYears ? `${f.horizonYears}年 · ` : ''}
                          目标: {GOALS.find((g) => g.id === f.primaryGoal)?.zh || f.primaryGoal} · 档位: {RISK_TIERS.find((r) => r.id === f.manualRiskTier)?.zh || '自动测评'}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} /> {new Date(p.savedAt).toLocaleString()}
                          {p.aiAnalysis && <span style={{ color: 'var(--accent-secondary)' }}>· 含 AI 归因报告</span>}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="action-btn-secondary"
                          style={{ fontSize: '0.76rem', padding: '4px 10px', color: 'var(--accent-color)', borderColor: 'var(--accent-color)' }}
                        >
                          调取 <ArrowRight size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSavedProfile(p.id, e)}
                          className="action-icon"
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
                          title="删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvisoryView;
