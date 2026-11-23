import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLang } from '../../i18n/langCore';
import { CLASSIC_PORTFOLIOS, getHoldings } from '../../data/classicPortfolios';

// 资产类别 → 专用配色 token（定义在 index.css，浅色 / 深色主题各一套，保证相邻色块易于区分）
const CLASS_COLOR = {
  equity: 'var(--ac-equity)',
  bond: 'var(--ac-bond)',
  gold: 'var(--ac-gold)',
  commodity: 'var(--ac-commodity)',
  reit: 'var(--ac-reit)',
  cash: 'var(--ac-cash)',
};
const CLASS_ORDER = ['equity', 'bond', 'reit', 'gold', 'commodity', 'cash'];

const WeightBar = ({ holdings, lang }) => (
  <div className="classic-bar" role="img"
    aria-label={holdings.map((x) => `${x.isin} ${x.weight}%`).join(', ')}>
    {holdings.map((x) => (
      <span key={x.isin}
        style={{ width: `${x.weight}%`, background: CLASS_COLOR[x.assetClass] }}
        title={`${x.isin} · ${x.label[lang]} · ${x.weight}%`} />
    ))}
  </div>
);

/**
 * 经典组合库：浏览业界经典资产配置，一键套用到策略实验室（自定义权重模式）。
 * 数据见 src/data/classicPortfolios.js；仅用于教育与演示。
 */
const ClassicPortfoliosModal = ({ open, onClose, onApply }) => {
  const { t, lang } = useLang();
  const [variant, setVariant] = useState('us'); // 'us' | 'ucits'
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const ucitsReady = CLASSIC_PORTFOLIOS.some((p) => getHoldings(p, 'ucits'));
  const usedClasses = CLASS_ORDER.filter((c) =>
    CLASSIC_PORTFOLIOS.some((p) => (getHoldings(p, variant) || []).some((x) => x.assetClass === c))
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card classic-modal" role="dialog" aria-modal="true"
        aria-labelledby="classic-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="classic-modal-head">
          <div>
            <h2 id="classic-modal-title" style={{ margin: 0, fontSize: '1.6rem' }}>{t('lab.classicTitle')}</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              {t('lab.classicSubtitle')}
            </p>
          </div>
          <button type="button" ref={closeRef} onClick={onClose} className="action-btn-secondary"
            style={{ padding: '6px 10px' }} aria-label={t('lab.close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="classic-toolbar">
          <div role="group" aria-label={t('lab.variantLabel')} className="lab-segmented">
            <button type="button" aria-pressed={variant === 'us'} onClick={() => setVariant('us')}>
              {t('lab.variantUs')}
            </button>
            <button type="button" aria-pressed={variant === 'ucits'} onClick={() => setVariant('ucits')}
              disabled={!ucitsReady} title={ucitsReady ? '' : t('lab.variantUcitsSoon')}>
              {ucitsReady ? t('lab.variantUcits') : t('lab.variantUcitsSoon')}
            </button>
          </div>
          <div className="classic-legend" aria-hidden="true">
            {usedClasses.map((c) => (
              <span key={c}><i style={{ background: CLASS_COLOR[c] }} />{t(`lab.assetClass.${c}`)}</span>
            ))}
          </div>
        </div>

        <div className="classic-grid">
          {CLASSIC_PORTFOLIOS.map((p) => {
            const holdings = getHoldings(p, variant);
            if (!holdings) return null;
            return (
              <article key={p.id} className="classic-card">
                <header>
                  <h3>{p.name[lang]}</h3>
                  <span className={`classic-risk classic-risk-${p.risk}`}>{t(`lab.risk.${p.risk}`)}</span>
                </header>
                <div className="classic-origin">{p.origin[lang]}</div>
                <WeightBar holdings={holdings} lang={lang} />
                <ul className="classic-holdings">
                  {holdings.map((x) => (
                    <li key={x.isin} title={x.label[lang]}>
                      <i style={{ background: CLASS_COLOR[x.assetClass] }} aria-hidden="true" />
                      <b>{x.isin}</b> {x.weight}%
                    </li>
                  ))}
                </ul>
                <p className="classic-idea">{p.idea[lang]}</p>
                {p.note && <p className="classic-note">{p.note[lang]}</p>}
                <button type="button" className="create-btn classic-apply" onClick={() => onApply(p, variant)}>
                  {t('lab.classicApply')}
                </button>
              </article>
            );
          })}
        </div>

        <footer className="classic-disclaimer">
          <p>{t('lab.classicDisclaimer')}</p>
          <p>{t('lab.classicWindowNote')}</p>
        </footer>
      </div>
    </div>
  );
};

export default ClassicPortfoliosModal;
