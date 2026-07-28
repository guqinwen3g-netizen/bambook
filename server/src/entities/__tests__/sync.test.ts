import { describe, expect, it, vi } from 'vitest';
import { referenceIdFor, syncOrderEntityReferences } from '../sync';

describe('entity sync', () => {
  it('writes order relation references and graph links without touching source profiles', async () => {
    const ops: any[] = [];
    const prisma = {
      entityReference: {
        upsert: vi.fn((op) => ({ kind: 'reference', op })),
      },
      entityLink: {
        upsert: vi.fn((op) => ({ kind: 'link', op })),
      },
      $transaction: vi.fn(async (items) => {
        ops.push(...items);
      }),
    };

    await syncOrderEntityReferences(prisma as any, {
      id: 'ORDER-1',
      customer: 'Peerless Clothing',
      customerRelationId: 'REL-PEERLESS',
      millName: 'Panda Mill',
      millRelationId: 'REL-MILL',
    }, { source: 'manual', now: () => 1234 });

    expect(prisma.entityReference.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.entityLink.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ops[0].op.create).toEqual(expect.objectContaining({
      id: referenceIdFor('order', 'ORDER-1', 'customer', 'relation.organization', 'REL-PEERLESS'),
      ownerType: 'order',
      ownerId: 'ORDER-1',
      fieldKey: 'customer',
      targetType: 'relation.organization',
      targetId: 'REL-PEERLESS',
      source: 'manual',
      status: 'active',
    }));
    expect(ops[1].op.create).toEqual(expect.objectContaining({
      fromType: 'order',
      fromId: 'ORDER-1',
      toType: 'relation.organization',
      toId: 'REL-PEERLESS',
      linkKind: 'orderedBy',
    }));
  });
});

describe('syncShipmentReferences — shipsVia link uses carrierRelationId (task_mqxwgae9)', () => {
  it('生成 shipsVia link 用 carrierRelationId/carrierName（非 forwarder）', async () => {
    const { syncShipmentReferences } = await import('../sync');
    const ops: any[] = [];
    const prisma = {
      entityReference: { upsert: vi.fn((op) => ({ kind: 'reference', op })) },
      entityLink: { upsert: vi.fn((op) => ({ kind: 'link', op })) },
      $transaction: vi.fn(async (items) => { ops.push(...items); }),
    };

    await syncShipmentReferences(prisma as any, {
      id: 'SHP-1',
      shipmentNumber: 'SH-001',
      orderId: 'ORDER-1',
      customerRelationId: 'REL-CUST',
      customerName: 'ACME',
      carrierRelationId: 'REL-CARRIER',
      carrierName: 'FastShip Co',
    } as any, { source: 'manual', now: () => 1234 });

    // 应有 aboutOrder(1) + billTo(1) + shipsVia(1) 各 1 ref + 1 link = 6 ops
    const linkOps = ops.filter(o => o.kind === 'link');
    const shipsViaLinks = linkOps.filter(o => o.op.create?.linkKind === 'shipsVia');
    expect(shipsViaLinks).toHaveLength(1);
    // shipsVia link 的 toId 必须是 carrierRelationId 的值
    expect(shipsViaLinks[0].op.create).toEqual(expect.objectContaining({
      fromType: 'shipment',
      fromId: 'SHP-1',
      toType: 'relation.organization',
      toId: 'REL-CARRIER',
      linkKind: 'shipsVia',
    }));
    // shipsVia reference 的 fieldKey 必须是 carrierName
    const shipsViaRefs = ops.filter(o => o.kind === 'reference' && o.op.create?.fieldKey === 'carrierName');
    expect(shipsViaRefs).toHaveLength(1);
    expect(shipsViaRefs[0].op.create.targetId).toBe('REL-CARRIER');
  });

  it('carrierRelationId 缺失时不生成 shipsVia link', async () => {
    const { syncShipmentReferences } = await import('../sync');
    const ops: any[] = [];
    const prisma = {
      entityReference: { upsert: vi.fn((op) => ({ kind: 'reference', op })) },
      entityLink: { upsert: vi.fn((op) => ({ kind: 'link', op })) },
      $transaction: vi.fn(async (items) => { ops.push(...items); }),
    };

    await syncShipmentReferences(prisma as any, {
      id: 'SHP-2',
      orderId: 'ORDER-2',
      customerRelationId: 'REL-CUST',
      customerName: 'ACME',
      carrierRelationId: null,
      carrierName: null,
    } as any, { source: 'manual', now: () => 1234 });

    const shipsViaLinks = ops.filter(o => o.kind === 'link' && o.op.create?.linkKind === 'shipsVia');
    expect(shipsViaLinks).toHaveLength(0);
    // 仍生成 aboutOrder + billTo
    const linkKinds = ops.filter(o => o.kind === 'link').map(o => o.op.create?.linkKind);
    expect(linkKinds).toContain('aboutOrder');
    expect(linkKinds).toContain('billTo');
  });

  it('forwarderRelationId/forwarderName 不再触发 shipsVia（回归保护，字段已废弃）', async () => {
    const { syncShipmentReferences } = await import('../sync');
    const ops: any[] = [];
    const prisma = {
      entityReference: { upsert: vi.fn((op) => ({ kind: 'reference', op })) },
      entityLink: { upsert: vi.fn((op) => ({ kind: 'link', op })) },
      $transaction: vi.fn(async (items) => { ops.push(...items); }),
    };

    // 传 forwarderRelationId（旧字段，应被忽略，不生成 shipsVia）
    await syncShipmentReferences(prisma as any, {
      id: 'SHP-3',
      orderId: 'ORDER-3',
      customerRelationId: 'REL-CUST',
      customerName: 'ACME',
      forwarderRelationId: 'REL-OLD',
      forwarderName: 'OldForwarder',
    } as any, { source: 'manual', now: () => 1234 });

    const shipsViaLinks = ops.filter(o => o.kind === 'link' && o.op.create?.linkKind === 'shipsVia');
    expect(shipsViaLinks).toHaveLength(0); // forwarder 已废弃，不生成
  });
});

describe('manifest 字段契约对齐 schema（task_mqxwgae9）', () => {
  it('manifest 源码不含废弃的 forwarderRelationId/forwarderName', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestSrc = fs.readFileSync(
      path.resolve(__dirname, '../../agent/mcp/manifest.ts'), 'utf-8'
    );
    expect(manifestSrc).not.toContain('forwarderRelationId');
    expect(manifestSrc).not.toContain('forwarderName');
  });

  it('manifest shipping 段含 carrierRelationId/carrierName', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestSrc = fs.readFileSync(
      path.resolve(__dirname, '../../agent/mcp/manifest.ts'), 'utf-8'
    );
    expect(manifestSrc).toContain('carrierRelationId');
    expect(manifestSrc).toContain('carrierName');
  });
});
