# P1-D: order.confirm UX Acceptance Checklist

> Status: DRAFT — for codex review
> Owner: BAMBOOK 项目总设计师
> Scope: UX validation only — no email/postCommitHook (same as P1-A)

## 1. User Journey: Natural Language -> Approval Card

### 1.1 Happy Path

User says: "确认订单 PO-2024-001" (or "confirm order PO-2024-001")

Agent should:
1. Call `order.confirm` with orderId/poNumber
2. draftPhase reads order snapshot, generates ProcessDraft
3. Approval card appears in Agent workspace

**User sees approval card with:**

```
┌─────────────────────────────────────────────┐
│  确认订单 PO-2024-001                          │
│                                               │
│  变更清单:                                     │
│  • 订单状态: Pending -> Confirmed              │
│  • 创建发票 INV-2024-001: $5,000 USD (应收)    │
│                                               │
│  不可逆操作:                                   │
│  • 订单状态变更 (不可撤销)                      │
│  • 发票创建属于财务审计动作，需走冲销/作废流程                          │
│                                               │
│  影响范围: 订单、发票                           │
│                                               │
│           [拒绝]    [确认确认]                  │
└─────────────────────────────────────────────┘
```

**UX requirement:** User must understand WHAT changes, WHAT is irreversible, and WHAT modules are affected — before clicking approve.

### 1.2 Approval Card Acceptance Items

| Item | Requirement | Anti-pattern (禁止) |
|---|---|---|
| Title | Business action: "确认订单 PO-XXX" | Technical: "order.confirm" |
| Change list | Field-level: "状态 Pending -> Confirmed" | Vague: "订单将被确认" |
| Amount display | "$5,000 USD" with currency | Bare number "5000" |
| Irreversible markers | Icon + text on status + invoice | Hidden or missing |
| Impact scope | Human: "订单、发票" | Internal: ["orders","invoices"] |
| Approve button | "确认确认" (double confirm wording) — P1-D UX 建议，最终按钮文案需前端/产品确认 | Just "确认" (too easy to misclick) |
| Reject button | "拒绝" clearly visible | Only approve button |
| Email note | "当前 scope 暂不包含自动邮件通知" if user expects email | Silent omission |

## 2. Success Feedback

### 2.1 After Approval + Transaction Commit

**User sees:**

```
✅ 订单 PO-2024-001 已确认

订单状态: Confirmed
发票 INV-2024-001: $5,000 USD (已开票)

提示: 确认邮件尚未自动发送（当前 scope 限制），请手动在邮件模块发送确认通知。
```

**UX requirements:**
- Must confirm BOTH order status AND invoice created
- Must explicitly tell user email was NOT sent (manage expectation)
- Invoice number must be visible for cross-reference
- No false sense of "everything done" — email is manual

### 2.2 Anti-patterns (禁止的误导文案)

| 误导文案 | 问题 | 正确文案 |
|---|---|---|
| "订单已确认，通知已发送" | email 未发 | "订单已确认，邮件需手动发送" |
| "操作完成" | 太模糊 | "订单 Confirmed + 发票 INV-XXX 已开票" |
| "成功" | 无具体信息 | 必须列出 status + invoice number |
| "已完成所有步骤" | email 未做 | "订单+发票已完成，邮件待手动发送" |

## 3. Failure Feedback (5 Fail-Closed Scenarios)

### 3.1 Draft Failure — Missing Preconditions

**Scenario:** Order missing customer relation / no line items / not Pending

**User sees:**
```
❌ 无法确认订单 PO-2024-001

原因: [具体原因，从以下选一]
• 订单缺少客户关联 (无法创建发票)
• 订单没有行项目 (无法开票)
• 订单当前状态不是 Pending (当前: Production)

下一步: [具体建议]
• 请先在订单详情页补充客户信息，然后重新确认
• 请先添加行项目，然后重新确认
• 订单已在生产中，无需再次确认
```

**UX requirement:** Every failure MUST include a specific next-step suggestion. User must never be left thinking "what do I do now?"

### 3.2 Draft Failure — Invalid Amount

**Scenario:** totalActual/totalNet/quoteAmount all <= 0

**User sees:**
```
❌ 无法确认订单 PO-2024-001

原因: 订单金额异常 (实际金额、净金额、报价均为零或无效)

下一步: 请检查订单金额字段 (totalActual/totalNet/quoteAmount)，修正后重新确认。
```

### 3.3 Approval Rejected

**Scenario:** User clicks "拒绝"

**User sees:**
```
订单 PO-2024-001 确认已取消。

订单状态不变: Pending
无发票创建，无任何变更。

如需稍后确认，可重新发起。
```

**UX requirement:** Rejection must reassure "nothing changed." User must feel safe rejecting.

### 3.4 Modified Approval — Fail Closed

**Scenario:** Approval system returns modified state

**User sees:**
```
❌ 审批异常: 检测到修改状态

order.confirm 不支持修改审批 (P1-A 限制)。请重新发起确认，系统将生成新的审批单。
```

**UX requirement:** Explain WHY fail (not supported), tell HOW to proceed (re-invoke).

### 3.5 Status Drift / Missing Draft / Transaction Failure

**Scenario:** Order changed between draft and commit / draft not found / DB error

**User sees:**
```
❌ 确认失败: [具体原因]

• 订单状态已变更 (他人可能同时操作) → 请刷新后重新确认
• 审批单不存在或已过期 → 请重新发起确认
• 系统错误 → 请稍后重试或联系管理员

订单状态不变: Pending，无任何变更。
```

**UX requirement:** Must reassure "order unchanged, no side effects."

## 4. Misleading Copy Checklist (文案审查)

These phrases MUST NOT appear in any user-facing message:

| 禁止文案 | 原因 |
|---|---|
| "已通知客户" | email 未发送 |
| "邮件已发送" | email 未发送 |
| "全部完成" | email 未做 |
| "操作不可逆，请确认" | 太模糊，不说什么不可逆 |
| "系统错误" alone | 必须附 next-step |
| "请稍后重试" alone | 必须附具体原因 |
| "确认" as button | 太容易误点，用"确认确认" |
| Tool IDs (orders.update_status) | 用户看不懂，用业务名 |

## 5. Mandatory Next-Step Rules

Every failure scenario MUST include a next-step suggestion:

| Failure Type | Required Next-Step |
|---|---|
| Missing customer | "请先在订单详情页补充客户信息" |
| No line items | "请先添加行项目" |
| Wrong status | "订单当前是 {status}，无需确认 / 请先回退状态" |
| Amount <= 0 | "请检查 totalActual/totalNet/quoteAmount 字段" |
| Modified | "请重新发起确认生成新审批单" |
| Status drift | "请刷新后重新确认" |
| Transaction error | "请稍后重试或联系管理员" |
| Rejected | "如需稍后确认，可重新发起" |

**Iron rule:** No user should ever see a failure with no next-step suggestion.

## 6. Scope Exclusions (P1-D)

Same as P1-A — P1-D does NOT validate:
- Email send/draft (future notification/email slice (e.g., P1-E or later))
- EmailQueue retry (future notification/email slice (e.g., P1-E or later))
- postCommitHook execution (none in P1-A/D)
- Batch confirm (future)
- Multi-level approval (future)
- SMS notifications (future)
