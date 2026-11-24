import React, { useState, useEffect } from 'react';
import { UserCheck, X, Sparkles } from 'lucide-react';

/**
 * ClientInfoModal — 客户建议书信息与特殊诉求确认弹窗（Nordic Atelier 主题适配）
 */
const GOAL_OPTIONS = [
  { value: 'income', label: '现金流收息' },
  { value: 'preservation', label: '稳健保值' },
  { value: 'balanced', label: '平衡增值' },
  { value: 'growth', label: '长期复利成长' },
  { value: 'retirement', label: '退休收入保障' },
  { value: 'education', label: '子女教育基金' },
  { value: 'legacy', label: '家族财富传承' },
  { value: 'liquidity', label: '高流动性储备' },
];

const ClientInfoModal = ({ initialInfo, onConfirm, onSkip, onClose }) => {
  const init = initialInfo || {};
  const [name, setName] = useState(init.name || init.client_name || '');
  const [age, setAge] = useState(init.age ? String(init.age) : '');
  const [goals, setGoals] = useState(Array.isArray(init.goals) ? init.goals : []);
  const [advisor, setAdvisor] = useState(init.advisor || '');
  const [extraNotes, setExtraNotes] = useState(init.extra_notes || '');
  const [riskLabelZh, setRiskLabelZh] = useState(init.risk_label_zh || '均衡稳健型');

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleGoal = (val) => {
    setGoals((prev) =>
      prev.includes(val) ? prev.filter((g) => g !== val) : [...prev, val]
    );
  };

  const handleConfirm = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    onConfirm({
      name: trimmedName,
      client_name: trimmedName,
      age: age ? parseInt(age, 10) : null,
      goals,
      advisor: advisor.trim(),
      extra_notes: extraNotes.trim(),
      risk_label_zh: riskLabelZh.trim() || '均衡稳健型',
    });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="glass-card modal-content"
        style={{
          maxWidth: '580px',
          width: '94%',
          padding: '28px 32px',
          borderTop: '3px solid var(--accent-color)',
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '14px',
            marginBottom: '20px',
          }}
        >
          <div>
            <div className="stat-label" style={{ fontSize: '0.7rem', marginBottom: '4px' }}>
              PRIVATE WEALTH IPS PROFILE
            </div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserCheck size={20} style={{ color: 'var(--accent-color)' }} />
              客户建议书档案与诉求确认
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              以下信息将同步写入《专属资产配置建议书》封面、风险预算说明与 AI 深度撰写上下文。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="action-icon"
            style={{ background: 'transparent', border: 'none' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleConfirm} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>客户姓名 / 称谓</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：陈先生 / 家族信托专户"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>当前年龄</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="如 45"
                min={18}
                max={95}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>风险偏好定档</label>
              <select value={riskLabelZh} onChange={(e) => setRiskLabelZh(e.target.value)}>
                <option value="保守防御型">保守防御型</option>
                <option value="稳健偏收息">稳健偏收息</option>
                <option value="均衡配置型">均衡配置型</option>
                <option value="均衡稳健型">均衡稳健型</option>
                <option value="积极成长型">积极成长型</option>
                <option value="进取增值型">进取增值型</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>专属顾问 / 制作人</label>
              <input
                type="text"
                value={advisor}
                onChange={(e) => setAdvisor(e.target.value)}
                placeholder="例：WONDER Atelier 团队"
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              主要财务目标（可多选）
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {GOAL_OPTIONS.map((opt) => {
                const active = goals.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleGoal(opt.value)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '4px',
                      border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
                      background: active ? 'rgba(var(--accent-color-rgb), 0.12)' : 'var(--surface-subtle)',
                      color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {active ? '✓ ' : ''}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              客户特定诉求与家庭背景补充（选填，将写入建议书第一章及 AI 归因分析）
            </label>
            <textarea
              rows={3}
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              placeholder="例：计划 3 年后支出 15 万美元用于子女海外留学；已有足额分红险，本账户注重流动性与稳健派息；希望控制美股估值回调风险。"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.84rem',
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button type="submit" className="create-btn" style={{ flex: 2, justifyContent: 'center' }}>
              <Sparkles size={15} /> 确认并生成私人银行建议书
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="action-btn-secondary"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              跳过（通用模板）
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClientInfoModal;
