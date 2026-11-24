import React, { useState, useEffect, useRef } from 'react';
import { useLang } from './i18n/langCore';
import WealthReport from './components/WealthReport';
import ClientBriefReport from './components/ClientBriefReport';
import Sidebar from './components/Sidebar';
import StrategyLabView from './components/StrategyLabView';
import PortfolioView from './components/PortfolioView';
import CreatePortfolioModal from './components/modals/CreatePortfolioModal';
import DividendModal from './components/modals/DividendModal';
import DeleteModal from './components/modals/DeleteModal';
import RenameModal from './components/modals/RenameModal';
import RebalanceModal from './components/modals/RebalanceModal';
import ManageDivModal from './components/modals/ManageDivModal';
import CompositionModal from './components/modals/CompositionModal';
import McDocModal from './components/modals/McDocModal';
import ClientInfoModal from './components/ClientInfoModal';
import ILPEnrollmentBonusModal from './components/ILPEnrollmentBonusModal';
import { authStorage, authHeaders } from './utils/auth';
import { apiFetch } from './api/client';
import AuthModal from './components/AuthModal';
import AdminPanel from './components/AdminPanel';
import AdvisorClientsPanel from './components/AdvisorClientsPanel';
import HelpManualView from './components/HelpManualView';
import FeatureLock from './components/FeatureLock';
import ComplianceGateModal from './components/ComplianceGateModal';
import { buildSectorData, buildTop10Data, getDaysUntil, buildHoldingsCsv, buildDividendsCsv, downloadCsv } from './utils/portfolioStats';
import { useDividends } from './hooks/useDividends';
import { useComposition } from './hooks/useComposition';
import { useRebalance } from './hooks/useRebalance';
import { useStrategyLab } from './hooks/useStrategyLab';
import { useFundQuant } from './hooks/useFundQuant';
import FundQuantView from './components/FundQuantView';
import AdvisoryView from './components/AdvisoryView';
import MonitorOverviewView from './components/MonitorOverviewView';
import ImmigrationShowcase from './components/ImmigrationShowcase';
import { reloadReportAndHistory } from './utils/reportApi';
import { useTheme } from './theme/themeCore';
import { Menu, Briefcase, Activity, Database, Compass, FolderOpen, BookOpen, Sun, Moon, ShieldAlert, X } from 'lucide-react';


// ── 角色颜色映射（颜色固定，标签由 i18n 提供）──
const ROLE_META = {
  admin:   { color: 'var(--danger)' },
  advisor: { color: 'var(--info)' },
  premium: { color: 'var(--accent-secondary)' },
  free:    { color: 'var(--text-muted)' },
};

import { VerifyEmailOverlay, ResetPasswordOverlay } from './components/AuthOverlays';

function App() {
  const { lang, toggleLang, t } = useLang();
  const { theme, cycleTheme, isDark } = useTheme();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [urlParams] = useState(new URLSearchParams(window.location.search));
  const mode = urlParams.get('mode');
  const urlLang = urlParams.get('lang') || 'zh';
  const [authAction, setAuthAction] = useState(() => {
    if (window.location.pathname === '/verify-email') return 'verify';
    if (window.location.pathname === '/reset-password') return 'reset';
    return null;
  });
  const token = urlParams.get('token');

  const closeAuthAction = () => {
    setAuthAction(null);
    window.history.replaceState({}, '', '/');
  };

  // ── 合规确认状态（localStorage 持久化）──
  const [complianceAcked, setComplianceAcked] = useState(
    () => !!localStorage.getItem('ww_compliance_acked')
  );
  const handleComplianceAcknowledge = () => {
    localStorage.setItem('ww_compliance_acked', '1');
    setComplianceAcked(true);
  };

  const [portfolios, setPortfolios] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeTab, setActiveTab] = useState('portfolios'); // 'portfolios' or 'lab'
  const [activeAdvisoryClientInfo, setActiveAdvisoryClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  // ── 业务模块 hooks（原 App.jsx 内联状态与处理函数，见 src/hooks/）──
  const {
    showDivModal,
    setShowDivModal,
    showManageDivModal,
    setShowManageDivModal,
    dividendHistory,
    mDiv,
    setMDiv,
    handleManualDiv,
    handleOpenManageDivModal,
    handleDeleteManualDividend,
  } = useDividends({ activeId, setData });

  const {
    showCompModal,
    setShowCompModal,
    compTxs,
    compTargets,
    compEditing,
    compNewAsset,
    setCompNewAsset,
    handleOpenCompModal,
    handleCompEdit,
    handleCompSave,
    handleCompDelete,
    handleCompAddAsset,
    setCompTargets,
  } = useComposition({ activeId, setData });

  const {
    showRebalanceModal,
    setShowRebalanceModal,
    rebalancePreview,
    setRebalancePreview,
    rebalanceDate,
    setRebalanceDate,
    rebalanceDraftTargets,
    setRebalanceDraftTargets,
    undoConfirmOpen,
    setUndoConfirmOpen,
    handleUndoRebalance,
    handleUndoConfirmed,
    handleRebalancePreview,
    handleRebalanceSaveAndCalc,
    handleRebalanceExecute,
  } = useRebalance({ activeId, setData, setHistoryData, setLoading, setCompTargets });


  const [activeSubTab, setActiveSubTab] = useState('performance'); // 'performance' or 'dividends'
  const [divProjData, setDivProjData] = useState(null);
  const [divLoading, setDivLoading] = useState(false);
  const [taxRate, setTaxRate] = useState(0.0);
  const [dripMode, setDripMode] = useState(false);

  // ── Auth State ──────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => authStorage.getUser());
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // 策略实验室（含 ILP / 储蓄险 / 方案）
  const {
    labIsins,
    labInput,
    setLabInput,
    labData,
    labLoading,
    labError,
    labDaysBack,
    setLabDaysBack,
    labBaseCurrency,
    setLabBaseCurrency,
    stressTestData,
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
    labChartFontSize,
    setLabChartFontSize,
    reportLoading,
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
    savedScenarios,
    saveDialogOpen,
    setSaveDialogOpen,
    scenarioName,
    setScenarioName,
    scenarioSaving,
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
    handleAddMultipleLabIsins,
    handleRemoveLabIsin,
    handleSaveScenario,
    handleNewBlankStrategy,
    handleLoadScenario,
    handleDeleteScenario,
    handleRenameScenario,
    handleRunLabAnalysis,
    applyLabTemplate,
  } = useStrategyLab({ activeTab, currentUser });

  // Wonder Quant 基金量化库（306 只基金体检 + 对比 + 健康度）
  const {
    health: quantHealth,
    funds: quantFunds,
    facets: quantFacets,
    loading: quantLoading,
    error: quantError,
    detailSlug: quantDetailSlug,
    setDetailSlug: setQuantDetailSlug,
    compareSlugs: quantCompareSlugs,
    setCompareSlugs: setQuantCompareSlugs,
    toggleCompareSlug: toggleQuantCompareSlug,
    compareOpen: quantCompareOpen,
    setCompareOpen: setQuantCompareOpen,
    refreshFunds: refreshQuantFunds,
  } = useFundQuant({ activeTab, currentUser });

  const handleSendFundsToLab = (ids) => {
    if (!ids || ids.length === 0) return;
    handleAddMultipleLabIsins(ids, ids.length >= 2);
    if (ids.length >= 2) {
      setLabMode('auto');
    }
    setActiveTab('lab');
  };

  const handleAdvisorySendToLab = (items, title, profile) => {
    if (!items || items.length === 0) return;
    setActiveAdvisoryClientInfo({
      clientName: profile?.client_name || title || '客户配置方案',
      goal: profile?.primary_goal || 'balanced',
    });
    const ids = items.map((x) => String(x.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return;
    const weightsObj = {};
    let totalW = 0;
    items.forEach((x, idx) => {
      const id = String(x.id || '').trim();
      const w = Number(x.weight || 0);
      if (idx === items.length - 1) {
        weightsObj[id] = Number((100 - totalW).toFixed(2));
      } else {
        const rounded = Number(w.toFixed(2));
        weightsObj[id] = rounded;
        totalW += rounded;
      }
    });
    applyLabTemplate(ids, weightsObj);
    if (profile?.currency) setLabBaseCurrency(profile.currency);
    if (profile) {
      const d = profile.lab_directives;
      const cap = Number(d?.capital || profile.initial_capital || 500000);
      const yrs = Number(d?.years || profile.horizon_years || 10);
      const hasDraws =
        Number(d?.withdrawal ?? profile.annual_withdrawal ?? 0) > 0 ||
        Number(d?.withdrawal_2 || 0) > 0 ||
        ['income', 'preservation', 'retirement'].includes(profile.primary_goal);
      const smartTarget = hasDraws ? cap : Math.round(cap * 1.5);

      setLabMcSettings((prev) => ({
        ...prev,
        ...(d
          ? {
              cma_mode: d.cma_mode || 'forward_looking',
              capital: cap,
              years: yrs,
              target: smartTarget,
              withdrawal: Number(d.withdrawal ?? profile.annual_withdrawal ?? 0),
              withdrawal_start: Number(d.withdrawal_start || 1),
              withdrawal_end: Number(d.withdrawal_end || yrs || 30),
              withdrawal_2: Number(d.withdrawal_2 || 0),
              withdrawal_start_2: Number(d.withdrawal_start_2 || 31),
              withdrawal_end_2: Number(d.withdrawal_end_2 || 60),
              stress: Boolean(d.stress),
            }
          : {
              capital: cap,
              years: yrs,
              target: smartTarget,
              withdrawal: Number(profile.annual_withdrawal || 0),
            }),
      }));
      setIlpEnabled(Boolean(profile.ilp_planned));
      setClientInfo({
        name: profile.client_name || title || '',
        age: profile.age || null,
        goals: profile.primary_goal ? [profile.primary_goal] : [],
        advisor: currentUser?.name || '',
        extra_notes: profile.extra_notes || '',
        risk_level: profile.risk_level || '',
        risk_label_zh: profile.risk_label_zh || '',
        risk_score: profile.risk_score ?? null,
        target_envelope: profile.target_envelope || null,
        basket_title: profile.basket_title || title || '',
        holdings_rationale: profile.holdings_rationale || {},
        ai_analysis_text: profile.ai_analysis_text || '',
        tactical_summary_zh: profile.tactical_summary_zh || '',
      });
    }
    setActiveTab('lab');
  };

  const handleAdvisoryCreatePortfolio = (basket, profile) => {
    const holdings = basket?.holdings || [];
    if (holdings.length === 0) return;
    setActiveAdvisoryClientInfo({
      clientName: profile?.client_name || basket?.title_zh || '客户配置方案',
      goal: profile?.primary_goal || 'balanced',
    });
    let acc = 0;
    const allocArray = holdings.map((h, idx) => {
      if (idx === holdings.length - 1) {
        return {
          isin: h.lab_id,
          weight: Number(Math.max(0, 1 - acc).toFixed(4)),
          manual_price: '',
        };
      }
      const dec = Number((Number(h.weight_pct || 0) / 100).toFixed(4));
      acc += dec;
      return { isin: h.lab_id, weight: dec, manual_price: '' };
    });
    const clientPrefix = profile?.client_name ? `${profile.client_name} · ` : '';
    const isIncome =
      profile?.primary_goal === 'income' ||
      profile?.primary_goal === 'retirement' ||
      (basket?.metrics?.distributing_pct || 0) >= 50;
    const isAiaBasket =
      Boolean(profile?.ilp_planned) ||
      profile?.product_scope === 'aia_tmp2' ||
      holdings.some((h) => String(h.ilas_platform || '').startsWith('AIA'));
    setNewPf({
      name: `${clientPrefix}${basket.key === 'core' ? '核心推荐组合' : '备选配置组合'}`,
      budget: Number(profile?.initial_capital || 500000),
      date: new Date().toISOString().split('T')[0],
      dividend_strategy: isIncome ? 'CASH' : 'REINVEST',
      base_currency: profile?.currency || 'USD',
      wrapper_type: isAiaBasket ? 'AIA_TMP2' : 'BROKER_ETF',
      drift_tolerance_pct: 5,
      max_drawdown_pct: Number(profile?.target_envelope?.max_drawdown_pct || 15),
      is_public: false,
      allocations: allocArray,
    });
    setActiveTab('portfolios');
    setShowModal(true);
  };

  const handleAdvisoryOpenPortfolio = (portfolioId) => {
    setActiveId(portfolioId);
    setActiveAdvisoryClientInfo({
      clientName: '当前客户方案',
      goal: '',
    });
    setActiveTab('portfolios');
  };


  const [newPf, setNewPf] = useState({
    name: '',
    budget: 1000000,
    date: new Date().toISOString().split('T')[0],
    dividend_strategy: 'CASH',
    base_currency: 'USD',
    wrapper_type: 'AIA_TMP2',
    drift_tolerance_pct: 5,
    max_drawdown_pct: 15,
    is_public: false,
    allocations: [{ isin: '', weight: 0.5, manual_price: '' }, { isin: '', weight: 0.5, manual_price: '' }]
  });

  const totalWeight = newPf.allocations.reduce((sum, a) => sum + parseFloat(a.weight || 0), 0);
  
  // Asset allocation widgets（纯计算见 utils/portfolioStats.js）
  const sectorData = React.useMemo(() => buildSectorData(data), [data]);
  const top10Data = React.useMemo(() => buildTop10Data(data), [data]);

  const fetchPortfolios = () => {
    apiFetch('/api/portfolios')
      .then(res => res.json())
      .then(list => {
        setPortfolios(list);
        setActiveId(currentId => {
          if (!currentId && list.length > 0) return list[0].id;
          // If the current active ID is no longer in the list, fallback to first
          if (currentId && !list.find(p => p.id === currentId)) {
            return list.length > 0 ? list[0].id : null;
          }
          if (list.length === 0) return null;
          return currentId;
        });
      })
      .catch(err => console.error("Fetch portfolios error:", err));
  };

  useEffect(() => {
    fetchPortfolios();
  }, []);

  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    setAuthModalOpen(false);
    // Token is now in localStorage — re-fetch portfolios so admin/advisor sees all
    setTimeout(() => fetchPortfolios(), 100);
  };

  const handleLogout = () => {
    authStorage.clear();
    setCurrentUser(null);
    // Re-fetch without token to show only public portfolios
    setTimeout(() => fetchPortfolios(), 100);
  };

  // 切换组合时的状态重置：渲染期按 activeId 比较（React 官方推荐的「按 key 重置状态」写法），
  // 不在 effect 里同步 setState；effect 只负责异步取数。
  const [loadedPortfolioId, setLoadedPortfolioId] = useState(null);
  if (activeId !== loadedPortfolioId) {
    setLoadedPortfolioId(activeId);
    if (activeId) {
      setLoading(true);
      setHistoryData([]); // Clear old history
    } else {
      setData(null);
      setHistoryData([]);
      setDivProjData(null);
    }
  }

  useEffect(() => {
    if (activeId) {
      // 1. Fetch Core Data
      apiFetch(`/api/report/${activeId}`)
        .then(res => res.json())
        .then(resData => {
          if (resData.detail) throw new Error(resData.detail);
          setData(resData);
        })
        .catch(err => {
          console.error("Fetch report error:", err);
          setData(null);
        })
        .finally(() => setLoading(false));

      // 2. Fetch Historical Time-Series (Async background)
      apiFetch(`/api/report/history/${activeId}`)
        .then(async res => {
          const text = await res.text();
          // Python's json.dumps emits actual `NaN` which breaks strict JSON.parse. Handle it cleanly.
          const cleanText = text.replace(/:\s*NaN/g, ': null'); 
          return JSON.parse(cleanText);
        })
        .then(hData => {
            if (Array.isArray(hData)) {
                // Filter out any null or NaN values that could crash Recharts SVG renderers
                const cleanData = hData.filter(d => d && d.date && d.value !== null && !isNaN(d.value));
                setHistoryData(cleanData);
            }
        })
        .catch(err => console.error("History fetch error:", err));

    }
  }, [activeId]);

  // ── Heartbeat: Smart 10s poll — only full reload if NAV changed ─────────────
  const lastNavRef = useRef(null);
  useEffect(() => {
    if (!activeId) return;
    
    const pollHeartbeat = async () => {
      try {
        const res = await apiFetch(`/api/heartbeat/${activeId}`);
        if (!res.ok) return;
        const hb = await res.json();
        
        if (!hb.cache_hit || hb.total_nav === 0) return; // No cached data yet
        
        const prevNav = lastNavRef.current;
        const currNav = hb.total_nav;

        // Compute staleness (>5 min since last_updated)
        const isStale = hb.last_updated
          ? (Date.now() - new Date(hb.last_updated).getTime()) > 5 * 60 * 1000
          : false;

        // Trigger full reload if NAV moved more than 0.1% or data is stale
        const navChanged = prevNav !== null && Math.abs(currNav - prevNav) / Math.max(prevNav, 1) > 0.001;

        if (navChanged || isStale) {
          lastNavRef.current = currNav;
          // Re-trigger main report fetch silently (no loading spinner)
          apiFetch(`/api/report/${activeId}`)
            .then(r => r.json())
            .then(d => { if (!d.detail) setData(d); })
            .catch(() => {});
        } else if (prevNav === null) {
          lastNavRef.current = currNav;
        }
      } catch { /* 心跳失败静默，下个周期重试 */ }
    };

    const interval = setInterval(pollHeartbeat, 10_000);
    return () => clearInterval(interval);
  }, [activeId]);

  // 进入「收入与预测」或其参数变化时先置 loading（渲染期比较 key，不在 effect 里同步 setState）
  const divKey = activeId && activeSubTab === 'dividends' ? `${activeId}|${taxRate}|${dripMode}` : null;
  const [loadedDivKey, setLoadedDivKey] = useState(null);
  if (divKey !== loadedDivKey) {
    setLoadedDivKey(divKey);
    if (divKey) setDivLoading(true);
  }

  useEffect(() => {
    if (activeId && activeSubTab === 'dividends') {
       apiFetch(`/api/portfolios/dividends/projections/${activeId}?tax_rate=${taxRate}&drip=${dripMode}`)
         .then(res => {
           if (!res.ok) throw new Error(`Server returned ${res.status}`);
           return res.json();
         })
         .then(d => {
           if (d && d.portfolio_metrics) {
             setDivProjData(d);
           } else {
             setDivProjData(null);
           }
           setDivLoading(false);
         })
         .catch(err => {
           console.error("Div projection fetch error:", err);
           setDivProjData(null);
           setDivLoading(false);
         });
    }
  }, [activeId, activeSubTab, taxRate, dripMode]);

  const [creatingPf, setCreatingPf] = useState(false);
  const [createPfError, setCreatePfError] = useState('');

  const handleCreatePortfolio = async (e) => {
    e.preventDefault();
    setCreatePfError('');
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      setCreatePfError("权重总和必须等于 100% (1.0)");
      return;
    }

    const allocationsObj = {};
    const manualPrices = {};
    for (const a of newPf.allocations) {
      const isin = String(a.isin || '').trim();
      const w = parseFloat(a.weight);
      if (!isin) {
        setCreatePfError("请填写每行资产的 ISIN / 代码，或删除空行");
        return;
      }
      if (!Number.isFinite(w) || w <= 0) {
        setCreatePfError(`资产 ${isin} 的权重必须大于 0`);
        return;
      }
      allocationsObj[isin] = w;
      if (a.manual_price) manualPrices[isin] = parseFloat(a.manual_price);
    }

    setCreatingPf(true);
    try {
      const budgetVal = parseFloat(newPf.budget);
      const res = await apiFetch('/api/portfolios/new', {
        method: 'POST',
        body: {
          name: newPf.name,
          budget: Number.isFinite(budgetVal) ? budgetVal : 0,
          date: newPf.date,
          dividend_strategy: newPf.dividend_strategy,
          base_currency: newPf.base_currency || 'USD',
          is_public: newPf.is_public || false,
          client_id: newPf.client_id || null,
          allocations: allocationsObj,
          manual_prices: manualPrices,
          monitoring_config: {
            wrapper_type: newPf.wrapper_type || 'AIA_TMP2',
            drift_tolerance: Number(newPf.drift_tolerance_pct || 5) / 100,
            max_drawdown_limit: Number(newPf.max_drawdown_pct || 15) / 100,
          },
        }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = res.status === 401
          ? '请先登录后再创建组合'
          : (errJson.detail || errJson.message || `创建失败 (HTTP ${res.status})`);
        setCreatePfError(msg);
        return;
      }

      const result = await res.json();
      setShowModal(false);
      setCreatePfError('');
      fetchPortfolios();
      setActiveId(result.portfolio_id);
    } catch (err) {
      setCreatePfError(err?.name === 'AbortError' ? '请求超时，请稍后重试' : (err?.message || '网络错误，创建失败'));
    } finally {
      setCreatingPf(false);
    }
  };


  const handleDelete = async () => {
    if (!deleteCandidate) return;
    await apiFetch(`/api/portfolios/${deleteCandidate}`, { 
      method: 'DELETE',
    });
    setShowDeleteModal(false);
    // Don't set activeId to null here. fetchPortfolios will automatically detect 
    // that the currentId is missing from the new list and fallback to the first available.
    setDeleteCandidate(null);
    fetchPortfolios(); // This will auto-select the first available if activeId is now null or invalid
  };

  const handleRename = async (e) => {
    e.preventDefault();
    if (!renameDraft.trim()) return;
    await apiFetch(`/api/portfolios/${activeId}`, {
      method: 'PUT',
      body: { name: renameDraft.trim() }
    });
    setShowRenameModal(false);
    fetchPortfolios();
  };

  const activePortfolioName = () => portfolios.find(p => p.id === activeId)?.name || 'portfolio';

  const handleExportCSV = () => {
    if (!data) return;
    downloadCsv(buildHoldingsCsv(data), `${activePortfolioName()}_holdings.csv`);
  };

  const handleExportDividendsCSV = async () => {
    if (!activeId) return;
    try {
      const res = await apiFetch(`/api/portfolios/dividends/export/${activeId}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      const divs = await res.json();
      downloadCsv(buildDividendsCsv(divs), `${activePortfolioName()}_dividends.csv`);
    } catch (err) {
      console.error(err);
      alert("Failed to export dividends data.");
    }
  };

  const handleDeployLabStrategy = (allocations) => {
    // Convert allocations dict to array for the form
    const allocArray = Object.entries(allocations).map(([isin, weight]) => ({
      isin,
      weight: parseFloat(weight).toFixed(3),
      manual_price: ''
    }));
    setNewPf({
      ...newPf,
      name: 'Optimized Strategy',
      is_public: false,
      allocations: allocArray
    });
    setActiveTab('portfolios');
    setShowModal(true);
  };

  const canEditPortfolio = (pf) => {
    if (!pf) return false;
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (pf.user_id === currentUser.id) return true;
    if (currentUser.role === 'advisor' && !pf.is_public && pf.user_id !== currentUser.id) {
      return true;
    }
    return false;
  };
  const activePf = portfolios.find(p => p.id === activeId);
  const canEditActive = canEditPortfolio(activePf);

  // ── 移民展示模式：?mode=immigration 直接渲染，无需登录 ──────────────
  if (mode === 'immigration') {
    return <ImmigrationShowcase lang={urlLang} onBack={() => window.history.back()} />;
  }

  // ── 合规确认 Gate ──────────────────────────────────────────────────────────
  if (!complianceAcked) {
    return <ComplianceGateModal onAcknowledge={handleComplianceAcknowledge} />;
  }

  return (
    <div className="app-layout">
      {/* ── Top Header Bar ── */}
      <header className="app-topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="mobile-menu-trigger"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="topbar-brand-mobile">
            Portfolio<span>Atelier</span>
          </div>
          <div className="topbar-welcome">
            {currentUser
              ? `${t('header.welcome')}${currentUser.name || currentUser.email?.split('@')[0] || t('role.' + currentUser.role)}`
              : t('header.platform')}
          </div>
        </div>

        <div className="topbar-right">
          {/* ── 语言切换按钮 ── */}
          <button
            type="button"
            onClick={toggleLang}
            title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
            className="action-btn-secondary"
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
            }}
          >
            {t('header.langBtn')}
          </button>

          {/* ── 明暗画廊切换按钮 ── */}
          <button
            type="button"
            onClick={cycleTheme}
            title={`当前风格: ${theme.label} (点击切换日间画廊/暗夜黑金)`}
            aria-label={isDark ? 'Switch to Gallery Light mode' : 'Switch to Atelier Dark mode'}
            className="action-btn-secondary"
            style={{
              padding: '4px 10px',
              fontSize: 12,
              gap: '6px',
            }}
          >
            {isDark ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            <span>{isDark ? (lang === 'zh' ? '日间' : 'Light') : (lang === 'zh' ? '暗夜' : 'Dark')}</span>
          </button>

          {currentUser ? (
            <>
              {/* 角色徽章 */}
              <span style={{
                padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: ROLE_META[currentUser.role]?.color || 'var(--text-muted)',
                color: '#fff', letterSpacing: '0.03em',
              }}>
                {t('role.' + currentUser.role) || currentUser.role}
              </span>
              {/* 用户名 */}
              <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                {currentUser.name || currentUser.email?.split('@')[0]}
              </span>
              {/* 登出按钮 */}
              <button
                type="button"
                onClick={handleLogout}
                className="action-btn-secondary"
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                {t('header.logout')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="create-btn"
              style={{
                padding: '6px 16px',
                fontSize: 13,
              }}
            >
              {t('header.login')}
            </button>
          )}
        </div>
      </header>

      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab} setActiveTab={setActiveTab}
        portfolios={portfolios} setPortfolios={setPortfolios} activeId={activeId} setActiveId={setActiveId}
        setShowModal={setShowModal}
        setDeleteCandidate={setDeleteCandidate} setShowDeleteModal={setShowDeleteModal}
        savedScenarios={savedScenarios} handleLoadScenario={handleLoadScenario} handleDeleteScenario={handleDeleteScenario} handleRenameScenario={handleRenameScenario}
        currentUser={currentUser} canEditPortfolio={canEditPortfolio}
        mobileDrawerOpen={mobileDrawerOpen}
        setMobileDrawerOpen={setMobileDrawerOpen}
        onIlpSaved={(cfg) => {
          setIlpConfig({
            age: cfg.age ?? 35,
            gender: cfg.gender ?? 'male',
            smoker: cfg.smoker ?? false,
            totalPremium: parseFloat(cfg.premium) || 0,
            currency: cfg.currency ?? 'USD',
            enrollmentRate: cfg.enrollment_rate ?? null,
          });
          if (parseFloat(cfg.premium) > 0) setIlpEnabled(true);
        }}
      />

      {/* Main Content */}
      <main className="dashboard-container">
        {activeTab !== 'advisory' && activeAdvisoryClientInfo && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              marginBottom: '16px',
              background: 'rgba(var(--accent-color-rgb), 0.08)',
              border: '1px solid var(--accent-color)',
              borderRadius: '6px',
              fontSize: '0.84rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Compass size={16} style={{ color: 'var(--accent-color)' }} />
              <span>
                正在浏览衍生页面 · 随时返回正在配置的客户方案：
                <strong style={{ marginLeft: '4px', color: 'var(--accent-color)' }}>
                  {activeAdvisoryClientInfo.clientName}
                </strong>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('advisory')}
                className="action-btn-secondary"
                style={{ fontSize: '0.78rem', padding: '4px 12px', borderColor: 'var(--accent-color)', color: 'var(--accent-color)', fontWeight: 700 }}
              >
                ← 返回客户配置方案
              </button>
              <button
                type="button"
                onClick={() => setActiveAdvisoryClientInfo(null)}
                className="action-icon"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
                title="关闭提示"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'help' ? (
          <HelpManualView />
        ) : activeTab === 'admin' ? (
          <AdminPanel currentUser={currentUser} />
        ) : activeTab === 'advisor' ? (
          <AdvisorClientsPanel 
            currentUser={currentUser} 
            onAssignPortfolio={(clientId) => {
              setNewPf({ name: '', budget: 100000, allocations: [{isin: '', weight: ''}], date: '', base_currency: 'USD', dividend_strategy: 'CASH', is_public: false, client_id: clientId });
              setShowModal(true);
            }}
          />
        ) : activeTab === 'monitor' ? (
          <MonitorOverviewView
            currentUser={currentUser}
            onOpenPortfolioMonitor={(pid) => {
              setActiveId(pid);
              setActiveSubTab('monitor');
              setActiveTab('portfolios');
            }}
          />
        ) : activeTab === 'advisory' ? (
          <FeatureLock minRole="premium" currentUser={currentUser} featureName="客户配置向导" onLoginClick={() => setAuthModalOpen(true)}>
            <AdvisoryView
              onSendToLab={handleAdvisorySendToLab}
              onCreatePortfolio={handleAdvisoryCreatePortfolio}
              onOpenPortfolio={handleAdvisoryOpenPortfolio}
              onActiveClientChange={(info) => setActiveAdvisoryClientInfo(info)}
            />
          </FeatureLock>
        ) : activeTab === 'funds' ? (
          <FeatureLock minRole="premium" currentUser={currentUser} featureName="基金量化库" onLoginClick={() => setAuthModalOpen(true)}>
            <FundQuantView
              funds={quantFunds}
              facets={quantFacets}
              health={quantHealth}
              loading={quantLoading}
              error={quantError}
              detailSlug={quantDetailSlug}
              setDetailSlug={setQuantDetailSlug}
              compareSlugs={quantCompareSlugs}
              setCompareSlugs={setQuantCompareSlugs}
              toggleCompareSlug={toggleQuantCompareSlug}
              compareOpen={quantCompareOpen}
              setCompareOpen={setQuantCompareOpen}
              refreshFunds={refreshQuantFunds}
              onAddFundsToLab={handleSendFundsToLab}
            />
          </FeatureLock>
        ) : activeTab === 'lab' ? (
          <FeatureLock minRole="premium" currentUser={currentUser} featureName="策略实验室" onLoginClick={() => setAuthModalOpen(true)}>
            <StrategyLabView
              labIsins={labIsins} labInput={labInput} setLabInput={setLabInput}
              labData={labData} labLoading={labLoading} labError={labError}
              labDaysBack={labDaysBack} setLabDaysBack={setLabDaysBack}
              labBaseCurrency={labBaseCurrency} setLabBaseCurrency={setLabBaseCurrency}
              stressTestData={stressTestData}
              quantFunds={quantFunds}
              labMaxWeight={labMaxWeight} setLabMaxWeight={setLabMaxWeight}
              labMode={labMode} setLabMode={setLabMode}
              labCustomWeights={labCustomWeights} setLabCustomWeights={setLabCustomWeights}
              labTab={labTab} setLabTab={setLabTab}
              labChartFontSize={labChartFontSize} setLabChartFontSize={setLabChartFontSize}
              labMcSettings={labMcSettings} setLabMcSettings={setLabMcSettings}
              insuranceEnabled={insuranceEnabled} setInsuranceEnabled={setInsuranceEnabled}
              insurancePlan={insurancePlan} setInsurancePlan={setInsurancePlan}
              insuranceAlphaLow={insuranceAlphaLow} setInsuranceAlphaLow={setInsuranceAlphaLow}
              insuranceAlphaHigh={insuranceAlphaHigh} setInsuranceAlphaHigh={setInsuranceAlphaHigh}
              saveDialogOpen={saveDialogOpen} setSaveDialogOpen={setSaveDialogOpen}
              scenarioName={scenarioName} setScenarioName={setScenarioName}
              scenarioSaving={scenarioSaving}
              savedScenarios={savedScenarios}
              handleNewBlankStrategy={handleNewBlankStrategy}
              handleLoadScenario={handleLoadScenario}
              handleDeleteScenario={handleDeleteScenario}
              reportModalOpen={reportModalOpen} setReportModalOpen={setReportModalOpen}
              showMcDoc={showMcDoc} setShowMcDoc={setShowMcDoc}
              handleAddLabIsin={handleAddLabIsin}
              handleAddMultipleLabIsins={handleAddMultipleLabIsins}
              handleRemoveLabIsin={handleRemoveLabIsin}
              handleRunLabAnalysis={handleRunLabAnalysis} handleDeployLabStrategy={handleDeployLabStrategy}
              handleSaveScenario={handleSaveScenario} applyLabTemplate={applyLabTemplate}
              reportLoading={reportLoading} handleGenerateReport={handleGenerateReport}
              handleGenerateWordReport={handleGenerateWordReport}
              labSum={labSum} isLabReady={isLabReady}
              ilpEnabled={ilpEnabled} setIlpEnabled={setIlpEnabled}
              ilpConfig={ilpConfig} setIlpConfig={setIlpConfig}
              onOpenIlpEnrollmentModal={() => setIlpEnrollmentModalOpen(true)}
            />
          </FeatureLock>
        ) : activeTab === 'portfolios' && activeId ? (
          loading ? (
            <div style={{ textAlign: 'center', paddingTop: '100px', color: 'var(--text-secondary)' }}><h2>Analyzing Data...</h2></div>
          ) : data && data.details ? (
            <PortfolioView
              portfolios={portfolios} activeId={activeId} data={data} historyData={historyData} loading={loading}
              quantFunds={quantFunds}
              activeSubTab={activeSubTab} setActiveSubTab={setActiveSubTab}
              divProjData={divProjData} divLoading={divLoading} taxRate={taxRate} setTaxRate={setTaxRate}
              dripMode={dripMode} setDripMode={setDripMode}
              sectorData={sectorData} top10Data={top10Data} getDaysUntil={getDaysUntil}
              setShowDivModal={setShowDivModal} setShowRenameModal={setShowRenameModal} setRenameDraft={setRenameDraft}
              handleExportCSV={handleExportCSV} handleExportDividendsCSV={handleExportDividendsCSV}
              handleOpenCompModal={handleOpenCompModal} handleOpenManageDivModal={handleOpenManageDivModal}
              handleRebalancePreview={handleRebalancePreview} handleUndoRebalance={handleUndoRebalance}
              canEdit={canEditActive}
              ilpEnabled={ilpEnabled} ilpConfig={ilpConfig}
              setIlpConfig={setIlpConfig} setIlpEnabled={setIlpEnabled}
              onOpenIlpEnrollmentModal={() => setIlpEnrollmentModalOpen(true)}
              onPortfolioMutated={async () => {
                if (activeId) {
                  await reloadReportAndHistory(activeId, { setData, setHistoryData });
                }
              }}
            />
          ) : (
            <div style={{ textAlign: 'center', paddingTop: '100px', color: 'var(--text-secondary)' }}><h2>Data Unavailable</h2><p>Please select a different portfolio.</p></div>
          )
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', flexDirection: 'column', gap: '16px', color: 'var(--text-muted)' }}>
            <Briefcase size={40} strokeWidth={1.25} aria-hidden="true" />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>{t('empty.selectPortfolio')}</div>
          </div>
        )}
      </main>

      {/* ── Mobile Bottom Navigation Bar ── */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'portfolios' && !mobileDrawerOpen ? 'active' : ''}`}
          onClick={() => { setActiveTab('portfolios'); setMobileDrawerOpen(false); }}
        >
          <Briefcase size={18} aria-hidden="true" />
          <span>{t('sidebar.portfolios')}</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-item ${mobileDrawerOpen ? 'active' : ''}`}
          onClick={() => setMobileDrawerOpen(v => !v)}
        >
          <FolderOpen size={18} aria-hidden="true" />
          <span>{lang === 'zh' ? '目录/方案' : 'Catalog'}</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'funds' && !mobileDrawerOpen ? 'active' : ''}`}
          onClick={() => { setActiveTab('funds'); setMobileDrawerOpen(false); }}
        >
          <Database size={18} aria-hidden="true" />
          <span>{t('sidebar.funds')}</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'lab' && !mobileDrawerOpen ? 'active' : ''}`}
          onClick={() => { setActiveTab('lab'); setMobileDrawerOpen(false); }}
        >
          <Activity size={18} aria-hidden="true" />
          <span>{t('sidebar.lab')}</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'advisory' && !mobileDrawerOpen ? 'active' : ''}`}
          onClick={() => { setActiveTab('advisory'); setMobileDrawerOpen(false); }}
        >
          <Compass size={18} aria-hidden="true" />
          <span>{t('sidebar.advisory')}</span>
        </button>
        {currentUser && (
          <button
            type="button"
            className={`mobile-nav-item ${activeTab === 'help' && !mobileDrawerOpen ? 'active' : ''}`}
            onClick={() => { setActiveTab('help'); setMobileDrawerOpen(false); }}
          >
            <BookOpen size={18} aria-hidden="true" />
            <span>{lang === 'zh' ? '手册' : 'Guide'}</span>
          </button>
        )}
      </nav>

      {/* ── Modals ── */}
      <CreatePortfolioModal
        showModal={showModal} setShowModal={setShowModal}
        newPf={newPf} setNewPf={setNewPf} totalWeight={totalWeight}
        handleCreatePortfolio={handleCreatePortfolio}
        creatingPf={creatingPf}
        createPfError={createPfError}
        setCreatePfError={setCreatePfError}
        quantFunds={quantFunds}
      />
      <DividendModal
        showDivModal={showDivModal} setShowDivModal={setShowDivModal}
        mDiv={mDiv} setMDiv={setMDiv} handleManualDiv={handleManualDiv}
        data={data}
      />
      <DeleteModal
        showDeleteModal={showDeleteModal} setShowDeleteModal={setShowDeleteModal}
        handleDelete={handleDelete} setDeleteCandidate={setDeleteCandidate}
      />
      <RenameModal
        showRenameModal={showRenameModal} setShowRenameModal={setShowRenameModal}
        renameDraft={renameDraft} setRenameDraft={setRenameDraft}
        handleRename={handleRename}
      />
      <RebalanceModal
        showRebalanceModal={showRebalanceModal} setShowRebalanceModal={setShowRebalanceModal}
        rebalancePreview={rebalancePreview} setRebalancePreview={setRebalancePreview}
        rebalanceDate={rebalanceDate} setRebalanceDate={setRebalanceDate}
        rebalanceDraftTargets={rebalanceDraftTargets} setRebalanceDraftTargets={setRebalanceDraftTargets}
        handleRebalanceSaveAndCalc={handleRebalanceSaveAndCalc}
        handleRebalanceExecute={handleRebalanceExecute}
        portfolioId={activeId}
        authHeaders={authHeaders}
      />
      <ManageDivModal
        showManageDivModal={showManageDivModal} setShowManageDivModal={setShowManageDivModal}
        dividendHistory={dividendHistory} handleDeleteManualDividend={handleDeleteManualDividend}
      />
      <CompositionModal
        showCompModal={showCompModal} setShowCompModal={setShowCompModal}
        compTxs={compTxs} compTargets={compTargets} compEditing={compEditing}
        compNewAsset={compNewAsset} setCompNewAsset={setCompNewAsset}
        handleCompEdit={handleCompEdit} handleCompSave={handleCompSave}
        handleCompDelete={handleCompDelete} handleCompAddAsset={handleCompAddAsset}
        portfolios={portfolios} activeId={activeId}
      />
      <McDocModal showMcDoc={showMcDoc} setShowMcDoc={setShowMcDoc} />
      {clientInfoModalOpen && (
        <ClientInfoModal
          initialInfo={clientInfo}
          onConfirm={handleClientInfoConfirm}
          onSkip={handleClientInfoSkip}
          onClose={() => setClientInfoModalOpen(false)}
        />
      )}
      {reportModalOpen && labData?.monte_carlo && (
        <WealthReport
          labData={labData} labIsins={labIsins} labMcSettings={labMcSettings}
          labBaseCurrency={labBaseCurrency}
          stressTestData={stressTestData}
          ilpEnabled={ilpEnabled} ilpConfig={ilpConfig}
          insuranceEnabled={insuranceEnabled} insurancePlan={insurancePlan}
          clientInfo={clientInfo}
          onOpenClientInfo={() => setClientInfoModalOpen(true)}
          onClose={() => setReportModalOpen(false)}
          onGenerateWord={handleGenerateWordReport}
          reportLoading={reportLoading}
          onSwitchBrief={() => { setReportModalOpen(false); setBriefReportOpen(true); }}
        />
      )}
      {briefReportOpen && labData?.monte_carlo && (
        <ClientBriefReport
          labData={labData}
          labMcSettings={labMcSettings}
          labBaseCurrency={labBaseCurrency}
          stressTestData={stressTestData}
          insuranceEnabled={insuranceEnabled}
          insurancePlan={insurancePlan}
          clientInfo={clientInfo}
          onOpenClientInfo={() => setClientInfoModalOpen(true)}
          onGenerateWord={handleGenerateWordReport}
          reportLoading={reportLoading}
          onClose={() => setBriefReportOpen(false)}
          onSwitchProfessional={() => { setBriefReportOpen(false); setReportModalOpen(true); }}
        />
      )}
      <ILPEnrollmentBonusModal
        open={ilpEnrollmentModalOpen}
        onClose={() => setIlpEnrollmentModalOpen(false)}
        totalPremium={ilpConfig.totalPremium}
        currentRate={ilpConfig.enrollmentRate}
        onConfirm={(rate) => {
          setIlpConfig(prev => ({ ...prev, enrollmentRate: rate }));
          setIlpEnrollmentModalOpen(false);
        }}
      />

      {/* ── Undo Trades Confirm Dialog ── */}
      {undoConfirmOpen && (
        <div className="modal-overlay" onClick={() => setUndoConfirmOpen(false)}>
          <div className="glass-card modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '12px', textAlign: 'center', fontSize: '1.25rem' }}>
              {t('undo.title')}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px', textAlign: 'center' }}>
              {t('undo.body')}
              <br/><br/>
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('undo.warning')}</span>
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setUndoConfirmOpen(false)}
                className="action-btn-secondary"
              >
                {t('undo.cancel')}
              </button>
              <button
                type="button"
                onClick={handleUndoConfirmed}
                className="create-btn"
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
              >
                {t('undo.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Auth Modal ── */}
      {authModalOpen && (
        <AuthModal
          onSuccess={handleAuthSuccess}
          onClose={() => setAuthModalOpen(false)}
        />
      )}

      {/* ── Verification / Reset Overlays ── */}
      {authAction === 'verify' && (
        <VerifyEmailOverlay token={token} onClose={closeAuthAction} />
      )}
      {authAction === 'reset' && (
        <ResetPasswordOverlay token={token} onClose={closeAuthAction} />
      )}

      {/* ── 极简合规页脚 ── */}
      <footer style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'transparent',
        padding: '18px 32px',
        marginTop: 'auto',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
            {t('footer.copy')}
          </p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('ww_compliance_acked');
              setComplianceAcked(false);
            }}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-muted)',
              fontSize: '11px', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
              minBlockSize: 'auto',
              transition: 'color 0.2s',
            }}
          >
            {t('footer.disclaimer')}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;
