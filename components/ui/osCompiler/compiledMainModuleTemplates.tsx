import React from 'react';
import type { OSCompilerProvenance } from './osCompiler';

export type CompiledMainModuleId =
  | 'assistant'
  | 'development'
  | 'knowledge-base'
  | 'fabric-orders'
  | 'garment-orders'
  | 'invoices'
  | 'payment-vouchers'
  | 'quotations'
  | 'procurement'
  | 'inventory'
  | 'bom'
  | 'crm'
  | 'mes'
  | 'customs'
  | 'shipments'
  | 'emails'
  | 'business-tools'
  | 'admin-panel';

type CompiledMainModuleBlueprint = {
  version: 'bambook-os-compiler-v1';
  template: 'CompiledMainModuleSlot';
  pageId: CompiledMainModuleId;
  source: `${string}.main-app.compiler-slot`;
  provenance: OSCompilerProvenance;
  layoutMode: 'preserve-current-pixels';
  slotContract: {
    contentSlot: 'legacy-business-content';
    rule: 'The compiler owns main-app routing and provenance; complex legacy business content is mounted only as a replaceable semantic slot.';
  };
};

const MAIN_MODULE_SOURCE_BY_ID: Record<CompiledMainModuleId, CompiledMainModuleBlueprint['source']> = {
  assistant: 'Assistant.main-app.compiler-slot',
  development: 'DevelopmentManager.main-app.compiler-slot',
  'knowledge-base': 'DataTwinCenter.main-app.compiler-slot',
  'fabric-orders': 'OrderManager.main-app.compiler-slot',
  'garment-orders': 'GarmentOrders.main-app.compiler-slot',
  invoices: 'FinanceManager.invoices.main-app.compiler-slot',
  'payment-vouchers': 'FinanceManager.payment-vouchers.main-app.compiler-slot',
  quotations: 'QuotationManager.main-app.compiler-slot',
  procurement: 'ProcurementManager.main-app.compiler-slot',
  inventory: 'InventoryManager.main-app.compiler-slot',
  bom: 'BomManager.main-app.compiler-slot',
  crm: 'CrmManager.main-app.compiler-slot',
  mes: 'MesManager.main-app.compiler-slot',
  customs: 'CustomsManager.main-app.compiler-slot',
  shipments: 'ShipmentManager.main-app.compiler-slot',
  emails: 'EmailManager.main-app.compiler-slot',
  'business-tools': 'BusinessTools.main-app.compiler-slot',
  'admin-panel': 'AdminPanel.main-app.compiler-slot',
};

export const compileMainModuleSlot = (pageId: CompiledMainModuleId): CompiledMainModuleBlueprint => ({
  version: 'bambook-os-compiler-v1',
  template: 'CompiledMainModuleSlot',
  pageId,
  source: MAIN_MODULE_SOURCE_BY_ID[pageId],
  provenance: 'provisional',
  layoutMode: 'preserve-current-pixels',
  slotContract: {
    contentSlot: 'legacy-business-content',
    rule: 'The compiler owns main-app routing and provenance; complex legacy business content is mounted only as a replaceable semantic slot.',
  },
});

export type CompiledMainModuleSlotProps = {
  pageId: CompiledMainModuleId;
  children: React.ReactNode;
  className?: string;
};

export const CompiledMainModuleSlot = ({
  pageId,
  children,
  className = 'contents',
}: CompiledMainModuleSlotProps) => {
  const blueprint = compileMainModuleSlot(pageId);

  return (
    <div
      data-os-compiler-template={blueprint.template}
      data-os-compiler-source={blueprint.source}
      data-os-compiler-provenance={blueprint.provenance}
      data-os-compiler-role="main-module-slot"
      data-os-compiler-page-id={blueprint.pageId}
      data-os-compiler-layout-mode={blueprint.layoutMode}
      data-os-compiler-slot={blueprint.slotContract.contentSlot}
      className={className}
    >
      {children}
    </div>
  );
};
