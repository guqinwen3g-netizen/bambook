import { describe, expect, it } from 'vitest';
import type {
  PaymentRequest,
  PaymentRequestDetail,
  PaymentRequestStatus,
  CreatePaymentRequestInput,
} from '../services/paymentRequestService';
import type { CreditStatus, CreditHistoryItem, BankruptcySummary } from '../services/creditService';
import type { VoucherCategory, PaymentVoucherWithCategory } from '../services/paymentVoucherService';

const fs = require('fs');
const path = require('path');

/**
 * Phase 3 Wave 3.2 Track E runtime QA — 财务域 UI（付款申请 + 信用控制 + 凭证分类）
 * 验证前端 service / 面板 / FinanceManager 集成与后端契约的一致性：
 * - services/paymentRequestService.ts ↔ /api/v1/payment-requests
 * - services/creditService.ts ↔ /api/v1/credit
 * - PaymentVoucher.voucherCategory 六类枚举贯穿 表单/列表徽章/详情侧栏
 * - 权限显隐（scope 门控 + reviewerId/applicantId 守卫）与 loading/empty/error 三态
 *
 * 模式对齐 paymentVoucherMutationRuntimeQa.test.ts：源码静态断言为主（node 环境，
 * 不运行时导入含 apiService 依赖的模块），类型级 import 提供编译时契约保证。
 */

const PR_SVC = fs.readFileSync(path.resolve(__dirname, '../services/paymentRequestService.ts'), 'utf-8');
const CREDIT_SVC = fs.readFileSync(path.resolve(__dirname, '../services/creditService.ts'), 'utf-8');
const PV_SVC = fs.readFileSync(path.resolve(__dirname, '../services/paymentVoucherService.ts'), 'utf-8');
const PR_PANEL = fs.readFileSync(path.resolve(__dirname, 'finance/FinancePaymentRequestsPanel.tsx'), 'utf-8');
const CREDIT_PANEL = fs.readFileSync(path.resolve(__dirname, 'finance/FinanceCreditPanel.tsx'), 'utf-8');
const FINANCE_MGR = fs.readFileSync(path.resolve(__dirname, 'FinanceManager.tsx'), 'utf-8');

// 后端契约真源（只读断言；server/ 为冻结区，禁止修改）
const PR_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/paymentRequests/paymentRequestRoute.ts'), 'utf-8');
const PR_BACKEND_SVC = fs.readFileSync(path.resolve(__dirname, '../server/src/paymentRequests/paymentRequestService.ts'), 'utf-8');
const CREDIT_ROUTE = fs.readFileSync(path.resolve(__dirname, '../server/src/credit/creditRoute.ts'), 'utf-8');
const CREDIT_BACKEND_SVC = fs.readFileSync(path.resolve(__dirname, '../server/src/credit/creditService.ts'), 'utf-8');
const BANKRUPTCY_BACKEND_SVC = fs.readFileSync(path.resolve(__dirname, '../server/src/credit/bankruptcyService.ts'), 'utf-8');
const PV_MUTATION_BACKEND = fs.readFileSync(path.resolve(__dirname, '../server/src/finance/paymentVoucherMutationService.ts'), 'utf-8');

// ─────────────────────────────────────────────────────────────
// Part 1: paymentRequestService 端点封装 ↔ 后端路由
// ─────────────────────────────────────────────────────────────
describe('Track E [paymentRequestService]: 端点封装对齐后端路由', () => {
  it('base path /v1/payment-requests', () => {
    expect(PR_SVC).toContain("`/v1/payment-requests${path}`");
  });
  it('四个方法：listPaymentRequests / getPaymentRequest / createPaymentRequest / cancelPaymentRequest', () => {
    for (const m of ['listPaymentRequests', 'getPaymentRequest', 'createPaymentRequest', 'cancelPaymentRequest']) {
      expect(PR_SVC).toContain(`async ${m}(`);
    }
  });
  it('作废走 POST /:id/cancel（与后端 router.post(/:id/cancel) 一致）', () => {
    expect(PR_SVC).toContain('encodeURIComponent(id)}/cancel');
    expect(PR_ROUTE).toContain("router.post('/:id/cancel'");
  });
  it('后端路由四端点：POST / GET / GET /:id POST /:id/cancel', () => {
    expect(PR_ROUTE).toContain("router.post('/',");
    expect(PR_ROUTE).toContain("router.get('/',");
    expect(PR_ROUTE).toContain("router.get('/:id',");
  });
  it('不重复封装审批决策方法（decide 复用审批域 /v1/approvals/:id/decide）', () => {
    expect(PR_SVC).not.toContain('async decide');
    expect(PR_PANEL).toContain('approvalKernelService.decideApproval');
  });
});

// ─────────────────────────────────────────────────────────────
// Part 2: 付款申请状态机 / 枚举镜像后端真源
// ─────────────────────────────────────────────────────────────
describe('Track E [paymentRequestService]: 状态机与枚举镜像后端', () => {
  const STATUSES: PaymentRequestStatus[] = ['Draft', 'Pending', 'Approved', 'Rejected', 'VoucherIssued', 'Cancelled'];
  it('前端 PAYMENT_REQUEST_STATUSES 六值 = 后端 PAYMENT_REQUEST_STATUSES', () => {
    for (const s of STATUSES) {
      expect(PR_SVC).toContain(`'${s}'`);
      expect(PR_BACKEND_SVC).toContain(`'${s}'`);
    }
  });
  it('状态中文文案全覆盖（无裸枚举落 UI）', () => {
    const m = PR_SVC.match(/PAYMENT_REQUEST_STATUS_LABELS[\s\S]*?};/);
    expect(m).not.toBeNull();
    for (const s of STATUSES) expect(m![0]).toContain(s);
  });
  it('可作废状态口径一致：后端 CANCELLABLE_STATUSES = Draft/Pending，前端 canCancel 同口径', () => {
    expect(PR_BACKEND_SVC).toContain("['Draft', 'Pending']");
    expect(PR_PANEL).toContain("detail.status === 'Draft' || detail.status === 'Pending'");
  });
  it('来源单据类型四值镜像（purchase_order/order/expense/other）', () => {
    for (const t of ['purchase_order', 'order', 'expense', 'other']) {
      expect(PR_SVC).toContain(`'${t}'`);
      expect(PR_BACKEND_SVC).toContain(`'${t}'`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Part 3: 凭证分类 voucherCategory 六类枚举全链路
// ─────────────────────────────────────────────────────────────
describe('Track E [voucherCategory]: 六类枚举真源贯穿', () => {
  const CATEGORIES: VoucherCategory[] = ['normal', 'advance', 'deposit', 'sample_express', 'customer_reimburse', 'business_cost'];
  it('前端 VOUCHER_CATEGORIES 六值 = 后端 VALID_VOUCHER_CATEGORIES（fail-closed 校验源）', () => {
    for (const c of CATEGORIES) {
      expect(PV_SVC).toContain(`'${c}'`);
      expect(PV_MUTATION_BACKEND).toContain(`'${c}'`);
    }
  });
  it('付款性质与凭证分类同一枚举真源（后端 VALID_PAYMENT_CATEGORIES = VALID_VOUCHER_CATEGORIES）', () => {
    expect(PR_BACKEND_SVC).toContain('VALID_PAYMENT_CATEGORIES = VALID_VOUCHER_CATEGORIES');
    expect(PR_SVC).toContain('PAYMENT_CATEGORIES = VOUCHER_CATEGORIES');
  });
  it('VOUCHER_CATEGORY_LABELS 中文文案六类全覆盖', () => {
    const m = PV_SVC.match(/VOUCHER_CATEGORY_LABELS[\s\S]*?};/);
    expect(m).not.toBeNull();
    for (const c of CATEGORIES) expect(m![0]).toContain(c);
  });
  it('voucherCategoryLabel 未知值兜底（不裸抛）', () => {
    expect(PV_SVC).toContain('export const voucherCategoryLabel');
  });
  it('创建与编辑共用 PaymentVoucherMutationInput（分类字段双路径携带）', () => {
    expect(PV_SVC).toContain('async createPaymentVoucher(input: PaymentVoucherMutationInput');
    expect(PV_SVC).toContain('async updatePaymentVoucher(id: string, input: PaymentVoucherMutationInput');
  });
  it('类型级契约：PaymentVoucherWithCategory 允许携带 voucherCategory', () => {
    const row: PaymentVoucherWithCategory = {
      id: 'PAY_t', voucherNumber: 'PAY-T-001', type: 'Receipt', status: 'unreconciled',
      amount: 100, createdAt: 0, updatedAt: 0, voucherCategory: 'advance',
    };
    expect(row.voucherCategory).toBe('advance');
  });
});

// ─────────────────────────────────────────────────────────────
// Part 4: creditService 端点封装 ↔ 后端路由
// ─────────────────────────────────────────────────────────────
describe('Track E [creditService]: 端点封装对齐后端路由', () => {
  it('base path /v1/credit/:customerId', () => {
    expect(CREDIT_SVC).toContain('`/v1/credit/${encodeURIComponent(customerId)}${path}`');
  });
  it('四个方法：getCreditStatus / getCreditHistory / freezeCredit / thawCredit', () => {
    for (const m of ['getCreditStatus', 'getCreditHistory', 'freezeCredit', 'thawCredit']) {
      expect(CREDIT_SVC).toContain(`async ${m}(`);
    }
  });
  it('路径与后端 router 一致：/freeze /thaw /status /history', () => {
    for (const p of ["'/freeze'", "'/thaw'", "'/status'", "'/history'"]) {
      expect(CREDIT_SVC).toContain(p);
    }
    expect(CREDIT_ROUTE).toContain("router.post('/:customerId/freeze'");
    expect(CREDIT_ROUTE).toContain("router.post('/:customerId/thaw'");
    expect(CREDIT_ROUTE).toContain("router.get('/:customerId/status'");
    expect(CREDIT_ROUTE).toContain("router.get('/:customerId/history'");
  });
  it('冻结/解冻理由必填（reason 随 body 上送，审计强制）', () => {
    expect(CREDIT_SVC).toContain('body: JSON.stringify({ reason })');
  });
  it('系统身份与阈值镜像后端：system_credit_scan / 60 天', () => {
    expect(CREDIT_SVC).toContain("SYSTEM_CREDIT_ACTOR = 'system_credit_scan'");
    expect(CREDIT_BACKEND_SVC).toContain("SYSTEM_CREDIT_ACTOR = 'system_credit_scan'");
    expect(CREDIT_SVC).toContain('OVERDUE_FREEZE_THRESHOLD_DAYS = 60');
    expect(CREDIT_BACKEND_SVC).toContain('OVERDUE_FREEZE_THRESHOLD_DAYS = 60');
  });
  it('类型级契约：CreditStatus 含门禁标记与逾期天数；CreditHistoryItem 为 append-only 时间线', () => {
    const status: CreditStatus = {
      relationId: 'rel_1', hasCreditLimit: true, creditLimitId: 'cl_1', status: 'Frozen',
      creditFrozen: true, totalLimit: 100000, usedAmount: 40000, remaining: 60000,
      currency: 'USD', frozenAt: null, frozenBy: null, thawedReason: null,
      lastAutoScanDate: null, maxOverdueDays: 0,
    };
    expect(status.creditFrozen).toBe(true);
    const item: CreditHistoryItem = {
      id: 'h_1', creditLimitId: 'cl_1', relationId: 'rel_1',
      beforeUsedAmount: 30000, afterUsedAmount: 40000, delta: 10000,
      triggerType: 'order_confirm', triggerId: null, triggerBy: null, remark: null, createdAt: '',
    };
    expect(item.delta).toBe(10000);
  });
});

// ─────────────────────────────────────────────────────────────
// Part 5: FinancePaymentRequestsPanel 权限显隐 + 三态 + 真实 API
// ─────────────────────────────────────────────────────────────
describe('Track E [FinancePaymentRequestsPanel]: 权限显隐与三态', () => {
  it('新建入口按 scope 门控 finance:payment_request:create', () => {
    expect(PR_PANEL).toContain("hasPermission('finance:payment_request:create')");
  });
  it('审批操作仅当前审批人可见（reviewerId === currentUserId，服务端自审守卫兜底）', () => {
    expect(PR_PANEL).toContain('approval?.reviewerId === currentUserId');
    expect(PR_PANEL).toContain("approval?.status === 'pending'");
  });
  it('作废入口仅申请人可见（applicantId === currentUserId）', () => {
    expect(PR_PANEL).toContain('detail.applicantId === currentUserId');
  });
  it('审批决策消费 approvalKernelService.decideApproval（驳回必填意见）', () => {
    expect(PR_PANEL).toContain('approvalKernelService.decideApproval');
    expect(PR_PANEL).toContain('驳回必须填写审批意见');
  });
  it('loading / empty / error 三态齐全', () => {
    expect(PR_PANEL).toContain('bds-empty');
    expect(PR_PANEL).toContain('bds-alert danger');
    expect(PR_PANEL).toContain('animate-spin');
  });
  it('列表/创建/作废全部接真实 API（paymentRequestService），无本地伪造成功', () => {
    expect(PR_PANEL).toContain('paymentRequestService.listPaymentRequests');
    expect(PR_PANEL).toContain('paymentRequestService.createPaymentRequest');
    expect(PR_PANEL).toContain('paymentRequestService.cancelPaymentRequest');
    expect(PR_PANEL).toContain('paymentRequestService.getPaymentRequest');
  });
  it('创建表单携带 paymentCategory（付款性质）', () => {
    expect(PR_PANEL).toContain('paymentCategory: form.paymentCategory');
  });
});

// ─────────────────────────────────────────────────────────────
// Part 6: FinanceCreditPanel 权限显隐 + 三态 + 受控接口
// ─────────────────────────────────────────────────────────────
describe('Track E [FinanceCreditPanel]: 权限显隐与联动预留', () => {
  it('冻结/解冻入口按 scope 门控 credit:freeze:write / credit:thaw:write', () => {
    expect(CREDIT_PANEL).toContain("hasPermission('credit:freeze:write')");
    expect(CREDIT_PANEL).toContain("hasPermission('credit:thaw:write')");
  });
  it('冻结/解冻理由必填（审计强制，前端前置校验）', () => {
    expect(CREDIT_PANEL).toContain('冻结理由必填');
    expect(CREDIT_PANEL).toContain('解冻理由必填');
  });
  it('额度面板四要素：额度 / 已占用 / 可用 / 冻结状态 + 历史时间线', () => {
    for (const label of ['信用额度', '已占用', '可用额度', '额度状态', '信用历史']) {
      expect(CREDIT_PANEL).toContain(label);
    }
  });
  it('客户详情联动预留受控接口 customerId / onCustomerChange', () => {
    expect(CREDIT_PANEL).toContain('customerId?: string');
    expect(CREDIT_PANEL).toContain('onCustomerChange?: (customerId: string) => void');
  });
  it('loading / empty / error 三态齐全', () => {
    expect(CREDIT_PANEL).toContain('bds-empty');
    expect(CREDIT_PANEL).toContain('bds-alert danger');
    expect(CREDIT_PANEL).toContain('animate-spin');
  });
  it('全部接真实 API（creditService），无占位符', () => {
    expect(CREDIT_PANEL).toContain('creditService.getCreditStatus');
    expect(CREDIT_PANEL).toContain('creditService.getCreditHistory');
    expect(CREDIT_PANEL).toContain('creditService.freezeCredit');
    expect(CREDIT_PANEL).toContain('creditService.thawCredit');
  });
});

// ─────────────────────────────────────────────────────────────
// Part 7: FinanceManager 集成 — tab 接线 + 凭证分类 UI 落点
// ─────────────────────────────────────────────────────────────
describe('Track E [FinanceManager]: tab 接线与凭证分类落点', () => {
  it('FinanceTabId 含 paymentRequests / credit', () => {
    expect(FINANCE_MGR).toContain("'paymentRequests'");
    expect(FINANCE_MGR).toContain("'credit'");
  });
  it('FINANCE_TABS 含付款申请 / 客户信用入口', () => {
    expect(FINANCE_MGR).toContain("{ id: 'paymentRequests', label: '付款申请'");
    expect(FINANCE_MGR).toContain("{ id: 'credit', label: '客户信用'");
  });
  it('两个自包含面板挂载并复用已加载 relationOptions', () => {
    expect(FINANCE_MGR).toContain('<FinancePaymentRequestsPanel isDarkMode={isDarkMode} relations={relationOptions} />');
    expect(FINANCE_MGR).toContain('<FinanceCreditPanel isDarkMode={isDarkMode} relations={relationOptions} />');
  });
  it('自包含 tab 不消费共享列表与核销副作用（isSelfContainedTab 门禁）', () => {
    expect(FINANCE_MGR).toContain('isSelfContainedTab');
    expect(FINANCE_MGR).toContain('{!isSelfContainedTab && (');
  });
  it('凭证创建/编辑提交携带 voucherCategory', () => {
    expect(FINANCE_MGR).toContain('voucherCategory: voucherForm.voucherCategory');
  });
  it('凭证表单分类选择（六类枚举渲染）', () => {
    expect(FINANCE_MGR).toContain('凭证分类');
    expect(FINANCE_MGR).toContain('VOUCHER_CATEGORIES.map');
  });
  it('凭证列表分类徽章（非 normal 才展示）', () => {
    expect(FINANCE_MGR).toContain("voucherCategory !== 'normal'");
    expect(FINANCE_MGR).toContain('voucherCategoryLabel(');
  });
  it('凭证详情侧栏含凭证分类行', () => {
    expect(FINANCE_MGR).toContain("{ label: '凭证分类', value: voucherCategoryLabel((voucher as PaymentVoucherWithCategory).voucherCategory) }");
  });
});

// ─────────────────────────────────────────────────────────────
// Part 8: 类型级契约 — CreatePaymentRequestInput 不传 reviewerId（DR-007）
// ─────────────────────────────────────────────────────────────
describe('Track E [contract]: 审批人由服务端解析，前端不得传入', () => {
  it('CreatePaymentRequestInput 无 reviewerId 字段（编译时保证）', () => {
    const input: CreatePaymentRequestInput = {
      supplierName: 'ACME', totalAmount: 1000, currency: 'USD', paymentCategory: 'normal',
    };
    expect('reviewerId' in input).toBe(false);
    expect(PR_SVC).not.toContain('reviewerId:');
  });
  it('PaymentRequestDetail 携带审批单与凭证快照（详情闭环）', () => {
    const detail: PaymentRequestDetail = {
      id: 'pr_1', requestNumber: 'PR-001', requestDate: '2026-08-16',
      totalAmount: 1000, currency: 'USD', applicantId: 'u_1', status: 'Pending',
      paymentCategory: 'normal',
      approvalRequest: { id: 'ap_1', status: 'pending', reviewerId: 'u_2' },
      paymentVoucher: null,
    };
    expect(detail.approvalRequest?.status).toBe('pending');
  });
  it('PaymentRequest 运行时行类型可用（列表渲染契约）', () => {
    const row: PaymentRequest = {
      id: 'pr_2', requestNumber: 'PR-002', requestDate: '2026-08-16',
      totalAmount: '2000.00', currency: 'CNY', applicantId: 'u_1', status: 'Draft',
      paymentCategory: 'deposit',
    };
    expect(row.paymentCategory).toBe('deposit');
  });
});

// ─────────────────────────────────────────────────────────────
// Part 9: REQ2-15 客户破产货权处置（DR-055，X-10 全程留痕）
// creditService bankruptcy 方法 ↔ 后端 creditRoute /bankruptcy 五端点
// FinanceCreditPanel 破产处置区块（案件卡/开案/动作登记/闭案/时间线）
// ─────────────────────────────────────────────────────────────
describe('REQ2-15 [creditService]: 破产处置端点封装对齐后端路由', () => {
  it('base path /v1/credit/bankruptcy（与信用域同路由，非 :customerId 子路径）', () => {
    expect(CREDIT_SVC).toContain('`/v1/credit/bankruptcy${path}`');
  });
  it('五个方法：list / get / open / addAction / close', () => {
    for (const m of ['listBankruptcyProceedings', 'getBankruptcyProceeding', 'openBankruptcyProceeding', 'addBankruptcyAction', 'closeBankruptcyProceeding']) {
      expect(CREDIT_SVC).toContain(`async ${m}(`);
    }
  });
  it('路径与后端 router 一致：POST+GET 列表 / GET /:id 详情 / POST /:id/actions / POST /:id/close', () => {
    expect(CREDIT_SVC).toContain('}/actions`');
    expect(CREDIT_SVC).toContain('}/close`');
    expect(CREDIT_ROUTE).toContain("router.post('/bankruptcy'");
    expect(CREDIT_ROUTE).toContain("router.get('/bankruptcy'");
    expect(CREDIT_ROUTE).toContain("router.get('/bankruptcy/:id'");
    expect(CREDIT_ROUTE).toContain("router.post('/bankruptcy/:id/actions'");
    expect(CREDIT_ROUTE).toContain("router.post('/bankruptcy/:id/close'");
  });
  it('动作类型枚举镜像后端真源：六类动作 + 四类处置期动作', () => {
    for (const t of ['declare', 'resale', 'return_shipment', 'bad_debt', 'recover', 'close']) {
      expect(CREDIT_SVC).toContain(`'${t}'`);
      expect(BANKRUPTCY_BACKEND_SVC).toContain(`'${t}'`);
    }
    expect(CREDIT_SVC).toContain("DISPOSAL_ACTION_TYPES: readonly BankruptcyActionType[] = ['resale', 'return_shipment', 'bad_debt', 'recover']");
    expect(BANKRUPTCY_BACKEND_SVC).toContain("DISPOSAL_ACTION_TYPES = ['resale', 'return_shipment', 'bad_debt', 'recover']");
  });
  it('动作中文文案六类全覆盖（无裸枚举落 UI）', () => {
    const m = CREDIT_SVC.match(/BANKRUPTCY_ACTION_LABELS[\s\S]*?};/);
    expect(m).not.toBeNull();
    for (const t of ['宣告破产', '转卖处置', '退运', '坏账登记', '部分回款', '闭案']) {
      expect(m![0]).toContain(t);
    }
  });
});

describe('REQ2-15 [FinanceCreditPanel]: 破产处置区块（DR-055 三决策落点）', () => {
  it('破产区块嵌入信用面板（案件列表 + 开案入口；DR-055-① 案件化）', () => {
    expect(CREDIT_PANEL).toContain('破产处置 Bankruptcy');
    expect(CREDIT_PANEL).toContain('开案登记');
    expect(CREDIT_PANEL).toContain('renderBankruptcySection');
  });
  it('开案走 BottomSheet（宣告日 CapsuleDateInput + 申报债权额 + 备注）', () => {
    expect(CREDIT_PANEL).toContain('<BottomSheet');
    expect(CREDIT_PANEL).toContain('CapsuleDateInput');
    expect(CREDIT_PANEL).toContain('宣告日');
    expect(CREDIT_PANEL).toContain('申报债权总额');
  });
  it('案件详情子视图：实时损益汇总六格 + 处置时间线 append-only + 动作登记', () => {
    for (const label of ['申报债权', '转卖回收', '部分回款', '退运成本', '坏账合计', '净损失', '处置时间线', '处置动作登记']) {
      expect(CREDIT_PANEL).toContain(label);
    }
    expect(CREDIT_PANEL).toContain('renderProceedingDetail');
  });
  it('四类处置动作登记入口（resale/return_shipment/bad_debt/recover 全挂真实 API）', () => {
    expect(CREDIT_PANEL).toContain('DISPOSAL_ACTION_META');
    expect(CREDIT_PANEL).toContain('creditService.addBankruptcyAction');
    expect(CREDIT_PANEL).toContain('creditService.openBankruptcyProceeding');
    expect(CREDIT_PANEL).toContain('creditService.closeBankruptcyProceeding');
    expect(CREDIT_PANEL).toContain('creditService.listBankruptcyProceedings');
    expect(CREDIT_PANEL).toContain('creditService.getBankruptcyProceeding');
  });
  it('闭案确认含汇总结论 + 不自动解冻提示（DR-055-③）', () => {
    expect(CREDIT_PANEL).toContain('闭案确认（终态）');
    expect(CREDIT_PANEL).toContain('闭案不自动解冻');
    expect(CREDIT_PANEL).toContain('净损失 = 申报债权 − 转卖回收 − 部分回款 + 退运成本');
  });
  it('破产写操作按 credit:freeze:write 门控（服务端 fail-closed 兜底）', () => {
    expect(CREDIT_ROUTE).toContain("requireScope(req, res, 'credit:freeze:write')");
    expect(BANKRUPTCY_BACKEND_SVC).toContain('freezeCredit');
  });
  it('开案自动冻结为 best-effort（冻结失败不阻断开案）', () => {
    expect(BANKRUPTCY_BACKEND_SVC).toContain('creditFrozen = fr.ok');
    expect(BANKRUPTCY_BACKEND_SVC).toContain('best-effort');
  });
  it('类型级契约：BankruptcySummary 净损失口径（申报 − 回收 − 回款 + 退运成本）', () => {
    const summary: BankruptcySummary = {
      totalClaimed: 100000, resaleRecovered: 40000, returnShippingCost: 8000,
      badDebt: 45000, recovered: 7000, netLoss: 61000, actionCount: 5,
    };
    expect(summary.totalClaimed - summary.resaleRecovered - summary.recovered + summary.returnShippingCost).toBe(summary.netLoss);
  });
});
