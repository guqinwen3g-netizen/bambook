import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Electron window controls', () => {
  it('keeps the native window minimum aligned with the desktop OS layout contract', () => {
    const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

    expect(mainSource).toContain('export const BAMBOOK_OS_WINDOW_MIN_WIDTH = 1080');
    expect(mainSource).toContain('export const BAMBOOK_OS_WINDOW_MIN_HEIGHT = 760');
    expect(mainSource).toContain('minWidth: BAMBOOK_OS_WINDOW_MIN_WIDTH');
    expect(mainSource).toContain('minHeight: BAMBOOK_OS_WINDOW_MIN_HEIGHT');
    expect(css).toContain('--desktop-min-width: 1080px');
    expect(css).toContain('--desktop-min-height: 760px');
    expect(css).not.toContain('bambook-device-phone');
    expect(css).toContain('min-width: var(--desktop-min-width)');
    expect(css).toContain('min-height: var(--desktop-min-height)');
    expect(css).toContain('height: max(100vh, var(--desktop-min-height))');
  });

  it('keeps macOS traffic lights available while the window is fullscreen', () => {
    const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const enterFullScreenSource = mainSource.slice(
      mainSource.indexOf("mainWindow.on('enter-full-screen'"),
      mainSource.indexOf("mainWindow.on('leave-full-screen'")
    );
    const leaveFullScreenSource = mainSource.slice(
      mainSource.indexOf("mainWindow.on('leave-full-screen'"),
      mainSource.indexOf("mainWindow.once('ready-to-show'")
    );
    const controlsSource = readFileSync(new URL('./WindowControls.tsx', import.meta.url), 'utf8');

    expect(mainSource).toContain('mainWindow.setWindowButtonVisibility(mainWindow.isFullScreen() ? true : Boolean(visible))');
    expect(enterFullScreenSource).toContain('if (isMac) mainWindow?.setWindowButtonVisibility(true)');
    expect(leaveFullScreenSource).toContain('if (isMac) mainWindow?.setWindowButtonVisibility(false)');
    expect(controlsSource).toContain('!isFullScreen ? (');
    expect(controlsSource).toContain('main owns visibility there');
  });

  it('locks renderer zoom so trackpad pinch cannot scale the whole app', () => {
    const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(mainSource).toContain('function lockRendererZoom(window: BrowserWindow)');
    expect(mainSource).toContain('window.webContents.setZoomFactor(1)');
    expect(mainSource).toContain('window.webContents.setVisualZoomLevelLimits(1, 1)');
    expect(mainSource).toContain("window.webContents.on('before-input-event'");
    expect(mainSource).toContain("['+', '=', '-', '_', '0'].includes(key)");
    expect(mainSource).toContain('lockRendererZoom(mainWindow)');
  });

  it('can launch the Panda Lab as a separate dev preview with its own page', () => {
    const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pandaLabHtml = readFileSync(new URL('../dev-panda-lab.html', import.meta.url), 'utf8');
    const pandaLabEntry = readFileSync(new URL('../dev-panda-lab.tsx', import.meta.url), 'utf8');

    // A dedicated dev script serves the Panda Lab preview on its own port.
    expect(packageSource).toContain('"dev:panda-lab"');
    expect(packageSource).toContain('--port 3105');
    expect(packageSource).toContain('--open /dev-panda-lab.html');
    // Its own HTML page (not the main app entry).
    expect(pandaLabHtml).toContain('<title>Bambook Panda Sandbox</title>');
    expect(pandaLabHtml).toContain('src="/dev-panda-lab.tsx"');
    // Its own entry mounts the Panda mascot tuning studio.
    expect(pandaLabEntry).toContain("import './styles/flat-experimental.css'");
    expect(pandaLabEntry).toContain("import('./components/mascot/PandaLab')");
    expect(pandaLabEntry).toContain('<PandaLab');
  });

  it('keeps the main Electron dev launcher from killing the UI Lab dev window', () => {
    const electronStack = readFileSync(new URL('../scripts/electron-stack.sh', import.meta.url), 'utf8');

    expect(electronStack).toContain('UI Lab Electron dev 固定走 :3100');
    expect(electronStack).not.toContain('pkill -f "apps/Bambook/node_modules/electron/dist/Electron.app"');
    expect(electronStack).not.toContain('pkill -f "electron-vite/bin/electron-vite.js"');
    expect(electronStack).toContain('for port in 8081 3000; do');
    expect(electronStack).not.toContain('3001 3002');
    expect(electronStack).not.toContain('for port in 8081 3000 3100');
  });
});
