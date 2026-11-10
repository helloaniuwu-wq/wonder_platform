import React, { useState, useEffect, useRef } from 'react';
import { useLang } from './i18n/LangContext';
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
import AuthModal from './components/AuthModal';
import AdminPanel from './components/AdminPanel';
import AdvisorClientsPanel from './components/AdvisorClientsPanel';
import HelpManualView from './components/HelpManualView';
import FeatureLock from './components/FeatureLock';
import ImmigrationShowcase from './components/ImmigrationShowcase';
import { useTheme } from './theme/ThemeContext';


// ── 角色颜色映射（颜色固定，标签由 i18n 提供）──
const ROLE_META = {
  admin:   { color: '#ef4444' },
  advisor: { color: '#3b82f6' },
  premium: { color: '#f59e0b' },
  free:    { color: '#6b7280' },
};

// ── 合规确认弹窗（首次进入时展示）──────────────────────────────────────────
function ComplianceGateModal({ onAcknowledge }) {
  const { t } = useLang();
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      <div style={{
        background: 'linear-gradient(145deg, #0f1629 0%, #111827 100%)',
        border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: '20px',
        padding: '36px 32px',
        maxWidth: '540px',
        width: '100%',
        boxShadow: '0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
      }}>
        {/* 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '12px',
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', flexShrink: 0,
          }}>⚠️</div>
          <div>
            <h2 style={{ color: '#f1f5f9', fontSize: '17px', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
              {t('compliance.title')}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', margin: '3px 0 0' }}>
              {t('compliance.subtitle')} · Please read before proceeding
            </p>
          </div>
        </div>

        {/* 核心声明 */}
        <div style={{
          background: 'rgba(251,191,36,0.06)',
          border: '1px solid rgba(251,191,36,0.18)',
          borderRadius: '12px',
          padding: '16px 18px',
          marginBottom: '16px',
        }}>
          <p style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.75, margin: 0 }}>
            <strong style={{ color: '#fbbf24' }}>Wonder Wisdom. · </strong>
            {t('compliance.body')}
            <strong style={{ color: 'rgba(255,255,255,0.85)' }}>{t('compliance.bodyBold1')}</strong>
            {t('compliance.bodyMid')}
            <strong style={{ color: 'rgba(255,255,255,0.85)' }}>{t('compliance.bodyBold2')}</strong>
          </p>
        </div>

        <div style={{
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.18)',
          borderRadius: '12px',
          padding: '12px 18px',
          marginBottom: '24px',
        }}>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, margin: 0 }}>
            {t('compliance.bodyEn')}
          </p>
        </div>

        {/* 确认按钮 */}
        <button
          id="compliance-acknowledge-btn"
          onClick={onAcknowledge}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            border: 'none',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
            transition: 'all 0.2s',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          {t('compliance.btn')}
        </button>
        <p style={{ textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginTop: '12px', marginBottom: 0 }}>
          {t('compliance.footer')} · Continuing constitutes acceptance of the above terms
        </p>
      </div>
    </div>
  );
}

import { VerifyEmailOverlay, ResetPasswordOverlay } from './components/AuthOverlays';

function App() {
  const { lang, toggleLang, t } = useLang();
  const { theme, cycleTheme } = useTheme();
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
  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDivModal, setShowDivModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [showRebalanceModal, setShowRebalanceModal] = useState(false);
  const [rebalancePreview, setRebalancePreview] = useState(null);
  const [rebalanceDate, setRebalanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [rebalanceDraftTargets, setRebalanceDraftTargets] = useState({}); // editable in modal Step 1

  const [activeSubTab, setActiveSubTab] = useState('performance'); // 'performance' or 'dividends'
  const [divProjData, setDivProjData] = useState(null);
  const [divLoading, setDivLoading] = useState(false);
  const [taxRate, setTaxRate] = useState(0.0);
  const [dripMode, setDripMode] = useState(false);

  // Manage Dividends State
  const [showManageDivModal, setShowManageDivModal] = useState(false);
  const [dividendHistory, setDividendHistory] = useState([]);

  // Portfolio Composition Management State
  const [showCompModal, setShowCompModal] = useState(false);
  const [compTxs, setCompTxs] = useState([]);
  const [compTargets, setCompTargets] = useState({});
  const [compEditing, setCompEditing] = useState({});
  const [compNewAsset, setCompNewAsset] = useState({ isin: '', type: 'BUY', shares: 0, price: 0, date: new Date().toISOString().split('T')[0] });

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
    inflation: 2.5
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
    if (!ilpEnabled) return;
    const capital = parseFloat(labMcSettings.capital) || 0;
    setIlpConfig(prev => {
      if (prev.totalPremium === capital) return prev; // 值不变则不更新，避免触发 Effect 2
      return { ...prev, totalPremium: capital };
    });
    setLabMcSettings(prev =>
      prev.contribution !== 0 ? { ...prev, contribution: 0 } : prev
    );
  }, [ilpEnabled, labMcSettings.capital]); // eslint-disable-line react-hooks/exhaustive-deps



  // ── Undo Confirm Dialog State ────────────────────────────────────────────
  const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);

  // ── Auth State ──────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => authStorage.getUser());
  const [authModalOpen, setAuthModalOpen] = useState(false);

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
  

  const [newPf, setNewPf] = useState({
    name: '',
    budget: 1000000,
    date: new Date().toISOString().split('T')[0],
    dividend_strategy: 'CASH',
    base_currency: 'USD',
    is_public: false,
    allocations: [{ isin: '', weight: 0.5, manual_price: '' }, { isin: '', weight: 0.5, manual_price: '' }]
  });

  // Manual Dividend Form State
  const [mDiv, setMDiv] = useState({ isin: '', date: new Date().toISOString().split('T')[0], amount: 0 });

  const totalWeight = newPf.allocations.reduce((sum, a) => sum + parseFloat(a.weight || 0), 0);
  
  // Real-time lab sum for validation
  const labSum = labMode === 'custom' 
    ? labIsins.reduce((acc, isin) => acc + (parseFloat(labCustomWeights[isin]) || 0), 0)
    : 100;
  const isLabReady = labIsins.length >= 2 && Math.abs(labSum - 100) < 0.1;

  useEffect(() => {
    fetchPortfolios();
  }, []);

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


  // Process data for Ghostfolio Asset Allocation Widgets
  const sectorData = React.useMemo(() => {
    try {
      if (!data || !data.details) return [];
      let map = {};
      data.details.forEach(d => {
        if (d.isin.startsWith('CASH_')) return; // Skip cash for sector breakdown
        let sectorObj = d.sector;
        if (typeof sectorObj === 'string' && sectorObj.startsWith('{')) {
          try { sectorObj = JSON.parse(sectorObj); } catch(e) {}
        }
        
        if (typeof sectorObj === 'object' && !Array.isArray(sectorObj) && sectorObj !== null) {
          Object.entries(sectorObj).forEach(([k, weight]) => {
            const name = String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); // Format "consumer_cyclical" -> "Consumer Cyclical"
            map[name] = (map[name] || 0) + (Number(d.market_value) || 0) * (Number(weight) || 0);
          });
        } else {
          const s = String(sectorObj || 'Unknown');
          map[s] = (map[s] || 0) + (Number(d.market_value) || 0);
        }
      });
      return Object.entries(map)
        .map(([name, value]) => ({ name, value, pct: data.total_nav > 0 ? (value / data.total_nav * 100) : 0 }))
        .filter(d => d.value > 0 && !isNaN(d.value) && isFinite(d.value));
    } catch (e) {
      console.error("Safeguard: Sector processing failed", e);
      return [];
    }
  }, [data]);

  const top10Data = React.useMemo(() => {
    try {
      if (!data || !data.details) return [];
      return data.details
        .filter(d => !d.isin.startsWith('CASH_') && Number(d.market_value) > 0)
        .sort((a, b) => Number(b.market_value) - Number(a.market_value))
        .slice(0, 10)
        .map(d => ({
          name: d.name && d.name.length > 30 ? d.name.substring(0, 28) + '…' : (d.name || d.isin),
          fullName: d.name || d.isin,
          isin: d.isin,
          value: Number(d.market_value),
          pct: data.total_nav > 0 ? (Number(d.market_value) / data.total_nav * 100) : 0
        }));
    } catch (e) {
      console.error("Safeguard: Top10 processing failed", e);
      return [];
    }
  }, [data]);

  const fetchPortfolios = () => {
    fetch('/api/portfolios', { headers: authHeaders() })
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
    if (activeId) {
      setLoading(true);
      setHistoryData([]); // Clear old history
      
      // 1. Fetch Core Data
      fetch(`/api/report/${activeId}`)
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
      fetch(`/api/report/history/${activeId}`)
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

      } else {
      setData(null);
      setHistoryData([]);
      setDivProjData(null);
    }
  }, [activeId]);

  // ── Heartbeat: Smart 10s poll — only full reload if NAV changed ─────────────
  const lastNavRef = useRef(null);
  useEffect(() => {
    if (!activeId) return;
    
    const pollHeartbeat = async () => {
      try {
        const res = await fetch(`/api/heartbeat/${activeId}`);
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
          fetch(`/api/report/${activeId}`)
            .then(r => r.json())
            .then(d => { if (!d.detail) setData(d); })
            .catch(() => {});
        } else if (prevNav === null) {
          lastNavRef.current = currNav;
        }
      } catch (_) {}
    };

    const interval = setInterval(pollHeartbeat, 10_000);
    return () => clearInterval(interval);
  }, [activeId]);

  useEffect(() => {
    if (activeId && activeSubTab === 'dividends') {
       setDivLoading(true);
       fetch(`/api/portfolios/dividends/projections/${activeId}?tax_rate=${taxRate}&drip=${dripMode}`)
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

  const getDaysUntil = (dateStr) => {
    if (!dateStr) return null;
    const diffTime = new Date(dateStr) - new Date();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleCreatePortfolio = async (e) => {
    e.preventDefault();
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      alert("Total weight must be 100% (1.0)");
      return;
    }

    const allocationsObj = {};
    const manualPrices = {};
    newPf.allocations.forEach(a => {
      allocationsObj[a.isin] = parseFloat(a.weight);
      if (a.manual_price) manualPrices[a.isin] = parseFloat(a.manual_price);
    });

    const res = await fetch('/api/portfolios/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        name: newPf.name,
        budget: parseFloat(newPf.budget),
        date: newPf.date,
        dividend_strategy: newPf.dividend_strategy,
        base_currency: newPf.base_currency || 'USD',
        is_public: newPf.is_public || false,
        client_id: newPf.client_id || null,
        allocations: allocationsObj,
        manual_prices: manualPrices
      })
    });

    if (res.ok) {
      const result = await res.json();
      setShowModal(false);
      fetchPortfolios();
      setActiveId(result.portfolio_id);
    }
  };


  const handleDelete = async () => {
    if (!deleteCandidate) return;
    await fetch(`/api/portfolios/${deleteCandidate}`, { 
      method: 'DELETE',
      headers: authHeaders()
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
    await fetch(`/api/portfolios/${activeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: renameDraft.trim() })
    });
    setShowRenameModal(false);
    fetchPortfolios();
  };

  const handleUndoRebalance = () => {
    if (!activeId) return;
    setUndoConfirmOpen(true);
  };

  const handleUndoConfirmed = async () => {
    setUndoConfirmOpen(false);
    try {
      const res = await fetch(`/api/portfolios/rebalance/undo/${activeId}`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (data.status === 'success') {
        // Refresh core report data
        const repRes = await fetch(`/api/report/${activeId}`);
        const repData = await repRes.json();
        if (!repData.detail) setData(repData);
        
        // Also refresh historical chart
        fetch(`/api/report/history/${activeId}`)
          .then(async r => {
            const text = await r.text();
            return JSON.parse(text.replace(/:\s*NaN/g, ': null'));
          })
          .then(hData => {
            if (Array.isArray(hData)) {
              setHistoryData(hData.filter(d => d && d.date && d.value !== null && !isNaN(d.value)));
            }
          })
          .catch(() => {});
      } else {
        alert(`Failed to undo: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error during undo: ${err}`);
    }
  };

  // Step 1: Open modal and load current target_allocations into draft editor
  const handleRebalancePreview = async () => {
    if (!activeId) return;
    try {
      // Load current saved targets to pre-populate the editor
      const txRes = await fetch(`/api/portfolios/transactions/${activeId}`, { headers: authHeaders() });
      const txData = await txRes.json();
      const savedTargets = txData.target_allocations || {};
      setRebalanceDraftTargets(savedTargets);
      setRebalancePreview(null); // reset preview so modal starts on Step 1
      setShowRebalanceModal(true);
    } catch (e) {
      console.error(e);
    }
  };

  // Step 2: Save new targets to DB, then fetch fresh preview
  const handleRebalanceSaveAndCalc = async (draftTargets) => {
    if (!activeId) return;
    // 1. Persist the edited targets
    await fetch(`/api/portfolios/${activeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ target_allocations: draftTargets })
    });
    // 2. Fetch the preview with updated targets
    const params = new URLSearchParams();
    if (rebalanceDate) params.set('as_of_date', rebalanceDate);
    const res = await fetch(`/api/portfolios/rebalance/preview/${activeId}?${params}`);
    const json = await res.json();
    setRebalancePreview(json);
    // Also sync compTargets so composition modal stays consistent
    setCompTargets(draftTargets);
  };


  const handleRebalanceExecute = async () => {
    setLoading(true);
    setShowRebalanceModal(false);
    try {
      const rbRes = await fetch(`/api/portfolios/rebalance/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ as_of_date: rebalanceDate || null })
      });
      if (!rbRes.ok) {
        const err = await rbRes.json().catch(() => ({ detail: 'Unknown server error' }));
        alert(`⚠️ Rebalance 执行失败：${err.detail || rbRes.status}`);
        setLoading(false);
        return;
      }
      // Refresh core report data
      const repRes = await fetch(`/api/report/${activeId}`);
      const repData = await repRes.json();
      if (!repData.detail) setData(repData);

      // Also refresh historical chart so performance curve reflects the new trades
      fetch(`/api/report/history/${activeId}`)
        .then(async r => {
          const text = await r.text();
          const cleanText = text.replace(/:\s*NaN/g, ': null');
          return JSON.parse(cleanText);
        })
        .then(hData => {
          if (Array.isArray(hData)) {
            setHistoryData(hData.filter(d => d && d.date && d.value !== null && !isNaN(d.value)));
          }
        })
        .catch(() => {});
    } catch (e) {
      alert(`⚠️ Rebalance 网络错误：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleManualDiv = async (e) => {
    e.preventDefault();
    await fetch(`/api/portfolios/dividend/manual/${activeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ isin: mDiv.isin, date: mDiv.date, amount_per_share: parseFloat(mDiv.amount) })
    });
    setShowDivModal(false);
    // Refresh report
    const res = await fetch(`/api/report/${activeId}`);
    setData(await res.json());
  };

  const handleOpenManageDivModal = async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`/api/portfolios/dividends/export/${activeId}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      const divs = await res.json();
      setDividendHistory(divs);
      setShowManageDivModal(true);
    } catch (err) {
      console.error(err);
      alert("Failed to load dividends");
    }
  };

  const handleDeleteManualDividend = async (divId) => {
    if (!window.confirm("Are you sure you want to delete this manual dividend?")) return;
    try {
      await fetch(`/api/dividends/manual/${divId}`, { method: 'DELETE', headers: authHeaders() });
      const res = await fetch(`/api/portfolios/dividends/export/${activeId}`, { headers: authHeaders() });
      setDividendHistory(await res.json());
      
      const repRes = await fetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch (err) {
      console.error(err);
      alert("Failed to delete dividend");
    }
  };

  // ── Portfolio Composition Management ──────────────────────────────────────
  const handleOpenCompModal = async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`/api/portfolios/transactions/${activeId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to fetch transactions');
      const result = await res.json();
      setCompTxs(result.transactions || []);
      setCompTargets(result.target_allocations || {});
      setCompEditing({});
      setCompNewAsset({ isin: '', type: 'BUY', shares: 0, price: 0, date: new Date().toISOString().split('T')[0] });
      setShowCompModal(true);
    } catch (err) {
      console.error(err);
      alert('Failed to load portfolio composition');
    }
  };

  const handleCompEdit = (txId, field, value) => {
    setCompEditing(prev => ({
      ...prev,
      [txId]: { ...(prev[txId] || {}), [field]: value }
    }));
  };

  const handleCompSave = async (txId) => {
    const edits = compEditing[txId];
    if (!edits) return;
    try {
      // Save transaction changes (isin, shares, price)
      const txUpdate = {};
      if (edits.isin !== undefined) txUpdate.isin = edits.isin;
      if (edits.shares !== undefined) txUpdate.shares = edits.shares;
      if (edits.price !== undefined) txUpdate.price = edits.price;
      if (edits.date !== undefined) txUpdate.date = edits.date;
      if (Object.keys(txUpdate).length > 0) {
        await fetch(`/api/portfolios/transactions/${txId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(txUpdate)
        });
      }
      // Target weight updating logic has been removed as it's now handled by RebalanceModal
      // Refresh
      handleOpenCompModal();
      const repRes = await fetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch (err) {
      console.error(err);
      alert('Failed to save changes');
    }
  };

  const handleCompDelete = async (txId) => {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    try {
      await fetch(`/api/portfolios/transactions/${txId}`, { method: 'DELETE', headers: authHeaders() });
      handleOpenCompModal();
      const repRes = await fetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch (err) {
      alert('Failed to delete transaction');
    }
  };

  const handleCompAddAsset = async () => {
    if (!compNewAsset.isin || compNewAsset.shares <= 0 || compNewAsset.price <= 0) {
      alert('Please fill in ISIN, shares and price');
      return;
    }
    try {
      await fetch(`/api/portfolios/transactions/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(compNewAsset)
      });
      handleOpenCompModal();
      const repRes = await fetch(`/api/report/${activeId}`);
      setData(await repRes.json());
    } catch (err) {
      alert('Failed to add asset');
    }
  };

  const handleExportCSV = () => {
    if (!data) return;
    const headers = ["ASSET", "ISIN", "ALLOCATION (%)", "SHARES", "AVG COST", "PRICE", "VALUE", "DIVIDENDS", "PNL (%)"];
    const rows = data.details.map(a => [
      a.name,
      a.isin,
      (a.market_value / data.total_nav * 100).toFixed(1) + "%",
      a.isin.startsWith('CASH_') ? '1' : Math.floor(a.shares),
      a.total_cost ? (a.total_cost / (a.isin.startsWith('CASH_') ? 1 : a.shares)).toFixed(2) : '0',
      a.price.toFixed(2),
      a.market_value.toFixed(2),
      a.dividends.toFixed(2),
      a.yield.toFixed(2) + "%"
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${portfolios.find(p => p.id === activeId)?.name || 'portfolio'}_holdings.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportDividendsCSV = async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`/api/portfolios/dividends/export/${activeId}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      const divs = await res.json();
      
      const headers = ["DATE", "ASSET / ISIN", "FUND NAME", "TYPE", "SHARES HELD", "AMOUNT PER SHARE", "TOTAL DIVIDEND ($)"];
      const rows = divs.map(d => [
        d.date,
        d.isin,
        `"${d.name}"`, // Quote to handle commas in names
        d.type,
        d.shares_held,
        d.amount_per_share.toFixed(4),
        d.total_amount.toFixed(2)
      ]);

      const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${portfolios.find(p => p.id === activeId)?.name || 'portfolio'}_dividends.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      alert("Failed to export dividends data.");
    }
  };

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
      const data = await res.json();
      // Restore assets, weights, settings
      setLabIsins(data.assets);
      setLabCustomWeights(data.weights);
      setLabMode('custom');
      setLabMcSettings(data.mc_settings);
      // Restore chart data into labData structure
      setLabData(prev => ({
        ...(prev || {}),
        ...(data.summary || {}),
        mc_target_label: 'custom_portfolio',
        custom_portfolio: {
          allocations: data.weights,
          expected_return: data.summary.expected_return,
          volatility: data.summary.volatility,
          sharpe_ratio: data.summary.sharpe_ratio,
          dividend_yield: data.summary.dividend_yield,
        },
        monte_carlo: {
          chart: data.chart_data,
          irr: { p50: data.summary.irr_p50, p10: data.summary.irr_p10 },
          success_rate: data.summary.success_rate,
        },
        _restored_from: data.name,
      }));
      // ── 恢复 ILP 投连险配置 ──────────────────────────────────────────────
      if (data.ilp_enabled != null) {
        setIlpEnabled(!!data.ilp_enabled);
        if (data.ilp_config) setIlpConfig(data.ilp_config);
      }
      // ── 恢复储蓄险配置 ──────────────────────────────────────────────────
      if (data.insurance_enabled != null) {
        setInsuranceEnabled(!!data.insurance_enabled);
        if (data.insurance_plan)       setInsurancePlan(data.insurance_plan);
        if (data.insurance_alpha_low  != null) setInsuranceAlphaLow(data.insurance_alpha_low);
        if (data.insurance_alpha_high != null) setInsuranceAlphaHigh(data.insurance_alpha_high);
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
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 52, zIndex: 1000,
        background: 'var(--header-bg)',
        borderBottom: '1px solid rgba(99,102,241,0.2)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center',
        padding: '0 20px 0 260px',
        justifyContent: 'space-between',
      }}>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          {currentUser ? `${t('header.welcome')}${currentUser.name || currentUser.email?.split('@')[0] || t('role.' + currentUser.role)}` : t('header.platform')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* ── 语言切换按钮 ── */}
          <button
            onClick={toggleLang}
            title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
            style={{
              padding: '4px 12px', borderRadius: 8,
              background: 'rgba(99,102,241,0.12)',
              border: '1px solid rgba(99,102,241,0.35)',
              color: '#818cf8', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              letterSpacing: '0.05em',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; }}
          >
            {t('header.langBtn')}
          </button>
          
          {/* ── 主题切换按钮 ── */}
          <button
            onClick={cycleTheme}
            title={`当前风格: ${theme.label} (点击切换)`}
            style={{
              padding: '4px 8px', borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--glass-border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--glass-bg)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {theme.label.split(' ')[0]} {/* 仅显示 emoji */}
          </button>

          {currentUser ? (
            <>
              {/* 角色徽章 */}
              <span style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                background: ROLE_META[currentUser.role]?.color || '#6b7280',
                color: '#fff', letterSpacing: '0.02em',
              }}>
                {t('role.' + currentUser.role) || currentUser.role}
              </span>
              {/* 用户名 */}
              <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 500 }}>
                {currentUser.name || currentUser.email?.split('@')[0]}
              </span>
              {/* 登出按钮 */}
              <button
                onClick={handleLogout}
                style={{
                  padding: '4px 14px', borderRadius: 8, background: 'transparent',
                  border: '1px solid rgba(71,85,105,0.6)', color: '#94a3b8',
                  cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(71,85,105,0.6)'; e.currentTarget.style.color = '#94a3b8'; }}
              >{t('header.logout')}</button>
            </>
          ) : (
            <button
              onClick={() => setAuthModalOpen(true)}
              style={{
                padding: '7px 18px', borderRadius: 8,
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                border: 'none', color: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 700,
                boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
                transition: 'all 0.2s',
              }}
            >{t('header.login')}</button>
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
        ) : activeTab === 'lab' ? (
          <FeatureLock minRole="premium" currentUser={currentUser} featureName="策略实验室" onLoginClick={() => setAuthModalOpen(true)}>
            <StrategyLabView
              labIsins={labIsins} labInput={labInput} setLabInput={setLabInput}
              labData={labData} labLoading={labLoading} labError={labError}
              labDaysBack={labDaysBack} setLabDaysBack={setLabDaysBack}
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
              reportModalOpen={reportModalOpen} setReportModalOpen={setReportModalOpen}
              showMcDoc={showMcDoc} setShowMcDoc={setShowMcDoc}
              handleAddLabIsin={handleAddLabIsin} handleRemoveLabIsin={handleRemoveLabIsin}
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
            <div style={{textAlign: 'center', paddingTop: '100px'}}><h2>Analyzing Data...</h2></div>
          ) : data && data.details ? (
            <PortfolioView
              portfolios={portfolios} activeId={activeId} data={data} historyData={historyData} loading={loading}
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
            />
          ) : (
            <div style={{textAlign: 'center', paddingTop: '100px'}}><h2>Data Unavailable</h2><p>Please select a different portfolio.</p></div>
          )
        ) : (
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px', color: 'rgba(255,255,255,0.3)'}}>
            <div style={{fontSize: '3rem'}}>📊</div>
            <div>{t('empty.selectPortfolio')}</div>
          </div>
        )}
      </main>

      {/* ── Modals ── */}
      <CreatePortfolioModal
        showModal={showModal} setShowModal={setShowModal}
        newPf={newPf} setNewPf={setNewPf} totalWeight={totalWeight}
        handleCreatePortfolio={handleCreatePortfolio}
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
          onConfirm={handleClientInfoConfirm}
          onSkip={handleClientInfoSkip}
          onClose={() => setClientInfoModalOpen(false)}
        />
      )}
      {reportModalOpen && labData?.monte_carlo && (
        <WealthReport
          labData={labData} labIsins={labIsins} labMcSettings={labMcSettings}
          insuranceEnabled={insuranceEnabled} insurancePlan={insurancePlan}
          clientInfo={clientInfo}
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
          insuranceEnabled={insuranceEnabled}
          insurancePlan={insurancePlan}
          clientInfo={clientInfo}
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
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setUndoConfirmOpen(false)}>
          <div style={{
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '16px', padding: '32px', maxWidth: '420px', width: '90%',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{fontSize: '2rem', marginBottom: '12px', textAlign: 'center'}}>↩️</div>
            <h3 style={{color: '#fff', marginBottom: '12px', textAlign: 'center', fontSize: '1.1rem'}}>
              {t('undo.title')}
            </h3>
            <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '24px', textAlign: 'center'}}>
              {t('undo.body')}
              <br/><br/>
              <span style={{color: '#ef4444', fontWeight: 600}}>{t('undo.warning')}</span>
            </p>
            <div style={{display: 'flex', gap: '12px', justifyContent: 'center'}}>
              <button
                onClick={() => setUndoConfirmOpen(false)}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                  color: 'rgba(255,255,255,0.7)', borderRadius: '8px', padding: '10px 24px',
                  cursor: 'pointer', fontWeight: 500
                }}
              >{t('undo.cancel')}</button>
              <button
                onClick={handleUndoConfirmed}
                style={{
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  border: 'none', color: '#fff', borderRadius: '8px', padding: '10px 24px',
                  cursor: 'pointer', fontWeight: 600, boxShadow: '0 4px 12px rgba(239,68,68,0.4)'
                }}
              >{t('undo.confirm')}</button>
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
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: 'transparent',
        padding: '14px 24px',
        marginTop: '48px',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', margin: 0 }}>
            {t('footer.copy')}
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('ww_compliance_acked');
              setComplianceAcked(false);
            }}
            style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.2)',
              fontSize: '11px', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}
          >
            {t('footer.disclaimer')}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;
