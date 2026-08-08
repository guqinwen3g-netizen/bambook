/**
 * EmailTemplate Module Route — 业务场景邮件模板（F5 邮件智能化 / PRD 12.1）
 *
 * 端点（挂载于 /api/v1/email-templates）：
 *   - GET    /          — 模板列表（按 type 过滤，默认仅 active 且未删除）
 *   - POST   /          — 新建模板（自动从 subject/body 解析 {{var}} 变量清单）
 *   - PATCH  /:id       — 更新模板
 *   - DELETE /:id       — 软删除
 *   - POST   /seed      — 幂等载入标准业务模板库（报价/催款/交期/验货/问候）
 *
 * 守卫口径与 email 模块一致：读走 JWT 或 API-Key，写必须 JWT（requireJwtForWrite）。
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { actorIdFromRequest } from '../audit/routeAudit';
import { logger } from '../lib/logger';
import { extractTemplateVariables } from '../lib/templateVariables';

// 保持既有导出面（测试与外部引用兼容）；实现已共享至 lib/templateVariables
export { extractTemplateVariables };

export interface EmailTemplateRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
}

const TEMPLATE_TYPES = ['quote', 'payment_reminder', 'delivery_notice', 'inspection_report', 'greeting', 'general'] as const;

function generateTemplateId(): string {
  return `EMTPL__${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
}

/**
 * 幂等播种标准业务模板库（同 type+name 已存在则跳过）。
 * 供两处复用：POST /seed 手动触发 + 服务启动自动播种（保证模板库开箱有数，前端不成空壳）。
 */
export async function seedStandardEmailTemplates(
  prisma: PrismaClient,
  actorId?: string,
): Promise<{ created: number; skipped: number; total: number }> {
  const db = prisma as any;
  const now = Date.now();
  let created = 0;
  let skipped = 0;
  for (const tpl of STANDARD_EMAIL_TEMPLATES) {
    const existing = await db.emailTemplate.findFirst({ where: { type: tpl.type, name: tpl.name, deletedAt: null } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.emailTemplate.create({
      data: {
        id: generateTemplateId(),
        type: tpl.type,
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        variables: extractTemplateVariables(tpl.subject, tpl.body),
        isActive: true,
        createdAt: BigInt(now),
        updatedAt: BigInt(now),
      },
    });
    created += 1;
  }
  logger.info('[email-templates] seeded', { created, skipped, actorId });
  return { created, skipped, total: STANDARD_EMAIL_TEMPLATES.length };
}

/** BigInt 序列化（模块自洽，不依赖 index.ts 全局 toJSON 补丁的挂载顺序） */
function serializeBigInts<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as T;
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) out[k] = serializeBigInts(v);
    return out;
  }
  return value;
}

/** 标准业务模板库（PRD 12.1：报价/催款/交期通知/验货报告/节日问候） */
export const STANDARD_EMAIL_TEMPLATES: Array<{ type: string; name: string; subject: string; body: string }> = [
  {
    type: 'quote',
    name: '标准报价函',
    subject: 'Quotation {{quotationNo}} — {{companyName}}',
    body: `Dear {{customerName}},

Thank you for your inquiry. Please find our offer as follows:

Quotation No.: {{quotationNo}}
Valid Until: {{validUntil}}

Detailed pricing and terms are attached. Should you have any questions, please feel free to contact us.

Best regards,
{{senderName}}
{{companyName}}`,
  },
  {
    type: 'payment_reminder',
    name: '催款提醒函',
    subject: 'Payment Reminder — Invoice {{invoiceNo}}',
    body: `Dear {{customerName}},

We would like to kindly remind you that the following invoice is due for payment:

Invoice No.: {{invoiceNo}}
Amount: {{amount}}
Due Date: {{dueDate}}

We would appreciate your prompt arrangement. If payment has already been made, please disregard this notice.

Best regards,
{{senderName}}`,
  },
  {
    type: 'delivery_notice',
    name: '交期通知函',
    subject: 'Delivery Schedule — Order {{orderNo}}',
    body: `Dear {{customerName}},

We are writing to confirm the delivery schedule for your order:

Order No.: {{orderNo}}
Estimated Delivery: {{deliveryDate}}

We will keep you updated on the production progress. Please let us know if you have any concerns.

Best regards,
{{senderName}}`,
  },
  {
    type: 'inspection_report',
    name: '验货报告通知',
    subject: 'Inspection Report — Order {{orderNo}}',
    body: `Dear {{customerName}},

The inspection for your order has been completed:

Order No.: {{orderNo}}
Inspection Date: {{inspectionDate}}
Result: {{result}}

The full inspection report is attached for your review.

Best regards,
{{senderName}}`,
  },
  {
    type: 'greeting',
    name: '节日问候函',
    subject: '{{festival}} Greetings from {{companyName}}',
    body: `Dear {{customerName}},

On the occasion of {{festival}}, we would like to extend our warmest greetings and sincere thanks for your continued trust and partnership.

We look forward to our continued cooperation in the coming year.

Best wishes,
{{senderName}}
{{companyName}}`,
  },
];

export function createEmailTemplateRouter(options: EmailTemplateRouterOptions) {
  const { prisma, requireAuth, apiKeys } = options;
  const router = Router();

  const guard = createModuleAuthGuard({ requireAuth, apiKeys });
  router.use(guard);
  const requireWrite = requireJwtForWrite({ requireAuth, apiKeys });

  const db = prisma as any;

  // GET /api/v1/email-templates — 列表（?type=quote&includeInactive=1）
  router.get('/', async (req: Request, res: Response) => {
    try {
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
      const where: any = { deletedAt: null };
      if (type) where.type = type;
      if (!includeInactive) where.isActive = true;
      const items = await db.emailTemplate.findMany({ where, orderBy: [{ type: 'asc' }, { updatedAt: 'desc' }] });
      res.json({ ok: true, items: serializeBigInts(items), total: items.length });
    } catch (e: any) {
      logger.error('[email-templates] list error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'LIST_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // POST /api/v1/email-templates — 新建（variables 自动从模板文本解析）
  router.post('/', requireWrite, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const type = String(body.type || 'general').trim();
      const name = String(body.name || '').trim();
      const subject = String(body.subject || '').trim();
      const templateBody = String(body.body || '').trim();
      if (!name || !subject || !templateBody) {
        return res.status(400).json({ ok: false, error: { code: 'INVALID_INPUT', message: 'name/subject/body 必填' } });
      }
      if (!TEMPLATE_TYPES.includes(type as any)) {
        return res.status(400).json({ ok: false, error: { code: 'INVALID_TYPE', message: `type 须为 ${TEMPLATE_TYPES.join('/')}` } });
      }
      const now = Date.now();
      const item = await db.emailTemplate.create({
        data: {
          id: generateTemplateId(),
          type,
          name,
          subject,
          body: templateBody,
          variables: extractTemplateVariables(subject, templateBody),
          isActive: true,
          createdAt: BigInt(now),
          updatedAt: BigInt(now),
        },
      });
      res.status(201).json({ ok: true, item: serializeBigInts(item) });
    } catch (e: any) {
      logger.error('[email-templates] create error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'CREATE_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // PATCH /api/v1/email-templates/:id — 更新（改文本时重解析变量）
  router.patch('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const existing = await db.emailTemplate.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!existing) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '模板不存在' } });
      const body = req.body || {};
      const nextSubject = body.subject !== undefined ? String(body.subject) : existing.subject;
      const nextBody = body.body !== undefined ? String(body.body) : existing.body;
      const data: any = { updatedAt: BigInt(Date.now()) };
      if (body.name !== undefined) data.name = String(body.name).trim();
      if (body.type !== undefined) {
        if (!TEMPLATE_TYPES.includes(String(body.type) as any)) {
          return res.status(400).json({ ok: false, error: { code: 'INVALID_TYPE', message: `type 须为 ${TEMPLATE_TYPES.join('/')}` } });
        }
        data.type = String(body.type);
      }
      if (body.subject !== undefined) data.subject = nextSubject;
      if (body.body !== undefined) data.body = nextBody;
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
      if (body.subject !== undefined || body.body !== undefined) {
        data.variables = extractTemplateVariables(nextSubject, nextBody);
      }
      const item = await db.emailTemplate.update({ where: { id: req.params.id }, data });
      res.json({ ok: true, item: serializeBigInts(item) });
    } catch (e: any) {
      logger.error('[email-templates] update error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'UPDATE_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // DELETE /api/v1/email-templates/:id — 软删除
  router.delete('/:id', requireWrite, async (req: Request, res: Response) => {
    try {
      const existing = await db.emailTemplate.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!existing) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '模板不存在' } });
      await db.emailTemplate.update({ where: { id: req.params.id }, data: { deletedAt: BigInt(Date.now()), updatedAt: BigInt(Date.now()) } });
      res.json({ ok: true, id: req.params.id });
    } catch (e: any) {
      logger.error('[email-templates] delete error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: String(e?.message ?? e) } });
    }
  });

  // POST /api/v1/email-templates/seed — 幂等载入标准模板库（同 type+name 已存在则跳过）
  router.post('/seed', requireWrite, async (req: Request, res: Response) => {
    try {
      const result = await seedStandardEmailTemplates(prisma, actorIdFromRequest(req));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      logger.error('[email-templates] seed error', { error: e?.message || String(e) });
      res.status(500).json({ ok: false, error: { code: 'SEED_FAILED', message: String(e?.message ?? e) } });
    }
  });

  return router;
}
