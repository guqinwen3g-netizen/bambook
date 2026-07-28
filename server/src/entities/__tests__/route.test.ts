import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEntitiesRouter } from '../route';

function makeApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/entities', createEntitiesRouter({
    prisma,
    requireAuth: false,
    apiKeys: new Set<string>(),
  }));
  return app;
}

describe('entities route', () => {
  it('exposes versioned entity registry entries backed by existing source-of-truth models', async () => {
    const res = await request(makeApp({})).get('/api/v1/entities/registry');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.registryVersion).toBe('2026-05-09');
    expect(res.body.entityTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'relation.organization',
          sourceModel: 'Relation',
          schemaVersion: 1,
          canCreateInSourceModule: true,
        }),
        expect.objectContaining({
          type: 'product.fabricProfile',
          sourceModel: 'FabricProfile',
          schemaVersion: 1,
        }),
        expect.objectContaining({
          type: 'product.customerCode',
          sourceModel: 'FabricCustomerCode',
          schemaVersion: 1,
        }),
      ]),
    );
  });

  it('searches Relation as the organization source of truth and returns fillPatch data', async () => {
    const prisma = {
      relation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'REL-PEERLESS',
            name: 'Peerless Clothing',
            category: 'Customer',
            isOrganization: true,
            officialAddress: '8888 PIE IX Boulevard',
            billingAddress: 'Billing address',
            shippingAddress: 'Shipping address',
            primaryContactName: 'Jane Buyer',
            primaryContactPhone: '+1 514 000 0000',
            paymentTerms: 'AS PER AGREEMENT',
            currency: 'USD',
            deletedAt: null,
          },
        ]),
      },
    };

    const res = await request(makeApp(prisma))
      .post('/api/v1/entities/search')
      .send({
        query: 'peerless',
        fieldKey: 'customer',
        entityTypes: ['relation.organization'],
        include: { fillPatch: true },
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({
        entityType: 'relation.organization',
        id: 'REL-PEERLESS',
        title: 'Peerless Clothing',
        sourceModel: 'Relation',
        fillPatch: expect.objectContaining({
          customer: 'Peerless Clothing',
          customerRelationId: 'REL-PEERLESS',
          customerAddress: '8888 PIE IX Boulevard',
          contactPerson: 'Jane Buyer',
          contactTelephone: '+1 514 000 0000',
          paymentTerms: 'AS PER AGREEMENT',
          salesCurrency: 'USD',
        }),
      }),
    );
  });

  it('returns paginated entity search metadata and the requested result window', async () => {
    const prisma = {
      relation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'REL-1',
            name: 'Peerless Clothing A',
            category: 'Customer',
            isOrganization: true,
            deletedAt: null,
          },
          {
            id: 'REL-2',
            name: 'Peerless Clothing B',
            category: 'Customer',
            isOrganization: true,
            deletedAt: null,
          },
        ]),
        count: vi.fn().mockResolvedValue(3),
      },
    };

    const res = await request(makeApp(prisma))
      .post('/api/v1/entities/search')
      .send({
        query: 'peerless',
        entityTypes: ['relation.organization'],
        limit: 1,
        offset: 1,
        include: { fillPatch: false },
      });

    expect(res.status).toBe(200);
    expect(prisma.relation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      total: 3,
      limit: 1,
      offset: 1,
      hasMore: true,
    }));
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual(expect.objectContaining({
      id: 'REL-2',
      title: 'Peerless Clothing B',
    }));
  });

  it('searches fabric customer codes with customer context and hydrates exact entity refs', async () => {
    const fabricCode = {
      id: 'FCC-1',
      productAssetId: 'PROD-1',
      customerOrganizationId: 'REL-PEERLESS',
      customerNameSnapshot: 'Peerless Clothing',
      clientCode: 'ZROH-123',
      note: null,
      deletedAt: null,
      productAsset: {
        id: 'PROD-1',
        sku: 'FAB-001',
        name: 'Navy wool twill',
        fabricProfile: {
          id: 'FP-1',
          articleNo: 'ART-001',
          millQuality: 'MQ-001',
          millColorCode: 'NAVY',
          widthValue: 150,
          widthUnit: 'CM',
          weightValue: 180,
          weightUnit: 'GSM',
        },
        compositionLines: [],
      },
    };
    const prisma = {
      fabricCustomerCode: {
        findMany: vi.fn().mockResolvedValue([fabricCode]),
        findFirst: vi.fn().mockResolvedValue(fabricCode),
      },
    };

    const searchRes = await request(makeApp(prisma))
      .post('/api/v1/entities/search')
      .send({
        query: 'ZROH-123',
        fieldKey: 'clientCode',
        entityTypes: ['product.customerCode'],
        ownerContext: { customerRelationId: 'REL-PEERLESS' },
        include: { fillPatch: true },
      });

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items[0]).toEqual(
      expect.objectContaining({
        entityType: 'product.customerCode',
        id: 'FCC-1',
        title: 'ZROH-123',
        fillPatch: expect.objectContaining({
          clientCode: 'ZROH-123',
          product: 'Navy wool twill',
          fabricCode: 'ART-001',
          productColorCode: 'MQ-001',
          width: '150 CM',
          gsm: '180 GSM',
        }),
      }),
    );

    const hydrateRes = await request(makeApp(prisma))
      .post('/api/v1/entities/hydrate')
      .send({
        refs: [{ entityType: 'product.customerCode', id: 'FCC-1' }],
        include: { fillPatch: true },
      });

    expect(hydrateRes.status).toBe(200);
    expect(hydrateRes.body.items[0].id).toBe('FCC-1');
    expect(hydrateRes.body.items[0].fillPatch.clientCode).toBe('ZROH-123');
  });
});
