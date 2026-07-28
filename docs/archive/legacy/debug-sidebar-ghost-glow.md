# Debug Session: sidebar-ghost-glow
- **Status**: [OPEN]
- **Issue**: 当鼠标 hover 进入 sidebar（包括其内 nav button hover、button press、sidebar 自身 spotlight 任一触发），会出现一道"幽灵光"——半透明的、整窗高、从 sidebar 右沿向右延伸数百 px（浅色 ≈ 460px / 深色 ≈ 520px，大致到 Assistant 主区域 1/3 处）的朦胧光带。鼠标稍微离开 sidebar 一点后才消散。在某些场景下，鼠标移到主区域右上角（标题区）也会触发类似的水平光带。
- **Debug Server**: http://127.0.0.1:<port>/event （待启动）
- **Log File**: .dbg/trae-debug-log-sidebar-ghost-glow.ndjson

## Reproduction Steps
1. 启动 Electron dev 模式（`npm run dev` 或对应的 Electron preview）
2. 进入任意带 SidePanelContainer 主面板的页面（如 AI 助手 / Agent Working）
3. 将鼠标移入 sidebar 任意区域（空白、nav button、折叠按钮、头像）
4. 观察主区域出现"幽灵光"
5. 鼠标在 sidebar 内移动 / hover 不同 button / 按压 button：光持续存在
6. 鼠标移出 sidebar 一定距离后光消失

## 已尝试方案（全部失败或有副作用）
- 升级 SpotlightCard inline `overflow: 'clip'` → `overflow: 'hidden'`：未消除
- 关闭 SidePanelContainer 的 `liquidEdgeGlow={false}`：未消除
- SidePanelContainer 加 className `overflow-hidden`：被 inline style 覆盖，无效
- 关闭 sidebar 自身 SpotlightCard `spotlight={false}`：可消除（但只是验证不是修复）
- 同时清空 `SIDEBAR_HOVER_*_CLASS`：可消除
- 给 `.app-sidebar .bambook-outer-panel` 加 `contain: paint`：未消除
- 给同选择器加 `clip-path: inset(0 round 24px) + contain: layout paint style + isolation: isolate`：消除了幽灵光，但**误伤了 box-shadow（外阴影）**，导致动画硬切、左侧圆角暴露 → 已回滚

## 已确认的元凶来源（用户验证）
满足 ANY 触发：
- T1: sidebar 自身 SpotlightCard 的 spotlight 渲染（hover 进 sidebar 空白区域）
- T2: sidebar 内 nav button 的 :hover（hover button）
- T3: sidebar 内 nav button 的 :active（press button）

→ 三个独立触发源产生**完全相同**的幽灵光视觉，强烈暗示它们触发的是**同一个上游机制**（合成层重建？背景图溢出？某个共享的伪元素？）

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| H1 | 幽灵光是某个 fixed/absolute 定位的全局元素 | Med | Low | **Rejected** — 探针采样未发现这种元素 |
| H2 | 幽灵光是 SpotlightCard 内部 radial-gradient 溢出 SpotlightCard 的 overflow:hidden | High | Low | **Rejected** — sidebar 内 SpotlightCard 的 overflow 都正常 |
| H3 | 幽灵光是 .bambook-outer-panel 自身 background-image 渲染溢出 | Med | Low | **Rejected** — sidebar 内 panel 的 bg-image 是 'none' |
| H4 | 幽灵光是 .bambook-outer-panel ::before/::after 伪元素 | High | Low | **Rejected** — 探针未发现异常伪元素（虽然 elementsFromPoint 不返回伪元素，但所有可见的 DOM 元素均不在 sidebar 内 hover 状态下变化） |
| H5 | framer-motion layoutId 跨容器重建 | Low | Med | **Rejected** — 未发现 |
| **H6** | **主面板的 `backdrop-filter` 在自己的左边缘采样到了 sidebar 内的 spotlight/hover 亮像素，被 saturate(1.22) + blur(14px) 放大成"幽灵光"** | **High** | **Low** | **CONFIRMED** — 探针发现主面板 SpotlightCard rect={x:96,y:56,w:989,h:780}，紧贴 sidebar 右沿（x=270），有 backdrop-filter: saturate(1.22) blur(14px)。在 zoom 上下文里它会采样底下 wallpaper + sidebar 输出，而 sidebar 内的 spotlight/hover 让 sidebar 输出局部变亮 → 主面板 backdrop-filter 把它"透"过去并放大。 |

## Log Evidence
- 探针累计采集 38 个 sidebar hover 事件
- sidebar rect = {x:0, y:0, w:270, h:1126}
- 跨过 sidebar 右沿（x=270）的元素中，最显著的"接受 sidebar 输出"候选是：
  ```
  tag=DIV cls='relative isolate ... rounded-[24px] backdrop-blur-[14px] backdrop-saturate-[135%] bambook-dashbo...'
  rect: x=96 y=56 w=989 h=780
  backdrop-filter=saturate(1.22) blur(14px)
  overflow=hidden  isolation=isolate  z=auto
  ```
  这是 Assistant / Dashboard 主面板的 SpotlightCard。它的 backdrop-filter 采样区域包含 sidebar 与它重叠的部分（x=96~270）。

## Fix Strategy
**方案 C（已应用）**：给 `.app-sidebar` 加 `transform: translateZ(0)` + `will-change: transform`。
- 强制 sidebar 提升为独立 GPU 合成层
- 主面板的 backdrop-filter 在采样自己背后内容时，**独立合成层之间互相不可见**
- 主面板看不到 sidebar 的输出 → 不会采样到 sidebar 内的亮光 → 幽灵光消失

## Verification Conclusion
[Pending user verification - apply fix and test]
