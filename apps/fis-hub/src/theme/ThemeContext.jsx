import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * 主题管理 — Nordic Gallery Minimal (日间画廊) & Atelier Obsidian (暗夜黑金)
 *
 * 采用 CSS 变量 + data-theme 属性双驱动，零业务逻辑侵入。
 */

export const THEMES = {
  gallery: {
    id: 'gallery',
    mode: 'light',
    label: '🏛 画廊日间',
    labelEn: '🏛 Gallery Light',
    vars: {
      '--bg-canvas': '#F6F4EE',
      '--bg-gradient': 'linear-gradient(180deg, #F8F6F1 0%, #F2EFE7 100%)',
      '--surface-card': '#FCFBF8',
      '--surface-subtle': '#EFECE4',
      '--surface-elevated': '#FFFFFF',
      '--surface-inset': '#EAE6DC',
      '--glass-bg': '#FCFBF8',
      '--glass-border': '#DFDBD2',
      '--border-subtle': '#DFDBD2',
      '--border-strong': '#C5BEB0',
      '--accent-color': '#1E4D3B',
      '--accent-color-rgb': '30, 77, 59',
      '--accent-secondary': '#9A6F38',
      '--accent-secondary-rgb': '154, 111, 56',
      '--text-primary': '#141413',
      '--text-secondary': '#57534E',
      '--text-muted': '#8A847C',
      '--success': '#166534',
      '--success-bg': 'rgba(22, 101, 52, 0.08)',
      '--danger': '#991B1B',
      '--danger-bg': 'rgba(153, 27, 27, 0.08)',
      '--warning': '#9A5B13',
      '--warning-bg': 'rgba(154, 91, 19, 0.08)',
      '--info': '#1E4E79',
      '--info-bg': 'rgba(30, 78, 121, 0.08)',
      '--stat-gradient': 'linear-gradient(135deg, #141413 0%, #1E4D3B 100%)',
      '--sidebar-bg': '#F3F0E8',
      '--header-bg': 'rgba(246, 244, 238, 0.92)',
      '--card-blur': 'none',
      '--card-radius': '6px',
      '--card-shadow': '0 1px 2px rgba(20, 20, 19, 0.04), 0 8px 24px -12px rgba(20, 20, 19, 0.06)',
      '--sidebar-blur': 'none',
      '--chart-grid': 'rgba(20, 20, 19, 0.07)',
      '--chart-axis': '#78736A',
      '--tooltip-bg': 'rgba(252, 251, 248, 0.98)',
      '--tooltip-border': '#D5CFC3',
      '--tooltip-text': '#141413',
    },
  },
  obsidian: {
    id: 'obsidian',
    mode: 'dark',
    label: '🌙 暗夜黑金',
    labelEn: '🌙 Atelier Dark',
    vars: {
      '--bg-canvas': '#0E1013',
      '--bg-gradient': 'linear-gradient(180deg, #0E1013 0%, #13161B 100%)',
      '--surface-card': '#15181E',
      '--surface-subtle': '#1C2027',
      '--surface-elevated': '#1E222B',
      '--surface-inset': '#101216',
      '--glass-bg': '#15181E',
      '--glass-border': 'rgba(255, 255, 255, 0.08)',
      '--border-subtle': 'rgba(255, 255, 255, 0.08)',
      '--border-strong': 'rgba(197, 160, 89, 0.32)',
      '--accent-color': '#C5A059',
      '--accent-color-rgb': '197, 160, 89',
      '--accent-secondary': '#2E8B6E',
      '--accent-secondary-rgb': '46, 139, 110',
      '--text-primary': '#F3F0E8',
      '--text-secondary': '#A39E93',
      '--text-muted': '#6E6A61',
      '--success': '#34D399',
      '--success-bg': 'rgba(52, 211, 153, 0.1)',
      '--danger': '#F87171',
      '--danger-bg': 'rgba(248, 113, 113, 0.1)',
      '--warning': '#FBBF24',
      '--warning-bg': 'rgba(251, 191, 36, 0.1)',
      '--info': '#60A5FA',
      '--info-bg': 'rgba(96, 165, 250, 0.1)',
      '--stat-gradient': 'linear-gradient(135deg, #F3F0E8 0%, #C5A059 100%)',
      '--sidebar-bg': '#111318',
      '--header-bg': 'rgba(14, 16, 19, 0.90)',
      '--card-blur': 'none',
      '--card-radius': '6px',
      '--card-shadow': '0 4px 20px rgba(0, 0, 0, 0.45)',
      '--sidebar-blur': 'none',
      '--chart-grid': 'rgba(255, 255, 255, 0.06)',
      '--chart-axis': '#8A847C',
      '--tooltip-bg': 'rgba(21, 24, 30, 0.98)',
      '--tooltip-border': 'rgba(197, 160, 89, 0.3)',
      '--tooltip-text': '#F3F0E8',
    },
  },
};

const ThemeContext = createContext();

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
    try {
      localStorage.setItem('fis-theme', theme.id);
    } catch {}
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

export const useTheme = () => useContext(ThemeContext);
