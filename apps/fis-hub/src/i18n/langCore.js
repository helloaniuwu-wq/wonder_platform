import { createContext, useContext } from 'react';

/** 语言 context 与 useLang（与 Provider 组件分离，保证 LangContext.jsx 只导出组件以支持热更新）。 */

export const LangContext = createContext(null);

/**
 * useLang() — 在任意组件中使用
 * const { lang, t, toggleLang } = useLang();
 */
export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}
