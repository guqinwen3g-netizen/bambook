import { AgentRole, ToolRisk } from './types';

/**
 * agentLoop 主循环的边界常量。
 *
 * 这是整个 Agent 循环的"治理"层：所有上限都收口在这里，避免散落在多个文件里被各自硬编码。
 * 旧的 toolRuntime.runAgentToolCalls 上限 8 步、mcp/planner.planMcpToolCalls 上限 6 步、
 * mcp/executor.slice(0, 6) 这些数字将在 S2/S3 逐步迁移到引用这个常量。
 */
export const AGENT_LOOP_LIMITS = {
  /** 单次循环最多走多少步（含强制收尾）。 */
  maxSteps: 8,
  /** 单步内 LLM 可申请的工具调用数上限（防止 LLM 一次塞 50 个）。 */
  maxToolsPerStep: 3,
  /** 单个工具调用的硬超时（毫秒）。 */
  perToolTimeoutMs: 30_000,
  /** 整次循环的总耗时预算（毫秒）。超出后强制收尾，不再发起新的工具或 LLM 调用。 */
  totalBudgetMs: 90_000,
  /** LLM 输出 JSON 解析失败时的修复重试次数（"请严格按 schema 输出"）。 */
  llmRepairRetries: 1,
  /** 构建上下文时取最近多少轮对话历史（0=不含历史）。 */
  historyWindowSize: 8,
  /** 单个工具输出在 observation 中的字符上限（超出截断）。 */
  observationCharLimit: 6000,
  /** 整个 scratchpad observation 块的总字符预算（超出时从最早 step 压缩）。 */
  scratchpadCharBudget: 24_000,
} as const;

export type DefaultRoleDefinition = {
  id: AgentRole;
  name: string;
  description: string;
  permissions: string[];
};

export type DefaultToolDefinition = {
  id: string;
  name: string;
  scope: string;
  risk: ToolRisk;
  allowedRoles: AgentRole[];
  approvalRoles?: AgentRole[];
  description?: string;
  inputHint?: string;
};

export const DEFAULT_AGENT_ROLES: DefaultRoleDefinition[] = [
  {
    id: 'owner',
    name: 'Owner',
    description: 'System owner with full Agent OS administration and approval authority.',
    permissions: ['admin', 'knowledge:manage', 'tool:approve', 'memory:company:write'],
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Administrator for users, knowledge, tools, and operational policies.',
    permissions: ['admin', 'knowledge:manage', 'tool:approve'],
  },
  {
    id: 'manager',
    name: 'Manager',
    description: 'Department manager who can inspect team data and approve risky actions.',
    permissions: ['team:read', 'tool:approve'],
  },
  {
    id: 'merchandiser',
    name: 'Merchandiser',
    description: 'Order follow-up role with access to orders, suppliers, samples, and logistics.',
    permissions: ['orders:read', 'orders:draft'],
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Finance role for invoices, payments, contract amounts, and finance drafts.',
    permissions: ['finance:read', 'invoice:draft'],
  },
  {
    id: 'sales',
    name: 'Sales',
    description: 'Sales role for customers, quotes, order progress, and communication drafts.',
    permissions: ['sales:read', 'customer:draft'],
  },
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only role limited to authorized knowledge and business records.',
    permissions: ['read'],
  },
  {
    id: 'agent_operator',
    name: 'Agent Operator',
    description: 'Automation operator who can start allowed jobs without bypassing approvals.',
    permissions: ['automation:run'],
  },
];

export const DEFAULT_AGENT_TOOLS: DefaultToolDefinition[] = [
  {
    id: 'products.count',
    name: 'Count Product Assets',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'products.search',
    name: 'Search Product Assets',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'products.query',
    name: 'Query Product Assets',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'products.describe_schema',
    name: 'Describe Product Asset Schema',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'dictionary.query',
    name: 'Query Business Dictionary',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'records.query',
    name: 'Query Business Records',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'products.get',
    name: 'Get Product Asset',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'products.expand',
    name: 'Expand Product Asset Context',
    scope: 'products',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'orders.search',
    name: 'Search Orders',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },
  {
    id: 'orders.query',
    name: 'Query Orders',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },
  {
    id: 'orders.get',
    name: 'Get Order',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },
  {
    id: 'orders.expand',
    name: 'Expand Order Context',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },
  {
    id: 'relations.search',
    name: 'Search Relations',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales'],
  },
  {
    id: 'relations.query',
    name: 'Query Relations',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales'],
  },
  {
    id: 'relations.get',
    name: 'Get Relation',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales'],
  },
  {
    id: 'relations.expand',
    name: 'Expand Relation Context',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales'],
  },
  {
    id: 'relations.create',
    name: 'Create Relation',
    scope: 'relations',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'knowledge.search',
    name: 'Search Knowledge Base',
    scope: 'knowledge',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'entities.search',
    name: 'Search Business Entities',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'entities.hydrate',
    name: 'Hydrate Business Entities',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'email.send',
    name: 'Send Email',
    scope: 'automation',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'agent_operator'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'knowledge.ingest',
    name: 'Ingest Knowledge',
    scope: 'knowledge',
    risk: 'medium',
    allowedRoles: ['owner', 'admin', 'manager'],
    approvalRoles: ['owner', 'admin', 'manager'] as AgentRole[],
  },

  // ─────────────────────────────────────────────────────────────────────
  // Step 2/3 additions — keep aligned with server/src/agent/mcp/manifest.ts.
  // RBAC: read-only tools follow the same allowedRoles as their scope's
  // existing query tools; mutations require manager+; high-risk mutations
  // (status transitions, convert-to-order) require explicit approval.
  // ─────────────────────────────────────────────────────────────────────

  // Development management — read-only
  {
    id: 'development.query',
    name: 'Query Development Cases',
    scope: 'development',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'development.get',
    name: 'Get Development Case',
    scope: 'development',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },

  // Development management — mutations (require approval)
  {
    id: 'development.update_stage',
    name: 'Update Development Stage',
    scope: 'development',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'development.convert_to_order',
    name: 'Convert Development Case to Order',
    scope: 'development',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },

  // Orders — read-only extensions
  {
    id: 'orders.list_by_status',
    name: 'List Orders by Status',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },
  {
    id: 'orders.get_timeline',
    name: 'Get Order Timeline',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },
  {
    id: 'orders.kanban',
    name: 'Order Kanban Summary',
    scope: 'orders',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales'],
  },

  // Orders — mutations (require approval)
  {
    id: 'orders.update_status',
    name: 'Update Order Status',
    scope: 'orders',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'orders.batch_status',
    name: 'Batch Update Order Status',
    scope: 'orders',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },

  // Garment-specific mutations
  {
    id: 'garment.update_size_breakdown',
    name: 'Update Garment Size Breakdown',
    scope: 'orders',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'garment.update_production_steps',
    name: 'Update Garment Production Steps',
    scope: 'orders',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },

  // Cross-module relationship graph
  {
    id: 'links.query',
    name: 'Query Entity Links',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  {
    id: 'links.expand_neighbors',
    name: 'Expand Entity Neighbors',
    scope: 'relations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'viewer', 'agent_operator'],
  },
  // ─── 财务管理 (finance) — generated by scaffold-module.ts ───
  {
    id: 'finance.list_invoices',
    name: 'List Invoices',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'finance.get_invoice',
    name: 'Get Invoice',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'finance.list_vouchers',
    name: 'List Payment Vouchers',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'finance.get_voucher',
    name: 'Get Payment Voucher',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'finance.query_outstanding',
    name: 'Query Outstanding Balance',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'finance.get_aging',
    name: 'Get AR/AP Aging Report',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'finance.create_invoice',
    name: 'Create Invoice',
    scope: 'finance',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'finance'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'finance.create_voucher',
    name: 'Create Payment Voucher',
    scope: 'finance',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'finance'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'finance.apply_voucher_to_invoice',
    name: 'Apply Voucher To Invoice',
    scope: 'finance',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'finance'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  // ── Shipping (货运管理) ──
  {
    id: 'shipping.list_shipments',
    name: 'List Shipments',
    scope: 'shipping',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser', 'logistics'],
  },
  {
    id: 'shipping.get_shipment',
    name: 'Get Shipment',
    scope: 'shipping',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser', 'logistics'],
  },
  {
    id: 'shipping.create_shipment',
    name: 'Create Shipment',
    scope: 'shipping',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'logistics'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'shipping.update_tracking_status',
    name: 'Update Tracking Status',
    scope: 'shipping',
    risk: 'medium',
    allowedRoles: ['owner', 'admin', 'manager', 'logistics'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'shipping.scan_delays',
    name: 'Scan Delayed Shipments',
    scope: 'shipping',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser', 'logistics'],
  },
  // ── Quotations (报价管理) — C3 智能报价 ──
  {
    id: 'quotations.query',
    name: 'Query Quotations',
    scope: 'quotations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'sales', 'merchandiser'],
  },
  {
    id: 'quotations.get',
    name: 'Get Quotation',
    scope: 'quotations',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'sales', 'merchandiser'],
  },
  // ── Customs (通关单证) — C3 LC 审单 ──
  {
    id: 'customs.query_lc',
    name: 'Query Letters of Credit',
    scope: 'customs',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'customs.get_lc',
    name: 'Get Letter of Credit',
    scope: 'customs',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  // ── Email (邮件管理) — Phase 4a ──
  {
    id: 'email.list',
    name: 'List Emails',
    scope: 'email',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'logistics'],
  },
  {
    id: 'email.get',
    name: 'Get Email',
    scope: 'email',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'logistics'],
  },
  {
    id: 'email.search',
    name: 'Search Emails',
    scope: 'email',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'logistics'],
  },
  {
    id: 'email.sync',
    name: 'Sync Emails from IMAP',
    scope: 'email',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager'],
    approvalRoles: ['owner', 'admin'],
  },
  {
    id: 'email.link_to_order',
    name: 'Link Email to Order',
    scope: 'email',
    risk: 'medium',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales', 'logistics'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'email.ai_extract',
    name: 'AI Extract Email Fields',
    scope: 'email',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'sales'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'template.list',
    name: 'List Templates',
    scope: 'templates',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'logistics', 'viewer', 'agent_operator'],
  },
  {
    id: 'template.render',
    name: 'Render Template (HTML)',
    scope: 'templates',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'logistics', 'agent_operator'],
  },
  {
    id: 'template.render_pdf',
    name: 'Render Template to PDF',
    scope: 'templates',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales', 'logistics', 'agent_operator'],
  },
  // ─── 生产管线 (production) — 10 阶段门禁引擎 ───
  {
    id: 'production.get_pipeline',
    name: 'Get Production Pipeline',
    scope: 'production',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'production_manager', 'factory', 'merchandiser', 'logistics', 'agent_operator'],
      description: '获取订单的 10 阶段生产管线状态——当前阶段、每阶段状态（pending/done/skipped）、检查清单、验货报告。',
    inputHint: '{ orderId: string }',
},
  {
    id: 'production.advance_stage',
    name: 'Advance Production Stage',
    scope: 'production',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'production_manager', 'factory', 'agent_operator'],
      description: '推进订单到下一个生产阶段。自动执行门禁检查（裁剪前四项 checklist / 产前样双签 / 验货阈值），检查不通过会拒绝推进。',
    inputHint: '{ orderId: string, stageKey: string, operator?: string, note?: string }',
},
  {
    id: 'production.save_checklist',
    name: 'Save Pre-Cut Checklist',
    scope: 'production',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'production_manager', 'factory', 'agent_operator'],
      description: '保存裁剪前检查清单（放码确认 / 用量确认 / 样板确认 / 产前会议）。四项全部 true 才能通过裁剪前门禁。',
    inputHint: '{ orderId: string, gradingConfirmed?: boolean, consumptionConfirmed?: boolean, patternConfirmed?: boolean, preProductionMeeting?: boolean, meetingNote?: string }',
},
  {
    id: 'production.save_inspection',
    name: 'Save Inspection Report',
    scope: 'production',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'production_manager', 'factory', 'agent_operator'],
      description: '保存验货报告——总数量、合格数量、业务方审批。合格率≥90% 且不合格率≤3% 才能通过验货门禁。',
    inputHint: '{ orderId: string, totalUnits?: number, passedUnits?: number, inspectedBy?: string, approvedByBusiness?: boolean }',
},
  {
    id: 'production.sign_stage',
    name: 'Sign Production Stage',
    scope: 'production',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'production_manager', 'factory', 'agent_operator'],
      description: '对生产阶段进行双签（生产部 / 业务部）。产前样阶段需要双方都签才能推进。',
    inputHint: "{ orderId: string, stageKey: string, signType: \"production\" | \"business\", signerId?: string }",
},
  {
    id: 'production.scan_alerts',
    name: 'Scan Production Alerts',
    scope: 'production',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'production_manager', 'factory', 'merchandiser', 'logistics', 'agent_operator'],
      description: '扫描所有活跃订单的生产预警——生产计划超期、延期通知窗口临近。返回预警列表含严重级别。',
    inputHint: '{}',
},
  // ── E3 NL 高频业务操作（下样品单 / 对账单）──
  {
    id: 'development.create',
    name: 'Create Development Case',
    scope: 'development',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'merchandiser'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
  {
    id: 'finance.get_statement',
    name: 'Get Customer Statement',
    scope: 'finance',
    risk: 'low',
    allowedRoles: ['owner', 'admin', 'manager', 'finance', 'sales', 'merchandiser'],
  },
  {
    id: 'statement.send',
    name: 'Send Customer Statement',
    scope: 'finance',
    risk: 'high',
    allowedRoles: ['owner', 'admin', 'manager', 'finance'],
    approvalRoles: ['owner', 'admin', 'manager'],
  },
];
