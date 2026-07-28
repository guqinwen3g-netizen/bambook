# Bambook UI 美学规范文档

**版本**: 3.0  
**定位**: 极致美观、完整前端系统  
**核心原则**: 每一丝每一毫都不可轻易破坏

---

## 一、设计哲学

### 视觉风格
- **Command Center 命令中心风格** - 专业、科技、掌控感
- **iOS 26 Glass System** - 毛玻璃、发光边缘、层次感
- **Ethereal Horizon Palette** - 空灵地平线配色

### 核心特征
- 极致简约现代体系
- 几何简约设计
- 工业锐利美学
- 现代数字美学

---

## 二、色彩系统（精确值）

### 背景渐变（Command Center）
| 变量名 | 色值 | 用途 |
|--------|------|------|
| --bambook-bg-space | `#050a15` | 最深背景 |
| --bambook-bg-primary | `#0a1628` | 主背景 |
| --bambook-bg-secondary | `#162340` | 次背景 |
| --bambook-bg-tertiary | `#1a3a52` | 强调背景 |
| 渐变 | `linear-gradient(135deg, #0a1628 0%, #162340 50%, #1a3a52 100%)` | 页面背景 |

### 毛玻璃层级（精确值 - Bambook OS v3.1 收拢）
| 变量名 | 色值 / 类名 | 用途 |
|--------|------|------|
| --glass-white-3 | `rgba(255,255,255,0.03)` | 极微妙背景 |
| --glass-white-5 | `rgba(255,255,255,0.05)` | 微妙背景 |
| --glass-panel-light | `rgba(255,255,255,0.32)` | 浅色页面面板背景 (`blur(14px)`) |
| --glass-card-light | `rgba(255,255,255,0.22)` | 浅色轻量卡片背景 (`blur(12px)`) |
| --glass-panel-dark | `rgba(10,14,22,0.24)` | 深色页面面板背景 (`blur(16px)`) |
| --glass-card-dark | `rgba(255,255,255,0.02)` | 深色轻量卡片背景 |
| --glass-white-30 | `rgba(255,255,255,0.30)` | 边框/悬停 |

### 强调色（精确值）
| 变量名 | 色值 | 用途 |
|--------|------|------|
| --accent-blue | `#4a9eff` | 主要按钮/链接 |
| --accent-blue-bright | `#60a5fa` | 悬停高亮 |
| --accent-blue-dim | `#2563eb` | 渐变暗部 |
| --accent-cyan | `#4ecdc4` | Logo/次要强调 |
| --accent-teal | `#14b8a6` | 辅助色 |
| --accent-purple | `#a78bfa` | 特殊状态 |
| --accent-violet | `#8b5cf6` | 渐变点缀 |
| --accent-orange | `#fb923c` | 警告状态 |
| --accent-amber | `#f59e0b` | 次要警告 |
| --accent-red | `#ff6b6b` | 错误状态 |
| --accent-rose | `#f43f5e` | 严重错误 |
| --accent-green | `#22c55e` | 成功状态 |
| --accent-emerald | `#10b981` | 次要成功 |

### 文字色彩（精确值）
| 变量名 | 色值 | 用途 |
|--------|------|------|
| --text-primary | `rgba(255,255,255,0.95)` | 主文字 |
| --text-secondary | `rgba(255,255,255,0.70)` | 次要文字 |
| --text-tertiary | `rgba(255,255,255,0.45)` | 辅助文字 |
| --text-muted | `rgba(255,255,255,0.30)` | 禁用/提示 |

### 边框色彩（精确值）
| 变量名 | 色值 | 用途 |
|--------|------|------|
| --border-subtle | `rgba(255,255,255,0.06)` | 微妙分隔 |
| --border-default | `rgba(255,255,255,0.12)` | 标准边框 |
| --border-strong | `rgba(255,255,255,0.20)` | 强调边框 |
| --border-glow-blue | `rgba(74,158,255,0.30)` | 发光边框 |

---

## 三、阴影系统（精确值）

| 变量名 | 值 | 用途 |
|--------|-----|------|
| --shadow-sm | `0 2px 8px rgba(0,0,0,0.15)` | 小阴影 |
| --shadow-md | `0 4px 16px rgba(0,0,0,0.20)` | 中等阴影 |
| --shadow-lg | `0 8px 32px rgba(0,0,0,0.25)` | 大阴影 |
| --shadow-xl | `0 16px 48px rgba(0,0,0,0.30)` | 超大阴影 |
| --shadow-glow-blue | `0 0 20px rgba(74,158,255,0.15)` | 蓝色发光 |
| --shadow-glow-cyan | `0 0 20px rgba(78,205,196,0.15)` | 青色发光 |
| --shadow-glow-purple | `0 0 20px rgba(167,139,250,0.15)` | 紫色发光 |

---

## 四、间距系统（精确值，8px base）

| 变量名 | 值 | 用途 |
|--------|-----|------|
| --space-1 | `4px` | 微小间距 |
| --space-2 | `8px` | 紧凑间距 |
| --space-3 | `12px` | 标准间距 |
| --space-4 | `16px` | 舒适间距 |
| --space-5 | `20px` | 中等间距 |
| --space-6 | `24px` | 区块间距 |
| --space-8 | `32px` | 大区块间距 |
| --space-10 | `40px` | 超大间距 |
| --space-12 | `48px` | 特大间距 |
| --space-16 | `64px` | 巨大间距 |

---

## 五、圆角系统（精确值）

| 变量名 | 值 | 用途 |
|--------|-----|------|
| --radius-sm | `6px` | 小按钮/标签 |
| --radius-md | `10px` | 输入框/按钮 |
| --radius-lg | `16px` | 标准卡片 |
| --radius-xl | `24px` | 大卡片/面板 |
| --radius-2xl | `32px` | 超大卡片 |
| --radius-full | `9999px` | 胶囊/徽章 |

---

## 六、字体系统（精确值）

### 字体栈
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
```

### 字号（精确值）
| 变量名 | 值 | 用途 |
|--------|-----|------|
| --text-xs | `11px` | 标签/徽章 |
| --text-sm | `13px` | 辅助文字/按钮 |
| --text-base | `15px` | 正文 |
| --text-lg | `17px` | 卡片标题 |
| --text-xl | `20px` | 小标题 |
| --text-2xl | `24px` | 页面标题 |
| --text-3xl | `30px` | 大标题 |
| --text-4xl | `36px` | 显示文字 |

### 行高（精确值）
| 变量名 | 值 | 用途 |
|--------|-----|------|
| --leading-tight | `1.25` | 紧凑 |
| --leading-normal | `1.5` | 标准 |
| --leading-relaxed | `1.75` | 宽松 |

---

## 七、动画系统（精确值）

### 时间函数（精确值）
| 变量名 | 值 | 用途 |
|--------|-----|------|
| --ease-out | `cubic-bezier(0.16, 1, 0.3, 1)` | 标准过渡 |
| --ease-in-out | `cubic-bezier(0.65, 0, 0.35, 1)` | 对称动画 |
| --ease-spring | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性效果 |

### 持续时间（精确值）
| 变量名 | 值 | 用途 |
|--------|-----|------|
| --duration-fast | `150ms` | 快速反馈 |
| --duration-normal | `250ms` | 标准过渡 |
| --duration-slow | `400ms` | 缓慢动画 |
| --duration-slower | `600ms` | 入场动画 |

---

## 八、组件规范（精确代码）

### 1. Glass Card & Panel (Bambook OS v3.1 统一规范)
**卡片级材质 (.bambook-card-glass)**:
- 浅色：`background-color: rgba(255, 255, 255, 0.22)`, `blur(12px)`, 边框 `rgba(255,255,255,0.25)`。
- 深色：`background-color: rgba(255, 255, 255, 0.02)`, 噪点透明度降低至 `0.006`。

**面板级材质 (.bambook-panel-glass)**:
- 浅色：`background-color: rgba(255, 255, 255, 0.32)`, `blur(14px)`, 边框 `rgba(255,255,255,0.32)`。
- 深色：`background-color: rgba(10, 14, 22, 0.24)`, `blur(16px)`, 噪点透明度降低至 `0.008`。

**外层面板 (.bambook-outer-panel)**:
- 页面级容器阴影深度收拢调弱。
- 深色模式下，**绝对禁止**使用黑色粗边框（`rgba(0,0,0,0.32)`），必须统一使用浅白色高光半透明边框 `border-color: rgba(255,255,255,0.09) !important`，并搭配微弱外阴影及精细内投影，消除生硬的黑边感。

**变体**:
- `.glass-card--solid` - `background: var(--glass-white-15)`
- `.glass-card--subtle` - `background: var(--glass-white-5); border-color: var(--border-subtle)`
- `.glass-card--static` - `pointer-events: none` (无悬停效果)

### 2. 按钮规范

**主要按钮 (btn-glow)**
```css
.btn-glow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: linear-gradient(135deg, var(--accent-blue), var(--accent-blue-dim));
    border: none;
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-6);
    color: white;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-out);
    box-shadow: 0 4px 15px rgba(74, 158, 255, 0.35);
}

.btn-glow:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(74, 158, 255, 0.45);
}
```

**次要按钮 (btn-ghost)**
```css
.btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: var(--glass-white-5);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-6);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-out);
}

.btn-ghost:hover {
    background: var(--glass-white-12);
    border-color: var(--accent-blue);
}
```

**图标按钮 (btn-icon)**
```css
.btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--glass-white-8);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-out);
}

.btn-icon:hover {
    background: var(--glass-white-15);
    border-color: var(--accent-blue);
    color: var(--text-primary);
    box-shadow: var(--shadow-glow-blue);
}
```

### 3. 输入框规范
```css
.input-glass {
    width: 100%;
    background: var(--glass-white-5);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    transition: all var(--duration-normal) var(--ease-out);
}

.input-glass::placeholder {
    color: var(--text-muted);
}

.input-glass:hover {
    background: var(--glass-white-8);
    border-color: var(--border-strong);
}

.input-glass:focus {
    outline: none;
    background: var(--glass-white-12);
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.15), var(--shadow-glow-blue);
}
```

### 4. 侧边栏规范
**侧边栏及容器边缘规范**:
- 侧边栏面板边缘在高对比度的深色模式下，也必须使用统一的外层面板规范 `.dark .bambook-outer-panel`（`rgba(255,255,255,0.09)` 的高光亮边线代替旧版黑色底框）。
- **侧边栏选项按钮选中状态 (.sidebar-active)**：
  - 深色模式下，**绝对禁止**使用 `border-black/40`（粗黑边）及 `inset_-1px` 黑色底部阴影。
  - 必须使用 `border-white/10` 亮色微高光，配合 `inset_0_1px_0_rgba(255,255,255,0.14)` 的极细白色顶发光，以及微弱外阴影 `rgba(0,0,0,0.25)`，以确保被选中的按钮与毛玻璃质感侧边栏完美融合。

```css
/* 侧边栏大容器面板 (外层) - 精准挂载防嵌套污染的 outer-panel 重影子 */
.sidebar-outer-panel {
    box-shadow: 
        inset 0 1px 0 0 rgba(255, 255, 255, 0.10), /* 顶部 specular 白光微边 */
        0 24px 60px -24px rgba(0, 0, 0, 0.68),
        0 48px 100px -30px rgba(0, 0, 0, 0.80);
}

.sidebar-glass {
    width: 288px; /* w-72 */
    display: flex;
    flex-direction: column;
    background: var(--glass-white-5);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
}

/* 导航项 */
.sidebar-nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 300; /* font-light */
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out);
}

/* 果冻滑动指示器 (Jelly Selector Slider) - 主线程算力协同保障 */
.sidebar-jelly-slider {
    /* 采用 bouncy spring 位移 */
    transition: transform var(--duration-normal) var(--ease-spring);
    /* 切换重型 WebGL 页面（如地球）时，必须执行 340ms 延迟挂载，优先保障滑块满帧流畅度 */
}

/* 气泡弹出菜单 (Popover) - 防裁剪设计 */
.sidebar-popover-sibling {
    /* 弹出菜单绝对禁止嵌套在带有 overflow-hidden 的侧边栏内部 */
    /* 必须作为同级兄弟节点 (Sibling) 渲染在具有 overflow-visible 属性的外部 aside 中 */
    position: absolute;
    left: 32px; /* left-8 */
    width: 256px;
    bottom: 104px;
    z-index: 30;
    backdrop-filter: blur(20px);
}
```

---

## 九、布局规范

### 容器尺寸
| 元素 | 尺寸 | 说明 |
|------|------|------|
| 侧边栏展开 | `320px` (w-72) | 默认宽度 |
| 侧边栏收起 | `64px` (w-16) | 紧凑模式 |
| 最小宽度 | `729px` | 桌面端限制 |
| 卡片内边距 | `24px` (p-6) | 标准卡片 |

### 实际代码中的关键值
- Logo 尺寸: `28px`
- Logo 发光色: `#5DE0E6`
- 图标尺寸: `20px` (strokeWidth: 1)
- 分割线: `w-[1px] bg-gradient-to-b from-[#4A90E2]/40 via-[#4A90E2]/10 to-transparent`

---

## 十、特殊组件

### SpotlightCard（聚光灯卡片）
```tsx
// 鼠标跟随的聚光灯效果
// spotlightColor: "rgba(255, 255, 255, 0.15)"
// 背景: radial-gradient(600px circle at x y, rgba(255,255,255,0.15), transparent 40%)
// 过渡: duration-300 ease-out
// 悬停: scale-[1.02]
```

### FolderTabCard（文件夹标签卡片）
```tsx
// SVG 路径绘制文件夹形状
// 渐变: linear-gradient 从 rgba(30,41,59,0.7) 到 rgba(15,23,42,0.8)
// 边框: rgba(255,255,255,0.08)
// 顶部光学发光: bg-gradient-to-r from-transparent via-white/40 to-transparent
```

---

## 十一、修改规范

### ⚠️ 绝对禁止（红线）
| 项目 | 禁止操作 |
|------|----------|
| 色彩 | 修改 --accent-blue, --bambook-bg-* 主色值 |
| 毛玻璃 | 将模糊度（blur）提高至 20px 以上（太厚太毛），导致通透度降低；必须使用 v3.1 收拢标准：12px-16px 范围 |
| 圆角 | 修改 --radius-lg (16px) 基准 |
| 间距 | 修改 --space-2 (8px) 基数 |
| 边框黑线 | 在深色模式下为面板、卡片或选中按钮加上粗黑边（如 border-black/40 等） |
| 阴影 | 修改阴影参数结构 |
| 字体 | 修改字体栈顺序 |
| 动画 | 修改 --ease-out 时间函数 |

### ✅ 允许操作
| 项目 | 允许操作 |
|------|----------|
| 新增 | 创建新页面/组件（严格遵循规范） |
| 后端 | API 开发、数据库操作 |
| 数据 | 状态管理、数据流 |
| 变体 | 基于现有规范的组件变体 |

### 📝 修改流程
1. **对照规范** - 所有 UI 改动前查阅本文档
2. **视觉验证** - 与现有组件对比确保协调
3. **Kevin 审批** - 前端修改必须获得确认
4. **渐进实施** - 小步验证，避免大规模改动

---

## 十二、参考文件

| 文件 | 路径 | 说明 |
|------|------|------|
| 设计系统 | `bambook-frontend/styles/design-system.css` | 完整 CSS 变量和组件 |
| 主应用 | `bambook-frontend/App.tsx` | 布局结构和状态 |
| 侧边栏 | `bambook-frontend/components/Sidebar.tsx` | 导航交互和样式 |
| 仪表盘 | `bambook-frontend/components/Dashboard.tsx` | 主视图组件 |
| Spotlight | `components/ui/SpotlightCard.tsx` | 聚光灯效果 |
| FolderTab | `components/ui/FolderTabCard.tsx` | 文件夹卡片 |

---

**文档维护**: Bamboo (小竹)  
**最后更新**: 2026-04-14  
**状态**: 已对齐源代码精确值