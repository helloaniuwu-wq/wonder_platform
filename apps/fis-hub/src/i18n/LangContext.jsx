/**
 * LangContext — 全局语言状态管理
 * Global language state via React Context
 *
 * 默认语言：中文（zh）
 * 支持：zh / en
 * 持久化：localStorage key = 'ww_lang'
 */

import React, { useState, useCallback } from 'react';
import translations from './translations';
import { LangContext } from './langCore';

/**
 * Provider — 包裹 App 根节点
 */
export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem('ww_lang');
      return saved === 'en' ? 'en' : 'zh'; // 默认中文
    } catch {
      return 'zh';
    }
  });

  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem('ww_lang', l); } catch { /* 隐私模式下忽略 */ }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  }, [lang, setLang]);

  /**
   * t(key) — 取翻译文本
   * key 格式：'section.key'，例如 'header.logout'
   * 支持嵌套，如 'compliance.title'
   */
  const t = useCallback((key) => {
    const parts = key.split('.');
    let result = translations[lang];
    for (const part of parts) {
      if (result == null) return key;
      result = result[part];
    }
    return result ?? key;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LangContext.Provider>
  );
}
