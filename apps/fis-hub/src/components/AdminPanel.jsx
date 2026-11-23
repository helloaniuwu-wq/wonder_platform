import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, UserCheck, Shield, Award, User, RefreshCw, 
  Search, CheckCircle2, Ban, SlidersHorizontal, Briefcase 
} from 'lucide-react';
import { authHeaders } from '../utils/auth';

const API = '/api';

const ROLE_META = {
  admin:   { label: '管理员', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  advisor: { label: '财务顾问', color: 'var(--info)', bg: 'var(--info-bg)' },
  premium: { label: '付费会员', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  free:    { label: '普通用户', color: 'var(--text-muted)', bg: 'var(--surface-subtle)' },
};

export default function AdminPanel({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [filterRole, setFilterRole] = useState('all');
  const [search, setSearch] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/users`, {
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : (data.users || []));
    } catch (e) {
      setError('无法加载用户列表：' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API}/admin/stats`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      setStats(await res.json());
    } catch (_) {}
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchStats();
  }, [fetchUsers, fetchStats]);

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

        <button
          onClick={() => { fetchUsers(); fetchStats(); }}
          disabled={loading || statsLoading}
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
          title="刷新所有用户及统计数据"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>刷新</span>
        </button>
      </div>

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
                  {['用户 ID', '用户信息', '电子邮箱', '角色权限', '所属顾问', '状态', '管理操作'].map(h => (
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
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: 13 }}>
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

                      {/* 状态徽章 */}
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
                        {!isCurrent ? (
                          <button
                            onClick={() => handleStatusToggle(u.id, u.is_active)}
                            disabled={isBusy}
                            style={{
                              padding: '4px 10px',
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
                            {u.is_active ? '封禁账号' : '解封激活'}
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>保护</span>
                        )}
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
