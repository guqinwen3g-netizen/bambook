// Load env BEFORE Prisma is initialized.
// Local dev overrides come from .env.local (gitignored); .env is the fallback (e.g. cloud creds).
import dotenv from 'dotenv';
import path from 'path';
const SERVER_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(SERVER_ROOT, '.env.local'), override: true });
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'fs';
import { createImportRouter } from './import/route';
import { createOrdersRouter } from './orders/route';
import { createOrdersV2Router } from './orders/routeV2';
import { createOrderLinesRouter } from './orders/orderLinesRoute';
import { createRelationsRouter } from './relations/route';
import { createRelationsV2Router } from './relations/routeV2';
import { createHandoverRouter } from './handover/route';
import { createAccountStatusGuard } from './auth/accountStatusGuard';
import { createProductsRouter } from './products/route';
import { createSystemAssetsRouter } from './system-assets/route';
import { createPdmlRouter } from './pdml/route';
import { startPdmlSyncScheduler } from './pdml/scheduler';
import { createEntitiesRouter } from './entities/route';
import { createBusinessProfilesRouter } from './business-profiles/route';
import { createDevelopmentRouter } from './development/route';
import { createFinanceRouter } from './finance/route';
import { createFinanceV2Router } from './finance/routeV2';
import { createReportingRouter } from './reporting/route';
import { createShippingRouter } from './shipping/route';
import { createDashboardRouter } from './dashboard/route';
import { createQuotationRouter } from './quotations/quotationRoute';
import { createMoqRouter } from './moq/moqRoute';
import { createOrderChangeRouter } from './orderChanges/orderChangeRoute';
import { createSampleRouter } from './samples/sampleRoute';
import { createExceptionRouter } from './exceptions/exceptionRoute';
import { createCreditRouter } from './credit/creditRoute';
import { createInternalTradeRouter } from './internalTrade/internalTradeRoute';
import { createPaymentRequestRouter } from './paymentRequests/paymentRequestRoute';
import { createProcurementRouter } from './procurement/procurementRoute';
import { createInventoryRouter } from './inventory/inventoryRoute';
import { createBOMRouter } from './bom/bomRoute';
import { createCrmRouter } from './crm/crmRoute';
import { createCrmV2Router } from './crm/crmRouteV2';
import { createSupplierRouter } from './suppliers/factoryRoute';
import { createSuppliersV2Router } from './suppliers/factoryRouteV2';
import { createDataMigrationRouter } from './migration/dataMigrationRoute';
import { createSeasonRouter } from './seasons/seasonRoute';
import { createSeasonsV2Router } from './seasons/seasonRouteV2';
import { createMarketingV2Router } from './marketing/marketingRouteV2';
import { createRiskRouter } from './risk/riskRoute';
import { createBusinessLineRouter } from './businessLines/businessLineRoute';
import { ensureBusinessLineSeed } from './businessLines/businessLineService';
import { createQcRouter } from './qc/qcRoute';
import { createPricingRouter } from './pricing/pricingRoute';
import { createLookbookRouter } from './products/lookbookRoute';
import { createFabricRecommendationRouter } from './products/fabricRecommendationRoute';
import { createMesRouter } from './mes/mesRoute';
import { createCustomsRouter } from './customs/customsRoute';
import { createCustomsV2Router } from './customs/customsRouteV2';
import { createDocumentTemplateRouter } from './customs/documentTemplateRoute';
import { createProductionRouter } from './production/route';
import { createProductionV2Router } from './production/routeV2';
import { createTraceabilityRouter } from './traceability/traceabilityRoute';
import { createTemplatesRouter } from './templates/route';
import { logger } from './lib/logger';
import { attachPrismaSlowQueryLogger, createRequestTimingMiddleware } from './lib/requestTiming';
import { createEmailRouter } from './email/route';
import { createEmailTemplateRouter, seedStandardEmailTemplates } from './email/templateRoute';
import { createEmailSignatureRouter } from './email/signatureRoute';
import { addRealtimeClient, publishDataChange } from './realtime';
import { createAiRuntime } from './ai/runtime';
import { createAiRouter } from './ai/route';
import { createMacMiniChatRunner } from './ai/runner';
import { prewarmMeloTts, getMeloPrewarmStatus } from './ai/tts';
import { createKnowledgeDocumentsRouter } from './ai/knowledgeDocumentsRoute';
import { createKnowledgeRouter } from './knowledge/knowledgeRoute';
import { ensureSopTemplateSeed } from './knowledge/sopTemplateService';
import { createAgentRouter } from './agent/route';
import { ensureDefaultAgentTools } from './agent/tools';
import { createAuthRouter } from './auth/route';
import { createAdminRouter } from './admin/route';
import { createApprovalRouter } from './approvals/approvalRoute';
import { createApprovalKernelRouter } from './approvals/approvalKernelRoute';
import { createApprovalRoutingService } from './approvals/approvalRoutingService';
import { createApprovalCreateService } from './approvals/approvalCreateService';
import { createOrderChangeRequestService } from './orderChanges/orderChangeRequestService';
import { createAuditRouter } from './audit/route';
import { createHRRouter } from './hr/route';
import { initializeNotificationBindings } from './notifications/eventBindings';
import { createNotificationsRouter } from './notifications/route';
import { createAutomationRouter } from './config/automationRoute';
import { createSystemConfigRouter } from './config/systemConfigRoute';
import { registerAllLinkages } from './events/linkages';
import { startScheduler } from './scheduler';
import { createWorkflowRouter } from './workflow/workflowRoute';
import { WorkflowEngine, seedDefaultWorkflowDefinitions } from './workflow/workflowEngine';
import { registerWorkflowEventTriggers } from './workflow/workflowEventTriggers';
import { extractActorFromRequest } from './auth/middleware';
import { TokenPayload } from './auth/service';
import { AgentRole } from './agent/types';
import { createEmailService } from './auth/email';
import { createVerificationStore } from './auth/verification';
import { describeRuntimeDataSource } from './dataSource';

// Prisma (Bambook 数据) — 开启 query 事件以支撑慢查询日志（Phase 1 · 任务 1.2）
const prisma = new PrismaClient({
    log: [{ emit: 'event', level: 'query' }],
});
attachPrismaSlowQueryLogger(prisma as unknown as Parameters<typeof attachPrismaSlowQueryLogger>[0]);
const runtimeDataSource = describeRuntimeDataSource();
if (runtimeDataSource.warning) {
    logger.warn(`[data-source] ${runtimeDataSource.warning}`);
}
logger.info(`[data-source] kind=${runtimeDataSource.kind} host=${runtimeDataSource.host} database=${runtimeDataSource.name} businessTruth=${runtimeDataSource.isBusinessTruth}`);
ensureDefaultAgentTools(prisma).catch(error => {
    logger.error('[agent-tools] failed to ensure default tools', { error: error?.message || String(error) });
});
// F5 邮件智能化：启动时幂等播种标准业务邮件模板库（报价/催款/交期/验货/问候），保证 Compose 模板库开箱有数
seedStandardEmailTemplates(prisma).catch(error => {
    logger.error('[email-templates] boot seed failed', { error: error?.message || String(error) });
});
// C7 知识库深化：启动时幂等播种纺织外贸核心 SOP 模板（大货跟单/验货/出运/报关），仅当表为空时写入
ensureSopTemplateSeed(prisma)
    .then(seeded => { if (seeded) logger.info('[knowledge] SOP template seed applied'); })
    .catch(error => {
        logger.error('[knowledge] SOP template seed failed', { error: error?.message || String(error) });
    });
// PRD 6.2 业务线注册表：启动时幂等播种三大默认业务线（fabric/garment/capsule），
// 保证订单业务线标记（Capsule 子视图等）开箱可用，不再依赖手工注册
ensureBusinessLineSeed(prisma).catch(error => {
    logger.error('[business-lines] boot seed failed', { error: error?.message || String(error) });
});
// Phase 0 Sprint 1: 初始化业务事件总线 + 通知系统
// 注入 prisma 到 businessEventBus，订阅所有业务事件 → notificationService
initializeNotificationBindings(prisma);
// Phase 1 Sprint 3: 注册业务联动执行器（订单→生产→发货→发票→收款 自动联动）
registerAllLinkages();
// Phase 0 Sprint 2: 启动调度器（崩溃恢复 + 每日 briefing + 卡滞检测 + AgentJob 清理）
startScheduler(prisma);
// Phase 0 Sprint 2: 工作流引擎 — seed 默认定义 + 事件总线自动触发集成
seedDefaultWorkflowDefinitions(prisma).catch(error => {
    logger.error('[workflow] failed to seed default definitions', { error: error?.message || String(error) });
});
registerWorkflowEventTriggers(prisma);
startPdmlSyncScheduler({ prisma, onDataChange: publishDataChange });
const macMiniChatRunner = createMacMiniChatRunner({
    prisma,
    runSearch: task => aiRuntime.runSearch(task),
});
const aiRuntime = createAiRuntime({
    modelConcurrency: Number(process.env.BAMBOOK_AI_MODEL_CONCURRENCY || 3),
    searchConcurrency: Number(process.env.BAMBOOK_AI_SEARCH_CONCURRENCY || 6),
    heavyConcurrency: Number(process.env.BAMBOOK_AI_HEAVY_CONCURRENCY || 1),
    chatRunner: macMiniChatRunner,
});

const SDK_CONFIG = {
    apiKeys: new Set([
        process.env.BAMBOOK_SDK_KEY,
        process.env.BAMBOOK_API_KEY,
        process.env.VITE_BAMBOOK_API_KEY,
        process.env.NODE_ENV === 'production' ? undefined : 'dev-key-2024',
    ].filter(Boolean) as string[]),
    requireAuth: process.env.BAMBOOK_REQUIRE_AUTH === 'true' || process.env.NODE_ENV === 'production',
};

/**
 * API keys authenticate a calling service but do not carry user roles. Agent execution only
 * accepts a key after it has been explicitly bound to a least-privilege service principal.
 *
 * Required for production API-key Agent calls:
 * - BAMBOOK_AGENT_API_KEY_ACTOR_ID
 * - BAMBOOK_AGENT_API_KEY_ROLES (comma-separated AgentRole values)
 * Optional:
 * - BAMBOOK_AGENT_API_KEY_DISPLAY_NAME
 * - BAMBOOK_AGENT_API_KEY_DEPARTMENTS (comma-separated department ids)
 */
const AGENT_API_KEY_ACTORS = buildAgentApiKeyActors(SDK_CONFIG.apiKeys);

function buildAgentApiKeyActors(apiKeys: ReadonlySet<string>): ReadonlyMap<string, TokenPayload> {
    const userId = String(process.env.BAMBOOK_AGENT_API_KEY_ACTOR_ID || '').trim();
    const roles = parseAgentRoles(process.env.BAMBOOK_AGENT_API_KEY_ROLES);
    if (!userId || !roles.length) return new Map();

    const actor: TokenPayload = {
        userId,
        displayName: String(process.env.BAMBOOK_AGENT_API_KEY_DISPLAY_NAME || 'Bambook API Service').trim(),
        roles,
        permissions: [],
        departmentIds: splitConfigList(process.env.BAMBOOK_AGENT_API_KEY_DEPARTMENTS, ['company']),
    };
    return new Map(Array.from(apiKeys, (apiKey) => [apiKey, actor]));
}

function parseAgentRoles(value: string | undefined): AgentRole[] {
    const allowed = new Set<AgentRole>([
        'owner', 'admin', 'manager', 'merchandiser', 'finance', 'sales',
        'logistics', 'production_manager', 'factory', 'viewer', 'agent_operator',
    ]);
    return splitConfigList(value).filter((role): role is AgentRole => allowed.has(role as AgentRole));
}

function splitConfigList(value: string | undefined, fallback: string[] = []): string[] {
    const values = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
    return values.length ? Array.from(new Set(values)) : fallback;
}

const sdkAuth = (req: Request, res: Response, next: () => void) => {
    // 身份解析无条件执行（P0-001 修复）：有凭证就解析注入 req.actor，
    // 与鉴权开关解耦——requireAuth 只控制「无凭证是否拒绝」，不控制「是否解析」。
    // 否则开发模式（requireAuth=false）下 req.actor 恒空，通知等要求用户身份的路由全 401。
    const actor = extractActorFromRequest(req);
    if (actor) {
        (req as any).actor = actor;
    }
    if (!SDK_CONFIG.requireAuth) return next();

    if (actor) {
        return next();
    }

    // Priority 2: API key header
    const apiKey = (req.headers['x-bambook-api-key'] || req.query.apiKey) as string | undefined;
    if (!apiKey) {
        return res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'API Key is required. Please provide X-Bambook-API-Key header.',
        });
    }

    if (!SDK_CONFIG.apiKeys.has(apiKey)) {
        return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Invalid API Key.',
        });
    }

    next();
};

const app = express();
const PORT = process.env.PORT || 8081;

// 确保输出目录存在
const OUTPUT_DIR = path.join(__dirname, '../../output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 确保上传目录存在
const UPLOAD_DIR = process.env.BAMBOOK_UPLOAD_DIR || path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middlewares
const corsWithCredentials = cors({
    origin(origin, cb) {
        cb(null, origin || true);
    },
    credentials: true,
});
app.use(corsWithCredentials);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
// REQ2-13（DR-056-③）：停用账号即时失效——JWT 只验签不查库的根因缺口在组合根拦截
//（30s TTL 缓存；停用/交接路径调用 invalidateAccountStatusCache 同进程即时失效）
app.use(createAccountStatusGuard(prisma));
// 请求耗时日志：5xx→error / 慢请求→warn / 其余→debug（Phase 1 · 任务 1.2）
app.use(createRequestTimingMiddleware());
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

// Cloudflare Tunnel routes /bambook/api/* to this 8081 service (without prefix rewrite).
// Strip the /bambook prefix so existing /api/* handlers stay intact for the Electron
// desktop client, which calls https://jiangsupanda.com/bambook/api/... via the tunnel.
// (Web APP project已下线 — 不再有 /api/app 静态托管，仅保留 API 路由。)
app.use((req, _res, next) => {
    if (req.url === '/bambook/api' || req.url.startsWith('/bambook/api/')) {
        req.url = req.url.slice('/bambook'.length);
    }
    next();
});

// Serve uploaded images at /api/uploads/*
app.use('/api/uploads', express.static(UPLOAD_DIR));

// Serve webapp (frontend SPA) at /api/app/ — Cloudflare Tunnel routes /bambook/api/app/* here.
// The /bambook prefix is stripped by the middleware above, so Express sees /api/app/*.
const WEBAPP_DIR = path.join(__dirname, '..', 'webapp');
if (fs.existsSync(WEBAPP_DIR)) {
  app.use('/api/app', express.static(WEBAPP_DIR));
  // SPA fallback: non-asset requests return index.html so client-side routing works
  app.get('/api/app', (_req, res) => res.sendFile(path.join(WEBAPP_DIR, 'index.html')));
  app.get('/api/app/*', (req, res, next) => {
    if (req.path.includes('.')) return next(); // asset request → 404
    res.sendFile(path.join(WEBAPP_DIR, 'index.html'));
  });
}

// Serialization helper for BigInt
// @ts-ignore
BigInt.prototype.toJSON = function () {
    return Number(this);
};

// Serialization helper for Prisma.Decimal — ensures JSON output is number, not string
import { Prisma } from '@prisma/client';
// @ts-ignore
if (Prisma.Decimal.prototype.toJSON === undefined || Prisma.Decimal.prototype.toJSON.name !== 'decimalToNumberJSON') {
    const _origToJSON = Prisma.Decimal.prototype.toJSON;
    // @ts-ignore
    Prisma.Decimal.prototype.toJSON = function decimalToNumberJSON() {
        return Number(this);
    };
}

// Health Check
app.get('/api/health', async (_req, res) => {
    const ttsPrewarm = getMeloPrewarmStatus();
    const health = {
        status: "ok",
        node: "PandaAI-Sovereign-Node-Prisma",
        timestamp: Date.now(),
        version: process.env.npm_package_version || '1.0.0',
        authRequired: SDK_CONFIG.requireAuth,
        realtime: 'sse-in-process',
        database: 'ok',
        tts: ttsPrewarm
            ? {
                provider: ttsPrewarm.provider,
                prewarmOk: ttsPrewarm.ok,
                prewarmSkipped: ttsPrewarm.skipped,
                prewarmElapsedMs: ttsPrewarm.elapsedMs,
                prewarmAt: ttsPrewarm.at,
                prewarmError: ttsPrewarm.error,
            }
            : { provider: process.env.BAMBOOK_TTS_PROVIDER || 'melo', prewarmOk: null },
    };
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json(health);
    } catch (error: any) {
        res.status(503).json({
            ...health,
            status: 'error',
            database: 'unavailable',
            error: error?.message || 'Database unavailable',
        });
    }
});

// Sync Handler
const handleSync = async (model: any, req: express.Request, res: express.Response, entity?: string) => {
    try {
        if (req.method === 'GET') {
            const data = await model.findMany({ where: { deletedAt: null } });
            return res.json(data);
        }

        if (req.method === 'POST') {
            const incoming = req.body;
            const items = Array.isArray(incoming) ? incoming : [incoming];

            const ops = items.map((item: any) => {
                const payload = { ...item };
                if (payload.timestamp) payload.timestamp = BigInt(payload.timestamp);
                if (payload.updatedAt) payload.updatedAt = BigInt(payload.updatedAt);
                if (payload.deletedAt) payload.deletedAt = BigInt(payload.deletedAt);
                if (payload.lastInteraction) payload.lastInteraction = BigInt(payload.lastInteraction);

                return model.upsert({
                    where: { id: item.id },
                    update: payload,
                    create: payload
                });
            });

            await prisma.$transaction(ops);
            if (entity) {
                publishDataChange({
                    entity,
                    action: 'legacy-sync',
                    ids: items.map((item: any) => String(item.id)).filter(Boolean),
                });
            }
            return res.json({ status: "success", count: items.length });
        }
    } catch (e: any) {
        logger.error("Sync Error", { error: e?.message || String(e) });
        res.status(500).json({ status: "error", error: e.message });
    }
};

// Legacy broad sync routes. They remain for older screens during the Mac mini
// cutover, but are no longer an unauthenticated public write surface.
app.all('/api/dev-memory', sdkAuth, (req, res) => handleSync(prisma.projectMemory, req, res, 'dev-memory'));
app.all('/api/orders', sdkAuth, (req, res) => handleSync(prisma.order, req, res, 'orders'));
app.all('/api/knowledge', sdkAuth, (req, res) => handleSync(prisma.knowledgeItem, req, res, 'knowledge'));
app.all('/api/relations', sdkAuth, (req, res) => handleSync(prisma.relation, req, res, 'relations'));
app.all('/api/products', sdkAuth, (req, res) => handleSync(prisma.productAsset, req, res, 'products'));
app.all('/api/product-categories', sdkAuth, (req, res) => handleSync(prisma.productSubCategory, req, res, 'product-categories'));
app.all('/api/insights', sdkAuth, (req, res) => handleSync(prisma.insight, req, res, 'insights'));

app.get('/api/v1/events', sdkAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const removeClient = addRealtimeClient(res);
    req.on('close', removeClient);
});

app.use('/api/ai', createAiRouter({
    runtime: aiRuntime,
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
    apiKeyActors: AGENT_API_KEY_ACTORS,
}));

app.use('/api/v1/knowledge-documents', createKnowledgeDocumentsRouter({
    uploadDir: UPLOAD_DIR,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
    prisma,
    onDataChange: publishDataChange,
}));

// C7 知识库深化：SOP 模板 + 知识关联（图谱）只读
app.use('/api/v1/knowledge', createKnowledgeRouter({
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
    onDataChange: publishDataChange,
}));

const emailService = createEmailService();
const verificationStore = createVerificationStore();
const requireEmailVerification = process.env.AUTH_REQUIRE_EMAIL_VERIFY
  ? !/^(0|false|no)$/i.test(process.env.AUTH_REQUIRE_EMAIL_VERIFY.trim())
  : true;
logger.info(`[auth] email transport: ${emailService.describe()}; verification ${requireEmailVerification ? 'required' : 'optional'}`);

app.use('/api/auth', createAuthRouter({
  prisma,
  email: emailService,
  verification: verificationStore,
  requireEmailVerification,
}));

app.use('/api/admin', createAdminRouter({ prisma, email: emailService, requireAuth: SDK_CONFIG.requireAuth, apiKeys: SDK_CONFIG.apiKeys }));

// 业务审批中心（PRD 19.21）：双轨偏差等第九章业务审批的待办/已办/决策；
// Agent 工具审批（tool:*）走 Assistant resolve，不在此暴露
// P0-003 修复：审批决策后同步业务单据状态（OrderChangeRequest 等）
const orderChangeApprovalSyncService = createOrderChangeRequestService({
    prisma,
    approvalCreateService: createApprovalCreateService({
        prisma,
        routingService: createApprovalRoutingService({ prisma }),
    }),
});
app.use('/api/v1/approvals', createApprovalRouter({
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    onDecided: async (approval) => {
        if (approval.targetType !== 'OrderChangeRequest') return;
        const result = await orderChangeApprovalSyncService.syncFromApprovalDecision({
            approvalRequestId: approval.id,
            decision: approval.status,
            decisionNote: approval.decisionNote,
            actorId: approval.reviewerId,
        });
        if (!result.ok) {
            // 钩子层面已约定仅记日志不回滚审批；此处抛出让 route 层统一 error log
            throw new Error(result.error.message);
        }
    },
}));

// Phase 1 共享内核（DR-007）：审批委派 / BOSS 最终兜底 / 解析路径只读审计
app.use('/api/v1/approvals-kernel', createApprovalKernelRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));

app.use('/api/hr', createHRRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth, apiKeys: SDK_CONFIG.apiKeys }));

app.use('/api/agent', createAgentRouter({
    prisma,
    dataSource: runtimeDataSource,
    getRuntimeMetrics: aiRuntime.getMetrics,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
}));

// ------------------------------------------------------------------
// /api/v1/import — PDF order import (multipart upload, parse-only)
// Auth: shares BAMBOOK_SDK_KEY / BAMBOOK_REQUIRE_AUTH with /api/sdk/*.
// Mounted lazily-bound to SDK_CONFIG to avoid hoisting issues.
// ------------------------------------------------------------------
app.use(
    '/api/v1/import',
    (req, res, next) => createImportRouter({
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

// ------------------------------------------------------------------
// /api/v1/orders — persistent Order resource (Postgres via Prisma)
//   POST /import   { orders: ParsedOrder[] }   → upsert by poNumber
// Auth shares BAMBOOK_SDK_KEY / BAMBOOK_REQUIRE_AUTH with the rest of /api/v1.
// ------------------------------------------------------------------
app.use(
    '/api/v1/orders',
    (req, res, next) => createOrdersRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/orders',
    (req, res, next) => createOrdersV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/order-lines',
    (req, res, next) => createOrderLinesRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/relations',
    (req, res, next) => createRelationsRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/relations',
    (req, res, next) => createRelationsV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

// REQ2-13（DR-056）：业务员离职一键交接——五类归属字段批量移交 + 停用留痕
app.use(
    '/api/v2/handover',
    (req, res, next) => createHandoverRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/products',
    (req, res, next) => createProductsRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        uploadDir: UPLOAD_DIR,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// 阶段 P2：电子画册（PRD 6.2 P2 LookbookCatalog）
app.use(
    '/api/v1/lookbooks',
    (req, res, next) => createLookbookRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// 阶段 P2：面料推荐引擎（PRD 6.2 P2 FabricRecommendation，确定性打分）
app.use(
    '/api/v1/fabric-recommendations',
    (req, res, next) => createFabricRecommendationRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/development',
    (req, res, next) => createDevelopmentRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/finance',
    (req, res, next) => createFinanceRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/finance',
    (req, res, next) => createFinanceV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

// 阶段 A5：报表引擎（数据集白名单 + 定义/运行/导出）
app.use(
    '/api/v1/reports',
    (req, res, next) => createReportingRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/shipping',
    (req, res, next) => createShippingRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/dashboard',
    (req, res, next) => createDashboardRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/production',
    (req, res, next) => createProductionRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/production',
    (req, res, next) => createProductionV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v2/trace',
    (req, res, next) => createTraceabilityRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/quotations',
    (req, res, next) => createQuotationRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        uploadDir: UPLOAD_DIR,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// MOQ 域：阈值配置（settings:moq:write）+ 变更历史 + dry-run 预检（fail-closed，仅 JWT）
app.use(
    '/api/v1/moq',
    (req, res, next) => createMoqRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
    })(req, res, next),
);

// Phase 2 Wave 2.1：订单变更域（DR-010 变更/取消/暂停审批链）+ 样品域（DR-008/011/012/026/028/039）
app.use('/api/v1/order-changes', createOrderChangeRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));
app.use('/api/v1/samples', createSampleRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));

// Phase 2 Wave 2.2：受控例外（DR-013）+ 信用控制（冻结/解冻/额度占用）+ 内部交易（DR-005/033）+ 付款申请
app.use('/api/v1/exceptions', createExceptionRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));
app.use('/api/v1/credit', createCreditRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));
app.use('/api/v1/internal-trade', createInternalTradeRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));
app.use('/api/v1/payment-requests', createPaymentRequestRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth }));

// 阶段 D / D6：实体级审计查询（普通用户按 targetType+targetId，模块读权限门禁）
app.use(
    '/api/v1/audit',
    (req, res, next) => createAuditRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/procurement',
    (req, res, next) => createProcurementRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/inventory',
    (req, res, next) => createInventoryRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/bom',
    (req, res, next) => createBOMRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/crm',
    (req, res, next) => createCrmRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/crm',
    (req, res, next) => createCrmV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/mes',
    (req, res, next) => createMesRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/suppliers',
    (req, res, next) => createSupplierRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// REQ2-07 历史数据批量迁移（跨 relations/orders/invoices 独立域，DR-049-③）
app.use(
    '/api/v1/data-migration',
    (req, res, next) => createDataMigrationRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/suppliers',
    (req, res, next) => createSuppliersV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/seasons',
    (req, res, next) => createSeasonRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/seasons',
    (req, res, next) => createSeasonsV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v2/marketing',
    (req, res, next) => createMarketingV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/risk',
    (req, res, next) => createRiskRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// 阶段 P0 回补：业务线注册与订单 MOQ 软校验（PRD 6.2）
app.use(
    '/api/v1/business-lines',
    (req, res, next) => createBusinessLineRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// 阶段 P0 回补：QC 驻地 / 验货任务 / QC 工作台（PRD 6.2 / 4.2）
// REQ2-04：uploadDir 供第三方测试报告 PDF 落盘（与 products 图片同源 UPLOAD_DIR）
app.use(
    '/api/v1/qc',
    (req, res, next) => createQcRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        uploadDir: UPLOAD_DIR,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// 阶段 P1：退税率表 / 退税美元定价（轨道 B）/ 订单利润表 / 原材料价格（PRD 8 / 6.2 P1）
app.use(
    '/api/v1/pricing',
    (req, res, next) => createPricingRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/customs',
    (req, res, next) => createCustomsRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v2/customs',
    (req, res, next) => createCustomsV2Router({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

// 阶段 P3a：单据模板（PRD 11.3 DocumentTemplate）
app.use(
    '/api/v1/document-templates',
    (req, res, next) => createDocumentTemplateRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/templates',
    (req, res, next) => createTemplatesRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/system-assets',
    (req, res, next) => createSystemAssetsRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        uploadDir: UPLOAD_DIR,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/pdml',
    (req, res, next) => createPdmlRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

app.use(
    '/api/v1/entities',
    (req, res, next) => createEntitiesRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
    })(req, res, next),
);

app.use(
    '/api/v1/business-profiles',
    (req, res, next) => createBusinessProfilesRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: publishDataChange,
    })(req, res, next),
);

// Phase 0 Sprint 1: 通知系统路由（鉴权后挂载，要求 actor.userId）
app.use(
    '/api/v1/notifications',
    (req, res, next) => {
        // 共用 sdkAuth 中间件链
        sdkAuth(req, res, () => {
            createNotificationsRouter()(req, res, next);
        });
    },
);

// ── 自动化规则 API ──
app.use(
    '/api/v1/automation',
    (req, res, next) => {
        sdkAuth(req, res, () => {
            createAutomationRouter(prisma)(req, res, next);
        });
    },
);

// ── 系统配置 API（W7 设置域：company.exporterProfile 服务端化，唯一写入口）──
app.use(
    '/api/v1/config',
    (req, res, next) => {
        sdkAuth(req, res, () => {
            createSystemConfigRouter({ prisma, requireAuth: SDK_CONFIG.requireAuth })(req, res, next);
        });
    },
);

// ── 工作流引擎 API（Phase 0 Sprint 2）──
app.use(
    '/api/v1/workflow',
    (req, res, next) => {
        sdkAuth(req, res, () => {
            createWorkflowRouter(prisma)(req, res, next);
        });
    },
);

// ------------------------------------------------------------------
// Universal Web Tools - 联网搜索与阅读代理
// ------------------------------------------------------------------

// 搜索代理 - 使用 DuckDuckGo HTML 版 (稳定且无 Key)
// 我们解析 HTML 版而不是使用 API，因为 HTML 版包含更丰富的实时结果 (天气、新闻)
app.get('/api/search', async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Missing query parameter 'q'" });

    logger.info(`🔍 [Search Proxy] Query: "${query}"`);
    try {
        const params = new URLSearchParams({
            q: query,
            kl: 'cn-zh', // 地区：中国 (关键！否则很多中文结果出不来)
            df: 'w',     // 时间范围：本周 (可选，默认不限)
        });

        // 模拟真实浏览器 Header，避免被判定为机器人
        const response = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new Error(`DuckDuckGo returned ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const results: any[] = [];

        // 解析搜索结果
        $('.result').each((i, el) => {
            if (i >= 8) return; // 限制返回数量

            const title = $(el).find('.result__title .result__a').text().trim();
            let url = $(el).find('.result__title .result__a').attr('href');
            let content = $(el).find('.result__snippet').text().trim();

            if (url && url.startsWith('//')) {
                url = 'https:' + url;
            }

            if (title && url) {
                results.push({
                    title,
                    url,
                    content
                });
            }
        });

        logger.info(`[Search Proxy] Found ${results.length} results via scraping.`);

        if (results.length === 0) {
            // Check for zero-click abstract (sometimes distinct structure)
            // But for now, just return empty
        }

        if (results.length === 0) {
            return res.json({
                query,
                source: 'ddg-empty',
                results: [{ title: 'No results found', url: '', content: 'DuckDuckGo did not return any results. This might be due to network blocking or no info found.' }]
            });
        }

        res.json({
            query,
            source: 'duckduckgo-html',
            results
        });

    } catch (error: any) {
        logger.error('[Search Proxy] Error', { error: error?.message || String(error) });
        res.status(500).json({ error: `Search failed: ${error.message}` });
    }
});

// URL 内容代理 - 绕过 CORS 获取任意网页内容
app.get('/api/fetch-url', async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });

    logger.info(`📖 [URL Proxy] Fetching: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new Error(`Target returned ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const html = await response.text();

        res.json({
            url,
            contentType,
            content: html,
            length: html.length
        });

    } catch (error: any) {
        logger.error('[URL Proxy] Error', { error: error?.message || String(error) });
        res.status(500).json({ error: `Fetch failed: ${error.message}` });
    }
});


// ------------------------------------------------------------------
// Email Service — extracted to server/src/email/route.ts (Phase 4a)
// ------------------------------------------------------------------
app.use('/api/v1/email', createEmailRouter({
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
}));
// F5 邮件智能化：业务场景模板库（PRD 12.1）
app.use('/api/v1/email-templates', createEmailTemplateRouter({
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
}));
// 阶段 P3b：邮件签名管理（PRD 12.1 EmailSignature）
app.use('/api/v1/email-signatures', createEmailSignatureRouter({
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
    onDataChange: publishDataChange,
}));
// Legacy IMAP proxy routes remain under /api/email for frontend compat
app.use('/api/email', createEmailRouter({
    prisma,
    requireAuth: SDK_CONFIG.requireAuth,
    apiKeys: SDK_CONFIG.apiKeys,
}));

// ------------------------------------------------------------------
// Market Data API - 真实大宗商品价格
// ------------------------------------------------------------------

// 棉花期货 API (ICE Futures)
app.get('/api/market/cotton', async (req, res) => {
    try {
        // 使用 Yahoo Finance API 获取棉花期货
        const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CT=F?interval=1d&range=1d', {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch cotton data');
        
        const data = await response.json();
        const quote = data?.chart?.result?.[0]?.meta;
        
        if (quote) {
            // CT=F 是棉花期货合约，价格单位是美分/磅
            res.json({
                status: 'success',
                symbol: 'CT=F',
                price: quote.regularMarketPrice,
                previousClose: quote.previousClose || quote.chartPreviousClose,
                currency: 'US cents/lb',
                timestamp: quote.regularMarketTime
            });
        } else {
            throw new Error('No quote data');
        }
    } catch (e: any) {
        logger.error('Cotton API error', { error: e?.message || String(e) });
        res.status(500).json({ status: 'error', error: e.message });
    }
});

// 羊毛期货 API (Australian Wool)
app.get('/api/market/wool', async (req, res) => {
    try {
        // 使用 Yahoo Finance 获取羊毛相关 ETF 或指标
        // EMI (Eastern Market Indicator) 是澳大利亚羊毛价格指数
        const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/WOLLF?interval=1d&range=1d', {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        const data = await response.json();
        const quote = data?.chart?.result?.[0]?.meta;
        
        if (quote && quote.regularMarketPrice > 0) {
            res.json({
                status: 'success',
                symbol: 'EMI (Wool)',
                price: quote.regularMarketPrice,
                currency: 'AUD/kg',
                timestamp: quote.regularMarketTime
            });
        } else {
            // 如果找不到羊毛 ETF，返回估算值
            res.json({
                status: 'estimated',
                symbol: 'EMI (Est.)',
                price: 14.50, // 基于历史的估算值 (AUD/kg)
                currency: 'AUD/kg',
                note: 'Real-time wool prices require specialized commodity terminals'
            });
        }
    } catch (e: any) {
        logger.error('Wool API error', { error: e?.message || String(e) });
        res.json({
            status: 'estimated',
            symbol: 'EMI (Est.)',
            price: 14.50,
            currency: 'AUD/kg'
        });
    }
});


// ------------------------------------------------------------------
// [DELETED] /api/po/* routes — data migrated to Postgres (/api/v1/orders).
// ------------------------------------------------------------------

interface ShippingNoticeOptions {
    contractNo?: string;
    supplier?: string;
    payerName?: string;
    payerAddress?: string;
    paymentTerms?: string;
    departurePort?: string;
    destinationPort?: string;
    shippingMethod?: string;
    shipmentDate?: string;
    consigneeName?: string;
    consigneeAddress?: string;
    notifyPartyName?: string;
    notifyPartyAddress?: string;
    forwarder?: string;
    customsDocs?: string;
    blRequirement?: string;
    packaging?: string;
    remarks?: string;
    itemRemarks?: string;
}

const DEFAULT_SUPPLIER = process.env.BAMBOOK_COMPANY_NAME_EN || 'JIANGSU PANDA CLOTHING CO.,LTD.';
const DEFAULT_DEPARTURE_PORT = 'SHANGHAI';
const DEFAULT_SHIPPING_METHOD = 'SEA';
const DEFAULT_BL_REQUIREMENT = '电放或正本提单按客户通知';
const DEFAULT_PACKAGING = 'ROLL PACKING';

const getPaymentTerms = (customerName?: string | null): string => {
    const customer = (customerName || '').toLowerCase();
    if (customer.includes('peerless')) return 'TT 60DAYS';
    return 'TT 30DAYS';
};

const createShippingNoticeExcel = (shippingData: any, filename: string): string => {
    const rows = [
        ['Shipping Notice'],
        ['Contract No.', shippingData.contractNo || ''],
        ['PO Numbers', (shippingData.poNumbers || []).join(', ')],
        ['Supplier', shippingData.supplier || ''],
        ['Payer', shippingData.payer?.name || ''],
        ['Payment Terms', shippingData.paymentTerms || ''],
        ['Departure Port', shippingData.departurePort || ''],
        ['Destination Port', shippingData.destinationPort || ''],
        ['Shipping Method', shippingData.shippingMethod || ''],
        ['Shipment Date', shippingData.shipmentDate || ''],
        ['Forwarder', shippingData.forwarder || ''],
        ['Customs Docs', shippingData.customsDocs || ''],
        ['B/L Requirement', shippingData.blRequirement || ''],
        ['Packaging', shippingData.packaging || ''],
        ['Remarks', shippingData.remarks || ''],
        [],
        ['PO', 'ZROH', 'Fabric Code', 'Quantity', 'Composition', 'Weight', 'Unit Price', 'Marks', 'Category', 'Purchase Price', 'Supplier'],
        ...((shippingData.items || []) as any[]).map(item => [
            item.poNumber || '',
            item.zroh || '',
            item.fabricCode || '',
            item.quantity || '',
            item.composition || '',
            item.weight || '',
            item.unitPrice || '',
            item.marks || '',
            item.category || '',
            item.purchasePrice || '',
            item.supplier || '',
        ]),
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Shipping Notice');
    const outputPath = path.join(OUTPUT_DIR, path.basename(filename));
    XLSX.writeFile(workbook, outputPath);
    return outputPath;
};

// 发货通知生成 API
app.post('/api/shipping-notice/generate', sdkAuth, async (req, res) => {
    try {
        const { poNumbers, options } = req.body as { poNumbers?: string[]; options?: ShippingNoticeOptions };

        if (!poNumbers || !Array.isArray(poNumbers) || poNumbers.length === 0) {
            return res.status(400).json({ success: false, error: '请提供至少一个 PO 号码' });
        }

        // 从 Prisma (Postgres) 获取订单和明细
        const dbOrders = await prisma.order.findMany({
            where: {
                poNumber: {
                    in: poNumbers
                }
            },
            include: {
                lines: true
            }
        });

        if (dbOrders.length === 0) {
            return res.status(400).json({ success: false, error: '未找到订单' });
        }

        // 将 Prisma Order 转换为 legacy Excel 构建器需要的结构
        const orders = dbOrders.map(o => ({
            po_number: o.poNumber || '',
            supplier_name: o.millName || '',
            customer_name: o.customer || '',
            payment_terms: o.paymentTerms || '',
            supplier_address: o.millAddress || '',
            consignee: o.consigneeName || '',
            currency: o.currency || '',
            order_date: o.poDate || '',
            total_amount: o.quoteAmount,
            season: o.season || '',
            contact_person: o.contactPerson || '',
            contact_telephone: o.contactPhone || '',
        }));

        // 按 PO 分组明细
        const itemsByPO: Record<string, any[]> = {};
        dbOrders.forEach(o => {
            const poNum = o.poNumber || '';
            itemsByPO[poNum] = o.lines.map(line => {
                const legacyItem = {
                    po_number: poNum,
                    zroh_number: line.materialCode || '',
                    fabric_code: line.millQuality || '',
                    fabric_content: line.cloth || '',
                    gsm: line.weight || '',
                    quantity: line.quantity,
                    unit_price: line.unitPrice || 0,
                    net_value: line.netValue || 0,
                    category: line.category || ''
                };
                return {
                    poNumber: poNum,
                    zroh: legacyItem.zroh_number,
                    fabricCode: legacyItem.fabric_code,
                    quantity: legacyItem.quantity,
                    composition: legacyItem.fabric_content,
                    weight: legacyItem.gsm,
                    unitPrice: legacyItem.unit_price,
                    marks: generatePOMarks(legacyItem),
                    category: legacyItem.category,
                    purchasePrice: legacyItem.net_value,
                    supplier: o.millName || ''
                };
            });
        });

        // 构建发货通知 data
        const shippingData = buildShippingNoticeDataFromPO(orders, itemsByPO, options);

        // 生成文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const poList = poNumbers.slice(0, 3).join('_');
        const filename = `ShippingNotice_${poList}_${timestamp}.xlsx`;

        // 生成 Excel 文件
        const outputPath = createShippingNoticeExcel(shippingData, filename);

        logger.info(`[Shipping Notice] Generated: ${outputPath}`);

        res.json({
            success: true,
            filename,
            downloadUrl: `/api/shipping-notice/download?file=${encodeURIComponent(filename)}`,
            data: shippingData
        });

    } catch (error: any) {
        logger.error('[Shipping Notice Error]', { error: error?.message || String(error) });
        res.status(500).json({ success: false, error: error.message });
    }
});

// 从 PO 数据库构建发货通知数据
function buildShippingNoticeDataFromPO(orders: any[], itemsByPO: Record<string, any[]>, options: ShippingNoticeOptions = {}): any {
    const firstOrder = orders[0];
    if (!firstOrder) {
        throw new Error('No orders provided');
    }

    const allItems = Object.values(itemsByPO).flat();

    return {
        contractNo: options.contractNo || orders.map(o => o.po_number).join('/'),
        poNumbers: orders.map(o => o.po_number),
        supplier: options.supplier || firstOrder.supplier_name || DEFAULT_SUPPLIER,

        payer: {
            name: options.payerName || firstOrder.customer_name,
            address: options.payerAddress || '',
            phone: '',
        },

        paymentTerms: options.paymentTerms || firstOrder.payment_terms || getPaymentTerms(firstOrder.customer_name),
        departurePort: options.departurePort || DEFAULT_DEPARTURE_PORT,
        destinationPort: options.destinationPort || '',
        shippingMethod: options.shippingMethod || DEFAULT_SHIPPING_METHOD,
        shipmentDate: options.shipmentDate || '',

        consignee: {
            name: options.consigneeName || firstOrder.customer_name,
            address: options.consigneeAddress || '',
        },
        notifyParty: {
            name: options.notifyPartyName || firstOrder.customer_name,
            address: options.notifyPartyAddress || '',
        },

        forwarder: options.forwarder || '指定货代，等通知',
        customsDocs: options.customsDocs || '发票 装箱单 提单',
        blRequirement: options.blRequirement || DEFAULT_BL_REQUIREMENT,
        packaging: options.packaging || DEFAULT_PACKAGING,

        remarks: options.remarks || '',
        itemRemarks: options.itemRemarks || '',

        items: allItems,
    };
}

// 生成 PO 唛头
function generatePOMarks(item: any): string {
    return `PO.NO.: ${item.po_number || ''}
ZROH: ${item.zroh_number || ''}
ART NO.: ${item.fabric_code || ''}
COLOR:
CONTENT: ${item.fabric_content || ''}
PIECE NO.:
NET LENGTH:
MADE IN CHINA`;
}

// 下载发货通知文件
app.get('/api/shipping-notice/download', sdkAuth, (req, res) => {
    const { file } = req.query;

    if (!file || typeof file !== 'string') {
        return res.status(400).json({ error: 'Missing file parameter' });
    }

    // 安全检查：只允许文件名，不允许路径
    const safeFilename = path.basename(file);
    const filePath = path.join(OUTPUT_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, safeFilename);
});

// 搜索订单 API
app.post('/api/orders/search', sdkAuth, async (req, res) => {
    try {
        const { keyword } = req.body;

        if (!keyword) {
            return res.json({ orders: [] });
        }

        // 使用 Prisma 搜索订单
        const orders = await prisma.order.findMany({
            where: {
                OR: [
                    { id: { contains: keyword, mode: 'insensitive' } },
                    { customer: { contains: keyword, mode: 'insensitive' } },
                    { millName: { contains: keyword, mode: 'insensitive' } },
                ],
                deletedAt: null
            },
            take: 50,
            orderBy: { updatedAt: 'desc' }
        });

        res.json({ orders });

    } catch (error: any) {
        logger.error('[Order Search Error]', { error: error?.message || String(error) });
        res.status(500).json({ error: error.message });
    }
});

// 综合市场数据 (汇率 + 大宗商品)
app.get('/api/market/all', async (_req: Request, res: Response) => {
    try {
        const results: any = {
            status: 'success',
            timestamp: new Date().toISOString(),
            forex: {},
            commodities: {}
        };
        
        // 1. 获取实时汇率
        try {
            const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
            const forexData = await forexRes.json();
            results.forex = {
                USD_CNY: forexData.rates.CNY,
                EUR_CNY: forexData.rates.EUR ? (1 / forexData.rates.EUR) * forexData.rates.CNY : null,
                GBP_CNY: forexData.rates.GBP ? (1 / forexData.rates.GBP) * forexData.rates.CNY : null,
                AUD_CNY: forexData.rates.AUD ? (1 / forexData.rates.AUD) * forexData.rates.CNY : null,
                source: 'real-time',
                isEstimate: false
            };
        } catch (e: any) {
            logger.error('Forex fetch failed', { error: e?.message || String(e) });
        }
        
        // 2. 获取棉花期货
        try {
            const cottonRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/CT=F?interval=1d&range=1d', {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const cottonData = await cottonRes.json();
            const cottonQuote = cottonData?.chart?.result?.[0]?.meta;
            if (cottonQuote) {
                // 转换为 CNY/Ton
                const cnyRate = results.forex.USD_CNY || 7.25;
                const usdPerLb = cottonQuote.regularMarketPrice;
                const cnyPerTon = usdPerLb * cnyRate * 2204.62; // 1 ton = 2204.62 lbs
                results.commodities.cotton = {
                    price: cnyPerTon,
                    currency: 'CNY/ton',
                    usdPrice: usdPerLb,
                    usdCurrency: 'US cents/lb',
                    source: 'real-time',
                    isEstimate: false
                };
            }
        } catch (e: any) {
            logger.error('Cotton fetch failed', { error: e?.message || String(e) });
        }
        
        // 3. 亚麻价格 (基于 USD 估算，波动较小)
        results.commodities.linen = {
            price: 87500, // 基础价格 CNY/ton
            currency: 'CNY/ton',
            note: 'Linen prices update weekly',
            source: 'estimate',
            isEstimate: true
        };
        
        // 4. 羊毛 (估算)
        results.commodities.wool = {
            price: 97500, // 基础价格 CNY/ton
            currency: 'CNY/ton',
            audPrice: 1450, // AUD/100kg
            note: 'Australian Wool EMI Index',
            source: 'estimate',
            isEstimate: true
        };
        
        res.json(results);
    } catch (e: any) {
        logger.error('Market API error', { error: e?.message || String(e) });
        res.status(500).json({ status: 'error', error: e.message });
    }
});

// =============================================================================
// [DELETED] /api/sdk/* routes — dead code, no frontend callers.
// The real API surface is /api/v1/* (orders, relations, products, import).
// =============================================================================

app.listen(PORT, () => {
    logger.info(`Sovereign Neural Core Online on port ${PORT}`);
    logger.info('Database Connection: Postgres via Prisma');
    logger.info(`SDK API: ${SDK_CONFIG.requireAuth ? 'Protected (API Key Required)' : 'Open (Local Access)'}`);
    logger.info(`Import API: POST /api/v1/import/order (auth: ${SDK_CONFIG.requireAuth ? 'required' : 'open'})`);
    logger.info(`Orders API: POST /api/v1/orders/import (auth: ${SDK_CONFIG.requireAuth ? 'required' : 'open'})`);
    if (process.env.BAMBOOK_MELO_PREWARM_ON_START === 'true') {
        prewarmMeloTts()
            .then(result => {
                if (!result.skipped) {
                    logger.info(`[tts] Melo prewarmed in ${result.elapsedMs}ms`);
                }
            })
            .catch(error => {
                logger.warn(`[tts] Melo prewarm failed: ${error?.message || error}`);
            });
    }
});
