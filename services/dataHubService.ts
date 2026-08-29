import { Insight, KnowledgeItem, Order, ProductAsset, ProductSubCategory, Relation, Invoice, PaymentVoucher, Shipment, DevelopmentCase } from '../types';
import { apiService } from './apiService';

export type DataHubMode = 'offline' | 'online' | 'syncing' | 'degraded';

export type DataHubEntity = 'orders' | 'relations' | 'knowledge' | 'products' | 'product-categories' | 'insights' | 'invoices' | 'payment-vouchers' | 'shipments' | 'development';

export interface DataHubSnapshot {
  orders: Order[];
  knowledge: KnowledgeItem[];
  insights: Insight[];
  relations: Relation[];
  products: ProductAsset[];
  productCategories: ProductSubCategory[];
  invoices: Invoice[];
  paymentVouchers: PaymentVoucher[];
  shipments: Shipment[];
  developmentCases: DevelopmentCase[];
  /** 列表分页元信息：orders 快照取首页（limit=500），total 供订单页「加载更多」判断截断 */
  meta?: { ordersTotal?: number };
}

const DATA_CHANGE_ENTITIES = new Set<DataHubEntity>([
  'orders',
  'relations',
  'knowledge',
  'products',
  'product-categories',
  'insights',
  'invoices',
  'payment-vouchers',
  'shipments',
  'development',
]);

const requireArray = <T>(value: T[] | null, entity: DataHubEntity): T[] => {
  if (!Array.isArray(value)) throw new Error(`${entity} data center request failed`);
  return value;
};

/**
 * 快照循环拉全：发票/凭证/运单/开发案后端默认 50 截断（take 上限 200），
 * 逐页拉取直至取尽，消除快照口径缺数。
 */
const SNAPSHOT_PAGE_SIZE = 200;
const pullAllPages = async <T>(fetchPage: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> => {
  const all: T[] = [];
  let offset = 0;
  for (let page = 0; page < 500; page += 1) {
    const { items, total } = await fetchPage(SNAPSHOT_PAGE_SIZE, offset);
    all.push(...items);
    if (items.length === 0 || all.length >= total) break;
    offset += items.length;
  }
  return all;
};

export const dataHubService = {
  async pullSnapshot(endpoint: string): Promise<DataHubSnapshot> {
    const [ordersPage, knowledge, insights, relations, products, productCategories, invoices, paymentVouchers, shipments, developmentCases] = await Promise.all([
      apiService.listOrdersPage(endpoint, { limit: 500 }),
      apiService.fetchCloudData<KnowledgeItem[]>('/api/knowledge', endpoint),
      apiService.fetchCloudData<Insight[]>('/api/insights', endpoint),
      apiService.listRelations(endpoint),
      apiService.listProducts(endpoint),
      apiService.fetchCloudData<ProductSubCategory[]>('/api/product-categories', endpoint),
      pullAllPages((limit, offset) => apiService.listInvoicesPage(endpoint, { limit, offset })),
      pullAllPages((limit, offset) => apiService.listPaymentVouchersPage(endpoint, { limit, offset })),
      pullAllPages((limit, offset) => apiService.listShipmentsPage(endpoint, { limit, offset })),
      pullAllPages((limit, offset) => apiService.listDevelopmentCasesPage(endpoint, { limit, offset })),
    ]);

    const snapshot: DataHubSnapshot = {
      orders: ordersPage.items,
      meta: { ordersTotal: ordersPage.total },
      knowledge: requireArray(knowledge, 'knowledge'),
      insights: requireArray(insights, 'insights'),
      relations: Array.isArray(relations) ? relations : [],
      products: Array.isArray(products) ? products : [],
      productCategories: requireArray(productCategories, 'product-categories'),
      invoices,
      paymentVouchers,
      shipments,
      developmentCases,
    };
    return snapshot;
  },

  async loadOrders(endpoint?: string): Promise<Order[]> {
    const rows = await apiService.listOrders(endpoint);
    return rows.filter((order: any) => !order.deletedAt);
  },

  async loadRelations(endpoint?: string): Promise<Relation[]> {
    const rows = await apiService.listRelations(endpoint);
    return rows.filter((relation: any) => !relation.deletedAt);
  },

  async pushLegacyData(path: string, endpoint: string, data: unknown): Promise<boolean> {
    return apiService.postCloudData(path, endpoint, data);
  },

  subscribe(
    endpoint: string | undefined,
    onDataChange: () => void,
    options: { debounceMs?: number } = {},
  ): () => void {
    const debounceMs = options.debounceMs ?? 800;
    let timer: number | undefined;
    const stop = apiService.subscribeToDataChanges(endpoint, (event) => {
      if (!DATA_CHANGE_ENTITIES.has(event.entity as DataHubEntity)) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(onDataChange, debounceMs);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      stop();
    };
  },
};
