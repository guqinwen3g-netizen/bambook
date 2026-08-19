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
    // 【登记 2026-08-19】全量串跑仍有既有的「每轮约 1 个随机模块失败」抖动（观察：
    // shipping orderLink / admin auditLogs / moq 等 mock+supertest 用例，错误表现为
    // HTTP 状态码/响应体随机错位，隔离跑全绿）。曾试 `pool:'threads'+isolate:true` 未消除，
    // 故判定非 vi.mock 模块串扰，更可能是残留 setInterval/异步句柄或共享 Postgres 定时任务
    // 在 72s 全量跑中途触发的时序类抖动。待后续系统二分定位（scheduler/pdml/ai SSE 候选）。
    // 未定位到根因前，单测全绿请以「隔离/定向跑」为准，全量单次失败不判回归。
  },
});
