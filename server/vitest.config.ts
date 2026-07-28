import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 隔离 root postcss/tailwindcss（worktree root 缺 tailwindcss 依赖时不阻断 server 测试）
  css: { postcss: { plugins: [] } },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['./src/test-setup.ts'],
    // DB-touching tests share a single Postgres instance; run files serially
    // to avoid them wiping each other's rows mid-flight.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
