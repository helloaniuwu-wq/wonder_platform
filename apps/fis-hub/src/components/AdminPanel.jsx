import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, UserCheck, Shield, Award, User, RefreshCw, 
  Search, CheckCircle2, Ban, SlidersHorizontal, Briefcase,
  BookOpen, Copy, ExternalLink, Sparkles, Edit, Send, MailCheck, AlertCircle, X
} from 'lucide-react';
import { authHeaders } from '../utils/auth';
import {
  buildSingleFundSopPrompt,
  buildBatchFundSopPrompt,
  copyAndDownloadSopPrompt,
  extractWatchFocusList,
} from '../utils/sopPromptBuilder';

const API = '/api';

const ROLE_META = {
  admin:   { label: '管理员', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  advisor: { label: '财务顾问', color: 'var(--info)', bg: 'var(--info-bg)' },
  premium: { label: '付费会员', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  free:    { label: '普通用户', color: 'var(--text-muted)', bg: 'var(--surface-subtle)' },
};

const QUEUE_STATUS_META = {
  queued:      { label: '待分析', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' },
  watching:    { label: '观察中', color: 'var(--info)', bg: 'rgba(59, 130, 246, 0.12)' },
  in_progress: { label: '分析中', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  completed:   { label: '已完成', color: 'var(--success)', bg: 'var(--success-bg)' },
  dismissed:   { label: '暂不分析', color: 'var(--text-muted)', bg: 'var(--surface-subtle)' },
};

export default function AdminPanel({ currentUser, onOpenFundDetail }) {
  const [adminTab, setAdminTab] = useState('users'); // 'users' | 'fund_queue'
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [filterRole, setFilterRole] = useState('all');
  const [search, setSearch] = useState('');

  // 正在编辑用户联系信息的弹窗状态
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editVerified, setEditVerified] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [resendingEmailId, setResendingEmailId] = useState(null);

  // Fund Research Queue state
  const [queueItems, setQueueItems] = useState([]);
  const [queueSummary, setQueueSummary] = useState(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueStatusFilter, setQueueStatusFilter] = useState('all');
  const [queueSearch, setQueueSearch] = useState('');
  const [editingNotes, setEditingNotes] = useState({});

  // loading 初始即为 true，首次加载无需再同步 setLoading(true)；
  // 手动刷新走 fetchUsers（先置 loading 再加载）。
  const loadUsers = useCallback(
    () =>
      fetch(`${API}/admin/users`, {
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      })
        .then(async (res) => {
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
          }
          return res.json();
        })
        .then((data) => setUsers(Array.isArray(data) ? data : (data.users || [])))
        .catch((e) => setError('无法加载用户列表：' + e.message))
        .finally(() => setLoading(false)),
    []
  );

  const loadStats = useCallback(
    () =>
      fetch(`${API}/admin/stats`, { headers: authHeaders() })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (data) setStats(data); })
        .catch(() => { /* 统计加载失败不阻塞页面 */ })
        .finally(() => setStatsLoading(false)),
    []
  );

  const fetchUsers = useCallback(() => {
    setLoading(true);
    return loadUsers();
  }, [loadUsers]);

  const fetchStats = useCallback(() => {
    setStatsLoading(true);
    return loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadUsers();
    loadStats();
  }, [loadUsers, loadStats]);

  const loadFundQueue = useCallback(
    () =>
      fetch(`${API}/admin/fund-research-queue`, { headers: authHeaders() })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          setQueueItems(Array.isArray(data.items) ? data.items : []);
          setQueueSummary(data.summary || null);
        })
        .catch((e) => {
          setError('无法加载基金观察分析队列：' + e.message);
        })
        .finally(() => {
          setQueueLoading(false);
        }),
    []
  );

  const fetchFundQueue = useCallback(() => {
    setQueueLoading(true);
    return loadFundQueue();
  }, [loadFundQueue]);

  useEffect(() => {
    if (adminTab === 'fund_queue') {
      loadFundQueue();
    }
  }, [adminTab, loadFundQueue]);

  const handleQueueUpdate = async (slug, patch) => {
    setSavingId(slug);
    try {
      const res = await fetch(`${API}/admin/fund-research-queue/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('更新失败');
      showSuccessFeedback(`已更新 ${slug} 队列状态`);
      await fetchFundQueue();
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleExportQueueMarkdown = async () => {
    try {
      const res = await fetch(`${API}/admin/fund-research-queue/export?format=markdown`, { headers: authHeaders() });
      if (!res.ok) throw new Error('导出失败');
      const md = await res.text();
      await navigator.clipboard?.writeText(md).catch(() => {});
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `基金分析线索-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccessFeedback('已导出 Obsidian 线索 Markdown（并复制到剪贴板）');
    } catch (e) {
      alert(e.message);
    }
  };

  const handleCopyAgentPrompt = async () => {
    const active = queueItems.filter((x) => ['queued', 'watching', 'in_progress'].includes(x.status));
    if (active.length === 0) {
      alert('当前没有待分析队列项');
      return;
    }
    const enriched = active.map((x) => ({
      ...x,
      admin_note: editingNotes[x.slug] !== undefined ? editingNotes[x.slug] : (x.admin_note || ''),
    }));
    const prompt = buildBatchFundSopPrompt(enriched);
    await copyAndDownloadSopPrompt(prompt, '', { download: false });
    showSuccessFeedback(`已生成并复制 ${active.length} 只待分析基金的 SOP v2.0 Prompt 到剪贴板（含关注事项）`);
  };

  const handleSingleFundPrompt = async (item, noteVal) => {
    const prompt = buildSingleFundSopPrompt(item, { adminNoteOverride: noteVal });
    const code = item.code || item.slug;
    const focusList = extractWatchFocusList(item, { adminNoteOverride: noteVal });
    await copyAndDownloadSopPrompt(prompt, '', { download: false });
    showSuccessFeedback(`已生成并复制 ${code} 的 SOP 分析 Prompt 到剪贴板（已纳入 ${focusList.length} 条关注事项）`);
  };

  const showSuccessFeedback = (msg) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(''), 3000);
  };

  // 更改角色
  const handleRoleChange = async (userId, newRole) => {
    setSavingId(userId);
    setError('');
    try {
      const res = await fetch(`${API}/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '修改角色失败');
      }
      showSuccessFeedback(`用户角色已更新为「${ROLE_META[newRole]?.label || newRole}」`);
      await fetchUsers();
      await fetchStats();
    } catch (e) {
      alert('修改角色失败：' + e.message);
    } finally {
      setSavingId(null);
    }
  };

  // 分配顾问
  const handleAdvisorChange = async (userId, newAdvisorId) => {
    setSavingId(userId);
    setError('');
    try {
      const res = await fetch(`${API}/admin/users/${userId}/advisor`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ advisor_id: newAdvisorId || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '分配顾问失败');
      }
      showSuccessFeedback(newAdvisorId ? '已成功分配专属财务顾问' : '已解除顾问关联');
      await fetchUsers();
    } catch (e) {
      alert('分配顾问失败：' + e.message);
    } finally {
      setSavingId(null);
    }
  };

  // 打开编辑用户联系信息弹窗
  const handleOpenEditUser = (user) => {
    setEditingUser(user);
    setEditName(user.name || '');
    setEditEmail(user.email || '');
    setEditVerified(Boolean(user.is_verified));
  };

  // 提交修改用户联系信息
  const handleSaveUserContact = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!editName.trim()) {
      alert('姓名不能为空');
      return;
    }
    if (!editEmail.trim() || !/\S+@\S+\.\S+/.test(editEmail.trim())) {
      alert('请输入有效的电子邮箱地址');
      return;
    }

    setEditSubmitting(true);
    try {
      const res = await fetch(`${API}/admin/users/${editingUser.id}/profile`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          email: editEmail.trim(),
          is_verified: editVerified,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '修改联系信息失败');
      }

      showSuccessFeedback(`已成功更新用户 ${data.user?.name || editingUser.name} 的联系信息`);
      setEditingUser(null);
      await fetchUsers();
    } catch (err) {
      alert('保存失败：' + err.message);
    } finally {
      setEditSubmitting(false);
    }
  };

  // 管理员为用户补发/触发验证邮件
  const handleAdminResendVerification = async (user) => {
    if (!confirm(`确认向 ${user.email} 补发验证邮件吗？`)) return;
    setResendingEmailId(user.id);
    try {
      const res = await fetch(`${API}/admin/users/${user.id}/resend-verification`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_url: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || '补发邮件失败');
      }
      showSuccessFeedback(data.message || `验证邮件已发送至 ${user.email}`);
    } catch (err) {
      alert('发送失败：' + err.message);
    } finally {
      setResendingEmailId(null);
    }
  };

  // 封禁 / 激活
  const handleStatusToggle = async (userId, isActive) => {
    setSavingId(userId);
    setError('');
    try {
      const res = await fetch(`${API}/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '操作状态失败');
      }
      showSuccessFeedback(!isActive ? '用户账号已激活' : '用户账号已被封禁');
      await fetchUsers();
    } catch (e) {
      alert('操作失败：' + e.message);
    } finally {
      setSavingId(null);
    }
  };

  // 过滤
  const filteredUsers = users.filter(u => {
    const matchRole = filterRole === 'all' || u.role === filterRole;
    const matchSearch = !search.trim() ||
      (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  const advisorsList = users.filter(x => x.role === 'advisor');

  const statCards = stats ? [
    { label: '总用户数', value: stats.total_users ?? 0, icon: <Users size={16} />, color: 'var(--text-primary)' },
    { label: '系统管理', value: stats.admin_count ?? 0, icon: <Shield size={16} />, color: 'var(--danger)' },
    { label: '财务顾问', value: stats.advisor_count ?? 0, icon: <UserCheck size={16} />, color: 'var(--info)' },
    { label: '付费会员', value: stats.premium_count ?? 0, icon: <Award size={16} />, color: 'var(--warning)' },
    { label: '普通用户', value: stats.free_count ?? 0, icon: <User size={16} />, color: 'var(--text-muted)' },
    { label: '投资组合', value: stats.total_portfolios ?? 0, icon: <Briefcase size={16} />, color: 'var(--accent-color)' },
  ] : [];

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
              background: 'var(--accent-secondary, #9A6F38)',
              color: 'var(--surface-elevated, #fff)',
              fontSize: 16
            }}>
              <Shield size={18} />
            </span>
            <h2 style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}>
              用户与权限管理中心
            </h2>
          </div>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
            系统管理员专区 · 跨域管理用户角色分级、顾问与客户映射关系，以及全平台账户生命周期
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="lab-segmented">
            <button type="button" aria-pressed={adminTab === 'users'} onClick={() => setAdminTab('users')}>
              👥 用户与权限管理
            </button>
            <button type="button" aria-pressed={adminTab === 'fund_queue'} onClick={() => setAdminTab('fund_queue')}>
              🔍 基金观察分析队列 {queueSummary ? `(${queueSummary.queued_count + queueSummary.watching_count + queueSummary.in_progress_count})` : ''}
            </button>
          </div>
          <button
            onClick={() => {
              if (adminTab === 'fund_queue') {
                fetchFundQueue();
              } else {
                fetchUsers();
                fetchStats();
              }
            }}
            disabled={loading || statsLoading || queueLoading}
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
            <RefreshCw size={14} className={loading || queueLoading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {adminTab === 'fund_queue' ? (
        <div>
          {queueSummary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { label: '全库可追踪基金', value: queueSummary.total_funds, color: 'var(--text-primary)' },
                { label: 'SOP 深度覆盖', value: `${queueSummary.sop_covered_count} (${queueSummary.coverage_pct}%)`, color: 'var(--success)' },
                { label: '待分析 / 观察', value: queueSummary.queued_count + queueSummary.watching_count, color: '#8b5cf6' },
                { label: '分析进行中', value: queueSummary.in_progress_count, color: 'var(--warning)' },
              ].map((c) => (
                <div key={c.label} style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius, 6px)', padding: '14px 16px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{c.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: c.color }}>{c.value}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
            <div className="lab-segmented">
              {[
                { id: 'all', label: '全部' },
                { id: 'queued', label: '待分析' },
                { id: 'watching', label: '观察中' },
                { id: 'in_progress', label: '分析中' },
                { id: 'completed', label: '已完成' },
                { id: 'dismissed', label: '暂不分析' },
              ].map((st) => (
                <button key={st.id} type="button" aria-pressed={queueStatusFilter === st.id} onClick={() => setQueueStatusFilter(st.id)}>
                  {st.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="搜代码 / 名称 / 备注…"
              className="atelier-input"
              style={{ flex: '1 1 200px', maxWidth: 260 }}
            />

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={handleCopyAgentPrompt} className="action-btn-secondary" style={{ fontSize: 12, padding: '7px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} /> 批量复制 SOP Prompt
              </button>
              <button type="button" onClick={handleExportQueueMarkdown} className="create-btn" style={{ fontSize: 12, padding: '7px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Download size={13} /> 导出 Obsidian 线索清单
              </button>
            </div>
          </div>

          {actionSuccess && (
            <div style={{ padding: '10px 16px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 'var(--card-radius, 6px)', color: 'var(--success)', fontSize: 13, marginBottom: 16 }}>
              {actionSuccess}
            </div>
          )}

          <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius, 6px)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-subtle)' }}>
                    {['基金代码 / 名称', '关注热度与用户备注', '优先级', '调度状态', '管理员备注', '一键创立 / 导出 SOP Prompt'].map((h) => (
                      <th key={h} style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queueLoading ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>加载队列中…</td></tr>
                  ) : (() => {
                    const visible = queueItems.filter((it) => {
                      if (queueStatusFilter !== 'all' && it.status !== queueStatusFilter) return false;
                      if (queueSearch.trim()) {
                        const hay = `${it.slug} ${it.code} ${it.fund_name} ${it.admin_note} ${JSON.stringify(it.requesters || [])}`.toLowerCase();
                        if (!hay.includes(queueSearch.toLowerCase())) return false;
                      }
                      return true;
                    });
                    if (visible.length === 0) {
                      return <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无观察队列记录</td></tr>;
                    }
                    return visible.map((it) => {
                      const sm = QUEUE_STATUS_META[it.status] || QUEUE_STATUS_META.queued;
                      const noteVal = editingNotes[it.slug] !== undefined ? editingNotes[it.slug] : (it.admin_note || '');
                      return (
                        <tr key={it.slug} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={() => onOpenFundDetail?.(it.slug)}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-color)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                {it.code} <ExternalLink size={11} />
                              </button>
                              {it.has_sop_report && (
                                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(16,185,129,0.12)', color: 'var(--success)', fontWeight: 700 }}>
                                  <BookOpen size={10} /> {it.sop_medal}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{it.fund_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{it.ilas_platform || '—'} · {it.asset_class}</div>
                          </td>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>👥 {it.request_count} 人标记</div>
                            {(it.requesters || []).map((req, ridx) => (
                              <div key={ridx} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                                <strong>{req.name || req.email}</strong>{req.note ? `：${req.note}` : ''}
                              </div>
                            ))}
                          </td>
                          <td style={tdStyle}>
                            <select
                              value={it.priority}
                              disabled={savingId === it.slug}
                              onChange={(e) => handleQueueUpdate(it.slug, { priority: e.target.value })}
                              className="atelier-select"
                              style={{ fontSize: 12, padding: '4px 8px' }}
                            >
                              <option value="P0_urgent">P0 紧急</option>
                              <option value="P1_high">P1 高优</option>
                              <option value="normal">普通</option>
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <select
                              value={it.status}
                              disabled={savingId === it.slug}
                              onChange={(e) => handleQueueUpdate(it.slug, { status: e.target.value })}
                              style={{ padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: sm.bg, color: sm.color, border: '1px solid var(--border-subtle)' }}
                            >
                              <option value="queued">待分析</option>
                              <option value="watching">观察中</option>
                              <option value="in_progress">分析中</option>
                              <option value="completed">已完成</option>
                              <option value="dismissed">暂不分析</option>
                            </select>
                          </td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                type="text"
                                value={noteVal}
                                onChange={(e) => setEditingNotes((prev) => ({ ...prev, [it.slug]: e.target.value }))}
                                placeholder="调度备注…"
                                className="atelier-input"
                                style={{ fontSize: 12, padding: '4px 8px', minWidth: 140 }}
                              />
                              <button
                                type="button"
                                disabled={savingId === it.slug}
                                onClick={() => handleQueueUpdate(it.slug, { admin_note: noteVal })}
                                className="action-btn-secondary"
                                style={{ fontSize: 11, padding: '4px 8px' }}
                              >
                                保存
                              </button>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              onClick={() => handleSingleFundPrompt(it, noteVal)}
                              className="create-btn"
                              style={{ fontSize: 11, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                              title="一键生成含全部关注事项的基金分析 SOP Prompt 并复制到剪贴板"
                            >
                              <Copy size={12} /> 复制 SOP Prompt
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>

      {/* ── 统计卡片 ── */}
      {!statsLoading && stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginBottom: 24
        }}>
          {statCards.map(c => (
            <div
              key={c.label}
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--card-radius, 6px)',
                padding: '14px 16px',
                boxShadow: 'var(--card-shadow)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: c.color }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.label}</span>
                {c.icon}
              </div>
              <div style={{
                fontSize: 24,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: c.color,
                letterSpacing: '-0.02em'
              }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 筛选 & 搜索 ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 18,
        alignItems: 'center'
      }}>
        {/* 角色过滤器 Tabs */}
        <div style={{
          display: 'flex',
          background: 'var(--surface-subtle)',
          borderRadius: 'var(--card-radius, 6px)',
          padding: 3,
          border: '1px solid var(--border-subtle)'
        }}>
          {[
            { id: 'all', label: '全部' },
            { id: 'admin', label: '管理员' },
            { id: 'advisor', label: '顾问' },
            { id: 'premium', label: '付费' },
            { id: 'free', label: '普通' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterRole(tab.id)}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: filterRole === tab.id ? 600 : 400,
                background: filterRole === tab.id ? 'var(--surface-card)' : 'transparent',
                color: filterRole === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: filterRole === tab.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <div style={{
          flex: 1,
          minWidth: 200,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius, 6px)',
          padding: '0 12px',
          height: 36
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜索姓名或邮箱…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── 动作反馈提示 ── */}
      {actionSuccess && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--success-bg)',
          border: '1px solid var(--success)',
          borderRadius: 'var(--card-radius, 6px)',
          color: 'var(--success)',
          fontSize: 13,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <CheckCircle2 size={16} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* ── 错误提示 ── */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--danger-bg)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--card-radius, 6px)',
          color: 'var(--danger)',
          fontSize: 13,
          marginBottom: 16
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── 加载状态 ── */}
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
          <div style={{ fontSize: 14 }}>正在加载用户列表…</div>
        </div>
      ) : (
        /* 用户表格 */
        <div style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius, 6px)',
          overflow: 'hidden',
          boxShadow: 'var(--card-shadow)'
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--surface-subtle)'
                }}>
                  {['用户 ID', '用户信息', '电子邮箱', '角色权限', '所属顾问', '邮箱验证', '账号状态', '管理操作'].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: '12px 16px',
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em'
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: 13 }}>
                      暂无符合条件的用户记录
                    </td>
                  </tr>
                ) : filteredUsers.map((u, idx) => {
                  const isCurrent = u.id === currentUser?.id;
                  const isBusy = savingId === u.id;

                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: idx % 2 === 0 ? 'transparent' : 'var(--surface-subtle)',
                        transition: 'background 0.15s',
                        opacity: isBusy ? 0.6 : 1
                      }}
                    >
                      {/* ID */}
                      <td style={tdStyle}>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--text-muted)'
                        }}>
                          {String(u.id).slice(0, 8)}…
                        </span>
                      </td>

                      {/* 用户姓名与头像 */}
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: ROLE_META[u.role]?.bg || 'var(--surface-subtle)',
                            border: `1px solid ${ROLE_META[u.role]?.color || 'var(--border-subtle)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 13,
                            fontWeight: 700,
                            color: ROLE_META[u.role]?.color || 'var(--text-secondary)',
                            flexShrink: 0
                          }}>
                            {(u.name || u.email || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, display: 'block' }}>
                              {u.name || '—'}
                            </span>
                            {isCurrent && (
                              <span style={{ fontSize: 10, color: 'var(--accent-color)', fontWeight: 600 }}>
                                (当前登录)
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 邮箱 */}
                      <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: 12 }}>
                        {u.email}
                      </td>

                      {/* 角色下拉 */}
                      <td style={tdStyle}>
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          disabled={isBusy || isCurrent}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            background: ROLE_META[u.role]?.bg || 'var(--surface-subtle)',
                            border: `1px solid ${ROLE_META[u.role]?.color || 'var(--border-subtle)'}`,
                            color: ROLE_META[u.role]?.color || 'var(--text-primary)',
                            cursor: isCurrent ? 'not-allowed' : 'pointer',
                            outline: 'none'
                          }}
                        >
                          <option value="admin">管理员 (admin)</option>
                          <option value="advisor">财务顾问 (advisor)</option>
                          <option value="premium">付费会员 (premium)</option>
                          <option value="free">普通用户 (free)</option>
                        </select>
                      </td>

                      {/* 关联顾问下拉 */}
                      <td style={tdStyle}>
                        {(u.role === 'premium' || u.role === 'free') ? (
                          <select
                            value={u.advisor_id || ''}
                            onChange={(e) => handleAdvisorChange(u.id, e.target.value)}
                            disabled={isBusy}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              background: 'var(--surface-subtle)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              outline: 'none'
                            }}
                          >
                            <option value="">-- 无指定顾问 --</option>
                            {advisorsList.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.name || a.email}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        )}
                      </td>

                      {/* 邮箱验证状态 */}
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: u.is_verified ? 'var(--success-bg)' : 'var(--warning-bg)',
                            color: u.is_verified ? 'var(--success)' : 'var(--warning)',
                            border: `1px solid ${u.is_verified ? 'var(--success)' : 'var(--warning)'}`
                          }}>
                            {u.is_verified ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                            {u.is_verified ? '已验证' : '未验证'}
                          </span>

                          {!u.is_verified && (
                            <button
                              type="button"
                              onClick={() => handleAdminResendVerification(u)}
                              disabled={resendingEmailId === u.id}
                              title="向该用户发送/补发验证邮件"
                              className="action-btn-secondary"
                              style={{ padding: '2px 6px', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            >
                              <Send size={10} className={resendingEmailId === u.id ? 'animate-spin' : ''} />
                              <span>{resendingEmailId === u.id ? '发送中' : '补发'}</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 账号状态徽章 */}
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: u.is_active ? 'var(--success-bg)' : 'var(--danger-bg)',
                          color: u.is_active ? 'var(--success)' : 'var(--danger)',
                          border: `1px solid ${u.is_active ? 'var(--success)' : 'var(--danger)'}`
                        }}>
                          {u.is_active ? <CheckCircle2 size={12} /> : <Ban size={12} />}
                          {u.is_active ? '正常' : '已封禁'}
                        </span>
                      </td>

                      {/* 操作 */}
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {/* 修改联系信息按钮 */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditUser(u)}
                            className="action-btn-secondary"
                            style={{
                              padding: '4px 8px',
                              fontSize: 11,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="修改该用户的姓名、邮箱与验证状态"
                          >
                            <Edit size={11} />
                            <span>改联系信息</span>
                          </button>

                          {!isCurrent ? (
                            <button
                              onClick={() => handleStatusToggle(u.id, u.is_active)}
                              disabled={isBusy}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: u.is_active ? 'var(--danger-bg)' : 'var(--success-bg)',
                                border: `1px solid ${u.is_active ? 'var(--danger)' : 'var(--success)'}`,
                                color: u.is_active ? 'var(--danger)' : 'var(--success)',
                                cursor: isBusy ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s'
                              }}
                            >
                              {u.is_active ? '封禁' : '解封'}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>保护</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 底部摘要 */}
      <div style={{
        marginTop: 16,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 12,
        color: 'var(--text-muted)'
      }}>
        <span>共检索到 {filteredUsers.length} 位用户</span>
        <span>管理员权限说明：不可修改自己的角色及封禁状态以防权限死锁</span>
      </div>
        </>
      )}

      {/* ── 管理员修改用户联系信息 Modal ── */}
      {editingUser && (
        <div style={overlayStyle} onClick={() => setEditingUser(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 6,
                  background: 'var(--accent-secondary, #9A6F38)', color: '#fff'
                }}>
                  <Edit size={15} />
                </span>
                <h3 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  修改用户联系信息
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-secondary)' }}>
              管理员可直接更正或更新该用户的真实姓名、注册邮箱以及邮箱验证状态。
            </p>

            <form onSubmit={handleSaveUserContact}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  用户显示姓名
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="请输入姓名"
                  className="atelier-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  disabled={editSubmitting}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  电子邮箱地址
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="请输入有效电子邮箱"
                  className="atelier-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  disabled={editSubmitting}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editVerified}
                    onChange={(e) => setEditVerified(e.target.checked)}
                    disabled={editSubmitting}
                  />
                  <span>将此邮箱标记为「已验证」状态（跳过用户点击邮件激活）</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="action-btn-secondary"
                  style={{ padding: '7px 14px', fontSize: 12 }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="create-btn"
                  style={{ padding: '7px 16px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  {editSubmitting ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  <span>{editSubmitting ? '正在保存…' : '保存联系信息'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──
const tdStyle = {
  padding: '12px 16px',
  color: 'var(--text-primary)',
  fontSize: 13,
  verticalAlign: 'middle',
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(10, 25, 47, 0.65)',
  backdropFilter: 'blur(6px)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalStyle = {
  position: 'relative',
  background: 'var(--surface-elevated, #fff)',
  border: '1px solid var(--border-strong, #e2e8f0)',
  borderTop: '3px solid var(--accent-color, #1B4D3E)',
  borderRadius: 'var(--card-radius, 8px)',
  padding: '24px 22px 20px',
  width: '100%',
  maxWidth: 420,
  boxShadow: 'var(--card-shadow, 0 20px 40px rgba(0,0,0,0.18))',
};
