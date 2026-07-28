import React, { Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/flat-experimental.css';

const UI_LAB_THEME_KEY = 'bambook_panda_lab_theme';

const PandaLab = React.lazy(async () => {
  return import('./components/mascot/PandaLab');
});

const DevPandaLabApp: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(UI_LAB_THEME_KEY) === 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.body.className = isDarkMode ? 'bg-[#071321] text-white' : 'bg-[#E8EEF5] text-slate-950';
    try {
      localStorage.setItem(UI_LAB_THEME_KEY, isDarkMode ? 'dark' : 'light');
      localStorage.setItem('theme_preference', isDarkMode ? 'dark' : 'light');
    } catch {
      // Dev-only convenience
    }
  }, [isDarkMode]);

  return (
    <Suspense fallback={<div className="p-8">Panda Sandbox loading...</div>}>
      <PandaLab
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(value => !value)}
      />
    </Suspense>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount dev panda lab');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <DevPandaLabApp />
  </React.StrictMode>,
);
