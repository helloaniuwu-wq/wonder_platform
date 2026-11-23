import React from 'react';
import { Lock } from 'lucide-react';
import { hasRole } from '../utils/auth';

const MIN_ROLE_LABELS = {
  premium: '付费会员',
  advisor: '财务顾问',
  admin: '管理员',
};

const UPGRADE_BENEFITS = {
  premium: [
    '蒙特卡洛终值模拟',
    '有效前沿组合优化',
    '保险底座叠加分析',
    '财富规划 PDF 报告',
    '无限组合创建',
  ],
  advisor: [
    '客户组合管理',
    '为客户上传保险方案',
    '客户演示模式（Showcase）',
    '高级数据导出',
  ],
  admin: ['系统级管理权限'],
};

export default function FeatureLock({
  minRole = 'premium',
  currentUser,
  children,
  featureName = '此功能',
  onLoginClick,
}) {
  if (currentUser && hasRole(currentUser.role, minRole)) {
    return children;
  }

  const benefits = UPGRADE_BENEFITS[minRole] || [];
  const requiredLabel = MIN_ROLE_LABELS[minRole] || minRole;
  const isLoggedIn = !!currentUser;
  const isFree = currentUser?.role === 'free';

  return (
    <div className="glass-card" style={{
      maxWidth: '560px',
      margin: '32px auto',
      borderTop: '3px solid var(--accent-secondary)',
      padding: '44px 32px',
      textAlign: 'center',
    }}>
      <div style={{
        width: 52, height: 52, margin: '0 auto 18px',
        borderRadius: '8px',
        background: 'var(--warning-bg)',
        border: '1px solid var(--border-strong)',
        color: 'var(--accent-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Lock size={24} aria-hidden="true" />
      </div>

      <h3 style={{
        margin: '0 0 8px',
        fontSize: '1.6rem',
        fontWeight: 700,
        color: 'var(--text-primary)',
      }}>
        {featureName} · 会员专属
      </h3>

      <p style={{ margin: '0 0 24px', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6 }}>
        此功能仅对 <span style={{ color: 'var(--accent-secondary)', fontWeight: 700 }}>{requiredLabel}</span> 及以上开放
        {isFree && '，您当前为普通用户'}
      </p>

      {benefits.length > 0 && (
        <div style={{
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--card-radius)',
          padding: '16px 22px',
          marginBottom: 24,
          textAlign: 'left',
          display: 'inline-block',
          minWidth: 260,
        }}>
          <div className="stat-label" style={{ fontSize: '0.68rem', marginBottom: 10 }}>
            升级权益概览
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {benefits.map(b => (
              <li key={b} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, color: 'var(--text-primary)' }}>
                <span style={{ color: 'var(--accent-color)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isLoggedIn ? (
        <div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
            请先登录后查看
          </p>
          {onLoginClick && (
            <button type="button" onClick={onLoginClick} className="create-btn">
              立即登录
            </button>
          )}
        </div>
      ) : (
        <div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
            请联系您的财务顾问为您的账号升级
          </p>
          <a
            href="mailto:support@wonderhub.hk"
            className="create-btn"
            style={{ textDecoration: 'none' }}
          >
            联系顾问了解更多
          </a>
        </div>
      )}
    </div>
  );
}
