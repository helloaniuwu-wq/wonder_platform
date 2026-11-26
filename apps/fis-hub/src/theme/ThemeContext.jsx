import React, { useState, useEffect } from 'react';
import { THEMES, ThemeContext } from './themeCore';

/**
 * 主题管理 — Nordic Gallery Minimal (日间画廊) & Atelier Obsidian (暗夜黑金)
 *
 * 采用 CSS 变量 + data-theme 属性双驱动，零业务逻辑侵入。
 */

export const ThemeProvider = ({ children }) => {
  const [themeId, setThemeId] = useState(() => {
    try {
      const saved = localStorage.getItem('fis-theme');
      return saved && THEMES[saved] ? saved : 'gallery';
    } catch {
      return 'gallery';
    }
  });

  useEffect(() => {
    const theme = THEMES[themeId] || THEMES.gallery;
    const root = document.documentElement;
    root.setAttribute('data-theme', theme.id);
    root.style.colorScheme = theme.mode;
    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    const themeMetas = document.querySelectorAll('meta[name="theme-color"]');
    themeMetas.forEach((meta) => {
      meta.setAttribute('content', theme.vars['--bg-canvas'] || '#F6F4EE');
    });
    try {
      localStorage.setItem('fis-theme', theme.id);
    } catch { /* 隐私模式下忽略 */ }
  }, [themeId]);

  const cycleTheme = () => {
    setThemeId((prev) => (prev === 'gallery' ? 'obsidian' : 'gallery'));
  };

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        setThemeId,
        cycleTheme,
        theme: THEMES[themeId] || THEMES.gallery,
        isDark: themeId === 'obsidian',
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
