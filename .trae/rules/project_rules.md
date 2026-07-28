# Project Rules

## Dev Server HMR 注意事项
- 修改代码后如果 Electron 没有变化，可能是 HMR 断了
- 重启方法: `pkill -f "bambook-intelligent-hub"; pkill -f "electron-vite"; sleep 2; nohup npm run electron:dev > /tmp/bambook-dev.log 2>&1 &`
- 等待 10 秒后检查 `tail /tmp/bambook-dev.log` 确认启动

## Lint/Typecheck 命令
- TypeScript: `npx tsc --noEmit --skipLibCheck`
- Build: `npx electron-vite build`

## 渲染路径铁律
- Relations/Products/Settings 有 compiled 双路径: 改 UI 只改 compiled 版本
- 其他页面 Manager 文件即实际渲染源
- `CompiledMainModuleSlot` className="contents" 是透明包裹器
