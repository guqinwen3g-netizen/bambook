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
    // NOTE: files must each run in a FRESH fork process (singleFork: false).
    // With singleFork: true all files share one long-lived process, and the
    // reused vite-node module runner intermittently serves corrupted modules
    // across file boundaries — observed as flaky
    //   - "Cannot find module './events'" (lazy CJS require of a .ts module
    //     surfacing at request time inside agent route handlers), and
    //   - supertest "Parse Error: Expected HTTP/, RTSP/ or ICE/".
    // fileParallelism: false alone still guarantees serial file execution,
    // so the shared-Postgres invariant above is preserved.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
  },
});
