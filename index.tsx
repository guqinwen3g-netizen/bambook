
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/urbanist/300.css';
import '@fontsource/urbanist/400.css';
import '@fontsource/urbanist/500.css';
import '@fontsource/urbanist/600.css';
import '@fontsource/urbanist/700.css';
import './index.css';
import './styles/flat-experimental.css';
import { installPageZoomGuard } from './pwa/pageZoomGuard';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

async function boot() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('bambookAgentPet') === '1') {
    const module = await import('./components/AgentPetWindow');
    const AgentPetWindow = module.default;
    root.render(
      <React.StrictMode>
        <AgentPetWindow />
      </React.StrictMode>
    );
    return;
  }


  try {
    installPageZoomGuard();
  } catch (err) {
    console.error('[boot] zoom guard install failed:', err);
  }
  const module = await import('./App');
  const RootApp = module.default;

  root.render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>
  );
}

boot().catch((err) => {
  console.error('[boot] fatal:', err);
  if (rootElement) {
    rootElement.innerHTML = '<div style="padding:2rem;font-family:system-ui;color:#333">应用启动失败，请刷新页面或检查网络连接。<br/><pre style="margin-top:1rem;font-size:12px;white-space:pre-wrap;color:#999"></pre></div>';
    const pre = rootElement.querySelector('pre');
    if (pre) pre.textContent = String(err?.message || err);
  }
});
