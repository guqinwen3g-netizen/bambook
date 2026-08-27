import { View } from '../types';

export type ViewPermissionPolicy = 'public-authenticated' | 'permission' | 'dev-only' | 'role';

export type ViewPermissionDefinition = {
  policy: ViewPermissionPolicy;
  required?: string;
  roles?: readonly string[];
};

export const VIEW_PERMISSION_DEFINITIONS = {
  [View.Dashboard]: { policy: 'public-authenticated' },
  [View.Cockpit]: { policy: 'permission', required: 'finance:read' },
  [View.Assistant]: { policy: 'permission', required: 'ai:chat' },
  [View.Relations]: { policy: 'permission', required: 'relations:read' },
  [View.Products]: { policy: 'permission', required: 'products:read' },
  [View.DataCenter]: { policy: 'permission', required: 'knowledge:read' },
  [View.Orders]: { policy: 'permission', required: 'orders:read' },
  [View.ProductionBoard]: { policy: 'permission', required: 'orders:read' },
  [View.Quotations]: { policy: 'permission', required: 'orders:read' },
  [View.Procurement]: { policy: 'permission', required: 'orders:read' },
  [View.Inventory]: { policy: 'permission', required: 'orders:read' },
  [View.BOM]: { policy: 'permission', required: 'orders:read' },
  [View.CRM]: { policy: 'permission', required: 'relations:read' },
  [View.Suppliers]: { policy: 'permission', required: 'relations:read' },
  [View.Seasons]: { policy: 'permission', required: 'relations:read' },
  [View.Risks]: { policy: 'permission', required: 'finance:read' },
  [View.MES]: { policy: 'permission', required: 'orders:read' },
  [View.Customs]: { policy: 'permission', required: 'orders:read' },
  [View.DocumentCenter]: { policy: 'permission', required: 'orders:read' },
  [View.Invoices]: { policy: 'permission', required: 'finance:read' },
  [View.PaymentVouchers]: { policy: 'permission', required: 'finance:read' },
  [View.Shipments]: { policy: 'permission', required: 'orders:read' },
  [View.Development]: { policy: 'permission', required: 'orders:read' },
  [View.Emails]: { policy: 'permission', required: 'emails:read' },
  [View.Settings]: { policy: 'public-authenticated' },
  [View.AccountSettings]: { policy: 'public-authenticated' },
  [View.SystemSettings]: { policy: 'public-authenticated' },
  [View.BusinessTools]: { policy: 'permission', required: 'tools:execute' },
  [View.UiLab]: { policy: 'dev-only' },
  [View.AdminPanel]: { policy: 'permission', required: 'users:read' },
  [View.HR]: { policy: 'permission', required: 'users:read' },
  [View.QcWorkbench]: { policy: 'permission', required: 'orders:read' },
  [View.Pricing]: { policy: 'permission', required: 'finance:read' },
  [View.Marketing]: { policy: 'permission', required: 'products:read' },
  [View.Reports]: { policy: 'permission', required: 'finance:read' },
} satisfies Record<View, ViewPermissionDefinition>;

export function getViewPermissionDefinition(view: View): ViewPermissionDefinition {
  return VIEW_PERMISSION_DEFINITIONS[view];
}

export function getViewPermission(view: View): string | undefined {
  const permissions = getViewPermissionDefinition(view);
  return permissions.policy === 'permission' ? permissions.required : undefined;
}

export function isAuthenticatedPublicView(view: View): boolean {
  return getViewPermissionDefinition(view).policy === 'public-authenticated';
}

export function isDevOnlyView(view: View): boolean {
  return getViewPermissionDefinition(view).policy === 'dev-only';
}
