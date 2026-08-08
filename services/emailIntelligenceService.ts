/**
 * Email Intelligence Service — F5 邮件智能化前端服务
 *
 * 覆盖 PRD 19.3 / 12.1 两块能力：
 *   1. 意图可视化：GET /api/v1/email/intents 聚合 AI 抽取的意图徽标（薄覆盖层，叠加在 IMAP 实时流上）
 *   2. 业务场景模板：GET /api/v1/email-templates 拉取模板库 + 纯函数变量渲染（{{var}} 替换）
 *
 * 两个端点均为 GET，模块守卫允许 API-Key 通过（写操作才强制 JWT）。
 */

import { apiService } from './apiService';

// ─── 意图可视化 ─────────────────────────────────────────────

/** 与 server/src/email/aiExtract.ts 的 EmailExtractedPayload.intent 值域对齐 */
export type EmailIntent =
  | 'inquiry' | 'quotation' | 'order' | 'shipment_notice'
  | 'invoice' | 'complaint' | 'follow_up' | 'other';

export type EmailCustomerSignal = 'positive' | 'neutral' | 'urgent' | 'risk' | 'unknown';

export interface EmailIntentInfo {
  intent: EmailIntent;
  customerSignal: EmailCustomerSignal | null;
  summary: string | null;
}

/** 意图中文标签（PRD 19.3：询价/订单确认/投诉/催款/一般 + AI 全值域扩展） */
export const EMAIL_INTENT_LABELS: Record<EmailIntent, string> = {
  inquiry: '询价',
  quotation: '报价',
  order: '订单确认',
  shipment_notice: '出运通知',
  invoice: '发票催款',
  complaint: '投诉',
  follow_up: '跟进',
  other: '一般',
};

/** 信号中文标签（仅 urgent/risk 需要显性提醒，其余不渲染避免列表噪音） */
export const EMAIL_SIGNAL_LABELS: Partial<Record<EmailCustomerSignal, string>> = {
  urgent: '紧急',
  risk: '风险',
};

/**
 * 按 mailbox + IMAP uids 批量拉取意图徽标。
 * 仅已同步且已 AI 抽取的邮件会出现在结果中；其余静默缺席（列表无标签）。
 */
export async function fetchEmailIntents(
  mailbox: string,
  uids: Array<string | number>,
  endpoint?: string,
): Promise<Record<string, EmailIntentInfo>> {
  const numericUids = uids
    .map(u => (typeof u === 'number' ? u : parseInt(String(u), 10)))
    .filter(n => Number.isFinite(n))
    .slice(0, 200);
  if (!mailbox || numericUids.length === 0) return {};

  const url = apiService.buildApiUrl(
    `/v1/email/intents?mailbox=${encodeURIComponent(mailbox)}&uids=${numericUids.join(',')}`,
    endpoint,
  );
  const apiKey = apiService.getApiKey();
  const res = await fetch(url, {
    headers: { ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
  });
  if (!res.ok) return {}; // 意图是增强层，失败不阻断列表
  const json: any = await res.json().catch(() => null);
  if (!json?.ok || !Array.isArray(json.items)) return {};

  const map: Record<string, EmailIntentInfo> = {};
  for (const item of json.items) {
    if (item?.uid === null || item?.uid === undefined) continue;
    map[String(item.uid)] = {
      intent: (item.intent || 'other') as EmailIntent,
      customerSignal: item.customerSignal ?? null,
      summary: item.summary ?? null,
    };
  }
  return map;
}

// ─── 业务场景模板 ───────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  type: string; // quote | payment_reminder | delivery_notice | inspection_report | greeting | general
  name: string;
  subject: string;
  body: string;
  variables: string[];
}

/** 模板类型中文标签（PRD 12.1：报价/催款/交期通知/验货报告/节日问候） */
export const EMAIL_TEMPLATE_TYPE_LABELS: Record<string, string> = {
  quote: '报价',
  payment_reminder: '催款',
  delivery_notice: '交期通知',
  inspection_report: '验货报告',
  greeting: '节日问候',
  general: '通用',
};

export async function fetchEmailTemplates(endpoint?: string): Promise<EmailTemplate[]> {
  const url = apiService.buildApiUrl('/v1/email-templates', endpoint);
  const apiKey = apiService.getApiKey();
  const res = await fetch(url, {
    headers: { ...(apiKey ? { 'x-bambook-api-key': apiKey } : {}) },
  });
  if (!res.ok) return [];
  const json: any = await res.json().catch(() => null);
  if (!json?.ok || !Array.isArray(json.items)) return [];
  return json.items.map((t: any) => ({
    id: String(t.id),
    type: String(t.type || 'general'),
    name: String(t.name || ''),
    subject: String(t.subject || ''),
    body: String(t.body || ''),
    variables: Array.isArray(t.variables) ? t.variables.map(String) : [],
  }));
}

/** 从模板文本提取 {{var}} 变量（与后端 extractTemplateVariables 同口径） */
export function extractTemplateVariables(...texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        out.push(m[1]);
      }
    }
  }
  return out;
}

/** 变量渲染：{{var}} → vars[var]，缺失变量保留占位符便于用户识别补填 */
export function renderEmailTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (raw, name) => {
    const v = vars[name];
    return v !== undefined && v !== '' ? v : raw;
  });
}

/**
 * 已知变量自动填充（PRD 19.3「变量自动填充」）：
 * 从收件人地址/当前日期等上下文推导，其余变量留空由用户补填。
 */
export function deriveTemplateVars(context: { to?: string; senderName?: string }): Record<string, string> {
  const vars: Record<string, string> = {};
  const nameSource = context.senderName || context.to || '';
  // "Display Name <a@b.com>" → Display Name；裸邮箱 → @ 前缀
  const displayMatch = nameSource.match(/^\s*(?:"?([^"<>]+)"?)\s*<[^>]+>/);
  const customerName = displayMatch?.[1]?.trim()
    || (nameSource.includes('@') ? nameSource.split('@')[0].trim() : nameSource.trim());
  if (customerName) vars.customerName = customerName;
  vars.date = new Date().toISOString().slice(0, 10);
  vars.today = vars.date;
  return vars;
}

export const emailIntelligenceService = {
  fetchEmailIntents,
  fetchEmailTemplates,
  extractTemplateVariables,
  renderEmailTemplate,
  deriveTemplateVars,
};
