/// <reference types="vitest" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const uiMode = process.env.VITE_UI_MODE || 'desktop';
  const isUiLabDev = process.env.BAMBOOK_UI_LAB_DEV === '1';
  const port = uiMode === 'mobile' ? 3001 : 3000;

  /** 与 dev 共用；`vite preview` 默认会继承 server.proxy，此处显式写入避免歧义 */
  const proxy = {
    '/api/zhipu': {
      target: 'https://open.bigmodel.cn/api/paas/v4',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/zhipu/, ''),
      secure: false
    },
    '/api/openai': {
      target: 'http://127.0.0.1:8045/v1',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/openai/, ''),
      secure: false
    },
    '/api/searx': {
      target: 'https://searx.be',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/searx/, ''),
      secure: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    },

  } as const;

  // When building for web deployment behind the Cloudflare Tunnel
  // (https://jiangsupanda.com/bambook/app/), assets must be referenced
  // relative to that mount path, not the root. Set BAMBOOK_WEB_DEPLOY=1
  // before `npm run build` to switch to the deployed base path. Electron
  // and dev mode keep the default '/'. Override with BAMBOOK_WEB_BASE if
  // the public path ever changes.
  // /bambook/app/ reuses the existing /bambook Cloudflare Tunnel ingress
  // (no extra Zero Trust public hostname needed; server strips the prefix).
  const webBase = process.env.BAMBOOK_WEB_BASE
    || (process.env.BAMBOOK_WEB_DEPLOY === '1' ? '/bambook/app/' : '/');

  return {
    base: webBase,
    server: {
      port,
      host: '0.0.0.0',
      proxy,
      watch: isUiLabDev
        ? {
            ignored: [
              '**/pwa/**',
              '**/public/sw.js',
              '**/public/manifest.webmanifest',
              '**/public/pwa-icon.svg',
            ],
          }
        : undefined,
    },
    preview: {
      port: 4173,
      host: '0.0.0.0',
      proxy
    },
    plugins: [react()],
    define: {
      'import.meta.env.VITE_UI_MODE': JSON.stringify(uiMode)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    optimizeDeps: {
      entries: ['index.html', 'dev-panda-lab.html'],
      exclude: ['winston']
    },
    build: {
      // Bundles can be large in this Electron app — disk delivery, no CDN.
      chunkSizeWarningLimit: 2500,
      // NOTE: Previously had a manualChunks() config that split React /
      // three / charts / etc into named vendor chunks. It produced
      // "Circular chunk" warnings at build time (vendor-react ↔ vendor ↔
      // vendor-three) and at runtime crashed the production preview with
      //   Uncaught TypeError: Cannot read properties of undefined
      //                       (reading 'useLayoutEffect')
      // because vendor-three loaded before vendor-react. Rollup's auto
      // chunking handles this correctly out of the box; the manual split
      // gave only a marginal caching benefit (this is an Electron app, no
      // CDN cache) and was not worth the breakage. Removed.
    },
    test: {
      // 默认 node 环境：套件以源码契约测试（readFileSync + import.meta.url 定位）为主，
      // jsdom 会把 import.meta.url 改写为 http:// 导致 fs 读取全部失败。
      // 个别需浏览器语义的测试文件用 `// @vitest-environment jsdom` 文件级声明开启。
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/out/**',
        '**/archive/**',
        '**/.{idea,git,cache,output,temp}**',
        // server/ 为独立 vitest 套件（需 DATABASE_URL 等后端环境），cd server && npx vitest run
        'server/**',
        // 未跟踪的设计探索资产，非交付面
        'design-lab/**',
      ]
    },
  };
});
