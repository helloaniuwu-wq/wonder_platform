import React, { useState } from 'react';
import { getEnrollmentBonusRate } from '../utils/ilpConfigCalc';

// ════════════════════════════════════════════════════════════════════════
//  开户奖赏确认弹窗 — 支持手动修改奖赏率
// ════════════════════════════════════════════════════════════════════════

const TIERS = [
  { min: 1000000, label: '$1,000,000+',  rate: 0.060 },
  { min: 500000,  label: '$500k–$999k',  rate: 0.055 },
  { min: 300000,  label: '$300k–$499k',  rate: 0.045 },
  { min: 100000,  label: '$100k–$299k',  rate: 0.035 },
  { min: 50000,   label: '$50k–$99k',    rate: 0.025 },
];

function matchTier(premium) {
  for (const t of TIERS) {
    if (premium >= t.min) return t;
  }
  return null;
}

// 外层只负责「是否打开」；内层每次打开（或保费/当前奖赏率变化）时重新挂载，
// 以惰性初始值完成表单初始化，不必在 effect 里同步 setState。
const ILPEnrollmentBonusModal = ({ open, ...rest }) => {
  if (!open) return null;
  return <ILPEnrollmentBonusModalBody key={`${rest.totalPremium}|${rest.currentRate}`} {...rest} />;
};

const ILPEnrollmentBonusModalBody = ({ onClose, onConfirm, totalPremium, currentRate }) => {
  // 初始化：优先用已有的 rate，否则用系统推荐
  const [customRate, setCustomRate] = useState(() => {
    const initRate = currentRate !== null && currentRate !== undefined
      ? currentRate
      : getEnrollmentBonusRate(totalPremium || 0);
    return parseFloat((initRate * 100).toFixed(2));
  });
  const tier = matchTier(totalPremium || 0);

  const rateDecimal = customRate / 100;
  const bonusAmount = (totalPremium || 0) * rateDecimal;

  const handleConfirm = () => {
    onConfirm(rateDecimal);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        background: '#1e1e2e', borderRadius: '12px', padding: '28px',
        width: '460px', maxWidth: '90vw',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
      }}>
        {/* 标题 */}
        <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px'}}>
          <span style={{fontSize: '1.5rem'}}>🎁</span>
          <div>
            <h3 style={{margin: 0, color: '#f59e0b'}}>开户奖赏确认</h3>
            <div style={{fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)'}}>
              卓达智悦 2 开户奖赏推广（限香港）
            </div>
          </div>
        </div>

        {/* 整付保费 & 系统推荐档 */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '8px',
          marginBottom: '16px', border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
            <span style={{color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem'}}>整付保费</span>
            <span style={{fontWeight: 700, color: '#fff'}}>
              ${Math.round(totalPremium || 0).toLocaleString()} USD
            </span>
          </div>
          {tier ? (
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
              <span style={{color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem'}}>系统推荐档位</span>
              <span style={{color: '#f59e0b', fontWeight: 600}}>
                {tier.label} → {(tier.rate * 100).toFixed(1)}%
              </span>
            </div>
          ) : (
            <div style={{color: '#ef4444', fontSize: '0.85rem'}}>
              ⚠️ 整付保费低于最低推广门槛（$50,000 USD）
            </div>
          )}
        </div>

        {/* 推广率表一览 */}
        <div style={{marginBottom: '16px'}}>
          <div style={{fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginBottom: '6px'}}>推广率参考表</div>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', fontSize: '0.78rem'}}>
            {TIERS.slice().reverse().map(t => (
              <React.Fragment key={t.min}>
                <span style={{
                  color: tier && t.min === tier.min ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                  fontWeight: tier && t.min === tier.min ? 600 : 400
                }}>{t.label}</span>
                <span style={{
                  textAlign: 'right',
                  color: tier && t.min === tier.min ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                  fontWeight: tier && t.min === tier.min ? 600 : 400
                }}>{(t.rate * 100).toFixed(1)}%</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 可调整奖赏率输入 */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)', padding: '14px', borderRadius: '8px',
          border: '1px solid rgba(245, 158, 11, 0.2)', marginBottom: '16px'
        }}>
          <div style={{fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', marginBottom: '8px'}}>
            可手动调整奖赏率（范围：0 – 10%）
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <span style={{fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)'}}>推广率</span>
            <input
              type="number"
              min="0" max="10" step="0.1"
              value={customRate}
              onChange={e => setCustomRate(Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(245,158,11,0.4)',
                color: '#f59e0b', borderRadius: '6px', padding: '8px 12px', width: '80px',
                fontSize: '1.1rem', fontWeight: 700, textAlign: 'center'
              }}
            />
            <span style={{color: '#f59e0b', fontWeight: 600}}>%</span>
          </div>
          <div style={{marginTop: '10px', fontSize: '1rem', fontWeight: 700, color: '#f59e0b'}}>
            开户奖赏金额：${Math.round(bonusAmount).toLocaleString()}
          </div>
        </div>

        {/* 推广期提示 */}
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)', padding: '10px 14px', borderRadius: '6px',
          border: '1px solid rgba(239, 68, 68, 0.15)', marginBottom: '20px',
          fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)'
        }}>
          ⚠️ 推广期：<strong style={{color: '#ef4444'}}>2026年4月1日 – 2026年6月30日</strong>（仅适用于香港地区）
        </div>

        {/* 按钮 */}
        <div style={{display: 'flex', justifyContent: 'flex-end', gap: '10px'}}>
          <button onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer'
            }}>
            取消
          </button>
          <button onClick={handleConfirm}
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none',
              color: '#fff', padding: '8px 24px', borderRadius: '6px', cursor: 'pointer',
              fontWeight: 600
            }}>
            ✓ 确认并应用
          </button>
        </div>
      </div>
    </div>
  );
};

export default ILPEnrollmentBonusModal;
