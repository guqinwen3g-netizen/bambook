import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { syncShipmentReferences } from '../../entities/sync';

// task ERP-P1-shipping-mutation-shared-service-foundation:
// 契约文本断言目标切至 shipmentMutationService.ts（route 已精简为 service 调用）。
const SERVICE = fs.readFileSync(path.resolve(__dirname, '../shipmentMutationService.ts'), 'utf-8');
const SHIPPING = fs.readFileSync(path.resolve(__dirname, '../route.ts'), 'utf-8');

describe('task_mqxxxu3k: shipping status 合法枚举（fail closed）', () => {
  it('service 导出 VALID_SHIPMENT_STATUSES 含 8 个合法值', () => {
    expect(SERVICE).toContain("export const VALID_SHIPMENT_STATUSES = ['Draft', 'Booked', 'Loading', 'Shipped', 'Arrived', 'Cleared', 'Delivered', 'Cancelled']");
  });

  it('service createShipment 事务前 fail closed 校验非法 status', () => {
    expect(SERVICE).toContain("'INVALID_STATUS'");
    expect(SERVICE).toContain('isValidShipmentStatus');
  });

  it('service updateShipment: 显式 status 时走 validateStatusTransition', () => {
    const idx = SERVICE.indexOf('export async function updateShipment');
    const end = SERVICE.indexOf('export async function deleteShipment', idx);
    const section = SERVICE.slice(idx, end);
    expect(section).toContain('validateStatusTransition');
    expect(section).toContain("'INVALID_STATUS'");
  });
});

describe('task_mqxxxu3k: shipping service 事务闭环（业务+sync+link+AuditLog 同事务）', () => {
  it('service 3 mutation 都通过 withTx($transaction 或复用外部 tx)', () => {
    const txCount = (SERVICE.match(/withTx\(/g) || []).length;
    expect(txCount).toBeGreaterThanOrEqual(3);
  });

  it('createShipment: t.shipment.create + syncShipmentReferences + linkOrderStatusFromShipment + writeRouteAuditLog 在同一事务', () => {
    const idx = SERVICE.indexOf('export async function createShipment');
    const end = SERVICE.indexOf('export async function updateShipment', idx);
    const section = SERVICE.slice(idx, end);
    expect(section).toContain('t.shipment.create');
    expect(section).toContain('syncShipmentReferences(prisma');
    expect(section).toContain(', t)');
    expect(section).toContain('linkOrderStatusFromShipment(t');
    expect(section).toContain('writeRouteAuditLog');
    expect(section).toContain('prisma: t');
  });

  it('updateShipment: findUnique + update + sync + link + AuditLog before+after 同事务', () => {
    const idx = SERVICE.indexOf('export async function updateShipment');
    const end = SERVICE.indexOf('export async function deleteShipment', idx);
    const section = SERVICE.slice(idx, end);
    expect(section).toContain('t.shipment.findUnique');
    expect(section).toContain('t.shipment.update');
    expect(section).toContain('syncShipmentReferences');
    expect(section).toContain('linkOrderStatusFromShipment');
    expect(section).toContain('before');
    expect(section).toContain('after');
  });

  it('deleteShipment: findUnique + soft delete + AuditLog 同事务', () => {
    const idx = SERVICE.indexOf('export async function deleteShipment');
    const section = SERVICE.slice(idx);
    expect(section).toContain('t.shipment.findUnique');
    expect(section).toContain('t.shipment.update');
    expect(section).toContain('deletedAt');
    expect(section).toContain('writeRouteAuditLog');
  });

  it('route.ts POST/PATCH/DELETE 只调用 service，不再自开 $transaction', () => {
    expect(SHIPPING).toContain('createShipment({');
    expect(SHIPPING).toContain('updateShipment({');
    expect(SHIPPING).toContain('deleteShipment({');
    // route 不再直接 $transaction（$transaction 已移入 service）
    expect(SHIPPING).not.toMatch(/prisma as any\)\.\$transaction/);
  });

  it('onDataChange 在 service 成功后触发（route 层，非事务体内）', () => {
    // route 层 onDataChange 只在 result.ok 后调用
    const patchIdx = SHIPPING.indexOf("router.post('/'");
    const nextRouter = SHIPPING.indexOf("router.patch('/:id'", patchIdx);
    const postSection = SHIPPING.slice(patchIdx, nextRouter);
    // onDataChange 出现在 result.ok 分支
    const idxOk = postSection.indexOf("if (!result.ok)");
    const idxData = postSection.indexOf('onDataChange', idxOk);
    expect(idxData).toBeGreaterThan(idxOk);
  });
});

describe('task_mqxxxu3k: NOT_FOUND 错误契约（404 不漂成 500）', () => {
  it('route.ts POST/PATCH/DELETE 的 statusCodeMap 覆盖 NOT_FOUND → 404', () => {
    const notFoundMatches = SHIPPING.match(/NOT_FOUND:\s*404/g) || [];
    // PATCH 与 DELETE 至少都要有；此外还有 ORDER_NOT_FOUND: 404
    expect(notFoundMatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('task_mqxxxu3k: syncShipmentReferences(tx) 真实分支', () => {
  it('传 tx 时逐个 await tx.entityReference/entityLink upsert，不调 tx.$transaction', async () => {
    const entityReferenceUpsert = vi.fn().mockResolvedValue({});
    const entityLinkUpsert = vi.fn().mockResolvedValue({});
    const txTransaction = vi.fn();

    const tx = {
      entityReference: { upsert: entityReferenceUpsert },
      entityLink: { upsert: entityLinkUpsert },
      $transaction: txTransaction,
    } as any;

    const shipment = {
      id: 'SHP-1', shipmentNumber: 'SHP001',
      orderId: 'ORDER-1', customerRelationId: 'REL-1', customerName: 'Acme', carrierRelationId: 'CARR-1', carrierName: 'FastShip',
    };

    await syncShipmentReferences({} as any, shipment, { source: 'route:test' }, tx);

    expect(txTransaction).not.toHaveBeenCalled();
    expect(entityReferenceUpsert.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(entityLinkUpsert.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('某个 upsert reject 时整体 reject（事务回滚语义）', async () => {
    const entityReferenceUpsert = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('SYNC_FAIL'));
    const entityLinkUpsert = vi.fn().mockResolvedValue({});

    const tx = {
      entityReference: { upsert: entityReferenceUpsert },
      entityLink: { upsert: entityLinkUpsert },
    } as any;

    const shipment = {
      id: 'SHP-1', shipmentNumber: 'SHP001',
      orderId: 'ORDER-1', customerRelationId: 'REL-1', customerName: 'Acme',
    };

    await expect(syncShipmentReferences({} as any, shipment, { source: 'route:test' }, tx))
      .rejects.toThrow('SYNC_FAIL');
  });

  it('无 tx 时保持原 prisma.$transaction(ops) 逻辑（向后兼容）', async () => {
    const entityReferenceUpsert = vi.fn().mockResolvedValue({});
    const entityLinkUpsert = vi.fn().mockResolvedValue({});
    const prismaTransaction = vi.fn().mockResolvedValue([]);

    const prisma = {
      entityReference: { upsert: entityReferenceUpsert },
      entityLink: { upsert: entityLinkUpsert },
      $transaction: prismaTransaction,
    } as any;

    const shipment = { id: 'SHP-1', shipmentNumber: 'SHP001', orderId: 'ORDER-1' };

    await syncShipmentReferences(prisma, shipment, { source: 'route:test' });

    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    const opsArg = prismaTransaction.mock.calls[0][0];
    expect(Array.isArray(opsArg)).toBe(true);
    expect(opsArg.length).toBeGreaterThan(0);
  });
});
