import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { LangProvider } from './i18n/LangContext.jsx'
import { ThemeProvider } from './theme/ThemeContext.jsx'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
if (API_BASE) {
  const originalFetch = window.fetch;
  window.fetch = (url, options) => {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      url = `${API_BASE}${url}`;
    }
    return originalFetch(url, options);
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <LangProvider>
        <App />
      </LangProvider>
    </ThemeProvider>
  </StrictMode>,
)
