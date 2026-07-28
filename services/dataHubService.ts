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

export const dataHubService = {
  async pullSnapshot(endpoint: string): Promise<DataHubSnapshot> {
    const [orders, knowledge, insights, relations, products, productCategories, invoices, paymentVouchers, shipments, developmentCases] = await Promise.all([
      apiService.listOrders(endpoint),
      apiService.fetchCloudData<KnowledgeItem[]>('/api/knowledge', endpoint),
      apiService.fetchCloudData<Insight[]>('/api/insights', endpoint),
      apiService.listRelations(endpoint),
      apiService.listProducts(endpoint),
      apiService.fetchCloudData<ProductSubCategory[]>('/api/product-categories', endpoint),
      apiService.listInvoices(endpoint),
      apiService.listPaymentVouchers(endpoint),
      apiService.listShipments(endpoint),
      apiService.listDevelopmentCases(endpoint),
    ]);

    const snapshot: DataHubSnapshot = {
      orders: Array.isArray(orders) ? orders : [],
      knowledge: requireArray(knowledge, 'knowledge'),
      insights: requireArray(insights, 'insights'),
      relations: Array.isArray(relations) ? relations : [],
      products: Array.isArray(products) ? products : [],
      productCategories: requireArray(productCategories, 'product-categories'),
      invoices: Array.isArray(invoices) ? invoices : [],
      paymentVouchers: Array.isArray(paymentVouchers) ? paymentVouchers : [],
      shipments: Array.isArray(shipments) ? shipments : [],
      developmentCases: Array.isArray(developmentCases) ? developmentCases : [],
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
