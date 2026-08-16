# Prisma Schema 缺口清单与迁移方案

> **基线**：`server/prisma/schema.prisma` HEAD = `f35e159`（2026-08-16）
> **设计真源**：本文档为 Prisma schema 变更的设计真源，前端工程师按本文档 DSL 草稿执行 migration
> **生成日期**：2026-08-16
> **关联文档**：[MOQ最小起订量.md](../03-业务规则/MOQ最小起订量.md) / [业务规则总览.md](../03-业务规则/业务规则总览.md) / [财务域模型组.md](./财务域模型组.md) / [订单与生产模型组.md](./订单与生产模型组.md) / [底座域模型组.md](./底座域模型组.md) / [客户与关系模型组.md](./客户与关系模型组.md)

---

## §1 缺口全景

| 严重度 | 数量 | 覆盖范围 |
|--------|------|---------|
| 🔴 P0（MOQ + 审批 + 三类费用，Fail-Closed 无法落地） | 9 项 | MoqThresholdConfig×2 / Order.moqSnapshot+capsuleExemption / OrderLine.moqOverride / Quotation.moqSnapshot / QuotationLine.moqOverride / Order.businessLine 补 other / ApprovalRequest.reviewerId NOT NULL / PaymentVoucher.voucherCategory |
| 🟡 P1（其他新增设计模型，本轮收口必需） | 12 项 | PaymentRequest / CreditLimitHistory / CreditLimit.frozen* / OrderInternalTransfer / Order.isInternalFabricTrade* / CustomerTier.moqOverrideRatio / InspectionReport.signatures / UserPermissionOverrides / OrderProfitSheet.costBreakdown 契约 / Customer.creditFrozen / GarmentProfile.moq 归一化 / InvoiceAllocation 触发器（代码层） |
| 🟢 P2（可选增强） | 3 项 | Settings_roles rank / MoqThresholdConfig previewImpact 缓存 / ApprovalRequest.reassignments 审计表 |

---

## §2 Migration 1 — MOQ 必做（P0-1 ~ P0-7）

> **依赖**：无前置依赖，可独立执行
> **影响范围**：新增 2 模型 + Order/OrderLine/Quotation/QuotationLine 各加列 + seed 初始配置
> **回滚**：DROP 新模型 + DROP COLUMN 新字段（不影响现有数据）

### P0-1 / P0-2：新增 MoqThresholdConfig + MoqThresholdConfigHistory

```prisma
// ============ MOQ 阈值配置（Admin 可调，非写死常量）============
// 设计真源：MOQ最小起订量.md §2.1 / §2.3
// 取数优先级第 5 级（产品档案/工厂合同/客户协议/行级 override 均高于此）
// 兜底代码常量（800/200/20）仅为第 6 级 last resort

model MoqThresholdConfig {
  id                 String   @id // 格式：MOQCFG__${shortId}
  fabricDefaultMoq   Int      // 面料档 MOQ（seed 默认 800，单位米）
  garmentDefaultMoq  Int      // 成衣档 MOQ（seed 默认 200，单位件）
  capsuleMoq         Int      // Capsule 档 MOQ（seed 默认 20，单位件；勾选 capsuleExemption 后降级使用）
  isActive           Boolean  @default(true) // 当前生效配置（DB 层仅允许 1 条 isActive=true）
  effectiveFrom      DateTime @default(now()) // 生效时间（支持定时生效）
  effectiveTo        DateTime? // 失效时间（被新配置替代时写入）

  // 审计
  changedBy          String   // 变更人 userId
  changeReason       String   // 变更理由（≥5 字必填，前端校验）
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([isActive])
  @@index([effectiveFrom])
}

// append-only 变更历史（无软删，不可篡改）
model MoqThresholdConfigHistory {
  id                      String   @id // 格式：MOQHIST__${shortId}
  configId                String   // 关联 MoqThresholdConfig.id

  // 变更前快照
  beforeFabricDefaultMoq  Int
  beforeGarmentDefaultMoq Int
  beforeCapsuleMoq        Int

  // 变更后快照
  afterFabricDefaultMoq   Int
  afterGarmentDefaultMoq  Int
  afterCapsuleMoq         Int

  // 审计
  changedBy               String   // 变更人 userId
  changeReason            String   // 变更理由
  changedAt               DateTime @default(now())

  @@index([configId])
  @@index([changedAt])
}
```

> **DB 层唯一性约束**：`isActive=true` 仅允许 1 条。PostgreSQL 实现方式：
> ```sql
> CREATE UNIQUE INDEX moq_threshold_config_only_one_active
> ON "MoqThresholdConfig" ((1)) WHERE "isActive" = true;
> ```

### P0-3 / P0-5 / P0-7：Order 模型加列

```prisma
// 在 Order 模型 businessLine 字段之后追加：

  // ============ MOQ 快照（writeOnce，创建时写入，不随配置变更追溯）============
  /// JSONB：{ fabricDefaultMoq, garmentDefaultMoq, capsuleMoq, snapshotAt, configId, source: 'moq_config' | 'fallback_constant' }
  /// 服务端在 Order.create 时 writeOnce 填充；后续不可更新（service 层强制）
  moqSnapshot            Json     @default('{}')

  // ============ Capsule MOQ 豁免标记（DR-003）============
  /// Capsule 勾选后 MOQ_effective 从 garmentDefaultMoq 降级为 capsuleMoq（不是完全无 MOQ）
  capsuleExemption       Boolean  @default(false)
  capsuleExemptionBy     String?  // 勾选操作者 userId
  capsuleExemptionAt     DateTime? // 勾选时间

  // ============ DR-005 内部面料交易标记 ============
  /// true = 内部关联方交易，不进入对外营收，财务报表独立归集抵销
  isInternalFabricTrade  Boolean  @default(false)
  /// isInternalFabricTrade=true 时必填，关联内部公司/关联方 ID
  internalCounterpartyId String?
```

> **businessLine 字段注释修正**（P0-7）：
> ```prisma
>   // 原：businessLine String? // fabric | garment | capsule（snapshot，不强制外键）
>   // 改为：
>   businessLine String? // fabric | garment | capsule | other（4值业务线标签；snapshot，不强制外键；capsule 仅对 type=Garment 生效的子类型透镜；other 对应 DR-028 其他贸易）
> ```

### P0-6：OrderLine / QuotationLine 加列

```prisma
// 在 OrderLine 模型 fieldSources 字段之后追加：

  // ============ MOQ 行级 override（取数优先级第 1 级，高于产品档案/系统配置）============
  /// 用户手工填写的行级 MOQ 覆盖值（需审批人备注 + scope: moq:line_override）
  moqOverride            Int?

// 在 QuotationLine 模型 notes 字段之后追加：
  moqOverride            Int? // 同上
```

### P0-4：Quotation 模型加列

```prisma
// 在 Quotation 模型 departmentId 字段之后追加：

  // ============ MOQ 快照（writeOnce，同 Order.moqSnapshot）============
  moqSnapshot            Json     @default('{}')
```

### P0-6 补充：OrderLine 加列（DR-005 内部结算价）

```prisma
// 在 OrderLine 模型追加：
  /// 内部交易结算价（isInternalFabricTrade=true 时启用，替代 unitPrice 做内部核算）
  internalTransferPrice  Decimal? @db.Decimal(18, 4)
```

### Seed 脚本

```typescript
// server/scripts/seed-moq-thresholds.ts（与 seed-rbac 同约定：npx tsx scripts/seed-moq-thresholds.ts）
await prisma.moqThresholdConfig.upsert({
  where: { id: 'MOQCFG__seed_initial' },
  create: {
    id: 'MOQCFG__seed_initial',
    fabricDefaultMoq: 800,
    garmentDefaultMoq: 200,
    capsuleMoq: 20,
    isActive: true,
    effectiveFrom: new Date(),
    changedBy: 'system_seed',
    changeReason: 'seed 初始配置',
  },
  update: {},
});
```

---

## §3 Migration 2 — 审批 + 财务域基础（P0-8 / P0-9 / P1-1）

> **依赖**：无前置依赖
> **影响范围**：ApprovalRequest 列约束变更 + PaymentVoucher 加列 + 新增 PaymentRequest 模型
> **回滚注意**：ApprovalRequest.reviewerId NOT NULL 需三步法（先兜底→回填→加约束）

### P0-8：ApprovalRequest.reviewerId 三步法 NOT NULL

```sql
-- Step 1：服务端兜底（代码层，非 SQL）
-- 在 approvalService.createRequest 中增加：
--   reviewerId = body.reviewerId ?? resolveReviewerByDepartment(body.requesterId)
--   if (!reviewerId) throw new Error('NO_REVIEWER_RESOLVED')
-- 部署后运行一段时间确认无 null 新增

-- Step 2：回填历史 null 行
UPDATE "ApprovalRequest"
SET "reviewerId" = (
  SELECT d."managerId"
  FROM "UserAccount" u
  JOIN "Department" d ON u."primaryDeptId" = d."id"
  WHERE u."id" = "ApprovalRequest"."requesterId"
)
WHERE "reviewerId" IS NULL;

-- 兜底：仍为 null 的行，指向第一个 ADMIN 用户
UPDATE "ApprovalRequest"
SET "reviewerId" = (
  SELECT ur."userId" FROM "UserRole" ur
  JOIN "Role" r ON ur."roleId" = r."id"
  WHERE r."id" = 'ADMIN' LIMIT 1
)
WHERE "reviewerId" IS NULL;

-- Step 3：加 NOT NULL 约束
ALTER TABLE "ApprovalRequest" ALTER COLUMN "reviewerId" SET NOT NULL;
```

```prisma
// ApprovalRequest 模型修改（Step 3 完成后）：
// 原：reviewerId   String?
// 改为：
  reviewerId   String    // DR-007：NOT NULL，服务端 resolveReviewerByDepartment 解析，前端不得传入
```

### P0-9：PaymentVoucher 加列 voucherCategory

```prisma
// 在 PaymentVoucher 模型 type 字段之后追加：

  // ============ 凭证分类（DR-022 三类费用归入）============
  /// normal(常规) | advance(预收款，DR-019) | deposit(保证金)
  /// | sample_express(样品快递费，DR-022，默认计入内部运营成本)
  /// | customer_reimburse(客户报销费用，DR-022)
  /// | business_cost(业务成本/招待费/佣金等，DR-022)
  voucherCategory       String   @default("normal")
```

```sql
-- 回填历史行
UPDATE "PaymentVoucher" SET "voucherCategory" = 'normal' WHERE "voucherCategory" IS NULL;
```

### P1-1：新增 PaymentRequest 模型（DR-017 先申请后付款）

```prisma
// ============ PaymentRequest 付款申请单（DR-017 先申请后付款）============
// 设计真源：财务域模型组.md §2.1
// 审批与执行分离：PaymentRequest(Approved) → 生成 PaymentVoucher(Disbursement)

model PaymentRequest {
  id                 String    @id // 格式：PAYR__${shortId}
  requestNumber      String    @unique // 业务申请号（如 PAYR-20260816-001）

  // ─── 业务字段 ───
  supplierId         String? // 供应商 Relation ID（snapshot FK）
  supplierName       String? // 冗余快照
  requestDate        String // 申请日期 YYYY-MM-DD
  expectedPaymentDate String? // 预期付款日期 YYYY-MM-DD
  totalAmount        Decimal  @db.Decimal(18, 4) // 申请金额
  currency           String   @default("CNY")

  // ─── 申请人 & 审批人（DR-007）───
  applicantId        String // 申请人 userId
  reviewerId         String // 审批人 userId（NOT NULL，DR-007 服务端 resolveReviewerByDepartment 解析）

  // ─── 状态机 ───
  // Draft(编辑中) → Pending(提交申请，DR-007 解析 reviewerId，生成 ApprovalRequest)
  // → Approved(审批通过，可生成 PaymentVoucher) / Rejected(驳回退回 Draft)
  // → Paid(关联 PaymentVoucher 已核销完毕) / Cancelled(作废)
  status             String   @default("Draft")

  // ─── 关联审批单 ───
  approvalRequestId  String? // 关联 ApprovalRequest.id（Approved 时必有）

  // ─── 关联付款凭证（Approved 后生成）───
  paymentVoucherId   String? // 关联 PaymentVoucher.id（Paid 时必有）

  // ─── 费用分类（同 PaymentVoucher.voucherCategory）───
  paymentCategory    String   @default("normal") // normal | advance | deposit | sample_express | customer_reimburse | business_cost

  // ─── 归属 ───
  ownerId            String? // 行级权限 dataScope
  departmentId       String?

  // ─── 备注 / 附件 ───
  remark             String?
  attachments        Json?

  // ─── 时间戳 + 软删 ───
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?

  @@index([status])
  @@index([supplierId])
  @@index([applicantId])
  @@index([reviewerId])
  @@index([requestNumber])
  @@index([requestDate])
  @@index([ownerId])
  @@index([departmentId])
}
```

---

## §4 Migration 3 — 信用闭环 + DR-005 + 薪酬授权（P1-2 ~ P1-8）

> **依赖**：无前置依赖
> **影响范围**：新增 3 模型 + CreditLimit/CustomerTier/InspectionReport 各加列

### P1-2 / P1-3：CreditLimit 加列 + 新增 CreditLimitHistory

```prisma
// CreditLimit 模型追加（在 deletedAt 之前）：

  // ============ 60天逾期冻结/解冻审计（15缺口 #8）============
  frozenAt            DateTime? // 冻结时间（crmService.runCreditRiskScan 60天逾期自动写入）
  frozenBy            String? // 冻结触发者（'system_credit_scan' 或手动操作人 userId）
  thawedReason        String? // 解冻理由（审批通过手动解冻 或 逾期款全额核销自动解冻）
  lastAutoScanDate    DateTime? // 最近一次信用巡检时间（每日 10:00 更新）

// ============ CreditLimitHistory 额度变更历史（append-only）============
// 设计真源：信用控制规则.md §2.2.1 额度释放闭环触发链路

model CreditLimitHistory {
  id              String   @id // 格式：CLHIST__${shortId}
  creditLimitId   String   // 关联 CreditLimit.id
  relationId      String   // 冗余：关联 Relation.id（便于按客户查历史）

  // ─── 变更前后 ───
  beforeUsedAmount Decimal @db.Decimal(18, 4)
  afterUsedAmount  Decimal @db.Decimal(18, 4)
  delta            Decimal @db.Decimal(18, 4) // after - before（负=释放，正=占用）

  // ─── 触发来源 ───
  triggerType     String   // payment_allocate(核销释放) | order_confirm(下单占用) | order_cancel(取消释放) | manual_adjust(手动调整) | credit_freeze(冻结) | credit_thaw(解冻)
  triggerId       String?  // 触发源 ID（InvoiceAllocation.id / Order.id / ApprovalRequest.id 等）
  triggerBy       String?  // 触发人 userId（系统自动则为 'system_*'）

  remark          String?
  createdAt       DateTime @default(now())

  @@index([creditLimitId])
  @@index([relationId])
  @@index([triggerType])
  @@index([createdAt])
}
```

### P1-4 / P1-5：OrderInternalTransfer 模型（DR-005）

```prisma
// ============ OrderInternalTransfer 内部面料交易核算（DR-005）============
// 设计真源：订单与生产模型组.md §2B.4

model OrderInternalTransfer {
  id                  String   @id // 格式：OIT__${shortId}
  orderId             String   // 关联 Order.id（isInternalFabricTrade=true 的订单）

  // ─── 交易方向 ───
  transferDirection   String   // outgoing(我方卖出) | incoming(我方买入)
  counterpartyId      String   // 关联方 ID（内部公司/关联方）
  ourDepartmentId     String?  // 我方归属部门

  // ─── 核算快照 ───
  transferAmount      Decimal  @db.Decimal(18, 4) // 内部交易金额
  transferCurrency    String   @default("CNY")
  transferDate        String   // 交易日期 YYYY-MM-DD

  // ─── 认账 ───
  recognizedBy        String?  // 认账人 userId
  recognizedAt        DateTime?

  memo                String?

  // ─── 时间戳 + 软删 ───
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  deletedAt           DateTime?

  @@unique([orderId, transferDirection]) // 一张订单每个方向仅 1 条
  @@index([orderId])
  @@index([counterpartyId])
  @@index([transferDirection])
}
```

### P1-6：CustomerTier 加列

```prisma
// CustomerTier 模型追加（在 paymentTermsDays 之后）：

  // ============ MOQ 折扣权益（取数优先级第 2 级）============
  /// MOQ 折扣比例（0.70 = 7折，例：Platinum Tier 面料 800m → 560m）
  /// null = 不享受 MOQ 折扣，按标准阈值执行
  moqOverrideRatio    Decimal? @db.Decimal(5, 2)
```

### P1-7：InspectionReport 加列 signatures

```prisma
// InspectionReport 模型追加（在模型尾部）：

  // ============ 产前样双签（质量门禁 §9.3-②）============
  /// JSONB：{ qcSignedAt, qcSignerId, businessSignedAt, businessSignerId }
  /// 后端 StageService.checkPreCutReady() 校验两字段均非空才放行开裁
  signatures          Json?    @default('{}')
```

### P1-8：新增 UserPermissionOverrides 模型

```prisma
// ============ UserPermissionOverrides 临时权限授权（决策点 4-A 薪酬绝密）============
// 设计真源：HR模块概述.md §10.6 / 薪酬与工资条.md §10
// SuperAdmin 可通过此表给指定人员追加敏感 scope（如 hr:salary:read + sensitive:salary）

model UserPermissionOverrides {
  id              String    @id // 格式：UPO__${shortId}
  userId          String    // 被授权用户 userId
  scope           String    // 权限 scope（如 'hr:salary:read' / 'sensitive:salary' / 'settings:moq:write'）

  // ─── 授权信息 ───
  grantedBy       String    // 授权人 userId（必须为 SuperAdmin）
  grantedAt       DateTime  @default(now())
  reason          String    // 授权理由
  expiresAt       DateTime? // 过期时间（null = 长期有效）

  // ─── 状态 ───
  isActive        Boolean   @default(true) // false = 已撤销

  // ─── 时间戳 + 软删 ───
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?

  @@unique([userId, scope]) // 同一用户同一 scope 仅 1 条 active
  @@index([userId])
  @@index([scope])
  @@index([isActive])
}
```

---

## §5 Migration 4 — 字段归一化 + 契约补全（P1-9 / P1-11）

### P1-11：GarmentProfile.moq String → Int 归一化

```prisma
// GarmentProfile 模型修改：
// 原：moq String?
// 改为（拆为两个字段）：
  moqValue        Int?     // 成衣 MOQ 数值（例：200）
  moqUnit         String   @default("PCS") // 单位（PCS / SET 等）

// Migration SQL：
-- 1. 先加新列
ALTER TABLE "GarmentProfile" ADD COLUMN "moqValue" INTEGER;
ALTER TABLE "GarmentProfile" ADD COLUMN "moqUnit" TEXT NOT NULL DEFAULT 'PCS';
-- 2. 从旧 moq String 中 parse 数字回填（正则提取数字部分）
UPDATE "GarmentProfile"
SET "moqValue" = CAST(SUBSTRING("moq" FROM '[0-9]+') AS INTEGER)
WHERE "moq" ~ '[0-9]+';
-- 3. 确认后删除旧列
ALTER TABLE "GarmentProfile" DROP COLUMN "moq";
```

### P1-9：OrderProfitSheet.details JSON 契约（代码层，非 schema 变更）

无需改 schema 字段（details Json 已存在）。在 service 层补 Zod 校验：

```typescript
// server/src/finance/orderProfitSheetSchema.ts（新增）
const CostBreakdownItemSchema = z.object({
  type: z.enum(['sample_express', 'customer_reimburse', 'business_cost', 'other']),
  voucherId: z.string(),
  amount: z.number().nonnegative(),
});

const ProfitSheetDetailsSchema = z.object({
  costBreakdown: z.array(CostBreakdownItemSchema).optional(),
  // ... 其他已有字段
});
```

### P1-12：InvoiceAllocation.afterInsert 触发器（代码层，非 schema 变更）

无需改 schema。在 service 层包装：

```typescript
// server/src/finance/invoiceAllocationRepo.ts（新增或修改）
async function createWithCreditRelease(
  allocation: InvoiceAllocationCreateInput,
  tx: PrismaTransaction
) {
  // 1. 写入 InvoiceAllocation
  const created = await tx.invoiceAllocation.create({ data: allocation });

  // 2. 同事务内重算 CreditLimit.usedAmount
  const customerInvoices = await tx.invoice.findMany({
    where: { customerRelationId: allocation.customerRelationId, status: { in: ['Issued', 'PartiallyPaid'] } },
    select: { amountOutstanding: true },
  });
  const newUsedAmount = customerInvoices.reduce((sum, inv) => sum + inv.amountOutstanding, 0);

  const creditLimit = await tx.creditLimit.findFirst({
    where: { relationId: allocation.customerRelationId, status: 'Active' },
  });
  if (creditLimit) {
    const before = creditLimit.usedAmount;
    await tx.creditLimit.update({
      where: { id: creditLimit.id },
      data: { usedAmount: newUsedAmount },
    });
    // 3. append CreditLimitHistory
    await tx.creditLimitHistory.create({
      data: {
        creditLimitId: creditLimit.id,
        relationId: allocation.customerRelationId,
        beforeUsedAmount: before,
        afterUsedAmount: newUsedAmount,
        delta: newUsedAmount.minus(before),
        triggerType: 'payment_allocate',
        triggerId: created.id,
        triggerBy: allocation.createdBy,
      },
    });
  }
  return created;
}
```

---

## §8 Migration 5 — DR-007 组织归属解析扩展 + 订单变更（DR-010）+ 面料 S/S 船样（P0-10 ~ P0-18）

> **依赖**：建议在 Migration 2（ApprovalRequest.reviewerId NOT NULL 三步法）之后执行；否则 ApprovalRequest.reviewerId 仍可空时扩展字段 NOT NULL 约束会冲突。
> **影响范围**：Department 加列 + ApprovalRequest 扩展 8 字段（1 NOT NULL / 1 writeOnce / 2 JSON 类 + BOSS 强制长度 / bypassedApprovalId）+ 新增 OrderChangeRequest + 新增 FabricShipmentSample
> **回滚注意**：ApprovalRequest.departmentSnapshotId NOT NULL → **三步法**（先加列允许 NULL → 写回填脚本按 requesterId→UserAccount.departmentId 先回填旧行 → 再改 NOT NULL；与 P0-8 reviewerId NOT NULL 类似模式）

### P0-10：Department.headId（resolveReviewerByDepartment 的部门 head 真源）

```prisma
// Department 模型：在 metadata 之后，createdAt 之前追加：

  // ============ 部门主管（DR-007 resolveReviewerByDepartment 入口真源）============
  /// FK UserAccount.id，headId=NULL → 触发 FALLBACK_DEPT_HEAD_VACANT 兜底（DR7-A4）
  /// 设计真源：底座域模型组.md §39
  headId               String?

  // ============ head 成员一致性（BASE-39-A1）：代码层校验，非FK约束 ============
  // （head 必须是本部门成员；跨部门 head 可选允许但告警）

  // 模型尾部索引追加：
  @@index([headId])
```

> **回填注意**：旧行 headId=NULL；迁移时若有旧 Department.managerId 或其他同名字段 → 先映射到 headId；无则保持 NULL（由系统管理员 scope 兜底 DR-007 FALLBACK）。

---

### P0-11 ~ P0-16：ApprovalRequest 扩展 8 字段（DR-007 全审计链）

```prisma
// ApprovalRequest 模型：在 decidedAt DateTime? 之后，relation 声明前追加：

  // ============ DR-007 reviewerResolverRoute（解析路径真源，createOnce 写入，不允许 NULL）============
  /// 枚举：DEPT_HEAD | FALLBACK_DEPT_HEAD_VACANT | FALLBACK_SELF_APPLY_SUPERVISOR | BOSS_FINAL_BYPASS
  /// 设计真源：底座域模型组.md §39 / 审批与human-in-the-loop.md §14
  reviewerResolverRoute String  // P0-11 NOT NULL（三步法加列，见 Migration 注意事项）

  // ============ 审批人主动转派（BASE-39-B2）3 字段 ============
  delegatedBy           String?  // P0-12 原审批人 userId（只有 reviewerId=本人可写）
  delegatedAt           DateTime? // 委托时间
  delegateReason        String?  // 委托理由（≥10字建议）

  // ============ 前端越权传入守卫审计（DEV-11-B4/DR7-A2）============
  clientReviewerIdSupplied Boolean @default(false) // P0-13 true=前端 body 中带 reviewerId（被忽略或拒绝）

  // ============ BOSS 最终兜底特批（P0-14，BASE-39-B3；绝密级仅 BOSS 容器可写；reason≥30字）============
  bossFinalBypassBy     String?    // BOSS userId
  bossFinalBypassAt     DateTime?  // 兜底时间
  bossFinalBypassReason String? @db.Text // 兜底理由（服务端 Zod 校验 ≥30 字 fail-closed）

  // ============ DR-013 例外绑定被拒审批（P0-15）============
  bypassedApprovalId    String? // 关联 ApprovalRequest.id（被 DR-013 例外绕过的原 Rejected 审批单；DR7-B4/BASE-39-B3 审计真源）

  // ============ 部门归属快照（P0-16，BASE-39-A2；调动部门不追溯未决审批 reviewerId——幂等 & 审计基础）============
  departmentSnapshotId  String // P0-16 NOT NULL（三步法：先加列 NULL → 按 requesterId→UserAccount.departmentId 回填旧行 → 改 NOT NULL）
```

> **NOT NULL 三步法通用模式（P0-11 / P0-16 适用）**：
> ```sql
> -- Step 1：加列允许 NULL
> ALTER TABLE "ApprovalRequest" ADD COLUMN "reviewerResolverRoute" TEXT;
> ALTER TABLE "ApprovalRequest" ADD COLUMN "departmentSnapshotId" TEXT;
>
> -- Step 2：回填旧行（createOnce 字段必须创建时写入，旧行统一兜底值：reviewerResolverRoute='DEPT_HEAD_LEGACY_FALLBACK'；departmentSnapshotId 用 requesterId→UserAccount.departmentId）
> UPDATE "ApprovalRequest"
> SET "reviewerResolverRoute" = 'DEPT_HEAD_LEGACY_FALLBACK'
> WHERE "reviewerResolverRoute" IS NULL;
>
> UPDATE "ApprovalRequest"
> SET "departmentSnapshotId" = (
>   SELECT "departmentId" FROM "UserAccount" u WHERE u."id" = "ApprovalRequest"."requesterId" LIMIT 1
> )
> WHERE "departmentSnapshotId" IS NULL;
>
> -- 仍为 NULL 的 departmentSnapshotId → 兜底 'DEPT_UNKNOWN_LEGACY'（不允许 NULL）
> UPDATE "ApprovalRequest" SET "departmentSnapshotId" = 'DEPT_UNKNOWN_LEGACY' WHERE "departmentSnapshotId" IS NULL;
>
> -- Step 3：加 NOT NULL 约束
> ALTER TABLE "ApprovalRequest" ALTER COLUMN "reviewerResolverRoute" SET NOT NULL;
> ALTER TABLE "ApprovalRequest" ALTER COLUMN "departmentSnapshotId" SET NOT NULL;
> ```

---

### P0-17：新增 OrderChangeRequest（DR-010 已批准订单变更申请——变更需审批不可业务员直改）

```prisma
// ============ OrderChangeRequest 订单变更申请（DR-010 已批准订单变更控制）============
// 设计真源：订单变更规则.md / 订单状态机.md §14 OSM-010-C1
// 触发路径：Order.status=Confirmed/Production 时业务员直改 → 后端 ORDER_ALREADY_CONFIRMED 拒绝 → 引导提交本单 → DR-007 路由部门主管审批 → 通过后在 OrderStatusTransition 生成变更门禁记录

model OrderChangeRequest {
  id                   String    @id // 格式：OCR__${shortId}
  orderId              String    // 关联 Order.id（必须 status=Confirmed/Production 以上）
  requestNumber        String    @unique // 业务号：OCR-YYYYMMDD-001

  // ─── 变更前快照（writeOnce） ───
  /// JSONB：{ quantity, unitPrice, deliveryDate, customer, shipToAddress, ... 所有允许变更字段的旧值 }
  beforeSnapshot       Json
  /// JSONB：{ quantity, unitPrice, deliveryDate, ... 所有允许变更字段的新值 }
  afterDelta           Json

  // ─── 变更类型 & 影响评估 ───
  changeTypes          String[]  // 枚举：quantity | unitPrice | deliveryDate | customer | ship_to | product_spec | payment_terms | other
  impactLevel          String    @default("medium") // low / medium / high（服务端自动评估：涉及价格/交期/数量≥10%=high）
  changeReason         String    @db.Text // 变更理由（≥15字必填 fail-closed）

  // ─── 申请人 & 审批（DR-007 组织归属解析）───
  requesterId          String    // 申请人 userId（业务员）
  reviewerId           String    // NOT NULL，DR-007 resolveReviewerByDepartment 解析
  approvalRequestId    String?   // 关联 ApprovalRequest.id（可选：通用审批复用）

  // ─── 状态机 ───
  // Draft → Pending(DR-007解析reviewerId) → Approved(写入OrderStatusTransition + 回写Order) / Rejected(退回Draft) / Cancelled
  status               String    @default("Draft")

  // ─── 执行结果 ───
  appliedAt            DateTime? // Approved 后实际回写 Order 的时间
  appliedBy            String?   // 回写操作者（服务端后台=system_change_apply 或 申请人Apply按钮）

  notes                String?
  attachments          Json?

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime?

  @@index([orderId])
  @@index([status])
  @@index([requesterId])
  @@index([reviewerId])
  @@index([requestNumber])
  @@index([impactLevel])
}
```

---

### P0-18：新增 FabricShipmentSample（S/S 船样——DR-014/016 面料出运条件 3 之一：S/S 确认）

```prisma
// ============ FabricShipmentSample 面料 S/S 船样（DR-014 出运条件 3 并行之一）============
// 设计真源：QC模块概述.md §16 QC-014 / 订单与生产模型组.md §14 样品 × QC 强边界
// 业务语义：面料链在大货生产后、出运前，截取大货样=S/S船样寄客户确认；样品与QC内部门禁弱关联（通常业务登记为主，客户不通过才转QC——见DR-029）；与 Shipment 绑定 1:N。

model FabricShipmentSample {
  id                   String    @id // 格式：FSS__${shortId}
  sampleCode           String    @unique // 业务号：FSS-YYYYMMDD-001

  // ─── 业务归属（1张 Shipment 可有多个 S/S 样；同 Shipment 可多批次） ───
  shipmentId           String    // 关联 Shipment.id（出运单；若 Shipment 还未建则先空后绑定）
  orderId              String    // 关联 Order.id（业务归属订单；便于未建Shipment时溯源）
  fabricProfileId      String?   // 关联 FabricProfile.id（冗余快照）

  // ─── 样品基础信息 ───
  sampleQuantity       Decimal   @db.Decimal(10, 2) // 取样长度（米）
  sampleUnit           String    @default("meter")
  batchNo              String?   // 对应大货生产批次号
  rollNos              String[]  @default([]) // 取样卷号（便于追溯）
  cuttingDate          String    // 取样日期 YYYY-MM-DD

  // ─── 寄送信息 ───
  sentToCustomer       Boolean   @default(false)
  sentDate             String?   // 寄出日期 YYYY-MM-DD
  courier              String?   // 快递商（DHL/FedEx/SF 等）
  trackingNumber       String?   // 快递单号
  recipientName        String?   // 收件人
  recipientContact     String?

  // ─── 客户确认（3 并行条件 2/3：S/S 确认；Shipment.releaseReady 校验此条件之一） ───
  customerStatus       String    @default("pending") // pending | approved | rejected | needs_revision
  customerFeedbackDate String?
  customerFeedbackNote String?   @db.Text

  // ─── QC 责任（DR-029 面料链：QC 不做第一门禁，customerStatus=rejected 或业务员主动请求才转QC） ───
  qcInspectionReportId String?   // 关联 InspectionReport.id（type=FabricSS 或 EarlyProduction；面料QC评审结果）
  qcRequestedBy        String?   // 业务主动转QC 操作者 userId
  qcRequestedAt        DateTime?

  notes                String?
  attachments          Json?     // 样品照片、快递单扫描件等

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime?

  @@index([shipmentId])
  @@index([orderId])
  @@index([customerStatus])
  @@index([sentToCustomer])
  @@index([qcInspectionReportId])
}
```

---

## §9 Migration 6 — 早期生产样 + 客户协议MOQ + DR-013 受控例外 + UserAccount.departmentId 一致性（P1-13 ~ P1-16）

> **依赖**：可独立执行；其中 P1-14 Relation.customerAgreementMoq 与 Migration 1 的 MOQ 配置可并行。
> **影响范围**：新增 EarlyProductionSample（P1-13）/ Relation 加列（P1-14）/ 新增 Dr013ExceptionRequest（P1-15）/ P1-16 代码层一致性校验脚本

### P1-13：新增 EarlyProductionSample（面料早期生产样——出运前置但非强制性，客户不通过才转QC）

```prisma
// ============ EarlyProductionSample 面料早期生产样（DR-015 面料投产追踪）============
// 设计真源：订单与生产模型组.md §14 样品类型表 / QC模块概述.md §16 QC-015
// 业务语义：面料大货开机后早期（例：第 500 米出缸时）先送 2~5 米样品=早期生产样；客户提前评估颜色/手感/幅宽；与 QC 可选关联（DR-029 面料链业务登记为主）。
// 与 FabricShipmentSample(S/S) 的关系：EarlyProductionSample → 客户反馈 → 大货继续/调整 → FabricShipmentSample(S/S) → 大货QC → 出运（3 条件并行）。

model EarlyProductionSample {
  id                   String    @id // 格式：EPS__${shortId}
  sampleCode           String    @unique // 业务号：EPS-YYYYMMDD-001

  orderId              String    // 关联 Order.id（面料订单，业务归属）
  fabricProfileId      String?   // FabricProfile.id
  millName             String?   // 冗余：生产工厂

  // ─── 样品基础 ───
  sampleQuantity       Decimal   @db.Decimal(10, 2)
  sampleUnit           String    @default("meter")
  productionStage      String?   // 取样阶段（例：greige_out_of_loom / after_dyeing / after_finishing——供质检追溯）
  producedMeterage     Decimal?  @db.Decimal(12, 2) // 取样时已生产米数（判断是否足够早期）
  cuttingDate          String    // 取样日期

  // ─── 业务寄送 & 客户确认 ───
  sentToCustomer       Boolean   @default(false)
  sentDate             String?
  trackingNumber       String?
  customerStatus       String    @default("pending") // pending | approved | rejected | adjust_and_resend
  customerFeedbackDate String?
  customerFeedbackNote String?   @db.Text

  // ─── QC（DR-029：仅 customerStatus=rejected 或业务主动转QC时调用） ───
  qcInspectionReportId String?
  qcRequestedBy        String?
  qcRequestedAt        DateTime?

  // ─── 调整 & 重发（customerStatus=adjust_and_resend 时链到下次 EarlyProductionSample） ───
  previousSampleId     String?   // 反向关联 EarlyProductionSample.id（第 N 轮→第 N+1 轮调整链）

  notes                String?
  attachments          Json?

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime?

  @@index([orderId])
  @@index([customerStatus])
  @@index([previousSampleId])
  @@index([qcInspectionReportId])
}
```

---

### P1-14：Relation.customerAgreementMoq（客户协议MOQ——MOQ取数第 3 级）

```prisma
// Relation 模型：在 customerTiers CustomerTier[] 后、索引前追加：

  // ============ 客户协议MOQ（MOQ取数第 3 级：高于系统配置 & Tier 折扣，低于工厂合同 & 产品档案 & 行级 override）============
  /// 设计真源：MOQ最小起订量.md §2.2 取数优先级
  /// JSONB：{ fabricDefaultMoq?: number, garmentDefaultMoq?: number, capsuleMoq?: number, agreementDate?: string, agreementRef?: string }
  /// 无协议客户本字段=null（→ 降级用 Tier 折扣 × 系统配置 MoqThresholdConfig）
  customerAgreementMoq Json?

  // ============ MOQ 客户 Tier 反向关联（冗余保留；与 CustomerTier.moqOverrideRatio 1:N 对齐） ============
  // 已有 customerTiers CustomerTier[]
```

---

### P1-15：新增 Dr013ExceptionRequest（DR-013 受控例外——被拒审批后申请例外，审计链完整）

```prisma
// ============ Dr013ExceptionRequest DR-013 受控例外申请（绕过被拒审批/门禁）============
// 设计真源：审批与human-in-the-loop.md §14 DR7-B4 / 底座域模型组.md §39 BASE-39-B3
// 业务语义：某审批单（MOQ/价格/变更/出运/样品等）被主管/Z Rejected 后，业务认为必须破例 → 发起 Dr013ExceptionRequest → 仍走 DR-007 组织归属（主管自申请→Z→BOSS 兜底）。
// 与 ApprovalRequest 关系：1 张 Dr013ExceptionRequest 绑定 1~N 张被拒 ApprovalRequest（bypassedApprovalIds 数组），最终通过后写入每张 ApprovalRequest.bypassedApprovalId 反链。

model Dr013ExceptionRequest {
  id                   String    @id // 格式：EXC__${shortId}
  exceptionNumber      String    @unique // 业务号：EXC-YYYYMMDD-001

  // ─── 例外分类（与 5 类豁免端到端对齐，DEV-11-A1~A4） ───
  exceptionCategory    String    // moq_exemption | price_deviation | order_change | shipment_release | qc_fault | payment_term | sample_skip | other
  subCategory          String?   // 细分（例：shipment_release 的 "without_ss_confirmed" / "qc_final_failed" 等）

  // ─── 被绕过的被拒审批链（≥1 张 ApprovalRequest.status=REJECTED） ───
  bypassedApprovalIds  String[]  // 绑定的 ApprovalRequest.id 列表（反链：ApprovalRequest.bypassedApprovalId 指向本 EXC 审批）

  // ─── 核心理由 & 客户承诺（≥30字 fail-closed；最终 BOSS 兜底用） ───
  exceptionReason      String    @db.Text // 例外理由（业务语义；≥30字）
  customerCommitment   String?   @db.Text // 客户书面承诺（例："客户已书面承诺额外补偿 + 次年 3 倍增量订单"；最终兜底时建议写本字段）
  riskMitigationPlan   String?   @db.Text // 风险应对措施（例："已冻结客户 20% 尾款作为保证金"；有则更强）

  // ─── 申请人 & 审批（仍走 DR-007） ───
  requesterId          String
  reviewerId           String    // NOT NULL，DR-007 resolveReviewerByDepartment
  approvalRequestId    String?   // 关联 ApprovalRequest.id（本 EXC 请求的审批链；非 bypassed 的审批）

  // ─── 状态机 ───
  // Draft → Pending → ReviewerApproved / ReviewerRejected（Z Rejected）→ BossFinalBypass（若启动）→ Approved / Cancelled
  status               String    @default("Draft")

  // ─── BOSS 最终兜底（与 ApprovalRequest.bossFinalBypass* 对齐；冗余便于 EXC 独立视图查询） ───
  bossFinalBypassBy    String?
  bossFinalBypassAt    DateTime?
  bossFinalBypassReason String?   @db.Text // ≥30字，同 ApprovalRequest 校验

  notes                String?
  attachments          Json?     // 客户承诺邮件截图、合同扫描件等

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime?

  @@index([exceptionCategory])
  @@index([status])
  @@index([requesterId])
  @@index([reviewerId])
  @@index([exceptionNumber])
}
```

---

### P1-16：UserAccount.departmentId 一致性校验 & 调动审计（代码层 + 迁移脚本，非 Schema 必改）

```prisma
// Schema 侧：若 UserAccount.departmentId 不存在则补齐（多数项目已存在；缺则加）
// 若已有，则补迁移脚本 + 代码层 service 守卫：

// server/src/base/departmentUserConsistency.ts（新增）
// 1. 启动时跑一次：UserAccount.departmentId vs Department 存在性 → 报告脏数据（departmentId=X 但 Department X 不存在）
// 2. HR.employeeProfile.update 部门调动时：
//    - 不修改未决 ApprovalRequest.reviewerId（=原部门 head；由 departmentSnapshotId 固化；BASE-39-A2）
//    - 写入 UserDepartmentHistory append-only（可选 P2 增强；P1 先写 AuditLog 事件 USER_DEPT_CHANGED）
// 3. resolveReviewerByDepartment 始终用申请人.departmentId（=当前归属）对新创建审批；旧未决单完全不读新归属
```

---

## §10 迁移执行顺序总表（更新后，含 Migration 5/6）

| 批次 | Migration | 包含缺口 | 可并行 | 预计影响 |
|------|-----------|---------|--------|---------|
| 1 | `20260816_migrate_moq_thresholds` | P0-1~7 + P1-5 半 + P1-4 半 | ✅ 独立 | 新增 2 模型 + 4 模型加列 + seed |
| 2 | `20260816_migrate_approval_finance` | P0-8 + P0-9 + P1-1 + **P0-10（Department.headId 可先加列）** | ⚠️ 独立（P0-11~P0-16 须在 P0-8 reviewerId NOT NULL 三步法后跟进） | ApprovalRequest 约束变更 + PaymentVoucher 加列 + 新增 PaymentRequest |
| 2.5 | `20260817_migrate_dr007_approval_ext` | **P0-11 ~ P0-16（ApprovalRequest 扩展8字段）** ——Migration 2 三步法回填完成后执行 | ⚠️ 依赖 Migration 2 Step 3 完成 | ApprovalRequest 扩展 8 字段（2个 NOT NULL 需三步法：reviewerResolverRoute/departmentSnapshotId）+ 回填 + 加约束 |
| 3 | `20260816_migrate_credit_internal_hr` | P1-2~3 + P1-4 整 + P1-6~8 + **P1-14（Relation.customerAgreementMoq可在此批）** | ✅ 独立（与 1/2/2.5/5 都不冲突） | 新增 3 模型 + 4 模型加列 |
| 4 | `20260817_migrate_field_normalize` | P1-9 + P1-11 + P1-12 + **P1-16（UserAccount.departmentId一致性）** | ✅ 独立 | GarmentProfile 归一化 + 代码层 Zod + InvoiceAllocation 触发器 + 调动一致性脚本 |
| 5 | `20260818_migrate_dr010_change_dr014_sample` | **P0-17（OrderChangeRequest，DR-010）+ P0-18（FabricShipmentSample，DR-014/016）** | ✅ 独立（不与 1~3 互锁；与 4 可并行） | 新增 2 模型 + Order.status ≥ Confirmed 改业务链路走本单 |
| 6 | `20260818_migrate_p1_samples_exceptions` | **P1-13（EarlyProductionSample）+ P1-15（Dr013ExceptionRequest，DR-013）** | ✅ 独立；与批次 5 可并行（两张样品表不互锁） | 新增 2 模型 + DR-013 受控例外审计链 + 样品多轮调整链 previousSampleId |
| — | P2 增强（后两批次按需） | P2-1~P2-5（Settings_roles rank / Moq previewImpact / 委派审计 / 委派链 / 预警阈值） | 可选延迟 | 不阻塞 P0/P1 业务真源 |

> **强依赖链（严禁并行）**：Migration 2（P0-8 reviewerId NOT NULL 三步法）→ Migration 2.5（P0-11/P0-16 NOT NULL 三步法）→ 后批次随意。
> 其余批次（1/3/4/5/6）均完全独立，可 6 个 migration 并行部署。

---

## §11 关联设计文档索引（更新后，含 DR-007/DR-010/DR-013/样品出运链）

| 文档 | 关联缺口 |
|------|---------|
| [MOQ最小起订量.md](../03-业务规则/MOQ最小起订量.md) §2.1-2.4 / §15 验收矩阵 | P0-1~7（MoqThresholdConfig / moqSnapshot / capsuleExemption / moqOverride）+ **P1-14（Relation.customerAgreementMoq，第 3 级取数优先级）** + **P1-6（CustomerTier.moqOverrideRatio，第 2 级）** + **P1-11（GarmentProfile.moqValue/Unit，第 4 级产品档案）** |
| [业务规则总览.md](../03-业务规则/业务规则总览.md) §X 15缺口矩阵 | P0-8（ApprovalRequest.reviewerId NOT NULL，DR-007 全部审批通用） |
| [财务域模型组.md](./财务域模型组.md) §2.1 | P1-1（PaymentRequest 模型）/ P0-9（voucherCategory）/ P1-9（costBreakdown 契约） |
| [订单与生产模型组.md](./订单与生产模型组.md) §2B.4 / §14 样品×QC强边界 | P1-4 / P1-5（DR-005 内部面料交易）+ **P0-18（FabricShipmentSample S/S）** + **P1-13（EarlyProductionSample 早期生产样）** |
| [底座域模型组.md](./底座域模型组.md) §39 DR-007 组织归属解析验收 | **P0-10（Department.headId）** + **P0-11~16（ApprovalRequest 扩展8字段）** + P1-8（UserPermissionOverrides）+ **P1-16（UserAccount.departmentId 一致性）** |
| [审批与 human-in-the-loop.md](../04-模块设计/07-AI助手/审批与human-in-the-loop.md) §14 DR-007 组织归属解析验收 | **P0-11~16（reviewerResolverRoute/delegated*/clientReviewerIdSupplied/BOSS*/bypassedApprovalId/departmentSnapshotId）** + **P0-15（bypassedApprovalId 绑定 DR-013 被拒审批）** + **P1-15（Dr013ExceptionRequest）** |
| [偏差校验与审批链.md](../04-模块设计/03-订单与生产/Pricing-定价与成本/偏差校验与审批链.md) §11 DR-007 5类豁免端到端验收 | P0-8 + P0-11~16 + P1-15（DR-013 受控例外） |
| [订单状态机.md](../04-模块设计/03-订单与生产/Orders-订单管理/订单状态机.md) §14 DR-010 变更控制（OSM-010-C1~OSM-010-E2） | **P0-17（OrderChangeRequest，订单变更申请）** |
| [QC 质检中心模块概述.md](../04-模块设计/03-订单与生产/QcWorkbench-QC质检中心/模块概述.md) §16 DR-014/015/016/029 样品QC验收 | **P0-18（FabricShipmentSample S/S，DR-014 并行条件）** + **P1-13（EarlyProductionSample，DR-015 投产追踪）** + P1-7（InspectionReport.signatures 双签） |
| [客户与关系模型组.md](./客户与关系模型组.md) | P1-2~3（CreditLimit + History）/ P1-6（CustomerTier.moqOverrideRatio）+ **P1-14（Relation.customerAgreementMoq 协议MOQ）** |
| [10条事件联动.md](../03-业务规则/10条事件联动（L1-L10）与事件总线.md) §X | P0-8（ApprovalPolicy 规则驱动迁移四步走）+ P1-12（InvoiceAllocation 信用释放触发器） |
