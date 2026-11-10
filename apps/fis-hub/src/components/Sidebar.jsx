import React, { useState, useRef } from 'react';
import { Briefcase, Activity, Plus, Trash2, Users, UserCheck, GripVertical, Link, BookOpen } from 'lucide-react';
import ILPSettingsModal from './ILPSettingsModal';
import { useLang } from '../i18n/LangContext';

/**
 * Sidebar component — tabs, portfolio list (with drag-to-reorder), actions, scenarios drawer, and role-aware nav.
 */
const Sidebar = ({
  activeTab, setActiveTab,
  portfolios, setPortfolios, activeId, setActiveId,
  setShowModal,
  setDeleteCandidate, setShowDeleteModal,
  savedScenarios, handleLoadScenario, handleDeleteScenario, handleRenameScenario,
  currentUser, canEditPortfolio,
  onIlpSaved,
}) => {
  const { t } = useLang();
  const isAdmin   = currentUser?.role === 'admin';
  const isAdvisor = currentUser?.role === 'advisor' || isAdmin;

  // ── ILP 设置弹窗 ──────────────────────────────────────────────────
  const [ilpModalOpen, setIlpModalOpen] = useState(false);

  // ── 方案重命名状态 ──────────────────────────────────────────────────
  const [editingScenarioId, setEditingScenarioId] = useState(null);
  const [editScenarioName, setEditScenarioName] = useState('');

  // ── 拖拽排序状态 ──────────────────────────────────────────────
  const dragId    = useRef(null);   // 正在拖动的组合 id
  const dragOver  = useRef(null);   // 当前悬停目标 id
  const [dropTarget, setDropTarget] = useState(null); // 用于高亮插入线

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

  const handleDragLeave = () => {
    // 不立即清除，避免子元素触发 leave
  };

  const handleDrop = async (e, targetId) => {
    e.preventDefault();
    setDropTarget(null);
    const fromId = dragId.current;
    if (!fromId || fromId === targetId) return;

    // 重新排序本地列表
    const newList = [...portfolios];
    const fromIdx = newList.findIndex(p => p.id === fromId);
    const toIdx   = newList.findIndex(p => p.id === targetId);
    newList.splice(fromIdx, 1);
    newList.splice(toIdx, 0, portfolios[fromIdx]);

    // 立即更新 UI
    setPortfolios(newList);

    // 持久化到后端
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
    <aside className="sidebar">
      <div className="sidebar-logo">Portfolio<span style={{fontWeight:300}}>Hub</span></div>

      {/* ── 主 Tab 切换 ── */}
      <div style={{display: 'flex', gap: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px'}}>
        <button
          onClick={() => setActiveTab('portfolios')}
          style={tabBtnStyle(activeTab === 'portfolios')}
        >
          <Briefcase size={14} /> {t('sidebar.portfolios')}
        </button>
        <button
          onClick={() => setActiveTab('lab')}
          style={tabBtnStyle(activeTab === 'lab')}
        >
          <Activity size={14} /> {t('sidebar.lab')}
        </button>
      </div>

      {/* ── 角色专属入口 ── */}
      {(isAdmin || isAdvisor) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {isAdvisor && (
            <button
              onClick={() => setActiveTab('advisor')}
              style={roleNavBtnStyle(activeTab === 'advisor', '#3b82f6')}
            >
              <UserCheck size={14} />
              {isAdmin ? t('sidebar.advisorClients') : t('sidebar.myClients')}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              style={roleNavBtnStyle(activeTab === 'admin', '#ef4444')}
            >
              <Users size={14} />
              {t('sidebar.userMgmt')}
            </button>
          )}
        </div>
      )}

      {/* ── 组合列表（支持拖拽排序）── */}
      <nav className="portfolio-list" style={{display: activeTab === 'portfolios' ? 'flex' : 'none', flexDirection: 'column', gap: 6}}>
        <div className="stat-label" style={{marginBottom: '4px', fontSize: '0.7rem'}}>
          {t('sidebar.myPortfolios')}
          <span style={{ marginLeft: 6, color: 'rgba(255,255,255,0.25)', fontSize: '0.62rem', fontWeight: 400 }}>
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
              onClick={() => {setActiveId(pf.id); setActiveTab('portfolios');}}
              style={{
                position: 'relative',
                outline: isDropTarget ? '2px solid rgba(var(--accent-color-rgb),0.8)' : 'none',
                transition: 'outline 0.1s',
                cursor: 'grab',
              }}
            >
              {/* 拖拽手柄 */}
              <div
                style={{
                  display: 'flex', alignItems: 'center',
                  color: 'rgba(255,255,255,0.2)',
                  marginRight: 6, flexShrink: 0,
                  cursor: 'grab',
                }}
                title={t('sidebar.dragTitle')}
              >
                <GripVertical size={13} />
              </div>

              <div style={{flex: 1, minWidth: 0}}>
                <div className="name" style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                  {pf.name}
                </div>
                <div className="date">{pf.dividend_strategy} Strategy</div>
              </div>

              <div className="actions">
                {canEditPortfolio && canEditPortfolio(pf) && (
                  <Trash2 size={14} className="action-icon" onClick={(e) => { e.stopPropagation(); setDeleteCandidate(pf.id); setShowDeleteModal(true); }} />
                )}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── 组合操作按钮 ── */}
      {activeTab === 'portfolios' && (
        <>
          <button className="create-btn" onClick={() => setShowModal(true)}>
            <Plus size={18} /> {t('sidebar.newStrategy')}
          </button>
        </>
      )}

      {/* ── 策略实验室：历史方案 ── */}
      {activeTab === 'lab' && (
        <nav className="scenarios-list" style={{display: 'block', marginTop: '6px'}}>
          <div className="stat-label" style={{marginBottom: '8px', fontSize: '0.75rem', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.7)'}}>{t('sidebar.savedScenarios')}</div>
          {savedScenarios.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '30px 0' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📭</div>
              <div style={{ fontSize: '0.75rem' }}>{t('sidebar.noScenarios')}</div>
            </div>
          ) : savedScenarios.map(sc => (
            <div key={sc.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px', marginBottom: '10px', cursor: 'pointer', transition: 'border-color 0.2s', position: 'relative' }}
                 onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)'}
                 onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                 onClick={() => handleLoadScenario(sc.id)}>
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
                      style={{ flex: 1, width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid #10b981', color: '#fff', borderRadius: '4px', padding: '2px 4px', fontSize: '0.85rem' }}
                    />
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editScenarioName.trim()) {
                          handleRenameScenario(sc.id, editScenarioName);
                        }
                        setEditingScenarioId(null);
                      }}
                      style={{ background: '#10b981', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', padding: '0 6px' }}
                    >✓</button>
                  </div>
                ) : (
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#10b981', paddingRight: '40px', lineHeight: 1.2 }}>{sc.name}</div>
                )}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}>{new Date(sc.created_at).toLocaleDateString(t === undefined || t('header.langBtn') === 'EN' ? 'zh-CN' : 'en-US')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {sc.assets.map(a => <span key={a} style={{ background: 'rgba(var(--accent-color-rgb),0.12)', color: 'var(--accent-color)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600 }}>{a}</span>)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                <div><span style={{color: 'rgba(255,255,255,0.4)'}}>{t('sidebar.capital')}: </span><span>${(sc.summary.capital/1000).toFixed(0)}k</span></div>
                <div><span style={{color: 'rgba(255,255,255,0.4)'}}>{t('sidebar.annualDraw')}: </span><span style={{color: '#f59e0b'}}>${((sc.summary.withdrawal||0)/1000).toFixed(0)}k</span></div>
              </div>
              <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '4px' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditScenarioName(sc.name); setEditingScenarioId(sc.id); }}
                  style={{ background: 'rgba(0,0,0,0.2)', border: 'none', borderRadius: '6px', color: 'rgba(16,185,129,0.6)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px' }}
                  title={t('sidebar.renameTitle')}>
                  <span style={{ fontSize: '12px', lineHeight: 1 }}>✎</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteScenario(sc.id); }}
                  style={{ background: 'rgba(0,0,0,0.2)', border: 'none', borderRadius: '6px', color: 'rgba(244,63,94,0.6)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px' }}
                  title={t('sidebar.deleteTitle')}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </nav>
      )}
      {/* ── 底部按钮组（操作手册 + ILP 设置）── */}
      {currentUser && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: '12px', paddingBottom: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--header-bg)', backdropFilter: 'blur(10px)', marginTop: 'auto' }}>
          <button
            onClick={() => setActiveTab('help')}
            style={{
              width: '100%', padding: '9px 12px',
              background: activeTab === 'help' ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.06)',
              border: `1px solid ${activeTab === 'help' ? 'rgba(16,185,129,0.4)' : 'rgba(16,185,129,0.12)'}`,
              borderRadius: '9px', color: activeTab === 'help' ? '#34d399' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: activeTab === 'help' ? 700 : 500,
              display: 'flex', alignItems: 'center', gap: '7px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { if (activeTab !== 'help') { e.currentTarget.style.background = 'rgba(16,185,129,0.12)'; e.currentTarget.style.color = '#34d399'; }}}
            onMouseLeave={e => { if (activeTab !== 'help') { e.currentTarget.style.background = 'rgba(16,185,129,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}}
          >
            <BookOpen size={13} />
            <span>{t('sidebar.helpManual')}</span>
          </button>
          <button
            onClick={() => setIlpModalOpen(true)}
            style={{
              width: '100%', padding: '9px 12px',
              background: 'rgba(var(--accent-color-rgb),0.06)',
              border: '1px solid rgba(var(--accent-color-rgb),0.15)',
              borderRadius: '9px', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: '7px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--accent-color-rgb),0.15)'; e.currentTarget.style.color = 'var(--accent-color)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--accent-color-rgb),0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          >
            <Link size={13} />
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
  );
};

// ── Styles ──
const tabBtnStyle = (active) => ({
  flex: 1, padding: '8px',
  background: active ? 'rgba(var(--accent-color-rgb),0.2)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--accent-color)' : 'transparent'),
  borderRadius: '6px',
  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  fontSize: '0.82rem',
});

const roleNavBtnStyle = (active, accentColor) => ({
  width: '100%', padding: '9px 12px',
  background: active ? `${accentColor}20` : 'rgba(255,255,255,0.04)',
  border: `1px solid ${active ? accentColor + '60' : 'rgba(255,255,255,0.08)'}`,
  borderRadius: 9, color: active ? '#fff' : 'rgba(255,255,255,0.6)',
  cursor: 'pointer', fontSize: '0.82rem', fontWeight: active ? 700 : 400,
  display: 'flex', alignItems: 'center', gap: 8,
  transition: 'all 0.2s',
});

export default Sidebar;
