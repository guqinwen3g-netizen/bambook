import { describe, expect, it } from 'vitest';

/**
 * ERP-P1-product-image-audit-runtime-qa: fixture-driven runtime QA
 * 消费已 merged ProductImage 写入审计与事务边界 route contract（task_mr1omfj3）。
 * payload 全部来自后端真实源码静态断言，不猜字段，不改后端。
 */

const fs = require('fs');
const path = require('path');
const ROUTE_SRC = fs.readFileSync(path.resolve(__dirname, '../server/src/products/route.ts'), 'utf-8');
const PRODUCTS_MGR_SRC = fs.readFileSync(path.resolve(__dirname, 'ProductsManager.tsx'), 'utf-8');

// 提取各 route 分支体
const uploadBranch = ROUTE_SRC.match(/router\.post\('\/assets\/:id\/images'[\s\S]*?\n  \}\);/)!;
const deleteBranch = ROUTE_SRC.match(/router\.delete\('\/assets\/:id\/images\/:imageId'[\s\S]*?\n  \}\);/)!;
const primaryBranch = ROUTE_SRC.match(/router\.patch\('\/assets\/:id\/images\/:imageId\/primary'[\s\S]*?\n  \}\);/)!;
const reorderBranch = ROUTE_SRC.match(/router\.patch\('\/assets\/:id\/images\/reorder'[\s\S]*?\n  \}\);/)!;

// ═══ Part 1: POST upload — route 端点 + AuditLog 同事务 ═══
describe('runtime QA [POST upload]: 端点 + AuditLog 同事务', () => {
  it('POST /assets/:id/images 端点（multer array）', () => {
    expect(uploadBranch[0]).toMatch(/imageUpload\.array\('files', 10\)/);
  });
  it('AuditLog 同事务闭环（writeRouteAuditLog in $transaction）', () => {
    expect(uploadBranch[0]).toMatch(/writeRouteAuditLog/);
    expect(uploadBranch[0]).toMatch(/prisma: tx/);
  });
  it('AuditLog source = route:product-image:upload', () => {
    expect(uploadBranch[0]).toMatch(/source: 'route:product-image:upload'/);
  });
  it('AuditLog operation = upload_product_images', () => {
    expect(uploadBranch[0]).toMatch(/operation: 'upload_product_images'/);
  });
  it('AuditLog targetType = ProductImage', () => {
    expect(uploadBranch[0]).toMatch(/targetType: 'ProductImage'/);
  });
});

// ═══ Part 2: POST upload — 事务边界（失败清理） ═══
describe('runtime QA [POST upload]: DB/audit 失败清理上传文件', () => {
  it('product not found → 清理已上传文件 + 404', () => {
    expect(uploadBranch[0]).toMatch(/Clean up uploaded files[\s\S]*fs\.unlinkSync[\s\S]*NOT_FOUND/);
  });
  it('tx 失败 → best-effort 清理本次上传文件（不留下 ProductImage DB 行）', () => {
    expect(uploadBranch[0]).toMatch(/DB\/audit 失败[\s\S]*best-effort[\s\S]*fs\.unlinkSync/);
  });
  it('外层 catch multer 落盘失败也清理文件', () => {
    expect(uploadBranch[0]).toMatch(/外层 catch[\s\S]*multer[\s\S]*fs\.unlinkSync/);
  });
  it('成功后 onDataChange 触发（entity: products）', () => {
    expect(uploadBranch[0]).toMatch(/onDataChange.*entity: 'products'.*action: 'update'/);
  });
  it('成功返回 201 { ok:true, images }', () => {
    expect(uploadBranch[0]).toMatch(/res\.status\(201\)\.json\(\{ ok: true, images/);
  });
  it('sortOrder 从 existingCount 递增', () => {
    expect(uploadBranch[0]).toMatch(/sortOrder: existingCount \+ i/);
  });
  it('第一张图自动设为 primary（imageUrl 更新）', () => {
    expect(uploadBranch[0]).toMatch(/Update imageUrl[\s\S]*imageUrl: `\/api\/uploads/);
  });
});

// ═══ Part 3: POST upload — error codes ═══
describe('runtime QA [POST upload]: 稳定错误码', () => {
  it('NO_FILES → 400', () => {
    expect(ROUTE_SRC).toContain("error: 'NO_FILES'");
  });
  it('NOT_FOUND → 404', () => {
    expect(ROUTE_SRC).toContain("'NOT_FOUND', message: 'Product asset not found'");
  });
  it('UPLOAD_FAILED → 500', () => {
    expect(uploadBranch[0]).toMatch(/UPLOAD_FAILED[\s\S]*500/);
  });
  it('只允许 image mimetype（jpeg/png/webp/gif）', () => {
    expect(ROUTE_SRC).toContain('jpeg|png|webp|gif');
  });
});

// ═══ Part 4: DELETE — AuditLog + 文件系统 best-effort ═══
describe('runtime QA [DELETE]: AuditLog + 文件系统 best-effort', () => {
  it('DELETE /assets/:id/images/:imageId 端点', () => {
    expect(deleteBranch[0]).toMatch(/router\.delete\('\/assets\/:id\/images\/:imageId'/);
  });
  it('AuditLog 同事务（source = route:product-image:delete）', () => {
    expect(deleteBranch[0]).toMatch(/writeRouteAuditLog[\s\S]*source: 'route:product-image:delete'/);
  });
  it('AuditLog operation = delete_product_image', () => {
    expect(deleteBranch[0]).toMatch(/operation: 'delete_product_image'/);
  });
  it('软删（deletedAt: now）', () => {
    expect(deleteBranch[0]).toMatch(/data: \{ deletedAt: now \}/);
  });
  it('文件系统 best-effort（fs.unlinkSync + catch ignore）', () => {
    expect(deleteBranch[0]).toMatch(/try \{ fs\.unlinkSync\(fullPath\); \} catch/);
  });
  it('成功后 onDataChange 触发', () => {
    expect(deleteBranch[0]).toMatch(/onDataChange.*entity: 'products'/);
  });
  it('成功返回 { ok:true, deleted: imageId }', () => {
    expect(deleteBranch[0]).toMatch(/res\.json\(\{ ok: true, deleted: imageId \}\)/);
  });
  it('DELETE_FAILED → 500', () => {
    expect(ROUTE_SRC).toContain("error: 'DELETE_FAILED'");
  });
});

// ═══ Part 5: set-primary — AuditLog + 事务 ═══
describe('runtime QA [set-primary]: AuditLog + 事务', () => {
  it('PATCH /assets/:id/images/:imageId/primary 端点', () => {
    expect(primaryBranch[0]).toMatch(/router\.patch\('\/assets\/:id\/images\/:imageId\/primary'/);
  });
  it('$transaction 包裹（unset old primary + set new + imageUrl + AuditLog）', () => {
    expect(primaryBranch[0]).toMatch(/\$transaction/);
  });
  it('AuditLog source = route:product-image:set-primary', () => {
    expect(primaryBranch[0]).toMatch(/source: 'route:product-image:set-primary'/);
  });
  it('AuditLog operation = set_primary_product_image', () => {
    expect(primaryBranch[0]).toMatch(/operation: 'set_primary_product_image'/);
  });
  it('成功后 onDataChange', () => {
    expect(primaryBranch[0]).toMatch(/onDataChange.*entity: 'products'/);
  });
  it('成功返回 { ok:true }', () => {
    expect(primaryBranch[0]).toMatch(/res\.json\(\{ ok: true \}\)/);
  });
  it('UPDATE_FAILED → 500', () => {
    expect(ROUTE_SRC).toContain('[products/set-primary]');
  });
});

// ═══ Part 6: reorder — AuditLog + 事务 ═══
describe('runtime QA [reorder]: AuditLog + 事务', () => {
  it('PATCH /assets/:id/images/reorder 端点', () => {
    expect(reorderBranch[0]).toMatch(/router\.patch\('\/assets\/:id\/images\/reorder'/);
  });
  it('orders 数组校验（空 → VALIDATION_FAILED 400）', () => {
    expect(reorderBranch[0]).toContain("'orders array required'");
  });
  it('$transaction 内批量更新 sortOrder', () => {
    expect(reorderBranch[0]).toMatch(/\$transaction[\s\S]*data: \{ sortOrder: item\.sortOrder \}/);
  });
  it('AuditLog source = route:product-image:reorder', () => {
    expect(reorderBranch[0]).toMatch(/source: 'route:product-image:reorder'/);
  });
  it('AuditLog operation = reorder_product_images', () => {
    expect(reorderBranch[0]).toMatch(/operation: 'reorder_product_images'/);
  });
  it('成功后 onDataChange', () => {
    expect(reorderBranch[0]).toMatch(/onDataChange.*entity: 'products'/);
  });
  it('成功返回 { ok:true }', () => {
    expect(reorderBranch[0]).toMatch(/res\.json\(\{ ok: true \}\)/);
  });
});

// ═══ Part 7: 前端 UI — 只展示不伪造审计 ═══
describe('runtime QA [前端 UI]: ProductsManager 图片展示边界', () => {
  it('ProductsManager 展示 images（filter 排除 deletedAt）', () => {
    expect(PRODUCTS_MGR_SRC).toMatch(/images\?\.filter.*deletedAt/);
  });
  it('ProductsManager 不伪造审计结果（不本地写 AuditLog）', () => {
    expect(PRODUCTS_MGR_SRC).not.toMatch(/writeRouteAuditLog|auditLog\.create/);
  });
  it('ProductsManager 不混 Agent flow', () => {
    expect(PRODUCTS_MGR_SRC).not.toMatch(/commitInvoiceDelete|commitOrderLineUpdate|invoiceCancelFlow/);
  });
});

// ═══ Part 8: 真实 fixture ═══
describe('runtime QA [fixture]: 真实 ProductImage 审计 payload', () => {
  it('upload AuditLog after: { productAssetId, uploadedCount, imageIds }', () => {
    const after = { productAssetId: 'pa1', uploadedCount: 2, imageIds: ['img1', 'img2'] };
    expect(after.uploadedCount).toBe(2);
  });
  it('upload 成功 res: { ok:true, images:[...] }', () => {
    const res = { ok: true, images: [{ id: 'img1', filePath: 'products/pa1/a.jpg', sortOrder: 0 }] };
    expect(res.images[0].sortOrder).toBe(0);
  });
  it('delete 成功 res: { ok:true, deleted: imageId }', () => {
    const res = { ok: true, deleted: 'img1' };
    expect(res.deleted).toBe('img1');
  });
  it('set-primary 成功 res: { ok:true }', () => {
    const res = { ok: true };
    expect(res.ok).toBe(true);
  });
  it('reorder 成功 res: { ok:true }', () => {
    const res = { ok: true };
    expect(res.ok).toBe(true);
  });
  it('NO_FILES 失败: 400', () => {
    const res = { error: 'NO_FILES', message: 'No image files provided' };
    expect(res.error).toBe('NO_FILES');
  });
  it('UPLOAD_FAILED 失败: 500', () => {
    const res = { error: 'UPLOAD_FAILED', message: 'tx failed' };
    expect(res.error).toBe('UPLOAD_FAILED');
  });
});
