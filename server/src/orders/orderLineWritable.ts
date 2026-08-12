/**
 * ERP-P1: OrderLine 可写字段共用 helper（route + Agent flow 共用，避免反向依赖 route 模块）。
 */

export const ORDER_LINE_WRITABLE_FIELDS = new Set([
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
  // Garment extension fields
  'sizeBreakdown',
  'productionSteps',
  'styleNo',
  'colorName',
  'bomItems',
  'garmentSampleStages',
]);

export function stripLineWritable(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ORDER_LINE_WRITABLE_FIELDS.has(k) || v === undefined) continue;
    out[k] = v;
  }
  return out;
}
