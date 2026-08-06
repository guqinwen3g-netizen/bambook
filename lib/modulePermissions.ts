import { View } from '../types';

export type ViewPermissionPolicy = 'public-authenticated' | 'permission' | 'dev-only' | 'role';

export type ViewPermissionDefinition = {
  policy: ViewPermissionPolicy;
  required?: string;
  roles?: readonly string[];
};

export const VIEW_PERMISSION_DEFINITIONS = {
  [View.Dashboard]: { policy: 'public-authenticated' },
  [View.Assistant]: { policy: 'permission', required: 'ai:chat' },
  [View.Relations]: { policy: 'permission', required: 'relations:read' },
  [View.Products]: { policy: 'permission', required: 'products:read' },
  [View.KnowledgeBase]: { policy: 'permission', required: 'knowledge:read' },
  [View.Orders]: { policy: 'permission', required: 'orders:read' },
  [View.Quotations]: { policy: 'permission', required: 'orders:read' },
  [View.Procurement]: { policy: 'permission', required: 'orders:read' },
  [View.Inventory]: { policy: 'permission', required: 'orders:read' },
  [View.BOM]: { policy: 'permission', required: 'orders:read' },
  [View.Invoices]: { policy: 'public-authenticated' },
  [View.PaymentVouchers]: { policy: 'public-authenticated' },
  [View.Shipments]: { policy: 'public-authenticated' },
  [View.Development]: { policy: 'public-authenticated' },
  [View.Emails]: { policy: 'permission', required: 'emails:read' },
  [View.Settings]: { policy: 'public-authenticated' },
  [View.AccountSettings]: { policy: 'public-authenticated' },
  [View.SystemSettings]: { policy: 'public-authenticated' },
  [View.BusinessTools]: { policy: 'permission', required: 'tools:execute' },
  [View.UiLab]: { policy: 'dev-only' },
  [View.AdminPanel]: { policy: 'permission', required: 'users:read' },
  [View.HR]: { policy: 'permission', required: 'users:read' },
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
