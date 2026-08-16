# Relations 联系人管理模块设计 (Relations & Contacts)

## §1 元信息

| 项 | 值 |
|---|---|
| **模块定位** | 客户与开拓域的"身份真源"——承载客户 / 供应商 / 代理商 / 合作伙伴 / 政府 / 内部 / 其他 7 类组织档案的唯一权威源；联系人 `Contact` 嵌套于 Relation；EntityAlias / EntityLink 图谱承载合并去重与跨模块关联 |
| **模块边界** | 组织 / 联系人 CRUD + 多角色联系人（主联系人 / 决策人 / 备用联系人）+ EntityAlias 别名表 + EntityLink 关联图谱 + 编号发号器 + 行级 scope + 字典校验 + 跨模块 preview state 跳转；不含跟进记录 / 商机 / 信用额度 / 分层（这些在 [CRM-客户跟进.md](./CRM-客户跟进.md)） |
| **核心角色** | 业务员（含自己客户档案、跟单、同部门只读访问，宽泛容器含跟单）、销售主管（部门档案，部门管理职责）、系统管理员（总领导，含HR/合规宽泛职能：Internal 类、Government/Partner 类只读访问） |
| **范式** | 范式 A（三级导航 category → organizations → detail）+ 范式 B（grid / table 双视图）+ 范式 D（详情面板 6 区块）三态切换 |
| **优先级** | P0（开拓基础） |
| **实现状态** | ✅ 已落地（7 类组织树 + 多角色联系人 + DetailPanel 6 区块 + OrgChart 汇报线 + sessionStorage preview state 跨模块跳转 + V2 行级 scope + 编号发号器 CUS-00001/SUP-00001 + 字典校验 + Compiled 双路径渲染） |
| **关联 PRD 章节** | §5.3（客户档案管理）、§9.4（信用控制基础）、§19.5（关系智库页详细设计）、§24.2（分组导航） |
| **关联代码** | [RelationsManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/RelationsManager.tsx) 桌面端主组件 / [relationMutationService.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/relationMutationService.ts) 写路径 / [relationServiceV2.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/relationServiceV2.ts) V2 + scope / [entities/sync.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/sync.ts) EntityLink 图谱 / `server/prisma/schema.prisma` Relation/Contact/EntityAlias/EntityLink 模型 |

---

## §2 模块边界与上下文

Relations 模块在客户与开拓域中扮演"**单权威源**"角色：

- **身份唯一真源**：客户 / 供应商 / 代理商等 7 类组织档案只在此模块创建与编辑；下游模块（订单 / 报价 / 采购 / 发票 / 商机 / 跟进）通过 FK `customerRelationId` / `supplierRelationId` / `intermediaryRelationId` 反向引用，禁止重复维护客户档案。
- **联系人写路径收口**：联系人 `Contact` 的 CRUD 真源在本模块 DetailPanel 联系人名片区块；CRM 模块的"联系人"Tab 仅渲染只读卡片，编辑通过 `primeRelationsOrgDetailPreview(orgId) + onNavigate(View.Relations)` 跳转回本模块。
- **合并去重图谱**：`EntityAlias` 别名表（normalized 字段大小写归一化）承载"同一实体的不同写法"识别；`EntityLink` 承载跨模块实体关联图谱（如订单 → 客户 / 商机 → 客户 / 发票 → 客户）。两者的"实体"目标是 `Relation`，不重复维护独立的"客户档案"表。
- **跨模块 preview state**：`sessionStorage` 持久化 `bambook_relations_preview_state`（navLevel / selectedOrgId / activeTab / searchTerm / 排序模式 / 滚动位置），保证用户从 CRM / Orders / Email 等模块跳转回来时直接落在原组织详情。
- **Compiled 双路径**：与其他模块（Products / Settings）一致，本模块 UI 走 `compiledRelationsTemplates` 编译路径（详见 [设计系统规范](../../01-产品总览/4.设计系统规范.md)），改 UI 只改 compiled 版本。

---

## §3 模块范围与核心能力

### 3.1 范围内（In Scope）

| 能力 | 说明 | 代码入口 |
|------|------|---------|
| 三级导航 | category（7 类）→ organizations（该类列表）→ detail（详情）三级，sessionStorage 持久化 preview state | `RelationsManager` navLevel + `readRelationsPreviewState` |
| 双视图切换 | grid（卡片网格）+ table（紧凑表格）双模式 + 排序（recent / rating / contacts / name） | `RelationListDisplayMode` + `compareRelationsForList` |
| 组织详情 6 区块 | basic（基础）/ contact（联系方式）/ address（地址）/ finance（财务）/ personal（个人）/ notes（备注偏好） | `organizationFormSections` + `DetailPanel` |
| 多角色联系人 | 主联系人 `isPrimary`（单点）+ 决策人 `isDecisionMaker` + 备用联系人 `backupContacts` JSON + 多 shipTo 地址 | `ContactList` + `contactFormSections` |
| 汇报线 | `parentId` / `reportsToId` 双字段承载组织内部汇报线，`OrgChart` 渲染 | `OrgChart` 组件 |
| 编号发号器 | 客户编码 `CUS-00001` / 供应商编码 `SUP-00001` 由 `sequenceService.nextNumber` 分配 | `relationServiceV2.generateRelationCode` |
| 字典校验 | `stage` / `tier` 字段在 `dictSvc.getEntries` 字典内合法性校验（fail open：字典未 seed 跳过） | `validateDictField` |
| 行级 scope | `permissionService.getDataScopeResolver(actor, 'relations')` 三档过滤 + V2 路由全量接入 | `buildScopeWhere` + V2 路由 |
| 系统配置默认值 | `currency` / `paymentTerms` 缺省时从 `systemConfigService` 取（`finance.defaultCurrency` / `finance.defaultPaymentTerms`） | `applyConfigDefaults` |
| EntityLink 图谱 | 关系创建 / 更新 / 软删时双写 `EntityReference + EntityLink`，软删走 `deactivateEntityLinks` | `syncRelationEntityReferences` |
| 跨模块 preview | `primeRelationsOrgDetailPreview` helper 供 CRM / Orders / Email 调用，跳转回来直接落在指定组织详情 | `RelationsManager` 导出 |
| 软删归档 | `deletedAt` 软删 + 关联 EntityLink 同步失效 | `relationMutationService.deleteRelation` |

### 3.2 范围外（Out of Scope）

- ❌ 跟进记录 / 商机 / 信用额度 / 客户分层（在 [CRM-客户跟进.md](./CRM-客户跟进.md)）
- ❌ 工厂档案 `FactoryProfile`（在 Suppliers 模块，1:1 承载工厂属性）
- ❌ 营销活动 / 营销线索（在 [Marketing-营销.md](./Marketing-营销.md)）
- ❌ 展会线索 / 季度回顾（在 [Seasons-季节展会.md](./Seasons-季节展会.md)）
- ❌ 实体合并 UI（`EntityAlias` 数据层已建，无前端合并 / 去重 UI，已知 P1 缺口）

---

## §4 7 类关系矩阵与 4 大能力

### 4.1 7 类关系分类（`RELATION_CATEGORY_DEFINITIONS`）

| 类别 | 图标 | 描述 |
|------|------|------|
| Supplier 供应商 | Box | 原材料、零部件及生产服务供应商库 |
| Customer 客户 | Users | B2B 经销商与战略大客户名录 |
| Agent 代理商 | Briefcase | 区域总代与分销渠道合作伙伴 |
| Partner 合作伙伴 | Handshake | 技术、物流及联合研发战略伙伴 |
| Government 政府/机构 | Landmark | 监管部门、行业协会与标准组织 |
| Internal 内部 | Building2 | 公司内部部门 / 子公司 |
| Other 其他 | Globe2 | 媒体、咨询机构及其他利益相关方 |

类别是 `category` 字段（封闭集 `VALID_RELATION_CATEGORIES`），方向分组一律用 `category`；`type` 字段为业务子类自由文本（如 `Fabric Mill` / `Trading Agent` / `Freight Forwarder`），不参与方向分组。

### 4.2 4 大能力

| 能力 | 落点 | 备注 |
|------|------|------|
| 单权威源 | Relation 表 + 7 类 category | 下游 FK 反向引用，禁止重复维护 |
| 合并去重 | EntityAlias（normalized 大小写归一化 + source + confidence） | 数据层已建，UI 待补 |
| 多角色联系人 | Contact `isPrimary` / `isDecisionMaker` + backupContacts JSON | 主联系人单点事务保证 |
| 信用额度管理 | CreditLimit（多对一 Relation，按时间序历史） | 写路径在 CRM 模块，本模块只读展示 |

---

## §5 核心业务流程图

```
┌────────────────────────────────────────────────────────────────────┐
│                  Relation 单权威源                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │Supplier │ │Customer │ │  Agent  │ │ Partner │ │ Govern  │ ...  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │
│       │           │           │           │           │            │
│       └───────────┴───────────┴───────────┴───────────┘            │
│                            │                                       │
│                            ▼                                       │
│              ┌──────────────────────────┐                          │
│              │  Contact（嵌套多角色）    │                          │
│              │  主联系人 / 决策人 / 备用  │                          │
│              └──────────────────────────┘                          │
└────────────────────────────────────────────────────────────────────┘
                  │                       │
       ┌──────────┘                       └──────────┐
       ▼                                              ▼
┌──────────────────────┐                  ┌──────────────────────┐
│ EntityAlias 别名表    │                  │ EntityLink 图谱       │
│ (normalized 大小写    │                  │ (跨模块实体关联)      │
│  归一化 + source +    │                  │  Order → Relation     │
│  confidence)          │                  │  Opportunity → ...   │
│  → 合并去重识别       │                  │  Invoice → ...        │
└──────────────────────┘                  │  Quotation → ...      │
                                          └──────────────────────┘

跨模块 preview state（sessionStorage bambook_relations_preview_state）：
  CRM / Orders / Email → primeRelationsOrgDetailPreview(orgId)
                      → onNavigate(View.Relations)
                      → Relations 挂载时直接落在该组织详情联系人 Tab
```

下游模块通过 `customerRelationId` 等 FK 反向归集客户业务数据；本模块的 `Relation.lastInteraction` 字段由下游模块写入维护（订单创建 / 跟进记录创建时更新）。

---

## §6 数据模型概要

Relations 模块持久化真源由 4 个核心模型组成：

| 模型 | 角色 | 关键约束 |
|------|------|---------|
| `Relation` | 组织 / 联系人主表（80+ 字段，含关系快照 + 业务档案） | `id` PK / `code` `@unique` 业务编码（CUS-00001 等）/ `category` 7 类封闭集 / `deletedAt` 软删 / 9 索引 |
| `Contact` | 联系人（多对一 Relation） | `@@index([relationId])` / `@@index([isPrimary])` / 软删 / 主联系人单点（事务内清除其他 primary） |
| `EntityAlias` | 别名表（合并去重识别） | `@@index([targetType, targetId])` / `@@index([normalized])` 大小写归一化 / `source` + `confidence` 来源标识 |
| `EntityLink` | 跨模块实体关联图谱 | `@@index([fromType, fromId])` / `@@index([toType, toId])` / `linkKind` 关联类型 / `status` active|inactive / 软删 + `deactivateEntityLinks` 失效 |

**关键关联**：
- `Relation.parentId` / `reportsToId` 双字段承载组织内部汇报线（自引用）。
- `Contact.relationId` 多对一 + `onDelete: Cascade`（删组织级联软删联系人）。
- `EntityLink` 双向：`fromType/fromId` → `toType/toId`，`linkKind` 标注关联语义（如 `customerOf` / `supplierFor` / `intermediaryFor`）。
- `Relation` 业务档案字段：`chineseName` / `englishName` / `creditLevel` / `summary` / `primaryContactName` / `backupContacts` JSON / `shipToAddresses` JSON / `financialNotes` / `website` / `paymentTerms` / `paymentPreference` / `currency` / `taxId` / `creditLimit` Decimal / `officialAddress` 等。

---

## §7 字段词典与类型契约

Relations 模块的 TypeScript 类型契约集中在 [types.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/types.ts) §210-§296（`Relation` / `RelationCategory`）与 §3089-§3125（`Contact` / `ContactInput`）：

- `Relation`：含 `id` / `code` / `name` / `category` 7 类联合类型 / `type` 业务子类自由文本 / `isOrganization` / `parentId` / `reportsToId` / `role` / `department` / `tags` / `contactInfo` / `rating` / `lastInteraction` / `preferences` + 业务档案字段。
- `RelationCategory` 联合类型：`'Supplier' | 'Customer' | 'Agent' | 'Partner' | 'Government' | 'Internal' | 'Other'`。
- `Contact`：含 `name` / `title` / `department` / `email` / `phone` / `mobile` / `wechat` / `whatsapp` / `isPrimary` / `isDecisionMaker` / `birthday` / `personalNote` / `tags` / `status Active|Inactive|Left`。
- `ContactInput`：写入接口（不含 `status` / `id` / 时间戳，由服务层填充）。

前端常量真源在 [RelationsManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/RelationsManager.tsx) §59-§198，包括 `RELATION_CATEGORY_IDS` / `RELATION_CATEGORY_DEFINITIONS`（7 类 + 图标 + 描述）、`organizationFormSections`（5 区块）、`contactFormSections`（4 区块）、`paymentTermOptions`（6 选项）、`currencyOptions`（4 币种）、`languageOptions`（4 语言）、`relationSortOptions`（4 排序模式）。

---

## §8 API 端点概要

### 8.1 V1 路由（`/api/v1/relations`，向后兼容旧前端 + Agent tool 调用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 列表（支持 category/stage/tier/search 筛选） |
| GET | `/:id` | 单组织详情 |
| POST | `/` | 创建（手动 or 导入） |
| PUT | `/:id` | 更新 |
| DELETE | `/:id` | 软删（关联 EntityLink 同步失效 + 审计） |
| GET | `/by-target` | 按 EntityLink target 反查关联 Relation |
| POST | `/:id/contacts` | 创建联系人 |
| PUT | `/contacts/:id` | 更新联系人 |
| DELETE | `/contacts/:id` | 软删联系人 |

### 8.2 V2 路由（`/api/v2/relations`，行级 scope + 字典校验 + 编号发号器）

| 方法 | 路径 | 守卫 | 说明 |
|------|------|------|------|
| GET | `/` | relations:read | 列表（带 scope where + 筛选 + 分页 + 模糊搜索 name/englishName/chineseName/code） |
| GET | `/:id` | relations:read | 详情（含 scope 反查） |
| POST | `/` | relations:write | 创建（编号发号器 + 字典校验 + 系统配置默认值） |
| PUT | `/:id` | relations:write | 更新（scope + 字典校验） |
| DELETE | `/:id` | relations:write | 软删（scope + EntityLink 同步失效） |
| GET | `/sales-funnel` | relations:read | 销售漏斗聚合（按 stage 分组 count） |

### 8.3 实体图谱路由（`/api/v1/entities`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/by-target?type=&id=` | 按 target 反查关联实体（EntityLink 图谱） |
| GET | `/search?q=` | 实体搜索（含 EntityAlias 别名匹配） |
| GET | `/sub-keys?type=` | 实体子字段键查询 |
| POST | `/sync` | 触发实体同步 |

V2 写操作复用 V1 `relationMutationService` 的 `toRelationDbPayload` / `toRelationUpdatePayload` 序列化逻辑，叠加 scope 校验 / 编号生成 / 字典校验三层增强。

---

## §9 权限矩阵与行级 Scope

| 角色 | 列表可见 | 编辑 | 创建 | 软删 |
|------|---------|------|------|------|
| admin / manager | 全部 | ✅ | ✅ | ✅ |
| sales | ownerId=me | ✅（自己的客户） | ✅（ownerId=me） | ❌ |
| merchandiser | 同部门 | ⚠️ 同部门只读 | ❌ | ❌ |
| hr | Internal 类全部 | ⚠️ 仅 Internal | ✅（仅 Internal） | ❌ |
| agent（API Key） | 全部只读 | ❌ | ❌ | ❌ |

行级 Scope 真源在 `permissionService.getDataScopeResolver(actor, 'relations')`，规则三档：
- `kind=all` → 不过滤（admin / manager）
- `kind=self` → `OR [{ ownerId: actor.userId }, { salesRepIds: { has: actor.userId } }]`
- `kind=department` → `OR [{ ownerId: { in: userIds } }, { salesRepIds: { hasSome: userIds } }, { departmentId: { in: deptIds } }]`

未登录返回 `{ ownerId: '__NOBODY__' }` 看不到任何数据；scope 为空集时同样返回 `__NOBODY__`。

---

## §10 设计系统约束

本模块遵循 BDS v2.1 中性契约 + Compiled 双路径：

- **Compiled 路径**：UI 走 `compiledRelationsTemplates`（详见 `components/ui/osCompiler/`），改 UI 只改 compiled 版本；非 compiled 版本仅作为 fallback 与单元测试基准。
- **SidePanel 容器**：`SIDE_PANEL_BASE_CLASS` / `SIDE_PANEL_CLASS` / `SpotlightCard` / `useGlassSurfaceEdgeMasks` 提供 spotlight 跟随光与边缘渐隐遮罩。
- **主题透明**：组件对 `isDarkMode` 透明，暗色由 `tokens.css [data-theme]` 统一覆盖。
- **三级导航 + 双视图**：category → organizations → detail 三级；grid / table 双视图切换由 `bds-segment` 控件承载。
- **OrgChart 渲染**：组织内部汇报线用 `OrgChart` 组件（GraphViz 风格节点 + 连线），承载 `parentId` / `reportsToId` 双字段语义。
- **空态**：`bds-empty` + Lucide 图标，无吉祥物 / 无插画。

---

## §11 业务规则接入状态

| 规则 | 接入状态 | 备注 |
|------|---------|------|
| 业务编号发号器（CUS-00001 / SUP-00001） | ✅ `sequenceService.nextNumber(prisma, seqType)` | seqType 由 category 决定（Supplier/Factory → supplier；其他 → customer） |
| 数据字典校验（stage / tier） | ✅ `dictSvc.getEntries(dictCode, { enabledOnly: false })` + fail open | 字典未 seed 时跳过校验，避免阻塞 |
| 系统配置默认值（currency / paymentTerms） | ✅ `systemConfigService.getString` | `finance.defaultCurrency` / `finance.defaultPaymentTerms` |
| 行级 scope 三档过滤 | ✅ V2 路由全量接入 | V1 路由保留向后兼容（无 scope） |
| EntityLink 图谱双写 | ✅ 创建 / 更新事务内 + 软删同步失效 | `syncRelationEntityReferences` + `deactivateEntityLinks` |
| 审计日志（create / update / delete） | ✅ `writeRouteAuditLog` + `prisma.auditLog.create` | 含 before / after 快照 + ip + source |
| 主联系人单点 | ✅ 事务内清除其他 primary | `tx.contact.updateMany` |
| 跨模块 preview state | ✅ sessionStorage 持久化 | 7 字段：navLevel / selectedCategory / selectedOrgId / selectedContactId / searchTerm / activeTab / displayMode / sortMode / 滚动位置 |
| 实体合并去重 UI | ⚠️ `EntityAlias` 数据层已建，无前端 UI | P1 缺口 |

---

## §12 状态机与生命周期

### 12.1 Relation 生命周期

```
创建（Active，deletedAt=null）
  ├─→ 更新（事务 + 审计 + EntityLink 同步）
  └─→ 软删（deletedAt=ts，EntityLink 同步失效，不可恢复）
```

`stage` 字段（Lead / Opportunity / Customer / Churned）由 `dictSvc` 字典校验合法枚举，无强制状态机流转规则；`tier` 字段（S / A / B / C / D / Z）同理。

### 12.2 Contact 生命周期

```
创建（Active，isPrimary 单点事务保证）
  ├─→ 更新（含 isPrimary 切换时清除同 relation 其他 primary）
  ├─→ Active → Inactive（手动标记非活跃）
  ├─→ Active/Inactive → Left（离职）
  └─→ 软删（deletedAt=ts + isPrimary 强制 false，避免主联系人引用失效）
```

### 12.3 EntityLink 生命周期

```
创建（status=active，事务内 upsert，确定性 ID）
  ├─→ 更新（confidence / source 更新）
  └─→ 失效（status=inactive，软删时 batch 调 deactivateEntityLinks）
```

`EntityReference` 与 `EntityLink` 双写，确定性 ID（`referenceIdFor` / `linkIdFor`）保证 upsert 幂等。

---

## §13 待补的设计缺口

| # | 缺口 | 优先级 | 落点 |
|---|------|-------|------|
| 1 | 实体合并去重 UI（EntityAlias 数据层已建，无前端合并 / 去重操作流） | P1 | DetailPanel 别名区块 |
| 2 | EntityLink 图谱可视化（当前只在 RelatedEntitiesPanel 列表展示，无图谱图） | P2 | 详情页图谱视图 |
| 3 | V1 路由行级 scope 接入（V2 已接入，V1 仍向后兼容无 scope） | P1 | route.ts |
| 4 | 客户档案导入（Excel / CSV 批量导入向导） | P1 | Relations 列表页 |
| 5 | 联系人 vCard 导出 / 导入 | P2 | DetailPanel 联系人区块 |
| 6 | 跨组织联系人共享（同一人在多个组织任职场景） | P2 | Contact 多对多重构 |

---

## §14 实现状态总览

| 子能力 | 状态 | 真源 |
|--------|------|------|
| 7 类组织树 + 三级导航 + sessionStorage preview | ✅ | `RelationsManager` + `readRelationsPreviewState` |
| 双视图 grid/table + 4 排序模式 | ✅ | `RelationListDisplayMode` + `compareRelationsForList` |
| 组织详情 6 区块 + DetailPanel | ✅ | `organizationFormSections` + `DetailPanel` |
| 多角色联系人 + 主联系人单点事务 | ✅ | `ContactList` + `crmService.createContact` |
| 汇报线 OrgChart | ✅ | `OrgChart` 组件 |
| 编号发号器 CUS-00001/SUP-00001 | ✅ | `relationServiceV2.generateRelationCode` |
| 字典校验 + 系统配置默认值 | ✅ | `validateDictField` + `applyConfigDefaults` |
| V2 路由行级 scope 三档过滤 | ✅ | `buildScopeWhere` + V2 路由 |
| EntityLink 图谱双写 + 软删失效 | ✅ | `syncRelationEntityReferences` + `deactivateEntityLinks` |
| 跨模块 preview state helper | ✅ | `primeRelationsOrgDetailPreview` 导出 |
| Compiled 双路径渲染 | ✅ | `compiledRelationsTemplates` |
| 实体合并去重 UI | ⚠️ 缺口 | EntityAlias 数据层已建 |
| 客户档案批量导入 | ⚠️ 缺口 | Relations 列表页 |

---

## §15 交叉链接

1. [CRM-客户跟进](./CRM-客户跟进.md) — 跟进记录 / 商机 / 信用额度 / 客户分层写路径 + 联系人只读视图
2. [Seasons-季节展会](./Seasons-季节展会.md) — 展会线索转化 category=Customer 的 Relation
3. [Marketing-营销](./Marketing-营销.md) — 营销活动关联 relationId + 中间人佣金规则关联 intermediaryRelationId
4. [订单管理 模块概述](../03-订单与生产/Orders-订单管理/模块概述.md) — 订单 customerRelationId 反向归集 + preview state 跳转
5. [实体关系总览](../../02-数据模型/实体关系总览.md) — Relation / Contact / EntityAlias / EntityLink 模型关系图
6. [角色与权限矩阵](../../01-产品总览/6.角色与权限矩阵.md) — 行级 scope 三档规则真源
7. [业务编号规则](../../01-产品总览/7.业务编号规则.md) — CUS-00001 / SUP-00001 发号器口径
8. [设计系统规范](../../01-产品总览/4.设计系统规范.md) — Compiled 双路径渲染规则

---

## §16 相关文档索引

| 文档 | 路径 |
|------|------|
| 前端组件真源 | [components/RelationsManager.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/RelationsManager.tsx) |
| V1 写路径服务 | [server/src/relations/relationMutationService.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/relationMutationService.ts) |
| V2 + scope 服务 | [server/src/relations/relationServiceV2.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/relations/relationServiceV2.ts) |
| EntityLink 图谱同步 | [server/src/entities/sync.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/sync.ts) `syncRelationEntityReferences` / `deactivateEntityLinks` |
| 实体图谱路由 | [server/src/entities/route.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/entities/route.ts) |
| 编号发号器 | [server/src/sequence/sequenceService.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/sequence/sequenceService.ts) |
| 字典服务 | [server/src/dictionaries/dataDictionaryService.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/src/dictionaries/dataDictionaryService.ts) |
| Prisma 模型真源 | [server/prisma/schema.prisma](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/server/prisma/schema.prisma) Relation/Contact/EntityAlias/EntityLink |
| 前端类型定义 | [types.ts](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/types.ts) §210-§296 / §3089-§3125 |
| Compiled 渲染模板 | [components/ui/osCompiler/compiledRelationsTemplates.tsx](file:///Users/qinwengu/WorkBuddy/Claw/apps/Bambook/components/ui/osCompiler/compiledRelationsTemplates.tsx) |
