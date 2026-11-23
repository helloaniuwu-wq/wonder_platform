import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, UserCheck, Briefcase, ShieldCheck, ChevronDown, ChevronUp, 
  Plus, Search, RefreshCw, Clock, Mail, SlidersHorizontal, Sparkles 
} from 'lucide-react';
import { authHeaders } from '../utils/auth';
import ILPSettingsModal from './ILPSettingsModal';

const API = '/api';

const formatDate = (dateStr) => {
  if (!dateStr) return '从未登录';
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 30) return `${diff} 天前`;
  return d.toLocaleDateString('zh-CN');
};

export default function AdvisorClientsPanel({ currentUser, onAssignPortfolio }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [clientPortfolios, setClientPortfolios] = useState({});
  const [portfolioLoading, setPortfolioLoading] = useState({});
  
  // ILP 弹窗状态
  const [ilpModal, setIlpModal] = useState({ 
    open: false, 
    userId: null, 
    userName: '', 
    userEmail: '' 
  });

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/advisor/clients`, {
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setClients(Array.isArray(data) ? data : (data.clients || []));
    } catch (e) {
      setError('无法加载客户列表：' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleExpandClient = async (clientId) => {
    if (expandedId === clientId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(clientId);
    if (clientPortfolios[clientId]) return; // 已加载，不重复请求

    setPortfolioLoading(prev => ({ ...prev, [clientId]: true }));
    try {
      const res = await fetch(`${API}/advisor/clients/${clientId}/portfolios`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setClientPortfolios(prev => ({
        ...prev,
        [clientId]: Array.isArray(data) ? data : (data.portfolios || [])
      }));
    } catch (e) {
      setClientPortfolios(prev => ({ ...prev, [clientId]: [] }));
    } finally {
      setPortfolioLoading(prev => ({ ...prev, [clientId]: false }));
    }
  };

  const filteredClients = clients.filter(c => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    const nameMatch = (c.name || '').toLowerCase().includes(term);
    const emailMatch = (c.email || '').toLowerCase().includes(term);
    const advMatch = (c.advisor_name || '').toLowerCase().includes(term);
    return nameMatch || emailMatch || advMatch;
  });

  const totalPortfoliosCount = clients.reduce((acc, c) => acc + (c.portfolio_count || 0), 0);

  return (
    <div style={{ padding: '0 0 60px', maxWidth: 1100, margin: '0 auto' }}>
      {/* ── 标题与概览 ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 16,
        marginBottom: 24,
        paddingBottom: 20,
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--accent-color-rgb, 30, 77, 59)',
              color: 'var(--surface-elevated, #fff)',
              fontSize: 16
            }}>
              <UserCheck size={18} />
            </span>
            <h2 style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}>
              {currentUser?.role === 'admin' ? '全域顾问与客户管理' : '我的客户管理'}
            </h2>
          </div>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
            {currentUser?.role === 'admin'
              ? '系统管理员视图 · 监控顾问与客户关联、组合配置与投连险参数'
              : '专注为您的客户规划高净值投资组合，支持存量代管与专属保险方案'}
          </p>
        </div>

        {/* 顶部指标胶囊 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            padding: '8px 16px',
            borderRadius: 'var(--card-radius, 6px)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>管理客户</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {clients.length} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>人</span>
              </div>
            </div>
            <div style={{ width: 1, height: 24, background: 'var(--border-subtle)' }} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>关联组合</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>
                {totalPortfoliosCount} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>个</span>
              </div>
            </div>
          </div>

          <button
            onClick={fetchClients}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 16px',
              borderRadius: 'var(--card-radius, 6px)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              transition: 'all 0.2s'
            }}
            title="刷新数据"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* ── 搜索栏 ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 20
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius, 6px)',
          padding: '0 14px',
          height: 42
        }}>
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="搜索客户姓名、电子邮箱或归属顾问…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'var(--font-sans)'
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '2px 6px'
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── 错误提示 ── */}
      {error && (
        <div style={{
          padding: '14px 18px',
          background: 'var(--danger-bg)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--card-radius, 6px)',
          color: 'var(--danger)',
          fontSize: 13,
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── 列表区域 ── */}
      {loading ? (
        <div style={{
          textAlign: 'center',
          padding: '80px 0',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius, 6px)',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>正在加载客户档案…</div>
        </div>
      ) : filteredClients.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '80px 24px',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius, 6px)',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.6 }}>👥</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            {search ? '未找到符合条件的客户' : '暂无关联客户记录'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {search ? '请尝试更换关键词搜索' : '请由系统管理员在「用户管理」中建立顾问与客户的关系'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredClients.map(client => {
            const isExpanded = expandedId === client.id;
            const portfolios = clientPortfolios[client.id] || [];
            const isLoadingPortfolios = portfolioLoading[client.id];

            return (
              <div
                key={client.id}
                style={{
                  background: 'var(--surface-card)',
                  border: isExpanded ? '1px solid var(--accent-color)' : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--card-radius, 6px)',
                  boxShadow: 'var(--card-shadow)',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s, box-shadow 0.2s'
                }}
              >
                {/* 客户卡片头部 */}
                <div style={{
                  padding: '18px 22px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16
                }}>
                  {/* 左侧：头像与基本信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 260 }}>
                    <div style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border-strong)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--accent-color)',
                      flexShrink: 0
                    }}>
                      {(client.name || client.email || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                          {client.name || '未设置姓名'}
                        </span>
                        {client.role && (
                          <span style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            background: client.role === 'premium' ? 'var(--warning-bg)' : 'var(--surface-subtle)',
                            color: client.role === 'premium' ? 'var(--warning)' : 'var(--text-muted)',
                            border: '1px solid var(--border-subtle)'
                          }}>
                            {client.role}
                          </span>
                        )}
                        {currentUser?.role === 'admin' && client.advisor_name && (
                          <span style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: 'var(--info-bg)',
                            color: 'var(--info)',
                            border: '1px solid var(--border-subtle)'
                          }}>
                            顾问: {client.advisor_name}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                        <Mail size={12} />
                        <span>{client.email}</span>
                      </div>
                    </div>
                  </div>

                  {/* 中间：统计数据 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{
                        fontSize: 18,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-color)'
                      }}>
                        {client.portfolio_count ?? 0}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>投资组合</div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{
                        fontSize: 18,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-secondary)'
                      }}>
                        {client.insurance_count ?? 0}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>保险方案</div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: 90 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>最后活跃</div>
                      <div style={{
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)',
                        marginTop: 2
                      }}>
                        {formatDate(client.last_login_at)}
                      </div>
                    </div>
                  </div>

                  {/* 右侧：动作按钮 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* 创建组合按钮 */}
                    {onAssignPortfolio && (
                      <button
                        onClick={() => onAssignPortfolio(client.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '7px 14px',
                          borderRadius: 'var(--card-radius, 6px)',
                          fontSize: 12,
                          fontWeight: 600,
                          background: 'var(--accent-color)',
                          color: 'var(--surface-elevated, #fff)',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'opacity 0.2s'
                        }}
                      >
                        <Plus size={13} />
                        <span>创建组合</span>
                      </button>
                    )}

                    {/* ILP 配置入口 */}
                    <button
                      onClick={() => setIlpModal({ 
                        open: true, 
                        userId: client.id, 
                        userName: client.name || client.email, 
                        userEmail: client.email 
                      })}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '7px 12px',
                        borderRadius: 'var(--card-radius, 6px)',
                        fontSize: 12,
                        fontWeight: 500,
                        background: 'var(--surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      title="配置该客户的 ILP 储蓄与投连险参数"
                    >
                      <SlidersHorizontal size={13} />
                      <span>ILP 参数</span>
                    </button>

                    {/* 展开/收起组合 */}
                    <button
                      onClick={() => handleExpandClient(client.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '7px 12px',
                        borderRadius: 'var(--card-radius, 6px)',
                        fontSize: 12,
                        fontWeight: 500,
                        background: isExpanded ? 'var(--surface-inset)' : 'transparent',
                        border: '1px solid var(--border-subtle)',
                        color: isExpanded ? 'var(--accent-color)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>{isExpanded ? '收起' : '组合列表'}</span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* 展开内容：组合明细 */}
                {isExpanded && (
                  <div style={{
                    borderTop: '1px solid var(--border-subtle)',
                    background: 'var(--surface-subtle)',
                    padding: '18px 22px'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 12
                    }}>
                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em'
                      }}>
                        📁 该客户名下的投资组合 ({portfolios.length})
                      </div>
                      {onAssignPortfolio && (
                        <button
                          onClick={() => onAssignPortfolio(client.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent-color)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: 0
                          }}
                        >
                          <Plus size={12} /> 为此客户新增组合
                        </button>
                      )}
                    </div>

                    {isLoadingPortfolios ? (
                      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        ⏳ 正在加载组合详情…
                      </div>
                    ) : portfolios.length === 0 ? (
                      <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        background: 'var(--surface-card)',
                        border: '1px dashed var(--border-subtle)',
                        borderRadius: 'var(--card-radius, 6px)',
                        color: 'var(--text-muted)',
                        fontSize: 13
                      }}>
                        该客户目前尚未创建任何投资组合。点击上方「创建组合」即可为其量身配置。
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                        {portfolios.map(pf => (
                          <div
                            key={pf.id}
                            style={{
                              padding: '14px 16px',
                              background: 'var(--surface-card)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--card-radius, 6px)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                                {pf.name}
                              </span>
                              <span style={{
                                fontSize: 10,
                                fontFamily: 'var(--font-mono)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: 'var(--surface-subtle)',
                                color: 'var(--text-muted)',
                                border: '1px solid var(--border-subtle)'
                              }}>
                                #{pf.id}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                              <span style={{
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: 'var(--accent-color-rgb, 30, 77, 59)',
                                color: 'var(--surface-elevated, #fff)',
                                fontWeight: 600
                              }}>
                                {pf.base_currency}
                              </span>
                              <span>分红策略: <strong>{pf.dividend_strategy}</strong></span>
                            </div>
                            <div style={{
                              fontSize: 11,
                              color: 'var(--text-muted)',
                              marginTop: 4,
                              paddingTop: 8,
                              borderTop: '1px solid var(--border-subtle)',
                              display: 'flex',
                              justifyContent: 'space-between'
                            }}>
                              <span>建仓时间</span>
                              <span style={{ fontFamily: 'var(--font-mono)' }}>
                                {pf.created_at ? new Date(pf.created_at).toLocaleDateString('zh-CN') : '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── ILP 配置模态窗 ── */}
      <ILPSettingsModal
        open={ilpModal.open}
        onClose={() => setIlpModal({ open: false, userId: null, userName: '', userEmail: '' })}
        onSaved={() => {
          setIlpModal({ open: false, userId: null, userName: '', userEmail: '' });
          fetchClients();
        }}
        targetUserId={ilpModal.userId}
        targetUserName={ilpModal.userName}
        targetUserEmail={ilpModal.userEmail}
        isAdvisorMode={true}
      />
    </div>
  );
}
