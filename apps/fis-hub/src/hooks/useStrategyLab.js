/**
 * 策略实验室：标的与权重、蒙特卡洛参数、储蓄险/ILP、方案保存与加载、报告生成。
 * 从 App.jsx 原样搬出，行为不变。
 */
import { useState, useEffect } from 'react';
import { authHeaders } from '../utils/auth';

export function useStrategyLab({ activeTab, currentUser }) {
  // Strategy Lab State
  const [labIsins, setLabIsins] = useState(['VOO', 'QQQ', 'IE0033534557']);
  const [labInput, setLabInput] = useState('');
  const [labData, setLabData] = useState(null);
  const [labLoading, setLabLoading] = useState(false);
  const [labError, setLabError] = useState(null);
  const [labDaysBack, setLabDaysBack] = useState(1825);
  const [labMaxWeight, setLabMaxWeight] = useState(1.0);
  const [labMode, setLabMode] = useState('custom'); // 'auto' or 'custom'
  const [labCustomWeights, setLabCustomWeights] = useState({});
  const [insuranceEnabled, setInsuranceEnabled] = useState(false);
  const [insurancePlan, setInsurancePlan] = useState(null);
  const [insuranceAlphaLow, setInsuranceAlphaLow] = useState(0.80);
  const [insuranceAlphaHigh, setInsuranceAlphaHigh] = useState(1.20);
  const [labMcSettings, setLabMcSettings] = useState({
    capital: 1000000,
    contribution: 0,
    contribution_start: 1,
    contribution_years: 10,
    withdrawal: 0,
    withdrawal_start: 1,
    withdrawal_end: 30,
    withdrawal_2: 0,
    withdrawal_start_2: 31,
    withdrawal_end_2: 60,
    withdrawal_inflation: false,
    years: 30,
    target: 2000000,
    stress: false,
    inflation: 2.5,
    cma_mode: 'shrunk'
  });
  const [labTab, setLabTab] = useState('optimization'); // optimization, backtest
  const [showLabDebug, setShowLabDebug] = useState(false);
  const [labChartFontSize, setLabChartFontSize] = useState(14);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [briefReportOpen, setBriefReportOpen] = useState(false);
  const [clientInfoModalOpen, setClientInfoModalOpen] = useState(false);
  const [clientInfo, setClientInfo] = useState(null);
  const [showMcDoc, setShowMcDoc] = useState(false);
  // Saved Scenarios State
  const [scenariosDrawer, setScenariosDrawer] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioSaving, setScenarioSaving] = useState(false);

  // ── ILP 投连险 State ────────────────────────────────────────────────────
  const [ilpEnabled, setIlpEnabled] = useState(false);
  const [ilpConfig, setIlpConfig] = useState({
    age: 35,
    gender: 'male',
    smoker: false,
    totalPremium: 0,
    currency: 'USD',
    enrollmentRate: null,
  });
  const [ilpEnrollmentModalOpen, setIlpEnrollmentModalOpen] = useState(false);

  // ── ILP ↔ MC 单向同步（防止循环触发 React Error #185） ─────────────────
  // 规则：ILP 是整付保费产品，保费 = Initial Capital，Annual Add = 0
  //
  // 设计原则：
  //   - 唯一数据流：capital → ILP保费（只在 capital 变化时同步保费，不反向）
  //   - 避免循环：不在 ilpConfig.totalPremium 变化时反写 capital
  //   - 用户直接修改保费时（在 ILPConfigPanel），仅更新 ilpConfig，不回写 capital
  //     （capital 是 MC 参数，保费跟随 capital，而非 capital 跟随保费）

  // Effect 1: ILP 开启时 / capital 改变时 → 同步保费，强制 contribution=0
  useEffect(() => {
    if (!ilpEnabled || !labMcSettings) return;
    const capital = parseFloat(labMcSettings.capital) || 0;
    setIlpConfig(prev => {
      if (prev.totalPremium === capital) return prev; // 值不变则不更新，避免触发 Effect 2
      return { ...prev, totalPremium: capital };
    });
    setLabMcSettings(prev =>
      prev && prev.contribution !== 0 ? { ...prev, contribution: 0 } : prev
    );
  }, [ilpEnabled, labMcSettings?.capital]); // eslint-disable-line react-hooks/exhaustive-deps



  // Real-time lab sum for validation
  const labSum = labMode === 'custom' 
    ? labIsins.reduce((acc, isin) => acc + (parseFloat(labCustomWeights[isin]) || 0), 0)
    : 100;
  const isLabReady = labIsins.length >= 2 && Math.abs(labSum - 100) < 0.1;

  // ── 登录后自动加载 ILP 配置 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    fetch('/api/ilp/config', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && (data.premium > 0 || data.age)) {
          setIlpConfig({
            age: data.age ?? 35,
            gender: data.gender ?? 'male',
            smoker: data.smoker ?? false,
            totalPremium: data.premium ?? 0,
            currency: data.currency ?? 'USD',
            enrollmentRate: data.enrollment_rate ?? null,
          });
          if (data.premium > 0) setIlpEnabled(true);
        }
      })
      .catch(() => {});
  }, [currentUser]);


  // ── Strategy Lab Handlers ────────────────────────────────────────────────

  // 点击「预览报告」→ 先弹客户信息弹窗
  const handleGenerateReport = () => {
    if (!labData?.monte_carlo) {
      alert('请先执行蒙特卡洛测算，再生成报告。');
      return;
    }
    setClientInfoModalOpen(true);
  };

  // 用户填写信息后确认 → 保存并打开报告
  const handleClientInfoConfirm = (info) => {
    setClientInfo(info);
    setClientInfoModalOpen(false);
    setReportModalOpen(true);
  };

  // 用户点击跳过 → 清空客户信息，直接打开报告
  const handleClientInfoSkip = () => {
    setClientInfo(null);
    setClientInfoModalOpen(false);
    setReportModalOpen(true);
  };

  // 后端 Word 文档生成（独立触发，与网页报告分开）
  const handleGenerateWordReport = async () => {
    if (!labData?.monte_carlo) {
      alert('请先执行蒙特卡洛测算，再生成报告。');
      return;
    }
    setReportLoading(true);
    try {
      const res = await fetch('/api/lab/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lab_result: labData,
          client_info: clientInfo || {},
          mc_settings: {
            capital:            Number(labMcSettings.capital),
            years:              Number(labMcSettings.years),
            withdrawal:         Number(labMcSettings.withdrawal),
            withdrawal_start:   Number(labMcSettings.withdrawal_start),
            withdrawal_end:     Number(labMcSettings.withdrawal_end),
            withdrawal_2:       Number(labMcSettings.withdrawal_2 || 0),
            withdrawal_start_2: Number(labMcSettings.withdrawal_start_2 || 1),
            withdrawal_end_2:   Number(labMcSettings.withdrawal_end_2 || 100),
            contribution:       Number(labMcSettings.contribution),
            contribution_start: Number(labMcSettings.contribution_start),
            contribution_years: Number(labMcSettings.contribution_years),
            inflation_pct:      Number(labMcSettings.inflation),
            target:             Number(labMcSettings.target),
            stress:             labMcSettings.stress,
          }
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || 'Report generation failed');
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const clientSuffix = clientInfo?.name ? `_${clientInfo.name}` : '';
      a.download = `wealth_report${clientSuffix}_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('报告生成失败：' + err.message);
    } finally {
      setReportLoading(false);
    }
  };

  const handleAddLabIsin = (e) => {
    e.preventDefault();
    if (!labInput.trim()) return;
    const isin = labInput.trim().toUpperCase();
    if (!labIsins.includes(isin)) {
      setLabIsins([...labIsins, isin]);
    }
    setLabInput('');
  };

  const handleRemoveLabIsin = (isin) => {
    setLabIsins(labIsins.filter(i => i !== isin));
  };

  // ─── Scenarios: Save / Load / Delete ───────────────────────────────────────
  const fetchSavedScenarios = async () => {
    try {
      const res = await fetch('/api/lab/scenarios');
      if (!res.ok) { console.warn('fetchSavedScenarios: backend not ready (status', res.status, ')'); return; }
      const data = await res.json();
      setSavedScenarios(Array.isArray(data) ? data : []);
    } catch (e) { console.error('fetchSavedScenarios:', e); }
  };

  useEffect(() => {
    if (activeTab === 'lab') {
      fetchSavedScenarios();
    }
  }, [activeTab]);

  const handleSaveScenario = async () => {
    if (!labData || !scenarioName.trim()) return;
    setScenarioSaving(true);
    try {
      // Build a lean summary from current labData
      const target = labData[labData.mc_target_label];
      const mc = labData.monte_carlo;
      const summary = {
        expected_return: target?.expected_return,
        volatility: target?.volatility,
        sharpe_ratio: target?.sharpe_ratio,
        dividend_yield: target?.dividend_yield,
        irr_p50: mc?.irr?.p50,
        irr_p10: mc?.irr?.p10,
        irr_p90: mc?.irr?.p90,
        success_rate: mc?.success_rate,
        capital: labMcSettings.capital,
        withdrawal: labMcSettings.withdrawal,
        years: labMcSettings.years,
      };
      const res = await fetch('/api/lab/scenarios/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: scenarioName.trim(),
          assets: labIsins,
          custom_weights: labCustomWeights,
          mc_settings: labMcSettings,
          summary,
          chart_data: mc?.chart || [],
          // ── ILP 投连险配置 ──────────────────────────────────────────────
          ilp_enabled: ilpEnabled,
          ilp_config: ilpEnabled ? ilpConfig : null,
          // ── 储蓄险配置 ──────────────────────────────────────────────────
          insurance_enabled: insuranceEnabled,
          insurance_plan: insuranceEnabled ? insurancePlan : null,
          insurance_alpha_low: insuranceEnabled ? insuranceAlphaLow : null,
          insurance_alpha_high: insuranceEnabled ? insuranceAlphaHigh : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveDialogOpen(false);
      setScenarioName('');
      fetchSavedScenarios(); // refresh list
      alert('✅ 方案已保存！');
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally {
      setScenarioSaving(false);
    }
  };

  const handleLoadScenario = async (id) => {
    try {
      const res = await fetch(`/api/lab/scenarios/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const rawSettings = data.mc_settings || data.settings || {};
      const cleanMcSettings = {};
      Object.entries(rawSettings).forEach(([k, v]) => {
        if (!k.startsWith('_')) cleanMcSettings[k] = v;
      });
      const mergedMcSettings = {
        capital: 1000000,
        contribution: 0,
        contribution_start: 1,
        contribution_years: 10,
        withdrawal: 0,
        withdrawal_start: 1,
        withdrawal_end: 30,
        withdrawal_2: 0,
        withdrawal_start_2: 31,
        withdrawal_end_2: 60,
        withdrawal_inflation: false,
        years: 30,
        target: 2000000,
        stress: false,
        inflation: 2.5,
        cma_mode: 'shrunk',
        ...cleanMcSettings,
      };

      const assets = Array.isArray(data.assets) ? data.assets : [];
      const rawWeights = data.weights || data.custom_weights || {};
      const uiWeights = {};
      const normAllocations = {};
      const weightSum = Object.values(rawWeights).reduce((s, v) => s + (parseFloat(v) || 0), 0);
      Object.entries(rawWeights).forEach(([isin, val]) => {
        const num = parseFloat(val) || 0;
        if (weightSum <= 1.5 && weightSum > 0) {
          uiWeights[isin] = Number((num * 100).toFixed(2));
          normAllocations[isin] = num;
        } else {
          uiWeights[isin] = num;
          normAllocations[isin] = weightSum > 0 ? num / weightSum : num / 100;
        }
      });

      const rawChart = data.chart_data || data.chart || [];
      const chartData = Array.isArray(rawChart) ? rawChart : [];
      const summary = data.summary || {};

      // Restore assets, weights, settings
      setLabIsins(assets);
      setLabCustomWeights(uiWeights);
      setLabMode('custom');
      setLabMcSettings(mergedMcSettings);
      // Restore chart data into labData structure
      setLabData(prev => ({
        ...(prev || {}),
        ...summary,
        mc_target_label: 'custom_portfolio',
        custom_portfolio: {
          allocations: normAllocations,
          expected_return: summary.expected_return ?? 0,
          volatility: summary.volatility ?? 0,
          sharpe_ratio: summary.sharpe_ratio ?? 0,
          dividend_yield: summary.dividend_yield ?? 0,
        },
        monte_carlo: {
          chart: chartData,
          irr: {
            p50: summary.irr_p50,
            p10: summary.irr_p10,
            ...(summary.irr_p90 !== undefined ? { p90: summary.irr_p90 } : {}),
          },
          success_rate: summary.success_rate ?? null,
        },
        _restored_from: data.name,
      }));
      // ── 恢复 ILP 投连险配置 ──────────────────────────────────────────────
      const ilpEn = data.ilp_enabled ?? rawSettings._ilp_enabled;
      const ilpCfg = data.ilp_config ?? rawSettings._ilp_config;
      if (ilpEn != null) {
        setIlpEnabled(!!ilpEn);
        if (ilpCfg) setIlpConfig(ilpCfg);
      } else {
        setIlpEnabled(false);
      }
      // ── 恢复储蓄险配置 ──────────────────────────────────────────────────
      const insEn = data.insurance_enabled ?? rawSettings._ins_enabled;
      const insPlan = data.insurance_plan ?? rawSettings._ins_plan;
      const insLow = data.insurance_alpha_low ?? rawSettings._ins_alpha_low;
      const insHigh = data.insurance_alpha_high ?? rawSettings._ins_alpha_high;
      if (insEn != null) {
        setInsuranceEnabled(!!insEn);
        if (insPlan) setInsurancePlan(insPlan);
        if (insLow != null) setInsuranceAlphaLow(insLow);
        if (insHigh != null) setInsuranceAlphaHigh(insHigh);
      } else {
        setInsuranceEnabled(false);
      }
      setScenariosDrawer(false);
    } catch (e) {
      alert('加载失败: ' + e.message);
    }
  };

  const handleDeleteScenario = async (id) => {
    if (!window.confirm('确认删除此方案？此操作不可撤销。')) return;
    await fetch(`/api/lab/scenarios/${id}`, { method: 'DELETE' });
    fetchSavedScenarios();
  };

  const handleRenameScenario = async (id, newName) => {
    try {
      const res = await fetch(`/api/lab/scenarios/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (!res.ok) throw new Error("Rename failed");
      fetchSavedScenarios();
    } catch (e) {
      alert('重命名失败: ' + e.message);
    }
  };
  // ───────────────────────────────────────────────────────────────────────────

  const handleRunLabAnalysis = async () => {

    if (labIsins.length < 2) {
      setLabError("Please add at least 2 ISINs to analyze correlations.");
      return;
    }
    
    let submitCustomWeights = null;
    if (labMode === 'custom') {
      const sum = labIsins.reduce((acc, isin) => acc + (parseFloat(labCustomWeights[isin]) || 0), 0);
      if (Math.abs(sum - 100) > 0.1) {
        setLabError(`Custom weights must sum to exactly 100%. Currently: ${sum.toFixed(1)}%`);
        return;
      }
      submitCustomWeights = {};
      labIsins.forEach(isin => {
        submitCustomWeights[isin] = (parseFloat(labCustomWeights[isin]) || 0) / 100;
      });
    }

    setLabLoading(true);
    setLabError(null);
    try {
      const payload = { 
        isins: labIsins, 
        days_back: labDaysBack, 
        max_weight: labMaxWeight, 
        risk_free_rate: 0.04,
        mc_capital: Number(labMcSettings.capital),
        mc_contribution: Number(labMcSettings.contribution),
        mc_contribution_start: Number(labMcSettings.contribution_start),
        mc_contribution_years: Number(labMcSettings.contribution_years),
        mc_withdrawal: Number(labMcSettings.withdrawal),
        mc_withdrawal_start: Number(labMcSettings.withdrawal_start),
        mc_withdrawal_end: Number(labMcSettings.withdrawal_end),
        mc_withdrawal_2: Number(labMcSettings.withdrawal_2 || 0),
        mc_withdrawal_start_2: Number(labMcSettings.withdrawal_start_2 || 1),
        mc_withdrawal_end_2: Number(labMcSettings.withdrawal_end_2 || 100),
        mc_withdrawal_inflation: labMcSettings.withdrawal_inflation,
        mc_years: Number(labMcSettings.years),
        mc_target: Number(labMcSettings.target),
        mc_stress: labMcSettings.stress,
        // 通胀按「百分数」透传（2.5 表示 2.5%），后端统一除以 100；
        // 之前这里也除了一次，等于按 0.025% 折现，真实购买力曲线失真。
        mc_inflation: Number(labMcSettings.inflation),
        cma_mode: labMcSettings.cma_mode || 'shrunk',
        _ts: Date.now() // Bust cache
      };
      
      if (insuranceEnabled && insurancePlan) {
        payload.insurance_plan = insurancePlan.years.map(y => ({
          year:           y.year,
          guaranteed_cv:  y.guaranteed_cv,
          non_guaranteed: y.non_guaranteed,
          withdrawal:     y.withdrawal,
          total_cv_base:  y.total_cv_base,
        }));
        payload.insurance_alpha_low  = insuranceAlphaLow;
        payload.insurance_alpha_high = insuranceAlphaHigh;
        payload.insurance_label      = insurancePlan.policy_name || "储蓄分红险";
      }

      if (submitCustomWeights) payload.custom_weights = submitCustomWeights;
      
      const res = await fetch('/api/lab/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "Failed to analyze");
      setLabData(result);
    } catch (err) {
      setLabError(err.message);
    } finally {
      setLabLoading(false);
    }
  };

  const applyLabTemplate = (isins, specificWeights = null) => {
    setLabIsins(isins);
    if (specificWeights) {
      setLabCustomWeights(specificWeights);
    } else {
      const equalWeight = (100 / isins.length).toFixed(1);
      const weights = {};
      isins.forEach(isin => {
        weights[isin] = equalWeight;
      });
      setLabCustomWeights(weights);
    }
  };

  return {
    labIsins,
    setLabIsins,
    labInput,
    setLabInput,
    labData,
    setLabData,
    labLoading,
    setLabLoading,
    labError,
    setLabError,
    labDaysBack,
    setLabDaysBack,
    labMaxWeight,
    setLabMaxWeight,
    labMode,
    setLabMode,
    labCustomWeights,
    setLabCustomWeights,
    insuranceEnabled,
    setInsuranceEnabled,
    insurancePlan,
    setInsurancePlan,
    insuranceAlphaLow,
    setInsuranceAlphaLow,
    insuranceAlphaHigh,
    setInsuranceAlphaHigh,
    labMcSettings,
    setLabMcSettings,
    labTab,
    setLabTab,
    showLabDebug,
    setShowLabDebug,
    labChartFontSize,
    setLabChartFontSize,
    reportLoading,
    setReportLoading,
    reportModalOpen,
    setReportModalOpen,
    briefReportOpen,
    setBriefReportOpen,
    clientInfoModalOpen,
    setClientInfoModalOpen,
    clientInfo,
    setClientInfo,
    showMcDoc,
    setShowMcDoc,
    scenariosDrawer,
    setScenariosDrawer,
    savedScenarios,
    setSavedScenarios,
    saveDialogOpen,
    setSaveDialogOpen,
    scenarioName,
    setScenarioName,
    scenarioSaving,
    setScenarioSaving,
    ilpEnabled,
    setIlpEnabled,
    ilpConfig,
    setIlpConfig,
    ilpEnrollmentModalOpen,
    setIlpEnrollmentModalOpen,
    labSum,
    isLabReady,
    handleGenerateReport,
    handleClientInfoConfirm,
    handleClientInfoSkip,
    handleGenerateWordReport,
    handleAddLabIsin,
    handleRemoveLabIsin,
    fetchSavedScenarios,
    handleSaveScenario,
    handleLoadScenario,
    handleDeleteScenario,
    handleRenameScenario,
    handleRunLabAnalysis,
    applyLabTemplate,
  };
}
