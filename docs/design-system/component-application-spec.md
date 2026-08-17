# 组件应用规范（语境 × 元素决策矩阵）

> **权威声明（2026-08-16 · BDS v2.2）**：本文是 BDS v2.2 的**应用层真源**——
> token 真源在 `styles/bds/tokens.css`，组件真源在 `styles/bds/components.css`，
> 本文回答第三个问题：**什么语境使用哪个组件、什么规格、什么材质、什么 token**。
> 落地纪律：任何 UI 元素动手前必须先查本矩阵；矩阵没有覆盖的场景，
> 必须先命名缺失输入、增补规范，**禁止在页面局部发明样式**。
> 统一发生在 token 与规则层，不是把不同语境压成同一外观——
> 每个范式有明确语境边界，形态与语境错配即为违例。

## 方法论：四层决策模型

```
L0 真源层   tokens.css 唯一真源（裸值只许存在于此）
L1 元件层   元件规格表：尺寸刻度 × 适用语境（本文 §1）
L2 组件层   元素家族范式目录：合法形态 × 语境边界（本文 §2-§7）
L3 页面层   页面类型骨架：区域构成 × 间距 × 材质（本文 §8）
L4 落地层   逐页审计 → 修正 → 浏览器真实渲染验证（执行流程，§9）
```

---

## §1 控件高度规格表（垂直节奏）

| 高度 | Token / 值 | 适用语境 | 决策理由 |
|---|---|---|---|
| 56 | `h-14` + `rounded-card-lg` | 页面级主操作、通知大按钮（Dashboard 同款） | 页面 chrome 签名元素，全系统统一造型 |
| 48 | `--h-btn-lg` | 英雄操作：登录、空态主 CTA | 视觉焦点场景专用 |
| 44 | `--h-input` | 独立表单页（登录等）的默认输入 | 独立表单是可聚焦任务区，最大触达面 |
| 40 | `--h-btn-md` | **内容区工具条等高规格**：filterbar 内全部控件、页面主操作按钮、默认图标按钮 | bar 内混排必须等高；filterbar CSS 已强制 |
| 36 | legacy `h-9` | **外壳 chrome 工具条**：Sidebar / PageHeader / compiled 玻璃工具条 | chrome 层比内容层密度高一级（H1 裁决） |
| 34 | `--h-input-sm` | 密集语境：表格内联编辑、纯搜索/过滤行、segment 配套控件、**模态/内联表单**（V7 裁决） | 数据密集区与模态表单密度优先 |
| 32 | `--h-btn-sm` | 卡片内次级操作、行内操作、34 行配套图标按钮 | 次级操作降级 |

**铁律：同一行/同一条 bar 内控件严格等高。** 高度由所在行的角色决定，不允许行内混档。

---

## §2 搜索框范式（2026-08-16 用户裁决，已固化）

| 范式 | 结构 | 材质 | 适用语境 | 反例（违例） |
|---|---|---|---|---|
| **单层搜索** | `.bds-search` + `.bds-input`（凹槽填充，自身即容器） | recessed 墨洗 | 搜索独立成行，或行内仅有重影图标按钮 | 外套 filterbar 形成双层容器 |
| **内嵌搜索** | `.bds-filterbar` 内 `.bds-input` | 内嵌 input 用 `--bg-panel` 与 frosted 膜分层 | 搜索与下拉/分段器/按钮组**共组一条 bar** | 仅搜索自身套 filterbar |
| **页头搜索** | `rdl-search` pill（40px 白雾洗） | 雾洗 pill | 全局页头 / 外壳层专属 | 内容区业务页使用 |

判定流程：行内除搜索外是否还有其他功能控件？无 → 单层；有 → 内嵌 filterbar；外壳页头 → rdl-search。

---

## §3 工具条范式（四种合法形态）

| 范式 | 结构 | 控件高度 | 适用语境 | 示例页面 |
|---|---|---|---|---|
| **filterbar 组合条** | `.bds-filterbar`（frosted pill 玻璃容器） | 40 等高 | 内容区多控件组合过滤行（搜索+下拉/分段器） | Customs / Inventory / Finance |
| **裸操作行** | `.bds-toolbar`（透明，tb-left/tb-right） | 40（主操作）/ 32（次级） | 纯操作行：新增、刷新、计数，无过滤控件 | MES 各 tab |
| **卡片头分段行** | `.bds-card` 头内 `.bds-segment` 组 | segment 自有节奏，配套 select 用 34 | 过滤维度是列表的「视图切换」（状态/类型分段） | Risks / Seasons |
| **compiled 玻璃工具条** | CompiledInteractiveCard + spotlight（legacy 轨） | 36 | Relations / Products / Settings compiled 页**专属**，不外溢 | Relations / Products |

**铁律：**
1. filterbar 是内容区**顶层**工具条，独立成行，禁止嵌入卡片内部；卡片内的过滤需求用「卡片头分段行」范式。
2. 一条 bar 只有搜索框自身 → 不是工具条，用 §2 单层搜索。
3. compiled 工具条不向业务 Manager 页扩散；业务页不新造工具条样式。

---

## §4 按钮层级

| 层级 | 变体 | 适用 | 数量纪律 |
|---|---|---|---|
| 主操作 | `.bds-btn-primary`（accent） | 页面/视图主任务（新建、保存、提交） | **每视图唯一** |
| 次操作 | `.bds-btn-secondary` / `.bds-btn-outline` | 与主操作并列的常规操作 | 同行 ≤2 |
| 三级 | `.bds-btn-ghost` | 工具行次级操作、刷新、更多 | 不限 |
| 危险 | `.bds-btn-danger` | 删除、撤销等破坏性操作 | 不与主操作相邻 |
| 图标按钮 | `.bds-btn-icon`（ghost 圆形） | 符号已全民熟悉的操作（刷新/关闭/搜索） | 陌生功能禁止 icon-only |
| 页面级大按钮 | 56px Dashboard 款（`h-14 w-14 rounded-card-lg`） | 页面级主操作、通知入口 | 每页 ≤2 |

**主操作位置规则（H2 裁决）**：统一收进 PageHeader actions 区最右侧；无 PageHeader 的页面放工具行左端。工具行其余位置只放过滤控件与次级操作。

**主操作唯一性粒度（V2 裁决）**：唯一性按「任务区」粒度判定——页面或独立面板（Pricing 双轨面板、模态表单各为一个任务区）各允许一个 primary；**列表行不是任务区**，行内动作（状态转换/发送/接受等）一律 `bds-btn-secondary`，danger 独立末位不与 accent 相邻。

---

## §5 下拉选择范式

| 范式 | 组件 | 适用语境 |
|---|---|---|
| 原生填充式 | `select.bds-select` | filterbar 内、表单内**默认**；新代码唯一选择 |
| 可搜索组合 | `.bds-combobox`（§54） | 选项 >10 需搜索、多选场景 |
| 外壳存量 | CustomSelect（36px legacy 轨） | 外壳 chrome 工具条存量，不再扩散，逐步收编 |
| compiled 专属 | CompiledSelectControl | compiled 页专属，不外溢 |

---

## §6 容器与嵌套

**同心圆角铁律**：`inner = outer − padding`，嵌套必须外大内小保层次。
panel(34) › card(24) › inset(22) › control(18)/field(16) › compact(14) › xs(8)。

**材质铁律**：
1. 页面级主容器全玻璃（2026-08-14 用户裁决）：`bds-card` 本体即磨砂玻璃。
2. 禁止膜叠膜：玻璃容器内的嵌套层用 `--bg-sunken` / `--recessed-bg` 派生材质，不再叠 frosted 膜。
3. 静态面零阴影；阴影仅属浮层（modal/toast/popover/dropdown）。

---

## §6.5 雾化分类色板（2026-08-17 批H · 评审报告 S3/FR-001 决策）

**定位**：业务实体的**分类编码色**（不是状态色）。14 色与雾琥珀 `#A98A4F`/雾砖红 `#B05F57` 同源色彩空间——饱和度统一 30%（25-35% 区间），浅色基色明度 47% / 文字 36%，暗色提亮 66-70%，零高饱和彩虹。

**token 结构**（`styles/bds/tokens.css` §4.5，每色四元 + rgb 三元组）：

| 元 | token | 用途 |
|---|---|---|
| 基色 | `--mask-{name}` | 圆点/图例/小色块 |
| 文字 | `--mask-{name}-text` | chip/徽章/节点标签文字（白底/雾底上保对比度） |
| 雾底 | `--mask-{name}-bg` | 分类 chip 底色（10-16% 透明度） |
| 描边 | `--mask-{name}-border` | chip 描边（28-34% 透明度） |
| 三元组 | `--mask-{name}-rgb` | 半透明变体派生（`rgb(var(--mask-{name}-rgb)/α)`） |

**14 色名册**：sky / violet / violet-soft / pink / emerald / amber / cyan / rose / olive / orange / teal / indigo / green / blue。

**应用纪律**：
1. **唯一合法用途**：业务实体分类编码（TraceabilityPanel 节点标签、实体分类 chip/徽章、图例）。当前唯一消费方：`TraceabilityPanel.tsx NODE_TYPE_META`（14 类溯源节点）。
2. **禁止用作语义状态色**：成功/警告/危险/进行 一律走 §4 语义色（`--success-*`/`--warning-*`/`--danger-*`/`--accent-*`）；分类色与状态色不得混用于同一语义。
3. **禁止大面积铺底**：雾底仅 chip/徽章级小面积；列表行/卡片容器仍走 `--recessed-bg` 中性墨洗。
4. **新分类需求**：优先复用 14 色名册；确需新增色必须满足同源色彩空间（饱和 25-35%）并在 tokens.css §4.5 + showcase ⑤ 同步登记。

---

## §7 列表范式

| 范式 | 组件 | 适用语境 |
|---|---|---|
| 对象列表 | `.bds-listrow`（hairline 分隔 + hover 浮底） | 对象摘要+操作：组织、联系人、风险 |
| 数据表格 | `.bds-table`（可 sticky 表头 / compact） | 列数 ≥4 且以数值/状态为主：订单、库存、财务 |
| 卡片列表 | `.bds-card` 栅格 | 视觉展示型：营销、产品卡、壁纸 |

---

## §8 页面骨架与间距

| 区域 | 规格 |
|---|---|
| 页头 Pagehead | `px-7 pt-5 pb-4`；标题中英混排单行省略；actions 在右（通知 56px 大按钮最右，Dashboard 在左） |
| 工具区 | 页头下 `mb-4`；filterbar / 裸操作行 / 无（三选一） |
| 内容区 | `px-7`；主容器玻璃卡；卡片 padding `--space-5` |
| 卡片间隙 | `--space-4` |
| 字重 | 全局 Light 300；强调靠字号与墨色层级，禁 font-medium+ |

**页面类型骨架**（L3 详表在 Phase B 审计时逐页核对）：
列表管理页 / 驾驶舱仪表盘 / 工作台看板 / 表单密集页 / 详情抽屉 / compiled 展示页。

---

## §9 落地判定流程（每个 UI 元素动手前必答）

1. 这个元素在哪个**页面类型**里？
2. 它属于哪个**区域角色**：chrome / 工具区 / 内容区 / 浮层？
3. 它的**元素角色**：主操作 / 过滤 / 搜索 / 展示 / 输入 / 导航？
4. 查本矩阵对应行 → 得到组件 + 高度 + 材质 + token。
5. **矩阵没有对应行** → 命名缺失输入，增补本规范；禁止页面局部发明。

## §10 裁决记录（2026-08-16 用户裁决落定）

| # | 议题 | 裁决 | 规则化 |
|---|---|---|---|
| H1 | 36/40 高度 | **双轨正式化**：外壳 chrome 36px / 内容区 40px | 已写入 §1 |
| H2 | 主操作位置 | **统一 PageHeader 右上**；无 PageHeader 页面放工具行左端 | 已写入 §4 |
| H3 | 纯搜索/过滤行规格 | 无 40 控件同行时**全行 34**（密集），配套图标按钮 sm(32) | 已写入 §1/§2 |
| V2 | 行内动作层级 | 主操作唯一性按任务区粒度；**行内动作一律 secondary**，danger 独立末位 | 已写入 §4 |
| V7 | 模态/内联表单高度 | **34px 密集规格**（现状固化）；inline style 收编为 `.bds-select.sm` 类；独立表单页仍 44 | 已写入 §1 |
| V9 | 面板主操作归属 | 面板内 primary 绑定面板状态（disabled 依赖面板输入）时留在面板任务区内（Pricing 双轨「保存定价记录」、利润表「生成利润表」）；无状态依赖的新建类主操作统一收 PageHeader（QC ref 注册模式：Pricing 3 Panel / Marketing LookbooksPanel / Inventory 2 tab / BomManager），PageHeader primary 随任务区切换 | 已写入 §4 |
| V10 | 组件基础类宽度纪律 | **`:where()` 零特异性宽度默认**：`:where(.bds-input, .bds-select){width:100%}`。根因：基础类内联 `width:100%` 与 Tailwind 应用类同特异性且 components.css 后加载，filterbar 内 `w-[140px]` 等声明全部失效 → select 通栏挤压换行（开发管理工具区堆叠事故）。永久纪律：基础组件类禁止内联 width | 已写入 components.css 注释 |
