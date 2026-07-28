
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/urbanist/300.css';
import '@fontsource/urbanist/400.css';
import '@fontsource/urbanist/500.css';
import '@fontsource/urbanist/600.css';
import '@fontsource/urbanist/700.css';
import './index.css';
import './styles/flat-experimental.css';
import { detectDeviceMode } from './pwa/deviceMode';
import { installPageZoomGuard, installPhoneZoomGuard } from './pwa/pageZoomGuard';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}

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


  const mode = detectDeviceMode();
  document.documentElement.classList.toggle('bambook-device-phone', mode === 'phone');
  document.body.classList.toggle('bambook-device-phone', mode === 'phone');
  installPageZoomGuard();
  if (mode === 'phone') {
    installPhoneZoomGuard();
  }
  const module = mode === 'phone'
    ? await import('./pwa/mobile/MobileWebApp')
    : await import('./App');
  const RootApp = module.default;

  root.render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>
  );
}

boot();
