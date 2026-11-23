import React, { useState, useRef } from 'react';
import { Briefcase, Activity, Plus, Trash2, Users, UserCheck, GripVertical, Link, BookOpen, X } from 'lucide-react';
import ILPSettingsModal from './ILPSettingsModal';
import { useLang } from '../i18n/langCore';

/**
 * Sidebar component — Nordic Gallery Catalog & Off-canvas Drawer on Tablet/Mobile.
 */
const Sidebar = ({
  activeTab, setActiveTab,
  portfolios, setPortfolios, activeId, setActiveId,
  setShowModal,
  setDeleteCandidate, setShowDeleteModal,
  savedScenarios, handleLoadScenario, handleDeleteScenario, handleRenameScenario,
  currentUser, canEditPortfolio,
  onIlpSaved,
  mobileDrawerOpen = false,
  setMobileDrawerOpen = () => {},
}) => {
  const { t } = useLang();
  const isAdmin   = currentUser?.role === 'admin';
  const isAdvisor = currentUser?.role === 'advisor' || isAdmin;

  const closeDrawer = () => {
    if (setMobileDrawerOpen) setMobileDrawerOpen(false);
  };

  // ── ILP 设置弹窗 ──────────────────────────────────────────────────
  const [ilpModalOpen, setIlpModalOpen] = useState(false);

  // ── 方案重命名状态 ──────────────────────────────────────────────────
  const [editingScenarioId, setEditingScenarioId] = useState(null);
  const [editScenarioName, setEditScenarioName] = useState('');

  // ── 拖拽排序状态 ──────────────────────────────────────────────
  const dragId    = useRef(null);
  const dragOver  = useRef(null);
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragStart = (e, id) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragOver.current) {
      dragOver.current = id;
      setDropTarget(id);
    }
  };

  const handleDragLeave = () => {};

  const handleDrop = async (e, targetId) => {
    e.preventDefault();
    setDropTarget(null);
    const fromId = dragId.current;
    if (!fromId || fromId === targetId) return;

    const newList = [...portfolios];
    const fromIdx = newList.findIndex(p => p.id === fromId);
    const toIdx   = newList.findIndex(p => p.id === targetId);
    newList.splice(fromIdx, 1);
    newList.splice(toIdx, 0, portfolios[fromIdx]);

    setPortfolios(newList);

    try {
      await fetch('/api/portfolios/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids: newList.map(p => p.id) })
      });
    } catch (err) {
      console.error('排序保存失败:', err);
    }

    dragId.current   = null;
    dragOver.current = null;
  };

  const handleDragEnd = () => {
    dragId.current   = null;
    dragOver.current = null;
    setDropTarget(null);
  };

  return (
    <>
      <div
        className={`sidebar-backdrop ${mobileDrawerOpen ? 'open' : ''}`}
        onClick={closeDrawer}
        aria-hidden="true"
      />
      <aside className={`sidebar ${mobileDrawerOpen ? 'drawer-open' : ''}`} aria-label="Primary Navigation">
        <div className="sidebar-header-row">
          <div className="sidebar-logo">
            Portfolio<span>Atelier</span>
          </div>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={closeDrawer}
            aria-label="Close navigation drawer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* ── 主 Tab 切换 ── */}
        <div className="sidebar-mode-tabs">
          <button
            type="button"
            onClick={() => { setActiveTab('portfolios'); }}
            className={`sidebar-mode-btn ${activeTab === 'portfolios' ? 'active' : ''}`}
          >
            <Briefcase size={14} aria-hidden="true" /> {t('sidebar.portfolios')}
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('lab'); }}
            className={`sidebar-mode-btn ${activeTab === 'lab' ? 'active' : ''}`}
          >
            <Activity size={14} aria-hidden="true" /> {t('sidebar.lab')}
          </button>
        </div>

        {/* ── 角色专属入口 ── */}
        {(isAdmin || isAdvisor) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {isAdvisor && (
              <button
                type="button"
                onClick={() => { setActiveTab('advisor'); closeDrawer(); }}
                style={roleNavBtnStyle(activeTab === 'advisor', 'var(--info)')}
              >
                <UserCheck size={14} aria-hidden="true" />
                {isAdmin ? t('sidebar.advisorClients') : t('sidebar.myClients')}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => { setActiveTab('admin'); closeDrawer(); }}
                style={roleNavBtnStyle(activeTab === 'admin', 'var(--accent-secondary)')}
              >
                <Users size={14} aria-hidden="true" />
                {t('sidebar.userMgmt')}
              </button>
            )}
          </div>
        )}

        {/* ── 组合列表（支持拖拽排序）── */}
        <nav
          className="portfolio-list"
          style={{ display: activeTab === 'portfolios' ? 'flex' : 'none', flexDirection: 'column', gap: 6 }}
          aria-label="Portfolios"
        >
          <div className="stat-label" style={{ marginBottom: '4px', fontSize: '0.68rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>01 / {t('sidebar.myPortfolios')}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem', fontWeight: 400 }}>
              {t('sidebar.draggable')}
            </span>
          </div>

          {portfolios.map(pf => {
            const isDropTarget = dropTarget === pf.id;
            return (
              <div
                key={pf.id}
                draggable
                onDragStart={(e) => handleDragStart(e, pf.id)}
                onDragOver={(e) => handleDragOver(e, pf.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, pf.id)}
                onDragEnd={handleDragEnd}
                className={`portfolio-item ${activeId === pf.id ? 'active' : ''}`}
                onClick={() => { setActiveId(pf.id); setActiveTab('portfolios'); closeDrawer(); }}
                style={{
                  outline: isDropTarget ? '2px solid var(--accent-color)' : 'none',
                  transition: 'outline 0.1s, border-color 0.18s, background-color 0.18s',
                  cursor: 'grab',
                }}
              >
                <div
                  style={{
                    display: 'flex', alignItems: 'center',
                    color: 'var(--text-muted)',
                    marginRight: 4, flexShrink: 0,
                    cursor: 'grab',
                  }}
                  title={t('sidebar.dragTitle')}
                >
                  <GripVertical size={13} aria-hidden="true" />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pf.name}
                  </div>
                  <div className="date">{pf.dividend_strategy} Strategy</div>
                </div>

                <div className="actions">
                  {canEditPortfolio && canEditPortfolio(pf) && (
                    <button
                      type="button"
                      aria-label={`Delete ${pf.name}`}
                      className="action-icon"
                      style={{ background: 'transparent', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minBlockSize: '28px', minInlineSize: '28px' }}
                      onClick={(e) => { e.stopPropagation(); setDeleteCandidate(pf.id); setShowDeleteModal(true); }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </nav>

        {/* ── 组合操作按钮 ── */}
        {activeTab === 'portfolios' && (
          <button
            type="button"
            className="create-btn"
            style={{ width: '100%', marginTop: '4px' }}
            onClick={() => { setShowModal(true); closeDrawer(); }}
          >
            <Plus size={16} aria-hidden="true" /> {t('sidebar.newStrategy')}
          </button>
        )}

        {/* ── 策略实验室：历史方案 ── */}
        {activeTab === 'lab' && (
          <nav className="scenarios-list" style={{ display: 'block', marginTop: '4px' }} aria-label="Saved Scenarios">
            <div className="stat-label" style={{ marginBottom: '10px', fontSize: '0.68rem' }}>
              02 / {t('sidebar.savedScenarios')}
            </div>
            {savedScenarios.length === 0 ? (
              <div style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                padding: '28px 12px',
                border: '1px dashed var(--border-subtle)',
                borderRadius: 'var(--card-radius)',
                background: 'var(--surface-card)',
              }}>
                <div style={{ fontSize: '0.78rem' }}>{t('sidebar.noScenarios')}</div>
              </div>
            ) : savedScenarios.map(sc => (
              <div
                key={sc.id}
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--card-radius)',
                  padding: '12px',
                  marginBottom: '8px',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background-color 0.2s',
                  position: 'relative',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                onClick={() => { handleLoadScenario(sc.id); closeDrawer(); }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  {editingScenarioId === sc.id ? (
                    <div style={{ flex: 1, display: 'flex', gap: '4px', marginRight: '24px' }}>
                      <input
                        autoFocus
                        value={editScenarioName}
                        onChange={e => setEditScenarioName(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.stopPropagation();
                            if (editScenarioName.trim()) {
                              handleRenameScenario(sc.id, editScenarioName);
                            }
                            setEditingScenarioId(null);
                          }
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEditingScenarioId(null);
                          }
                        }}
                        style={{
                          flex: 1, width: '100%',
                          background: 'var(--surface-subtle)',
                          border: '1px solid var(--accent-color)',
                          color: 'var(--text-primary)',
                          borderRadius: '4px', padding: '2px 6px', fontSize: '0.84rem',
                        }}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (editScenarioName.trim()) {
                            handleRenameScenario(sc.id, editScenarioName);
                          }
                          setEditingScenarioId(null);
                        }}
                        style={{
                          background: 'var(--accent-color)', border: 'none',
                          borderRadius: '4px', color: '#fff', cursor: 'pointer', padding: '0 8px',
                        }}
                      >✓</button>
                    </div>
                  ) : (
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent-color)', paddingRight: '46px', lineHeight: 1.3 }}>
                      {sc.name}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {sc.created_at ? new Date(sc.created_at).toLocaleDateString(t === undefined || t('header.langBtn') === 'EN' ? 'zh-CN' : 'en-US') : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {(Array.isArray(sc.assets) ? sc.assets : []).map(a => (
                    <span
                      key={a}
                      style={{
                        background: 'var(--surface-subtle)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontSize: '0.66rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                      }}
                    >
                      {a}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>{t('sidebar.capital')}: </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${((parseFloat(sc.summary?.capital) || 0)/1000).toFixed(0)}k</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>{t('sidebar.annualDraw')}: </span>
                    <span style={{ color: 'var(--accent-secondary)', fontWeight: 600 }}>${((parseFloat(sc.summary?.withdrawal) || 0)/1000).toFixed(0)}k</span>
                  </div>
                </div>
                <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    aria-label={t('sidebar.renameTitle')}
                    onClick={(e) => { e.stopPropagation(); setEditScenarioName(sc.name); setEditingScenarioId(sc.id); }}
                    style={{
                      background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)',
                      borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer',
                      padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '22px', height: '22px', minBlockSize: '22px', minInlineSize: '22px',
                    }}
                    title={t('sidebar.renameTitle')}
                  >
                    <span style={{ fontSize: '11px', lineHeight: 1 }}>✎</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('sidebar.deleteTitle')}
                    onClick={(e) => { e.stopPropagation(); handleDeleteScenario(sc.id); }}
                    style={{
                      background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)',
                      borderRadius: '4px', color: 'var(--danger)', cursor: 'pointer',
                      padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '22px', height: '22px', minBlockSize: '22px', minInlineSize: '22px',
                    }}
                    title={t('sidebar.deleteTitle')}
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </nav>
        )}

        {/* ── 底部按钮组（操作手册 + ILP 设置）── */}
        {currentUser && (
          <div style={{
            position: 'sticky', bottom: 0,
            paddingTop: '12px', paddingBottom: '4px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', gap: '6px',
            background: 'var(--sidebar-bg)',
            marginTop: 'auto',
          }}>
            <button
              type="button"
              onClick={() => { setActiveTab('help'); closeDrawer(); }}
              style={{
                width: '100%', padding: '9px 12px',
                background: activeTab === 'help' ? 'rgba(var(--accent-color-rgb), 0.1)' : 'var(--surface-card)',
                border: `1px solid ${activeTab === 'help' ? 'var(--accent-color)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--card-radius)',
                color: activeTab === 'help' ? 'var(--accent-color)' : 'var(--text-secondary)',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: activeTab === 'help' ? 700 : 500,
                display: 'flex', alignItems: 'center', gap: '8px',
                transition: 'all 0.18s',
              }}
            >
              <BookOpen size={14} aria-hidden="true" />
              <span>{t('sidebar.helpManual')}</span>
            </button>
            <button
              type="button"
              onClick={() => { setIlpModalOpen(true); closeDrawer(); }}
              style={{
                width: '100%', padding: '9px 12px',
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--card-radius)',
                color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: '8px',
                transition: 'all 0.18s',
              }}
            >
              <Link size={14} aria-hidden="true" />
              <span>{t('sidebar.ilpSettings')}</span>
            </button>
          </div>
        )}

        {/* ILP 设置弹窗 */}
        <ILPSettingsModal
          open={ilpModalOpen}
          onClose={() => setIlpModalOpen(false)}
          onSaved={(cfg) => {
            onIlpSaved && onIlpSaved(cfg);
          }}
          isAdvisorMode={false}
        />
      </aside>
    </>
  );
};

const roleNavBtnStyle = (active, accentVar) => ({
  width: '100%', padding: '9px 12px',
  background: active ? 'rgba(var(--accent-color-rgb), 0.1)' : 'var(--surface-card)',
  border: `1px solid ${active ? accentVar : 'var(--border-subtle)'}`,
  borderRadius: 'var(--card-radius)',
  color: active ? accentVar : 'var(--text-secondary)',
  cursor: 'pointer', fontSize: '0.82rem', fontWeight: active ? 700 : 500,
  display: 'flex', alignItems: 'center', gap: 8,
  transition: 'all 0.18s',
});

export default Sidebar;
