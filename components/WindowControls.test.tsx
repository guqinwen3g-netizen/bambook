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
    expect(css).toContain('body:not(.bambook-device-phone)');
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

  it('can launch UI Lab as a separate Electron preview with its own page and icon', () => {
    const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const electronViteSource = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8');
    const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const uiLabHtml = readFileSync(new URL('../dev-ui-lab.html', import.meta.url), 'utf8');
    const uiLabEntry = readFileSync(new URL('../dev-ui-lab.tsx', import.meta.url), 'utf8');
    const uiLabCommand = readFileSync(new URL('../Bambook-UI Lab Electron.command', import.meta.url), 'utf8');

    expect(mainSource).toContain("export const BAMBOOK_UI_LAB_ELECTRON_FLAG = 'BAMBOOK_ELECTRON_UI_LAB'");
    expect(mainSource).toContain("export const BAMBOOK_UI_LAB_ICON_PATH = path.resolve(__dirname, '../../build/ui-lab-icon.png')");
    expect(mainSource).toContain("export const BAMBOOK_UI_LAB_TITLE = 'Bambook UI Lab'");
    expect(mainSource).toContain("export const BAMBOOK_UI_LAB_USER_DATA_DIR = 'bambook-ui-lab'");
    expect(mainSource).toContain("app.setPath('userData', path.join(app.getPath('appData'), BAMBOOK_UI_LAB_USER_DATA_DIR))");
    expect(mainSource).toContain('app.dock?.setIcon(BAMBOOK_UI_LAB_ICON_PATH)');
    expect(mainSource).toContain("new URL('/dev-ui-lab.html', devUrl).toString()");
    expect(mainSource).toContain("isUiLabElectron ? '../renderer/dev-ui-lab.html' : '../renderer/index.html'");
    expect(electronViteSource).toContain("const BAMBOOK_ELECTRON_RENDERER_PORT = 3000");
    expect(electronViteSource).toContain("const BAMBOOK_UI_LAB_ELECTRON_RENDERER_PORT = 3100");
    expect(electronViteSource).toContain("process.env[BAMBOOK_UI_LAB_ELECTRON_FLAG] === '1'");
    expect(electronViteSource).toContain('port: rendererPort');
    expect(electronViteSource).toContain('strictPort: true');
    expect(electronViteSource).toContain("uiLab: path.resolve(__dirname, 'dev-ui-lab.html')");
    expect(packageSource).toContain('"electron:ui-lab": "env -u ELECTRON_RUN_AS_NODE BAMBOOK_ELECTRON_UI_LAB=1 electron-vite dev"');
    expect(packageSource).toContain('"electron:ui-lab:preview": "env -u ELECTRON_RUN_AS_NODE BAMBOOK_ELECTRON_UI_LAB=1 electron-vite build && env -u ELECTRON_RUN_AS_NODE BAMBOOK_ELECTRON_UI_LAB=1 electron-vite preview"');
    expect(uiLabHtml).toContain('<link rel="icon" href="/ui-lab-icon.svg" type="image/svg+xml">');
    expect(uiLabEntry).toContain("import WindowControls from './components/WindowControls'");
    expect(uiLabEntry).toContain('<WindowControls />');
    expect(uiLabCommand).toContain('exec npm run electron:ui-lab');
    expect(uiLabCommand).not.toContain('electron:ui-lab:preview');
    expect(uiLabCommand).not.toContain('scripts/electron-preview.sh');
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
