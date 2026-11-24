import React from 'react';
import { lookupCOI, normalizeIlpGender } from '../utils/ilpConfigCalc';

// ════════════════════════════════════════════════════════════════════════
//  ILP 保障与传承可视化卡片（Nordic Gallery Minimal Edition）
// ════════════════════════════════════════════════════════════════════════

const ILPSummaryCard = ({
  ilpConfig,
  currentCV,
  currentMonth,
  p50EstimateEnd,
  compact = false,
  onEditConfig,
}) => {
  if (!ilpConfig || !ilpConfig.totalPremium) return null;

  const normGender = normalizeIlpGender(ilpConfig.gender);
  const ageNum = Number(ilpConfig.age ?? 35);
  const matchedCoiRate = lookupCOI(ageNum, normGender);
  const sumAssured = ilpConfig.totalPremium * 1.05;
  const cv = currentCV || 0;
  const coverRatio = sumAssured > 0 ? Math.min(cv / sumAssured * 100, 100) : 0;
  const excessProtection = Math.max(0, sumAssured - cv);
  const enrollBonus = ilpConfig.totalPremium * (ilpConfig.enrollmentRate || 0);
  const month = currentMonth || 0;
  const loyaltyProg = Math.min(month / 60 * 100, 100);

  const fmt = (v) => '$' + Math.round(v).toLocaleString();

  if (compact) {
    return (
      <div style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '3px solid var(--accent-color)',
        borderRadius: 'var(--card-radius)',
        padding: '16px 18px',
        marginBottom: '18px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h4 style={{ margin: 0, color: 'var(--accent-color)', fontSize: '1rem' }}>投连险（ILP）模式 · 本组合独立费率</h4>
          </div>
          {onEditConfig && (
            <button
              type="button"
              onClick={onEditConfig}
              className="action-btn-secondary"
              style={{ padding: '4px 12px', fontSize: '0.78rem' }}
            >
              修改性别/年龄与费率
            </button>
          )}
        </div>

        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '12px', fontFamily: 'var(--font-mono)' }}>
          受保人：{ageNum}岁 · {normGender === 'female' ? '女' : '男'}
          {ilpConfig.smoker ? ' · 吸烟者' : ' · 非吸烟者'}
          &nbsp;·&nbsp;匹配 COI：<strong style={{ color: 'var(--accent-color)' }}>{matchedCoiRate.toFixed(2)}‰/年</strong>
          &nbsp;&nbsp;|&nbsp;&nbsp;整付保费：{fmt(ilpConfig.totalPremium)} {ilpConfig.currency || 'USD'}
          &nbsp;&nbsp;|&nbsp;&nbsp;身故赔偿：{fmt(sumAssured)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '10px' }}>
          <div style={{
            background: 'var(--surface-subtle)', padding: '10px 12px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 700, marginBottom: '6px' }}>费用状态</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              前期费（首5年）：{month < 60 ? '活跃' : '已结束'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              户口价值费：活跃
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              保险费用（COI {matchedCoiRate.toFixed(2)}‰/年）：{ageNum + Math.floor(month / 12) < 80 ? '活跃' : '已豁免'}
            </div>
          </div>

          <div style={{
            background: 'var(--surface-subtle)', padding: '10px 12px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-secondary)', fontWeight: 700, marginBottom: '6px' }}>奖赏状态</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              开户奖赏：{fmt(enrollBonus)} ✓ 已入账
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              长期奖赏：{month >= 60 ? '已启动' : `第${month}月（距60月）`}
            </div>
            {month < 60 && (
              <div style={{
                background: 'var(--surface-inset)', borderRadius: '4px', height: '6px',
                marginTop: '6px', overflow: 'hidden',
              }}>
                <div style={{
                  background: 'var(--accent-secondary)', height: '100%', width: `${loyaltyProg}%`,
                  borderRadius: '4px', transition: 'width 0.3s',
                }} />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          <div style={{
            background: 'var(--surface-subtle)', padding: '10px 12px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 700, marginBottom: '4px' }}>保障</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              CV：{fmt(cv)}&nbsp;&nbsp;保额：{fmt(sumAssured)}
            </div>
            <div style={{
              background: 'var(--surface-inset)', borderRadius: '4px', height: '8px',
              marginTop: '6px', overflow: 'hidden',
            }}>
              <div style={{
                background: cv >= sumAssured ? 'var(--success)' : 'var(--accent-color)',
                height: '100%', width: `${coverRatio}%`,
                borderRadius: '4px', transition: 'width 0.3s',
              }} />
            </div>
          </div>
          <div style={{
            background: 'var(--surface-subtle)', padding: '10px 12px', borderRadius: 'var(--card-radius)',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--info)', fontWeight: 700, marginBottom: '4px' }}>传承</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              ✓ 免遗产认证 · 直接赔付受益人
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              ✓ 不受债权人追索
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '15px', marginTop: '15px' }}>
      {/* 保障功能卡 */}
      <div style={{
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-subtle)',
        borderTop: '2px solid var(--accent-color)',
        borderRadius: 'var(--card-radius)', padding: '18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <h4 style={{ margin: 0, color: 'var(--accent-color)' }}>保障功能</h4>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          身故赔偿：<span style={{ color: 'var(--accent-color)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(sumAssured)}</span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>
          当前 CV：{fmt(cv)}
        </div>
        <div style={{
          background: 'var(--surface-inset)', borderRadius: '4px', height: '12px',
          marginBottom: '8px', overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            background: cv >= sumAssured ? 'var(--success)' : 'var(--accent-color)',
            height: '100%', width: `${coverRatio}%`,
            borderRadius: '4px', transition: 'width 0.3s',
          }} />
          <span style={{
            position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
            fontSize: '0.65rem', color: 'var(--text-primary)', fontWeight: 700, fontFamily: 'var(--font-mono)',
          }}>
            {coverRatio.toFixed(1)}%
          </span>
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {cv >= sumAssured ? (
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ CV 已超越保额，保险费用 ≈ 0</span>
          ) : (
            <>超额保障：<span style={{ color: 'var(--accent-secondary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>+{fmt(excessProtection)}</span></>
          )}
        </div>
      </div>

      {/* 传承功能卡 */}
      <div style={{
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-subtle)',
        borderTop: '2px solid var(--accent-secondary)',
        borderRadius: 'var(--card-radius)', padding: '18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <h4 style={{ margin: 0, color: 'var(--accent-secondary)' }}>传承功能</h4>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--accent-color)', fontWeight: 700 }}>✓</span> 免遗产认证（Probate-free）
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--accent-color)', fontWeight: 700 }}>✓</span> 直接赔付指定受益人
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--accent-color)', fontWeight: 700 }}>✓</span> 不受债权人追索
          </div>
        </div>
        {p50EstimateEnd > 0 && (
          <div style={{
            marginTop: '14px', paddingTop: '12px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>P50 情景传承估算</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>
              {fmt(p50EstimateEnd)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ILPSummaryCard;
