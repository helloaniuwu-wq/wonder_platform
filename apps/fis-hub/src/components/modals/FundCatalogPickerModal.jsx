import React, { useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { filterAndSortFunds, fmtNum, fmtSignedPct, gradeMeta } from '../../utils/fundQuantUtils';
import { useLang } from '../../i18n/langCore';

/**
 * Reusable 306-fund catalog picker modal embedded in StrategyLabView & CreatePortfolioModal.
 */
const FundCatalogPickerModal = ({ open, funds = [], existingIds = [], onClose, onConfirm }) => {
  const { lang } = useLang();
  const [q, setQ] = useState('');
  const [platformGroup, setPlatformGroup] = useState('all');
  const [domicile, setDomicile] = useState('all');
  const [assetClass, setAssetClass] = useState('all');
  const [selected, setSelected] = useState([]);

  const visibleFunds = useMemo(
    () =>
      filterAndSortFunds(funds, {
        q,
        platformGroup,
        domicile,
        assetClass,
        excludeNonRec: false,
        sortKey: 'quant_score',
        sortOrder: 'desc',
      }).slice(0, 80),
    [funds, q, platformGroup, domicile, assetClass]
  );

  if (!open) return null;

  const existingSet = new Set(existingIds.map((x) => String(x).toUpperCase()));

  const toggle = (code) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(860px, 95vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', gap: '14px', padding: '22px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
              {lang === 'en' ? `Pick from ${funds.length || 330}-Fund Library` : `从 ${funds.length || 330} 只基金产品库选基`}
            </h2>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {lang === 'en'
                ? 'Search AIA ILAS codes (Z01/B01), US/HK/CN/JP ETFs or ISINs — instant D1 lookup'
                : '支持按 AIA 代码（Z01/B01）、美/港/A/日 ETF、ISIN 或中文名检索，一键批量添加'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="action-btn-secondary" style={{ padding: '6px' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={lang === 'en' ? 'Search Z01, SCHD, 515080, Bond...' : '搜 Z01 / SCHD / 515080 / 债券...'}
              className="atelier-input"
              style={{ width: '100%', paddingLeft: '30px' }}
            />
          </div>
          <select value={platformGroup} onChange={(e) => setPlatformGroup(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Platforms' : '全部平台'}</option>
            <option value="aia">{lang === 'en' ? 'AIA ILAS (TMP2)' : 'AIA 卓达智悦2'}</option>
            <option value="eu_ucits">{lang === 'en' ? 'Europe / UCITS (IE/LU)' : '欧洲基金 (IE/LU UCITS)'}</option>
            <option value="us_intl">{lang === 'en' ? 'US / Intl / JP ETFs' : '美股 / 国际 / 日本 ETF'}</option>
            <option value="cn_hk">{lang === 'en' ? 'CN / HK Connect ETFs' : 'A股 / 港股通 ETF'}</option>
            <option value="bonds">{lang === 'en' ? 'Bond Funds' : '债券基金'}</option>
          </select>
          <select value={domicile} onChange={(e) => setDomicile(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Domiciles' : '全部税籍'}</option>
            <option value="ie">{lang === 'en' ? 'Ireland (IE)' : '爱尔兰 (IE)'}</option>
            <option value="lu">{lang === 'en' ? 'Luxembourg (LU)' : '卢森堡 (LU)'}</option>
            <option value="non_us">{lang === 'en' ? 'Estate-Tax Exempt' : '免美遗产税'}</option>
          </select>
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)} className="atelier-select" style={{ width: 'auto' }}>
            <option value="all">{lang === 'en' ? 'All Asset Classes' : '全部大类'}</option>
            <option value="股票">{lang === 'en' ? 'Equity' : '股票'}</option>
            <option value="固定收益">{lang === 'en' ? 'Fixed Income' : '固定收益'}</option>
            <option value="混合">{lang === 'en' ? 'Multi-Asset' : '混合'}</option>
            <option value="货币基金">{lang === 'en' ? 'Money Market' : '货币基金'}</option>
          </select>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
          {visibleFunds.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
              {funds.length === 0
                ? (lang === 'en' ? 'Catalog empty — sync via wq push-d1 first.' : '基金库尚未同步数据（请先在本机执行 wq run-daily）。')
                : (lang === 'en' ? 'No matching funds.' : '未找到匹配的基金。')}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface-subtle)', position: 'sticky', top: 0 }}>
                  <th style={{ width: 34, padding: '8px' }}></th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>{lang === 'en' ? 'Code / Name' : '代码 / 基金名称'}</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>{lang === 'en' ? 'Platform' : '分类'}</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>3Y Ann</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Sharpe</th>
                  <th style={{ textAlign: 'center', padding: '8px' }}>Grade</th>
                </tr>
              </thead>
              <tbody>
                {visibleFunds.map((f) => {
                  const idVal = f.code || f.slug;
                  const alreadyIn = existingSet.has(idVal.toUpperCase()) || existingSet.has(f.slug.toUpperCase());
                  const isSel = selected.includes(idVal);
                  const gm = gradeMeta(f.quant_grade);
                  return (
                    <tr
                      key={f.slug}
                      onClick={() => !alreadyIn && toggle(idVal)}
                      style={{
                        cursor: alreadyIn ? 'default' : 'pointer',
                        opacity: alreadyIn ? 0.55 : 1,
                        background: isSel ? 'rgba(197,155,95,0.12)' : 'transparent',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <td style={{ textAlign: 'center', padding: '8px' }}>
                        {alreadyIn || isSel ? <Check size={14} style={{ color: 'var(--accent-color)' }} /> : null}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-color)' }}>
                          {idVal} <span style={{ fontWeight: 500, fontFamily: 'inherit', color: 'var(--text-primary)' }}>{f.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '0.74rem' }}>
                        {f.ilas_platform || f.asset_class}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtSignedPct(f.ret_3y_ann)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtNum(f.sharpe_3y)}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <span style={{ padding: '1px 6px', borderRadius: '3px', background: gm.bg, color: gm.color, fontWeight: 700, fontSize: '0.72rem' }}>
                          {gm.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {lang === 'en' ? `Selected: ${selected.length}` : `已选：${selected.length} 只`}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="action-btn-secondary" onClick={onClose}>
              {lang === 'en' ? 'Cancel' : '取消'}
            </button>
            <button
              type="button"
              className="create-btn"
              disabled={selected.length === 0}
              onClick={() => {
                onConfirm(selected);
                setSelected([]);
                onClose();
              }}
            >
              {lang === 'en' ? `Add (${selected.length})` : `确认加入 (${selected.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FundCatalogPickerModal;
