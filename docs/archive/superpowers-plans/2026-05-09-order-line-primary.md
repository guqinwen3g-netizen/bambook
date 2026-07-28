# Order Line Primary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Order Management operate on individual fabric items (`OrderLine`) while keeping `Order` as the shared PO header.

**Architecture:** Add line-level fields and helpers first, then expose line-first server APIs, then move the Order Management UI selection/detail flow from PO-level `Order` to line-level view models. PDF import remains PO-based but persists lines by stable item identity instead of deleting all lines after line-level follow-up data exists.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Express, Prisma, PostgreSQL.

---

## File Structure

- `lib/orderLineItems.ts`: frontend-safe helpers for item number display/generation and flattening `Order + lines` into line-first view models.
- `lib/orderLineItems.test.ts`: unit tests for item number generation and line flattening.
- `types.ts`: extend `OrderLineLite`, add `OrderLineStatus`, add `OrderLineItem`.
- `server/prisma/schema.prisma`: add `OrderLine.status`, line-level follow-up fields, and uniqueness/indexes for stable upsert.
- `server/src/import/persistOrders.ts`: replace wholesale line delete/recreate with line upsert by `orderId + itemNo`.
- `server/src/import/__tests__/persistOrders.test.ts`: cover line preservation and item-number behavior.
- `server/src/orders/orderLineItems.ts`: server helper for default item number and line payload mapping.
- `server/src/orders/orderLinesRoute.ts`: expose `GET /`, `POST /`, and `PUT /:id` under `/api/v1/order-lines`.
- `server/src/index.ts`: mount the focused order-lines router.
- `server/src/orders/__tests__/route.test.ts`: cover manual line creation and update.
- `services/importService.ts`: add frontend API functions for line creation/update/list.
- `services/orderLineService.ts`: frontend API wrapper for line creation/update.
- `components/OrderManager.tsx`: switch list selection/detail state to selected line item.
- `components/order/OrderLineDetail.tsx`: focused detail surface for one fabric item plus parent PO context.
- `components/order/OrderLineForm.tsx`: focused manual entry form for one fabric item.
- `components/order/OrderLinesTable.tsx`: keep as PO detail support, but make item number display consistent.

## Task 1: Item Number and Line View Helpers

**Files:**
- Create: `lib/orderLineItems.ts`
- Create: `lib/orderLineItems.test.ts`
- Modify: `types.ts`

- [ ] **Step 1: Add failing tests for item numbering**

Create `lib/orderLineItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Order } from '../types';
import { displayItemNo, getNextItemNo, flattenOrderLines } from './orderLineItems';

describe('order line item numbering', () => {
  it('displays imported five-digit SAP item numbers as four-digit business numbers', () => {
    expect(displayItemNo('00010')).toBe('0010');
    expect(displayItemNo('00020')).toBe('0020');
    expect(displayItemNo('0011')).toBe('0011');
    expect(displayItemNo('ABC')).toBe('ABC');
  });

  it('generates ten-step default item numbers and ignores revision variants', () => {
    expect(getNextItemNo([])).toBe('0010');
    expect(getNextItemNo(['0010'])).toBe('0020');
    expect(getNextItemNo(['0010', '0011'])).toBe('0020');
    expect(getNextItemNo(['00010', '00020'])).toBe('0030');
  });
});

describe('flattenOrderLines', () => {
  it('creates one line-first item per order line', () => {
    const order: Order = {
      id: 'PO-4500159423',
      customer: 'Peerless',
      product: 'Imported PO',
      type: 'Fabric',
      quantity: 300,
      status: 'Pending',
      dueDate: '2026/07/01',
      quoteAmount: 900,
      poNumber: '4500159423',
      poDate: '2026/03/31',
      salesCurrency: 'USD',
      lines: [
        {
          id: 'L1',
          lineNumber: 1,
          itemNo: '00010',
          materialCode: '144749',
          millQuality: 'RD7302',
          description: 'CHARCOAL SOLID',
          width: '147 CM',
          exMillDate: '2026/07/01',
          deliveryDate: '2026/08/15',
          quantity: 300,
          unit: 'Meter',
          unitPrice: 3,
          netValue: 900,
          cloth: '70% Wool',
          weight: '186GSM',
          status: 'Production',
        },
      ],
    };

    expect(flattenOrderLines([order])).toEqual([
      expect.objectContaining({
        id: 'L1',
        orderId: 'PO-4500159423',
        poNumber: '4500159423',
        displayItemNo: '0010',
        displayId: 'PO 4500159423 / 0010',
        status: 'Production',
        customer: 'Peerless',
        amount: 900,
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/orderLineItems.test.ts`

Expected: FAIL because `lib/orderLineItems.ts` does not exist.

- [ ] **Step 3: Extend shared types**

Modify `types.ts` around `OrderLineLite`:

```ts
export type OrderLineStatus = 'Pending' | 'Production' | 'Shipping' | 'Delivered' | 'Alert';

export interface OrderLineLite {
  id: string;
  orderId?: string;
  lineNumber: number;
  itemNo?: string | null;
  materialCode?: string | null;
  millQuality?: string | null;
  description?: string | null;
  width?: string | null;
  exMillDate?: string | null;
  deliveryDate?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice?: number | null;
  netValue?: number | null;
  cloth?: string | null;
  weight?: string | null;
  status?: OrderLineStatus | null;
  productionBatch?: string | null;
  shippingDate?: string | null;
  shippingMethod?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  shipmentQuantity?: number | null;
  shipmentAmount?: number | null;
  actualPaymentDate?: string | null;
  actualPaymentAmount?: number | null;
  specialInstructions?: string | null;
}

export interface OrderLineItem extends OrderLineLite {
  order: Order;
  orderId: string;
  poNumber: string;
  customer: string;
  poDate?: string | null;
  salesCurrency?: string | null;
  displayItemNo: string;
  displayId: string;
  amount: number;
  status: OrderLineStatus;
}
```

- [ ] **Step 4: Implement helper**

Create `lib/orderLineItems.ts`:

```ts
import type { Order, OrderLineItem, OrderLineLite, OrderLineStatus } from '../types';

const DEFAULT_STATUS: OrderLineStatus = 'Pending';

export function displayItemNo(itemNo: string | null | undefined): string {
  const raw = String(itemNo ?? '').trim();
  if (/^\d{5}$/.test(raw) && raw.startsWith('0')) return raw.slice(1);
  if (/^\d{1,4}$/.test(raw)) return raw.padStart(4, '0');
  return raw || '0010';
}

export function getNextItemNo(existing: Array<string | null | undefined>): string {
  const mainNumbers = existing
    .map(displayItemNo)
    .filter((v) => /^\d{4}$/.test(v))
    .map((v) => Math.floor(Number(v) / 10) * 10);
  const next = mainNumbers.length === 0 ? 10 : Math.max(...mainNumbers) + 10;
  return String(next).padStart(4, '0');
}

export function flattenOrderLines(orders: Order[]): OrderLineItem[] {
  const items: OrderLineItem[] = [];
  for (const order of orders) {
    if (order.deletedAt || order.type !== 'Fabric') continue;
    const lines = order.lines && order.lines.length > 0
      ? [...order.lines].sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0))
      : [fallbackLine(order)];

    for (const line of lines) {
      const poNumber = order.poNumber || order.id;
      const displayNo = displayItemNo(line.itemNo || String(line.lineNumber * 10));
      const amount = line.netValue ?? (line.unitPrice != null ? line.unitPrice * line.quantity : order.quoteAmount);
      const status = line.status || order.status || DEFAULT_STATUS;
      items.push({
        ...line,
        order,
        orderId: line.orderId || order.id,
        poNumber,
        customer: order.customer,
        poDate: order.poDate,
        salesCurrency: order.salesCurrency,
        displayItemNo: displayNo,
        displayId: `PO ${poNumber} / ${displayNo}`,
        amount: amount ?? 0,
        status,
      });
    }
  }
  return items;
}

function fallbackLine(order: Order): OrderLineLite {
  return {
    id: `${order.id}__L001`,
    orderId: order.id,
    lineNumber: 1,
    itemNo: '0010',
    materialCode: order.clientCode ?? null,
    millQuality: order.productColorCode ?? null,
    description: order.product || order.fabricContent || null,
    width: order.width ?? null,
    exMillDate: order.clientDate || order.dueDate || null,
    deliveryDate: order.productionDate ?? null,
    quantity: order.quantity ?? 0,
    unit: 'Meter',
    unitPrice: order.salesPrice ?? null,
    netValue: order.contractAmount ?? order.quoteAmount ?? null,
    cloth: order.fabricContent ?? null,
    weight: order.gsm ?? null,
    status: order.status,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/orderLineItems.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add types.ts lib/orderLineItems.ts lib/orderLineItems.test.ts
git commit -m "feat: add order line item helpers"
```

## Task 2: Database Schema for Line-Level Follow-Up

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/src/orders/orderLineItems.ts`
- Create: `server/src/orders/orderLineItems.test.ts`

- [ ] **Step 1: Add failing server helper tests**

Create `server/src/orders/orderLineItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeItemNoForDisplay, nextItemNo } from './orderLineItems';

describe('server order line item helpers', () => {
  it('normalizes imported SAP item numbers for display', () => {
    expect(normalizeItemNoForDisplay('00010')).toBe('0010');
    expect(normalizeItemNoForDisplay('0011')).toBe('0011');
  });

  it('generates next ten-step item number ignoring revisions', () => {
    expect(nextItemNo([])).toBe('0010');
    expect(nextItemNo(['0010', '0011'])).toBe('0020');
    expect(nextItemNo(['00010', '00020'])).toBe('0030');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- src/orders/orderLineItems.test.ts`

Expected: FAIL because `src/orders/orderLineItems.ts` does not exist.

- [ ] **Step 3: Add server helper**

Create `server/src/orders/orderLineItems.ts`:

```ts
export function normalizeItemNoForDisplay(itemNo: string | null | undefined): string {
  const raw = String(itemNo ?? '').trim();
  if (/^\d{5}$/.test(raw) && raw.startsWith('0')) return raw.slice(1);
  if (/^\d{1,4}$/.test(raw)) return raw.padStart(4, '0');
  return raw || '0010';
}

export function nextItemNo(existing: Array<string | null | undefined>): string {
  const mainNumbers = existing
    .map(normalizeItemNoForDisplay)
    .filter((v) => /^\d{4}$/.test(v))
    .map((v) => Math.floor(Number(v) / 10) * 10);
  const next = mainNumbers.length === 0 ? 10 : Math.max(...mainNumbers) + 10;
  return String(next).padStart(4, '0');
}
```

- [ ] **Step 4: Update Prisma schema**

Modify `server/prisma/schema.prisma` inside `model OrderLine`:

```prisma
  status              String? @default("Pending")
  productionBatch     String?
  shippingDate        String?
  shippingMethod      String?
  invoiceNumber       String?
  invoiceDate         String?
  shipmentQuantity    Float?
  shipmentAmount      Float?
  actualPaymentDate   String?
  actualPaymentAmount Float?
  specialInstructions String?
  fieldSources        Json?
```

Add indexes at the bottom of `model OrderLine`:

```prisma
  @@unique([orderId, itemNo])
  @@index([status])
```

- [ ] **Step 5: Create deployable migration file**

Create `server/prisma/migrations/20260509123000_order_line_primary/migration.sql`:

```sql
-- Promote OrderLine into the line-level follow-up entity used by Order Management.
ALTER TABLE "OrderLine" ADD COLUMN "status" TEXT DEFAULT 'Pending';
ALTER TABLE "OrderLine" ADD COLUMN "productionBatch" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shippingDate" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shippingMethod" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "invoiceDate" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shipmentQuantity" DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "shipmentAmount" DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "actualPaymentDate" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "actualPaymentAmount" DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "specialInstructions" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "fieldSources" JSONB;

CREATE INDEX "OrderLine_status_idx" ON "OrderLine"("status");
CREATE UNIQUE INDEX "OrderLine_orderId_itemNo_key" ON "OrderLine"("orderId", "itemNo");
```

Do not run `prisma migrate dev` against the developer machine's `.env`, because the real database is controlled from the data-center ops panel. The deployable migration must be included in the server package; ops panel deploy runs `npx prisma migrate deploy` in the data-center environment.

- [ ] **Step 6: Run helper tests**

Run: `cd server && npm test -- src/orders/orderLineItems.test.ts`

Expected: PASS.

- [ ] **Step 7: Validate local Prisma assets without touching data-center DB**

Run:

```bash
cd server && npx prisma validate
cd server && npx prisma generate
cd server && npm run build
```

Expected: all PASS. These commands validate schema/client/build locally without applying migrations to the data-center database.

- [ ] **Step 8: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/orders/orderLineItems.ts server/src/orders/orderLineItems.test.ts
git commit -m "feat: add order line primary schema"
```

- [ ] **Step 9: Deployment note**

When this branch is ready to deploy, use the existing ops panel main API deployment path. Both `server/scripts/ops/ops-deploy-main-api.sh` and the ops panel uploaded-package deployment run:

```bash
npx prisma migrate deploy
npx prisma generate
npm run build
```

in the data-center environment.

## Task 3: Line-Aware PDF Persistence

**Files:**
- Modify: `server/src/import/persistOrders.ts`
- Modify: `server/src/import/__tests__/persistOrders.test.ts`

- [ ] **Step 1: Add failing preservation test**

Append to `server/src/import/__tests__/persistOrders.test.ts`:

```ts
  it('re-import preserves manual line follow-up fields by itemNo', async () => {
    const parsed = await loadFixtures();
    await persistOrders(prisma, [parsed[0]]);

    await prisma.orderLine.update({
      where: { orderId_itemNo: { orderId: 'PO-4500159423', itemNo: parsed[0].lines[0].itemNo } },
      data: {
        status: 'Production',
        specialInstructions: 'Manual line note',
      },
    });

    await persistOrders(prisma, [parsed[0]]);

    const line = await prisma.orderLine.findUnique({
      where: { orderId_itemNo: { orderId: 'PO-4500159423', itemNo: parsed[0].lines[0].itemNo } },
    });
    expect(line?.status).toBe('Production');
    expect(line?.specialInstructions).toBe('Manual line note');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- src/import/__tests__/persistOrders.test.ts`

Expected: FAIL before implementation because current persistence deletes and recreates lines.

- [ ] **Step 3: Replace line delete/create with upsert**

In `server/src/import/persistOrders.ts`, replace this transaction section:

```ts
      prisma.orderLine.deleteMany({ where: { orderId } }),
      ...(lineRows.length > 0
        ? [prisma.orderLine.createMany({ data: lineRows })]
        : []),
```

with:

```ts
      ...lineRows.map((line) =>
        prisma.orderLine.upsert({
          where: {
            orderId_itemNo: {
              orderId,
              itemNo: line.itemNo ?? `__LINE_${line.lineNumber}`,
            },
          },
          create: line,
          update: {
            lineNumber: line.lineNumber,
            materialCode: line.materialCode,
            millQuality: line.millQuality,
            description: line.description,
            width: line.width,
            exMillDate: line.exMillDate,
            deliveryDate: line.deliveryDate,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            netValue: line.netValue,
            via: line.via,
            cloth: line.cloth,
            weight: line.weight,
            category: line.category,
            notes: line.notes,
          },
        }),
      ),
```

Also change `mapLine` so empty item numbers get generated:

```ts
    itemNo: l.itemNo || String((idx + 1) * 10).padStart(4, '0'),
    status: 'Pending',
```

- [ ] **Step 4: Run persistence tests**

Run: `cd server && npm test -- src/import/__tests__/persistOrders.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/import/persistOrders.ts server/src/import/__tests__/persistOrders.test.ts
git commit -m "feat: preserve order line edits on import"
```

## Task 4: Line-First Server API

**Files:**
- Modify: `server/src/orders/route.ts`
- Create: `server/src/orders/orderLinesRoute.ts`
- Modify: `server/src/orders/__tests__/route.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add failing route tests**

Modify the test app setup in `server/src/orders/__tests__/route.test.ts` to import and mount the new router:

```ts
import { createOrderLinesRouter } from '../orderLinesRoute';
```

Inside `makeApp()`, after the existing `/api/v1/orders` mount, add:

```ts
  app.use(
    '/api/v1/order-lines',
    createOrderLinesRouter({
      prisma,
      requireAuth: false,
      apiKeys: new Set<string>(),
    }),
  );
```

Then add a route test that calls:

```ts
await request(app)
  .post('/api/v1/orders')
  .send({
    customer: 'Peerless',
    poNumber: 'PO-LINE-1',
    millName: 'Panda Mill',
    product: 'Header',
  })
  .expect(200);

const createdLine = await request(app)
  .post('/api/v1/order-lines')
  .send({
    poNumber: 'PO-LINE-1',
    itemNo: '0010',
    materialCode: '144749',
    millQuality: 'RD7302',
    description: 'CHARCOAL SOLID',
    quantity: 300,
    unit: 'Meter',
    unitPrice: 3,
    netValue: 900,
    status: 'Production',
  })
  .expect(200);

expect(createdLine.body.line).toMatchObject({
  itemNo: '0010',
  status: 'Production',
  materialCode: '144749',
});

await request(app)
  .put(`/api/v1/order-lines/${createdLine.body.line.id}`)
  .send({ status: 'Shipping', specialInstructions: 'Ready to ship' })
  .expect(200);

const listed = await request(app).get('/api/v1/order-lines').expect(200);
expect(listed.body.lines).toEqual([
  expect.objectContaining({
    poNumber: 'PO-LINE-1',
    itemNo: '0010',
    status: 'Shipping',
    specialInstructions: 'Ready to ship',
  }),
]);
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `cd server && npm test -- src/orders/__tests__/route.test.ts`

Expected: FAIL because `/api/v1/order-lines` routes do not exist.

- [ ] **Step 3: Add focused order-lines router**

Create `server/src/orders/orderLinesRoute.ts`:

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { nextItemNo } from './orderLineItems';

export interface OrderLinesRouterOptions {
  prisma: PrismaClient;
  requireAuth: boolean;
  apiKeys: Set<string>;
  onDataChange?: (event: { entity: string; action: string; ids?: string[] }) => void;
}

const ORDER_LINE_WRITABLE_FIELDS = new Set([
  'lineNumber',
  'itemNo',
  'materialCode',
  'millQuality',
  'description',
  'width',
  'exMillDate',
  'deliveryDate',
  'quantity',
  'unit',
  'unitPrice',
  'netValue',
  'via',
  'cloth',
  'weight',
  'category',
  'notes',
  'status',
  'productionBatch',
  'shippingDate',
  'shippingMethod',
  'invoiceNumber',
  'invoiceDate',
  'shipmentQuantity',
  'shipmentAmount',
  'actualPaymentDate',
  'actualPaymentAmount',
  'specialInstructions',
]);

export function createOrderLinesRouter(opts: OrderLinesRouterOptions): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!opts.requireAuth) return next();
    const k = req.headers['x-bambook-api-key'] as string | undefined;
    if (!k) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'X-Bambook-API-Key header required' });
    if (!opts.apiKeys.has(k)) return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API key' });
    next();
  });

  router.get('/', async (_req, res) => {
    const rows = await opts.prisma.orderLine.findMany({
      where: { order: { deletedAt: null } },
      include: { order: true },
      orderBy: [{ order: { importedAt: 'desc' } }, { lineNumber: 'asc' }],
    });
    return res.json({ ok: true, lines: rows.map(serializeOrderLine) });
  });

  router.post('/', async (req, res) => {
    const body = (req.body || {}) as Record<string, unknown> & { poNumber?: string };
    if (!body.poNumber) return res.status(400).json({ error: 'VALIDATION_FAILED', message: 'poNumber is required' });

    const ts = Date.now();
    const order = await opts.prisma.order.upsert({
      where: { poNumber: body.poNumber },
      update: { updatedAt: BigInt(ts) },
      create: {
        id: `PO-${body.poNumber}`,
        poNumber: body.poNumber,
        customer: String(body.customer || ''),
        product: String(body.description || body.materialCode || ''),
        type: 'Fabric',
        quantity: Number(body.quantity || 0),
        status: String(body.status || 'Pending'),
        dueDate: String(body.exMillDate || ''),
        quoteAmount: Number(body.netValue || 0),
        source: 'manual',
        importedAt: BigInt(ts),
        updatedAt: BigInt(ts),
      },
      include: { lines: true },
    });

    const writable = stripLineWritable(body);
    const itemNo = String(writable.itemNo || nextItemNo(order.lines.map((l) => l.itemNo)));
    const line = await opts.prisma.orderLine.create({
      data: {
        id: `${order.id}__${itemNo}`,
        orderId: order.id,
        lineNumber: Number(writable.lineNumber || order.lines.length + 1),
        itemNo,
        quantity: Number(writable.quantity || 0),
        status: String(writable.status || 'Pending'),
        ...writable,
      } as Prisma.OrderLineUncheckedCreateInput,
      include: { order: true },
    });
    opts.onDataChange?.({ entity: 'order-lines', action: 'create', ids: [line.id] });
    return res.json({ ok: true, line: serializeOrderLine(line) });
  });

  router.put('/:id', async (req, res) => {
    const id = req.params.id;
    const writable = stripLineWritable(req.body || {});
    if (Object.keys(writable).length === 0) return res.status(400).json({ error: 'EMPTY_PATCH', message: 'patch body has no editable fields' });
    const line = await opts.prisma.orderLine.update({
      where: { id },
      data: writable as Prisma.OrderLineUncheckedUpdateInput,
      include: { order: true },
    });
    opts.onDataChange?.({ entity: 'order-lines', action: 'update', ids: [line.id] });
    return res.json({ ok: true, line: serializeOrderLine(line) });
  });

  return router;
}

function stripLineWritable(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ORDER_LINE_WRITABLE_FIELDS.has(k) || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function serializeOrderLine(line: any) {
  const out: any = { ...line };
  for (const k of Object.keys(out)) if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  if (out.order) {
    out.poNumber = out.order.poNumber;
    out.customer = out.order.customer;
    for (const k of Object.keys(out.order)) if (typeof out.order[k] === 'bigint') out.order[k] = Number(out.order[k]);
  }
  return out;
}
```

- [ ] **Step 4: Mount order-lines router in server index**

Modify `server/src/index.ts`:

```ts
import { createOrderLinesRouter } from './orders/orderLinesRoute';
```

Add after the existing `/api/v1/orders` mount:

```ts
app.use(
    '/api/v1/order-lines',
    (req, res, next) => createOrderLinesRouter({
        prisma,
        requireAuth: SDK_CONFIG.requireAuth,
        apiKeys: SDK_CONFIG.apiKeys,
        onDataChange: (event) => notifyDataChange(event),
    })(req, res, next),
);
```

- [ ] **Step 5: Run route tests**

Run: `cd server && npm test -- src/orders/__tests__/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Run server build**

Run: `cd server && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/orders/orderLinesRoute.ts server/src/orders/route.ts server/src/orders/__tests__/route.test.ts server/src/index.ts
git commit -m "feat: add order line api"
```

## Task 5: Frontend API Functions

**Files:**
- Modify: `services/importService.ts`
- Create: `services/orderLineService.test.ts`
- Create: `services/orderLineService.ts`

- [ ] **Step 1: Add failing API service tests**

Create `services/orderLineService.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createOrderLine, updateOrderLineFields } from './orderLineService';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, line: { id: 'L1', itemNo: '0010' } }),
  })));
});

describe('orderLineService', () => {
  it('creates one fabric item', async () => {
    await createOrderLine({ poNumber: 'PO-1', itemNo: '0010', quantity: 1 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/order-lines'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"poNumber":"PO-1"'),
      }),
    );
  });

  it('updates one fabric item', async () => {
    await updateOrderLineFields('L1', { status: 'Shipping' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/order-lines/L1'),
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"status":"Shipping"'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/orderLineService.test.ts`

Expected: FAIL because `services/orderLineService.ts` does not exist.

- [ ] **Step 3: Add API service**

Create `services/orderLineService.ts`:

```ts
import type { OrderLineItem, OrderLineLite } from '../types';
import { apiService } from './apiService';

export async function createOrderLine(
  line: Partial<OrderLineLite> & { poNumber: string },
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; line: OrderLineItem }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;
  const res = await fetch(apiService.buildApiUrl('/v1/order-lines'), {
    method: 'POST',
    body: JSON.stringify(line),
    headers,
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Create line failed (HTTP ${res.status})`);
  return res.json();
}

export async function updateOrderLineFields(
  id: string,
  patch: Partial<OrderLineLite>,
  opts: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; line: OrderLineItem }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = opts.apiKey || apiService.getApiKey();
  if (apiKey) headers['X-Bambook-API-Key'] = apiKey;
  const res = await fetch(apiService.buildApiUrl(`/v1/order-lines/${encodeURIComponent(id)}`), {
    method: 'PUT',
    body: JSON.stringify(patch),
    headers,
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Update line failed (HTTP ${res.status})`);
  return res.json();
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run services/orderLineService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/orderLineService.ts services/orderLineService.test.ts
git commit -m "feat: add order line frontend api"
```

## Task 6: Line-First Order Management UI

**Files:**
- Modify: `components/OrderManager.tsx`
- Create: `components/order/OrderLineDetail.tsx`
- Create: `components/order/OrderLineForm.tsx`
- Modify: `components/order/OrderLinesTable.tsx`
- Test: `lib/orderLineItems.test.ts`

- [ ] **Step 1: Add UI model test for selected second line**

Extend `lib/orderLineItems.test.ts`:

```ts
it('keeps second line identity separate from first line under the same PO', () => {
  const order = {
    id: 'PO-1',
    customer: 'Peerless',
    product: 'PO',
    type: 'Fabric',
    quantity: 30,
    status: 'Pending',
    dueDate: '',
    quoteAmount: 30,
    poNumber: 'PO-1',
    lines: [
      { id: 'L1', lineNumber: 1, itemNo: '0010', quantity: 10, status: 'Pending' },
      { id: 'L2', lineNumber: 2, itemNo: '0020', quantity: 20, status: 'Shipping' },
    ],
  } as any;

  const items = flattenOrderLines([order]);
  expect(items[1]).toMatchObject({
    id: 'L2',
    displayId: 'PO PO-1 / 0020',
    quantity: 20,
    status: 'Shipping',
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run lib/orderLineItems.test.ts`

Expected: PASS after Task 1 helper exists.

- [ ] **Step 3: Switch table data to line items**

In `components/OrderManager.tsx`:

- import `flattenOrderLines`, `getNextItemNo`
- add `const lineItems = flattenOrderLines(orders);`
- replace `filteredOrders.flatMap(...)` table body with `lineItems.map((item) => ...)`
- row click should call a new `handleLineClick(item)` instead of `handleOrderClick(order)`
- status dot should read `getOrderStatusDot(item.status)`
- display id should use `item.displayId`
- customer should use `item.customer`
- quantity should use `item.quantity`
- amount should use `item.amount`

- [ ] **Step 4: Add line detail component**

Create `components/order/OrderLineDetail.tsx`:

```tsx
import React from 'react';
import type { OrderLineItem } from '../../types';

interface Props {
  item: OrderLineItem;
  isDarkMode?: boolean;
  isEditing?: boolean;
  onChange: (patch: Partial<OrderLineItem>) => void;
}

const OrderLineDetail: React.FC<Props> = ({ item, isDarkMode = false, isEditing = false, onChange }) => {
  const inputClass = `w-full bg-transparent border rounded-xl px-3 py-2 text-sm ${
    isDarkMode ? 'border-white/10 text-white' : 'border-slate-200 text-slate-800'
  }`;
  const textClass = isDarkMode ? 'text-slate-100' : 'text-slate-800';

  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-1 md:grid-cols-4 overflow-hidden rounded-[28px] border backdrop-blur-xl ${isDarkMode ? 'bg-white/[0.04] border-white/[0.08]' : 'bg-white/60 border-white/60 shadow-sm'}`}>
        {[
          ['ITEM', item.displayId],
          ['STATUS', item.status],
          ['QTY', `${Number(item.quantity || 0).toLocaleString()} ${item.unit || ''}`],
          ['AMOUNT', `${item.salesCurrency || 'USD'} ${Number(item.amount || 0).toLocaleString()}`],
        ].map(([label, value]) => (
          <div key={label} className={`p-6 ${isDarkMode ? 'border-white/[0.08]' : 'border-slate-100'}`}>
            <p className={`text-[10px] font-medium tracking-[0.22em] uppercase ${isDarkMode ? 'text-white/30' : 'text-slate-400'}`}>{label}</p>
            <p className={`mt-2 text-xl font-light tracking-tight truncate ${textClass}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className={`rounded-[28px] border p-6 ${isDarkMode ? 'bg-white/[0.04] border-white/[0.08]' : 'bg-white/60 border-white/60'}`}>
        <h3 className={`text-sm font-medium mb-4 ${textClass}`}>面料项目信息</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="PO Item" value={item.displayItemNo} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ itemNo: v } as any)} />
          <Field label="客供品号" value={item.materialCode || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ materialCode: v } as any)} />
          <Field label="工厂品色号" value={item.millQuality || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ millQuality: v } as any)} />
          <Field label="描述" value={item.description || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ description: v } as any)} />
          <Field label="成分" value={item.cloth || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ cloth: v } as any)} />
          <Field label="门幅" value={item.width || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ width: v } as any)} />
          <Field label="克重" value={item.weight || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ weight: v } as any)} />
          <Field label="出厂日期" value={item.exMillDate || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ exMillDate: v } as any)} />
          <Field label="到港日期" value={item.deliveryDate || ''} readOnly={!isEditing} inputClass={inputClass} onChange={(v) => onChange({ deliveryDate: v } as any)} />
        </div>
      </div>
    </div>
  );
};

function Field({ label, value, readOnly, inputClass, onChange }: { label: string; value: string; readOnly: boolean; inputClass: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">{label}</span>
      {readOnly ? <span className="block py-2 text-sm text-slate-500">{value || '-'}</span> : <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

export default OrderLineDetail;
```

- [ ] **Step 5: Wire detail save to line API**

In `components/OrderManager.tsx`:

- keep `selectedOrder` prop for compatibility, but add local selected line state: `const [selectedLineItem, setSelectedLineItem] = useState<OrderLineItem | null>(null);`
- `handleLineClick(item)` sets `selectedLineItem` and calls `onSelectOrder(item.order)`
- detail overlay reads `selectedLineItem`
- save line edits with `updateOrderLineFields(selectedLineItem.id, patch)`
- after saving, update the matching `order.lines` element in `orders`

- [ ] **Step 6: Manual create becomes add fabric item**

In `components/OrderManager.tsx`:

- change button label to `新增面料项目`
- default draft includes `itemNo: getNextItemNo(existing lines under same PO)`
- save with `createOrderLine`
- if server returns line with parent order, merge it into `orders`

- [ ] **Step 7: Run frontend checks**

Run:

```bash
npx vitest run lib/orderLineItems.test.ts services/orderLineService.test.ts
npm run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 8: Commit**

```bash
git add components/OrderManager.tsx components/order/OrderLineDetail.tsx components/order/OrderLineForm.tsx components/order/OrderLinesTable.tsx lib/orderLineItems.test.ts
git commit -m "feat: make order management line first"
```

## Task 7: End-to-End Verification and Cleanup

**Files:**
- Read: no planned edits.

- [ ] **Step 1: Run backend tests**

Run: `cd server && npm test`

Expected: all server tests PASS.

- [ ] **Step 2: Run backend build**

Run: `cd server && npm run build`

Expected: PASS.

- [ ] **Step 3: Run frontend targeted tests**

Run:

```bash
npx vitest run lib/orderLineItems.test.ts services/orderLineService.test.ts lib/orderStatusVisuals.test.ts components/ui/MarketIntelligence.test.tsx
```

Expected: all listed tests PASS.

- [ ] **Step 4: Run frontend build**

Run: `npm run build`

Expected: PASS. Existing Vite warnings about browser-externalized Node modules and large chunks can remain if build exits 0.

- [ ] **Step 5: Manual browser check**

Run: `npm run dev`

Open the local URL shown by Vite. Check:

- Order table shows one row per fabric item.
- A multi-line PO displays different item numbers, such as `0010` and `0020`.
- Clicking the second line opens second-line details.
- Status dot changes per line.
- Manual add button says `新增面料项目`.
- Creating another line under an existing PO defaults to the next item number.

- [ ] **Step 6: Record verification result**

Run: `git status --short`

Expected: no unexpected files from the verification commands. Do not create a commit in this task unless an earlier command failed and a concrete fix was made in the affected task's files.

## Self-Review

Spec coverage:

- PO as header only: covered by Tasks 4 and 6.
- OrderLine as table/detail primary object: covered by Tasks 1 and 6.
- PDF import one PO to multiple lines: covered by Task 3.
- Manual one fabric item at a time: covered by Tasks 4, 5, and 6.
- `0010/0020` with `0011` revision behavior: covered by Tasks 1 and 2.
- Imported `00010` display as `0010`: covered by Tasks 1 and 2.
- Line-level status dots: covered by Task 6 and verification.
- Re-import line preservation: covered by Task 3.

Placeholder scan: no deferred implementation markers are intended in this plan.

Type consistency: shared frontend type is `OrderLineItem`; database model remains `OrderLine`; helper names are `displayItemNo`, `getNextItemNo`, `normalizeItemNoForDisplay`, and `nextItemNo`.
