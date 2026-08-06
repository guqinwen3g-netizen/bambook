/** @type {import('tailwindcss').Config} */
// Local Tailwind v3 configuration — replaces the runtime CDN
// (cdn.tailwindcss.com Play CDN) used during early prototyping.
// Build-time JIT generates only the utilities actually referenced
// in the listed content files, keeping the emitted CSS small.
import typography from '@tailwindcss/typography';

export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './types.ts',
    './components/**/*.{ts,tsx,js,jsx}',
    './pwa/**/*.{ts,tsx,js,jsx}',
    './lib/**/*.{ts,tsx,js,jsx}',
    './services/**/*.{ts,tsx,js,jsx}',
    './utils/**/*.{ts,tsx,js,jsx}',
    './config/**/*.{ts,tsx,js,jsx}',
  ],
  // dark: 'class' so isDarkMode toggles via document root class.
  // Renderer code already uses `dark:` variants extensively.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Match the runtime body font set in index.html.
        // HarmonyOS Sans SC (designer-chosen CJK) is bundled locally via the
        // harmonyos-sans-sc-webfont-splitted npm package and imported at the
        // top of index.css.
        sans: [
          'Urbanist',
          'HarmonyOS Sans SC',
          'Inter',
          'Acherus Grotesque',
          'PingFang SC',
          'Microsoft YaHei',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      // ── Bambook Flat Design 圆角 token ──
      // 映射 os-vnext.css / --bambook-rdl-radius-* token 到语义类，
      // 组件用 rounded-card / rounded-inset 等，不再写 rounded-[22px]。
      // 值与实际渲染一致，替换后视觉零变化。
      borderRadius: {
        'panel': '34px',     // --os-vnext-radius-panel / --bambook-rdl-radius-panel
        'card': '24px',      // --os-vnext-radius-card
        'card-lg': '28px',   // --bambook-rdl-radius-card / --bambook-rdl-radius-toolbar
        'inset': '22px',     // --bambook-rdl-radius-inset
        'floating': '30px',  // --bambook-rdl-radius-floating
        'control': '18px',   // --os-vnext-radius-control
        'field': '16px',     // --os-vnext-radius-field
        'compact': '14px',   // 新增：覆盖 Assistant.tsx 等的 14px 用法
      },
      // ── Bambook 业务色 token ──
      // 映射 os-vnext.css 中 --bambook-*-rgb token 到语义类，
      // 组件用 bg-deep / text-link 等，支持 alpha 修饰符（bg-deep/40）。
      // 值与原硬编码完全一致，替换后视觉零变化。
      colors: {
        'deep': 'rgb(var(--bambook-bg-deep-rgb) / <alpha-value>)',
        'deep-alt': 'rgb(var(--bambook-bg-deep-alt-rgb) / <alpha-value>)',
        'app-dark': 'rgb(var(--os-vnext-bg-dark-rgb) / <alpha-value>)',
        'app-light': 'rgb(var(--os-vnext-bg-light-rgb) / <alpha-value>)',
        'action': 'rgb(var(--bambook-brand-action-rgb) / <alpha-value>)',
        'link': 'rgb(var(--bambook-brand-link-rgb) / <alpha-value>)',
        'link-light': 'rgb(var(--bambook-brand-link-light-rgb) / <alpha-value>)',
        'accent-cyan': 'rgb(var(--bambook-accent-cyan-rgb) / <alpha-value>)',
        'accent-blue': 'rgb(var(--bambook-accent-blue-rgb) / <alpha-value>)',
      },
    },
  },
  plugins: [
    // EmailManager renders rich-text email bodies via `prose prose-slate`.
    typography,
  ],
};
